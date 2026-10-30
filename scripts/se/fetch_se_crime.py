#!/usr/bin/env python3
"""Reported crime per Swedish municipality and city district from Brå -> scripts/se/crime_kommun.json.

Source: Brottsförebyggande rådet (Brå), "Anmälda brott" in its statistics database
(statistik.bra.se/solwebb). Brå has no API; this drives the database's own table form
(one POST, then the result frame), which is the only place offence types are published
per municipality. Brå's published statistics may be freely reused with Brå named as the
source (bra.se, "Data från Brå").

Three figures, matching Finland's crime layers (scripts/fetch_crime_index.py):

  violent_crime_rate   BrB 3 kap. Brott mot liv och hälsa — Finland's "crimes against life
                       and health" (rikoslaki 21 luku). Mean of the yearly rates over
                       VIOLENT_YEARS, as Finland's, because a small municipality sees a
                       few dozen a year.
  property_crime_rate  BrB 8–12 kap.: theft and robbery, fraud, embezzlement, crimes
                       against creditors, criminal damage — Finland's offences against
                       property (rikoslaki 28–37 luku, robbery included). Latest year.
  crime_index          All reported offences. Latest year.
  crime_index_change_pct
                       Change in the all-offence rate from CHANGE_FROM to the latest year,
                       per municipality only — Finland's (fetch_price_crime_history.py) is
                       the municipal rate's change over the same 2020– window. Districts
                       get none: two of the twenty (Järva, Norra innerstaden) did not exist
                       before 2024, so a DeSO there carries its municipality's change.

All per 1,000 residents, from Brå's own per-100,000 rates. These are Swedish counting
rules (every offence in a report counts, including attempts), so they are never put on
Finland's scale (stopsSe; computeQualityIndices ranges each country on its own).

Brå also publishes the city districts of Stockholm, Göteborg and Malmö (20 current ones),
written under "districts" here; fetch_se_districts.py says which DeSO lies in which, and a
DeSO there carries its district's figure, every other DeSO its municipality's (is_proxy
either way). A district created later than the first violent year (Järva and Norra
innerstaden, 2024) reports 0 offences for the years before it existed: a year with no
offences at all is read as "did not exist" and left out of its mean, never as no crime.

TLS: statistik.bra.se serves the wrong intermediate certificate (GeoTrust EV RSA CA 2018,
while its own certificate is issued by DigiCert EV RSA CA G2). Browsers fetch the right
one themselves; Python does not, and fails verification. certs/digicert_ev_rsa_ca_g2.pem is
that intermediate, from cacerts.digicert.com (SHA-256 95:88:EF:74:…:DA:5A:F6:14, valid to
2030-07-02), appended to the normal CA bundle. Verification stays on.

Usage: python scripts/se/fetch_se_crime.py
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT = HERE / "crime_kommun.json"
KOMMUNER = HERE / "kommuner.json"
DISTRICTS = HERE / "deso_district.json"
INTERMEDIATE = HERE / "certs" / "digicert_ev_rsa_ca_g2.pem"
ROOT = "https://statistik.bra.se/solwebb/action"
BASE = f"{ROOT}/anmalda/urval"
# "Årsvis - Kommun och storstädernas stadsområden 1996-", by offence type.
MENU_ID = 101
HEADERS = {"User-Agent": "naapurustot.fi data pipeline (+https://naapurustot.fi)"}

TOTAL = "5036"            # Totalt antal brott
VIOLENT = "11090"         # 3 kap. Brott mot liv och hälsa
PROPERTY = ["11095", "11096", "11097", "11098", "11099"]  # 8–12 kap.
VIOLENT_YEARS = 5
CHANGE_FROM = 2020
# Finland's floor (fetch_crime_index.CATEGORY_MIN_POPULATION). No Swedish municipality is
# under it today; kept so a figure never rests on a handful of incidents.
MIN_POPULATION = 2000
# Brå's form refuses more than this many cells in one table.
MAX_CELLS = 10_000


def ca_bundle() -> str:
    """The normal CA bundle plus Brå's missing intermediate, as a temporary file."""
    base = os.environ.get("REQUESTS_CA_BUNDLE") or requests.certs.where()
    f = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
    f.write(Path(base).read_text() + "\n" + INTERMEDIATE.read_text())
    f.close()
    return f.name


def latin1(res: requests.Response) -> str:
    res.raise_for_status()
    return res.content.decode("iso-8859-1")


def js_entries(page: str, name: str) -> list[list[str]]:
    """The form page's `name[i]="a*b*c";` arrays, split on Brå's `*` separator."""
    rows = re.findall(rf'{name}\[\d+\]="([^"]*)";', page)
    return [r.replace("\\xA0", " ").split("*") for r in rows]


def municipality_ids(page: str) -> dict[str, str]:
    """Brå region id -> SCB municipality code, matched by name. Fails unless all 290 match."""
    code_of = {name: code for code, name in json.loads(KOMMUNER.read_text()).items()}
    out: dict[str, str] = {}
    for rid, label in ((r[0], r[1]) for r in js_entries(page, "arrayRegionNivaEtt")):
        # "Ale kommun"; Heby is listed twice, once per county it has belonged to.
        m = re.fullmatch(r"(.+) kommun(?: \(Uppsala län from 2007\))?", label)
        if m and m.group(1) in code_of:
            out[rid] = code_of[m.group(1)]
    missing = set(code_of.values()) - set(out.values())
    if missing or len(out) != len(code_of):
        raise SystemExit(f"matched {len(out)} Brå municipalities to {len(code_of)} SCB codes; "
                         f"unmatched SCB codes: {sorted(missing)}")
    return out


def district_ids(page: str) -> dict[str, str]:
    """Brå region id -> district name, for every district fetch_se_districts.py assigns."""
    wanted = set(json.loads(DISTRICTS.read_text()).values())
    out = {r[0]: r[1].strip() for r in js_entries(page, "arrayRegionNivaEtt") if r[1].strip() in wanted}
    if set(out.values()) != wanted:
        raise SystemExit(f"Brå lists no district named {sorted(wanted - set(out.values()))}")
    return out


def year_ids(page: str) -> dict[int, str]:
    return {int(r[1]): r[0] for r in js_entries(page, "arrayPeriod") if r[2] == "311"}


def table(s: requests.Session, ca: str, offences: list[str], regions: list[str], periods: list[str]) -> dict:
    """{(period, offence, region, 'antal'|'antal_100'): int} for one table."""
    cells = len(offences) * len(regions) * len(periods) * 2
    if cells > MAX_CELLS:
        raise ValueError(f"{cells} cells exceeds Brå's {MAX_CELLS}")
    form = {
        "brottstyp_id_string": "*".join(offences),
        "region_id_string": "*".join(regions),
        "period_id_string": "*".join(periods),
        "fordelning_id_string": "",
        "antal": "1",
        "antal_100k": "1",
    }
    latin1(s.post(f"{BASE}/vantapopup", data=form, timeout=120, verify=ca))
    latin1(s.get(f"{BASE}/sok", timeout=300, verify=ca))
    page = latin1(s.get(f"{BASE}/soktabell", timeout=300, verify=ca))
    out = {}
    for period, offence, region, measure, raw in re.findall(
            r'headers="(\d+) 311 (\d+) (\d+) (antal|antal_100)">([^<]*)<', page):
        v = html.unescape(raw).replace("\xa0", "").replace(" ", "").strip()
        if not v.isdigit():
            raise SystemExit(f"unexpected cell {raw!r} for region {region}, offence {offence}")
        out[(period, offence, region, measure)] = int(v)
    expected = len(offences) * len(regions) * len(periods) * 2
    if len(out) != expected:
        raise SystemExit(f"Brå returned {len(out)} of {expected} cells — refusing to write a partial table")
    return out


def main() -> None:
    s = requests.Session()
    s.headers.update(HEADERS)
    # Per request, not s.verify: requests lets REQUESTS_CA_BUNDLE override a session's.
    ca = ca_bundle()
    # The form errors ("Ingen menykatalog har valts") unless the session has opened the
    # table catalogue first, as the site's own start page does.
    latin1(s.get(f"{ROOT}/start", params={"menykatalogid": 1}, timeout=60, verify=ca))
    form_page = latin1(s.get(f"{BASE}/urval", params={"menyid": MENU_ID}, timeout=60, verify=ca))
    kommuner = municipality_ids(form_page)
    districts = district_ids(form_page)
    years = year_ids(form_page)
    latest = max(years)
    violent_years = list(range(latest - VIOLENT_YEARS + 1, latest + 1))
    rids = sorted(kommuner) + sorted(districts)

    violent = table(s, ca, [VIOLENT, TOTAL], rids, [years[y] for y in violent_years])
    latest_t = table(s, ca, [TOTAL, *PROPERTY], rids, [years[latest]])
    change_t = table(s, ca, [TOTAL], sorted(kommuner), [years[CHANGE_FROM]])
    p = years[latest]

    out: dict[str, dict] = {}
    by_district: dict[str, dict] = {}
    withheld = []
    for rid in rids:
        total_n, total_r = latest_t[(p, TOTAL, rid, "antal")], latest_t[(p, TOTAL, rid, "antal_100")]
        population = round(total_n * 100_000 / total_r) if total_r else 0
        existed = [y for y in violent_years if violent[(years[y], TOTAL, rid, "antal")] > 0]
        if latest not in existed:
            raise SystemExit(f"region {rid}: no offences recorded in {latest}")
        rec = {
            "crime_index": round(total_r / 100, 1),
            "violent_crime_rate": round(
                sum(violent[(years[y], VIOLENT, rid, "antal_100")] for y in existed) / len(existed) / 100, 1),
            "property_crime_rate": round(sum(latest_t[(p, o, rid, "antal_100")] for o in PROPERTY) / 100, 1),
            "violent_count": sum(violent[(years[y], VIOLENT, rid, "antal")] for y in existed),
            "total_count": total_n,
            "population": population,
        }
        if existed != violent_years:
            rec["violent_years"] = existed
        if population < MIN_POPULATION:
            withheld.append(rid)
            rec["violent_crime_rate"] = rec["property_crime_rate"] = None
        if rid in kommuner:
            before = change_t[(years[CHANGE_FROM], TOTAL, rid, "antal_100")]
            if before == 0:
                raise SystemExit(f"region {rid}: no offences recorded in {CHANGE_FROM}")
            rec["crime_index_change_pct"] = round((total_r - before) / before * 100, 1)
            out[kommuner[rid]] = rec
        else:
            by_district[districts[rid]] = rec

    OUT.write_text(json.dumps({
        "source": "Brå, Anmälda brott (statistik.bra.se), per kommun och storstädernas stadsområden",
        "latest_year": latest,
        "violent_years": violent_years,
        "change_from": CHANGE_FROM,
        "withheld_under_population": MIN_POPULATION,
        "kommuner": dict(sorted(out.items())),
        "districts": dict(sorted(by_district.items())),
    }, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    v = sorted(r["violent_crime_rate"] for r in out.values() if r["violent_crime_rate"] is not None)
    print(f"wrote {OUT}: {len(out)} municipalities, {len(by_district)} districts "
          f"({len(withheld)} withheld), violent "
          f"{violent_years[0]}–{violent_years[-1]} per 1,000: min {v[0]}, median {v[len(v) // 2]}, "
          f"max {v[-1]}", file=sys.stderr)


if __name__ == "__main__":
    main()
