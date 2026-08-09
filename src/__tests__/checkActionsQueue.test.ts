import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs build script with no type declarations
import { IN_FLIGHT, DEFAULT_STUCK_MINUTES, minutesSince, inFlightRuns, findWedgedDeployJob, buildVerdict } from '../../scripts/check-actions-queue.mjs';

/**
 * Tests for the pre-push Actions queue check (scripts/check-actions-queue.mjs).
 *
 * The two behaviours worth pinning are the ones that were costing manual work:
 * recognising an in-flight auto-merge (pushing over it cancels it silently), and
 * recognising the wedged-deploy signature that deploy.yml's deploy-watchdog acts on.
 * Both are keyed on real API shapes observed on 2026-08-09; see the script's comments.
 */

const NOW = Date.parse('2026-08-09T12:39:00Z');

function run(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'claude/example',
    head_sha: 'abcdef1234567890',
    created_at: '2026-08-09T12:30:00Z',
    html_url: 'https://github.com/o/r/actions/runs/1',
    ...over,
  };
}

describe('minutesSince', () => {
  it('measures elapsed minutes', () => {
    expect(minutesSince('2026-08-09T12:09:00Z', NOW)).toBe(30);
  });

  it('clamps clock skew and missing timestamps to zero rather than going negative', () => {
    expect(minutesSince('2026-08-09T12:45:00Z', NOW)).toBe(0);
    expect(minutesSince(undefined, NOW)).toBe(0);
    expect(minutesSince('not-a-date', NOW)).toBe(0);
  });
});

describe('inFlightRuns', () => {
  it("treats a concurrency-gated run as in flight — GitHub reports it as 'pending', not 'queued'", () => {
    expect(IN_FLIGHT.has('pending')).toBe(true);
    const runs = [run({ status: 'pending' }), run({ id: 2, status: 'completed' })];
    expect(inFlightRuns(runs).map((r: { id: number }) => r.id)).toEqual([1]);
  });

  it('ignores completed runs and tolerates a missing list', () => {
    expect(inFlightRuns([run()])).toEqual([]);
    expect(inFlightRuns(undefined)).toEqual([]);
  });
});

describe('findWedgedDeployJob', () => {
  /** The shape observed on the wedged job 93229767509: queued, runner_id 0, no steps. */
  const wedgedJob = {
    id: 93229767509,
    name: 'deploy',
    status: 'queued',
    runner_id: 0,
    created_at: '2026-08-09T12:06:23Z',
    started_at: '2026-08-09T12:06:23Z',
    html_url: 'https://github.com/o/r/actions/runs/2/job/93229767509',
  };

  it('flags a deploy job queued past the threshold with no runner', () => {
    const hit = findWedgedDeployJob([wedgedJob], NOW);
    expect(hit).toMatchObject({ id: 93229767509, waitedMinutes: 33 });
  });

  it('does not flag a job that has only just been queued', () => {
    const fresh = { ...wedgedJob, started_at: '2026-08-09T12:38:00Z' };
    expect(findWedgedDeployJob([fresh], NOW)).toBeNull();
  });

  it('does not flag a job that already holds a runner — that one is starting, not stuck', () => {
    const assigned = { ...wedgedJob, runner_id: 1000007375 };
    expect(findWedgedDeployJob([assigned], NOW)).toBeNull();
  });

  it('ignores the build job and the watchdog itself, however long they queue', () => {
    const others = [
      { ...wedgedJob, name: 'build' },
      { ...wedgedJob, name: 'deploy-watchdog' },
    ];
    expect(findWedgedDeployJob(others, NOW)).toBeNull();
  });

  it('honours a caller-supplied threshold', () => {
    expect(findWedgedDeployJob([wedgedJob], NOW, 60)).toBeNull();
    expect(DEFAULT_STUCK_MINUTES).toBe(8);
  });
});

describe('buildVerdict', () => {
  it('reports CLEAR when nothing is in flight', () => {
    const v = buildVerdict({ autoMerge: [run()], deploy: [run({ id: 2 })] }, NOW);
    expect(v.code).toBe(0);
    expect(v.state).toBe('clear');
  });

  it('reports BUSY for an in-flight auto-merge, because a push would cancel it', () => {
    const v = buildVerdict({ autoMerge: [run({ status: 'in_progress' })] }, NOW);
    expect(v.code).toBe(1);
    expect(v.lines.join('\n')).toContain('claude/example');
  });

  it('does not call an in-flight deploy busy — deploys queue safely behind each other', () => {
    const v = buildVerdict({ deploy: [run({ status: 'in_progress' })] }, NOW);
    expect(v.code).toBe(0);
    expect(v.lines.join('\n')).toContain('deploy');
  });

  it('ranks a wedge above a busy auto-merge — it is the state that needs intervention', () => {
    const v = buildVerdict(
      {
        autoMerge: [run({ status: 'in_progress' })],
        deploy: [run({ id: 2, status: 'in_progress' })],
        wedged: [{ runId: 2, waitedMinutes: 33 }],
      },
      NOW,
    );
    expect(v.code).toBe(2);
    expect(v.state).toBe('wedged');
    expect(v.lines.join('\n')).toContain('cancel run 2');
  });
});
