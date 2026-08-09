#!/usr/bin/env node
/**
 * "Is the Actions queue clear enough to push?" — a pre-push check for sessions.
 *
 * Several Claude sessions share this repo, and two of the pipelines they trigger
 * interfere when they overlap:
 *
 *   1. auto-merge.yml runs under `concurrency: auto-merge-to-main` with
 *      `cancel-in-progress: true`. Pushing a second `claude/*` branch while a first
 *      one is still in its gate CANCELS that first run — the branch is left unmerged
 *      with a green-looking history and nothing says so. CLAUDE.md documents this
 *      ("serialize or stack branches"), but a doc note is not enforceable; this is.
 *
 *   2. deploy.yml runs under `concurrency: pages` with `cancel-in-progress: false`,
 *      so deploys queue instead of superseding. That is the correct ordering choice,
 *      but it means one wedged deploy stops every later one. The wedge is real and
 *      recurring — see findWedgedDeployJob below for the measured signature.
 *
 * Usage:
 *   node scripts/check-actions-queue.mjs              report once, exit code = verdict
 *   node scripts/check-actions-queue.mjs --wait       block until clear (default 30 min)
 *   node scripts/check-actions-queue.mjs --unstick    cancel a wedged deploy run
 *   node scripts/check-actions-queue.mjs --json       machine-readable output
 *
 * Exit codes: 0 clear, 1 auto-merge in flight (do not push), 2 wedged deploy,
 *             3 could not determine (gh missing / API error).
 *
 * Requires the `gh` CLI, authenticated. `jq` is NOT required — this parses JSON in
 * Node, because standalone jq is not installed on the dev machine (CLAUDE.md).
 */

import { execFileSync } from 'node:child_process';

export const AUTO_MERGE_WORKFLOW = 'auto-merge.yml';
export const DEPLOY_WORKFLOW = 'deploy.yml';

/**
 * Run/job states that mean "not finished". `pending` is the one that matters most and
 * is easy to miss: a run held at a concurrency gate reports `pending`, not `queued`.
 */
export const IN_FLIGHT = new Set(['queued', 'in_progress', 'pending', 'waiting', 'requested']);

/**
 * How long deploy.yml's `deploy` job may sit in `queued` before we call it wedged.
 *
 * The healthy transition is ~3 seconds (build completes -> deploy starts). Anything
 * past a few minutes is not a slow runner: the sibling `build` job on this repo is
 * assigned a runner in 2-3 s every time, so a `deploy` job with no runner is waiting
 * on the `github-pages` environment, not on capacity.
 */
export const DEFAULT_STUCK_MINUTES = 8;

/** Minutes between an ISO timestamp and `now` (ms). Negative clock skew clamps to 0. */
export function minutesSince(iso, now) {
  if (!iso) return 0;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (now - then) / 60000);
}

/** The subset of `runs` that has not reached a terminal state. */
export function inFlightRuns(runs) {
  return (runs ?? []).filter((r) => IN_FLIGHT.has(r.status));
}

/**
 * Detect the wedge that makes a human cancel a deploy by hand.
 *
 * Signature, measured on run 31307093810 (2026-08-09): `build` succeeded at 10:03:02,
 * the `deploy` job was created at 10:03:02 and then sat at `status: "queued"` with
 * `runner_id: 0` and NO steps array until it was cancelled at 11:47:05 — 1 h 44 m,
 * under a `timeout-minutes: 30` cap that never fired. It never fires, because
 * `timeout-minutes` measures execution and a job waiting on an environment has not
 * started executing. Nothing in the workflow can time this out.
 *
 * A job that merely lacks capacity looks different: it picks up a runner within
 * seconds here. So "queued, no runner, minutes old" is specific to the environment
 * wait, which is why this keys on `runner_id` being absent as well as on age.
 */
export function findWedgedDeployJob(jobs, now, stuckMinutes = DEFAULT_STUCK_MINUTES) {
  for (const job of jobs ?? []) {
    if (job.name !== 'deploy') continue;
    if (job.status !== 'queued') continue;
    if (job.runner_id) continue; // has a runner — genuinely starting, not wedged
    const waited = minutesSince(job.started_at ?? job.created_at, now);
    if (waited >= stuckMinutes) {
      return { id: job.id, waitedMinutes: Math.round(waited), url: job.html_url };
    }
  }
  return null;
}

/**
 * Turn the gathered state into a verdict.
 *
 * An in-flight auto-merge is a hard "do not push" (a push cancels it). An in-flight
 * deploy is only informational — deploys queue safely and a push does not disturb
 * them. A wedged deploy outranks both: it is the one state that needs a human (or
 * deploy.yml's own deploy-watchdog job) to intervene.
 */
export function buildVerdict({ autoMerge = [], deploy = [], wedged = [] }, now) {
  const lines = [];
  const busyAutoMerge = inFlightRuns(autoMerge);
  const busyDeploy = inFlightRuns(deploy);

  for (const run of busyAutoMerge) {
    lines.push(
      `auto-merge  ${run.status.padEnd(11)} ${run.head_branch} ` +
        `(${Math.round(minutesSince(run.created_at, now))}m) ${run.html_url}`,
    );
  }
  for (const run of busyDeploy) {
    lines.push(
      `deploy      ${run.status.padEnd(11)} ${(run.head_sha ?? '').slice(0, 7)} ` +
        `(${Math.round(minutesSince(run.created_at, now))}m) ${run.html_url}`,
    );
  }
  for (const w of wedged) {
    lines.push(
      `WEDGED      deploy job queued ${w.waitedMinutes}m with no runner — ` +
        `the github-pages environment is stuck; cancel run ${w.runId} to release it`,
    );
  }

  if (wedged.length > 0) {
    return { code: 2, state: 'wedged', lines, busyAutoMerge, busyDeploy, wedged };
  }
  if (busyAutoMerge.length > 0) {
    return { code: 1, state: 'busy', lines, busyAutoMerge, busyDeploy, wedged };
  }
  return { code: 0, state: 'clear', lines, busyAutoMerge, busyDeploy, wedged };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ghApi(path) {
  return JSON.parse(gh(['api', '-H', 'Accept: application/vnd.github+json', path]));
}

function repoSlug() {
  // `gh repo view` resolves the same remote gh itself would act on, so the check and
  // any --unstick cancel can never target a different repository than the caller's.
  return gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();
}

function gather(slug, stuckMinutes, now) {
  const runsOf = (wf) =>
    ghApi(`repos/${slug}/actions/workflows/${wf}/runs?per_page=20`).workflow_runs ?? [];

  const autoMerge = runsOf(AUTO_MERGE_WORKFLOW);
  const deploy = runsOf(DEPLOY_WORKFLOW);

  const wedged = [];
  for (const run of inFlightRuns(deploy)) {
    const { jobs } = ghApi(`repos/${slug}/actions/runs/${run.id}/jobs?per_page=50`);
    const hit = findWedgedDeployJob(jobs, now, stuckMinutes);
    if (hit) wedged.push({ ...hit, runId: run.id, runUrl: run.html_url });
  }
  return { autoMerge, deploy, wedged };
}

function main() {
  const argv = process.argv.slice(2);
  const wait = argv.includes('--wait');
  const unstick = argv.includes('--unstick');
  const asJson = argv.includes('--json');
  const stuckMinutes = Number(
    argv.find((a) => a.startsWith('--stuck-minutes='))?.split('=')[1] ?? DEFAULT_STUCK_MINUTES,
  );
  const waitCapMs =
    Number(argv.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? 30) * 60_000;

  let slug;
  try {
    slug = repoSlug();
  } catch {
    console.error('check-actions-queue: `gh` is unavailable or not authenticated.');
    process.exit(3);
  }

  const startedAt = Date.now();
  for (;;) {
    let state;
    try {
      state = gather(slug, stuckMinutes, Date.now());
    } catch (err) {
      console.error(`check-actions-queue: GitHub API call failed — ${err.message}`);
      process.exit(3);
    }

    const verdict = buildVerdict(state, Date.now());

    if (unstick && verdict.wedged.length > 0) {
      for (const w of verdict.wedged) {
        console.log(`cancelling wedged deploy run ${w.runId} (${w.runUrl})`);
        gh(['api', '-X', 'POST', `repos/${slug}/actions/runs/${w.runId}/cancel`]);
      }
      // The run behind it starts within seconds (measured: cancel 11:47:05 ->
      // next run's build started 11:47:08), so re-read rather than reporting stale.
      continue;
    }

    if (asJson) {
      console.log(JSON.stringify({ state: verdict.state, ...state }, null, 2));
    } else {
      console.log(verdict.lines.length ? verdict.lines.join('\n') : 'nothing in flight');
      console.log(
        verdict.code === 0
          ? '\nCLEAR — safe to push a claude/* branch.'
          : verdict.code === 1
            ? '\nBUSY — pushing now cancels the in-flight auto-merge. Wait, or use --wait.'
            : '\nWEDGED — a deploy is stuck on the github-pages environment. Re-run with --unstick.',
      );
    }

    // Only an in-flight auto-merge is worth waiting out. A wedge does not clear on its
    // own, so blocking on it would just burn the timeout.
    if (!wait || verdict.code !== 1) process.exit(verdict.code);
    if (Date.now() - startedAt > waitCapMs) {
      console.error('\ncheck-actions-queue: still busy at the --timeout cap; not waiting further.');
      process.exit(verdict.code);
    }
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},20000)']); // 20 s sleep
  }
}

if (process.argv[1] && process.argv[1].endsWith('check-actions-queue.mjs')) {
  main();
}
