#!/usr/bin/env python3
"""Shared helpers for the Statistics Finland (StatFin) PxWeb API.

Why this exists
---------------
StatFin has renamed both halves of its PxWeb addressing scheme:

* table paths lost their database prefix — ``statfin_rpk_pxt_13h4.px`` is now
  just ``13h4.px``; the old path returns HTTP 400.
* variable codes were replaced with versioned identifiers — ``Vuosi`` became
  ``timeperiod_y``, ``Alue``/``Kunta`` became ``alue_28_20210101``, and
  ``Rikosryhmä ja teonkuvauksen tarkenne`` became ``rikokset_74_20211209``.

Both renames are silent from the caller's point of view: the fetch fails, the
caller falls back to whatever it already had on disk, and the shipped data
quietly freezes at the last year the old codes worked. That is exactly how the
crime layer's capital-region values got stranded on a 2026-03 snapshot while
the rest of the country moved on.

So resolve variables by *what they contain* rather than by what they are
called, and try both table-path shapes. A future rename then costs nothing.
"""

from __future__ import annotations

import logging
import re
import time

import requests

logger = logging.getLogger(__name__)

PXWEB_BASE = "https://pxdata.stat.fi/PxWeb/api/v1"

_YEAR_RE = re.compile(r"^(19|20)\d{2}$")


def table_url_candidates(database: str, table_id: str, lang: str = "en") -> list[str]:
    """Return the current and legacy PxWeb URLs for a table, current first.

    ``database`` is the StatFin sub-database (e.g. ``rpk``), ``table_id`` the
    bare table id (e.g. ``13h4``).
    """
    root = f"{PXWEB_BASE}/{lang}/StatFin/{database}"
    return [
        f"{root}/{table_id}.px",
        f"{root}/statfin_{database}_pxt_{table_id}.px",
    ]


def fetch_table_meta(
    database: str,
    table_id: str,
    *,
    lang: str = "en",
    timeout: int = 60,
    retries: int = 3,
) -> tuple[str, dict]:
    """Fetch a table's metadata, trying the current then the legacy path.

    Returns ``(url, metadata)`` for the path that worked so the caller can POST
    its query to the same URL. Raises if no candidate answers.
    """
    last_exc: Exception | None = None
    for url in table_url_candidates(database, table_id, lang=lang):
        for attempt in range(1, retries + 1):
            try:
                r = requests.get(url, timeout=timeout)
                r.raise_for_status()
                meta = r.json()
                if meta.get("variables"):
                    logger.info("  PxWeb table %s/%s resolved to %s",
                                database, table_id, url)
                    return url, meta
                raise ValueError(f"No variables in metadata from {url}")
            except requests.RequestException as exc:
                last_exc = exc
                status = getattr(exc.response, "status_code", None)
                # A 400/404 means "wrong path", not "try again" — move on.
                if status in (400, 404):
                    break
                if attempt < retries:
                    time.sleep(2 ** attempt)
            except ValueError as exc:
                last_exc = exc
                break
    raise RuntimeError(
        f"Could not resolve PxWeb table {database}/{table_id}: {last_exc}"
    )


def var_code_for_value(meta: dict, value: str) -> str:
    """Return the code of the variable whose value list contains ``value``.

    Used to locate the area / offence-group / contents variables by a value we
    know is stable (``KU091``, ``101T603``, ``rik_1000``) rather than by a
    variable code that StatFin versions and renames.
    """
    for var in meta.get("variables", []):
        if value in var.get("values", []):
            return var["code"]
    raise KeyError(
        f"No PxWeb variable contains value {value!r} "
        f"(variables: {[v.get('code') for v in meta.get('variables', [])]})"
    )


def year_var_code(meta: dict) -> str:
    """Return the code of the time variable (the one whose values are years)."""
    for var in meta.get("variables", []):
        values = var.get("values", [])
        if values and all(_YEAR_RE.match(str(v)) for v in values):
            return var["code"]
    raise KeyError("No year-like PxWeb variable found")


def available_years(meta: dict) -> list[str]:
    """Return the table's available years, ascending."""
    code = year_var_code(meta)
    for var in meta["variables"]:
        if var["code"] == code:
            return sorted(var.get("values", []))
    return []


def latest_year(meta: dict, *, prefer: str | None = None) -> str:
    """Return the newest year the table publishes.

    Pass ``prefer`` to pin a specific year; it is honoured only if the table
    actually has it, so a stale pin degrades to the latest rather than to an
    exception. Never hard-code a year list — that is what froze this pipeline.
    """
    years = available_years(meta)
    if not years:
        raise ValueError("PxWeb table exposes no years")
    if prefer and prefer in years:
        return prefer
    if prefer:
        logger.warning("  Requested year %s unavailable (have %s..%s) — using latest",
                       prefer, years[0], years[-1])
    return years[-1]
