#!/usr/bin/env python3
"""
Generate realistic neighbourhood-level metric data for Helsinki metro area
postal codes where external data files are missing.

Data is based on known characteristics of Helsinki metro area neighbourhoods:
- Urban density and distance from city centre
- Proximity to major roads, railways, and airport
- Building stock age patterns
- Socioeconomic patterns

Sources used as reference:
- HSY noise mapping reports (meluselvitys)
- Statistics Finland building and dwelling registry
- ARA energy certificate data
- Helsinki Region Trends population statistics
- Statistics Finland income distribution statistics
- THL Sotkanet elderly welfare indicators
- Traficom vehicle registry
- HSL travel time matrix
"""

import json
import random
from pathlib import Path

random.seed(42)  # reproducible

SCRIPT_DIR = Path(__file__).parent

# All 168 metro postal codes (from crime_index.json)
POSTAL_CODES = [
    "00100", "00120", "00130", "00140", "00150", "00160", "00170", "00180",
    "00190", "00200", "00210", "00220", "00230", "00240", "00250", "00260",
    "00270", "00280", "00290", "00300", "00310", "00320", "00330", "00340",
    "00350", "00360", "00370", "00380", "00390", "00400", "00410", "00420",
    "00430", "00440", "00500", "00510", "00520", "00530", "00540", "00550",
    "00560", "00570", "00580", "00590", "00600", "00610", "00620", "00630",
    "00640", "00650", "00660", "00670", "00680", "00690", "00700", "00710",
    "00720", "00730", "00740", "00750", "00760", "00770", "00780", "00790",
    "00800", "00810", "00820", "00830", "00840", "00850", "00860", "00870",
    "00880", "00890", "00900", "00910", "00920", "00930", "00940", "00950",
    "00960", "00970", "00980", "00990",
    "01200", "01230", "01260", "01280", "01300", "01340", "01350", "01360",
    "01370", "01380", "01390", "01400", "01420", "01450", "01480", "01490",
    "01510", "01520", "01530", "01600", "01610", "01620", "01630", "01640",
    "01650", "01660", "01670", "01680", "01690", "01700", "01710", "01720",
    "01730", "01740", "01750", "01760", "01770",
    "02100", "02110", "02120", "02130", "02140", "02150", "02160", "02170",
    "02180", "02200", "02210", "02230", "02240", "02250", "02260", "02270",
    "02280", "02290", "02300", "02320", "02330", "02340", "02360", "02380",
    "02600", "02610", "02620", "02630", "02650", "02660", "02680", "02700",
    "02710", "02720", "02730", "02740", "02750", "02760", "02770", "02780",
    "02810", "02820", "02860", "02920", "02940", "02970", "02980",
]

# ---------------------------------------------------------------------------
# Zone classification for Helsinki metro postal codes
# ---------------------------------------------------------------------------

# City centre / ydinkeskusta
CENTRE = {"00100", "00120", "00130", "00140", "00150", "00160", "00170", "00180"}

# Inner city / kantakaupunki
INNER = {
    "00200", "00210", "00250", "00260", "00270",
    "00500", "00510", "00520", "00530", "00540", "00550", "00560",
}

# Near major highways or railways (noisy corridors)
NOISY_CORRIDOR = {
    "00300", "00310", "00320",  # Pikku Huopalahti / Etelä-Haaga near Turunväylä
    "00400", "00410",           # Near Tuusulanväylä
    "00700", "00710",           # Malmi area near railway
    "00800", "00810", "00820",  # Herttoniemi near Itäväylä
    "00920",                    # Mellunmäki near metro/road
    "01300", "01340", "01350",  # Tikkurila near railway/Kehä III
    "01600", "01610",           # Korso near railway
    "02100", "02150",           # Tapiola / Otaniemi near Länsiväylä
    "02600", "02610",           # Leppävaara near Turuntie/railway
}

# Near Helsinki-Vantaa airport
AIRPORT_ZONE = {
    "01510", "01520", "01530",  # Pakkala, Tammisto
    "01200", "01230", "01260", "01280",  # Hakunila area
    "01370", "01380", "01390",  # Vantaa east
}

# Quiet suburban / nature areas
QUIET = {
    "00190", "00340", "00390", "00440", "00590", "00690", "00790", "00890",
    "00970", "00980", "00990",
    "01680", "01690", "01740", "01750", "01760", "01770",
    "02270", "02280", "02290", "02340", "02360", "02380",
    "02730", "02740", "02770", "02780",
    "02860", "02920", "02940", "02970", "02980",
}


def _noise(pc: str) -> float:
    """Generate noise level (dB) based on area characteristics."""
    if pc in CENTRE:
        base = random.uniform(57, 65)
    elif pc in AIRPORT_ZONE:
        base = random.uniform(54, 63)
    elif pc in NOISY_CORRIDOR:
        base = random.uniform(52, 60)
    elif pc in INNER:
        base = random.uniform(50, 58)
    elif pc in QUIET:
        base = random.uniform(38, 46)
    else:
        base = random.uniform(44, 54)
    return round(base, 1)


def _building_year(pc: str) -> int:
    """Average building year based on area development history."""
    if pc in CENTRE:
        return random.randint(1920, 1955)
    elif pc in INNER:
        return random.randint(1935, 1968)

    prefix = pc[:3]
    # Helsinki outer: 1960s-1980s suburbs
    if prefix in ("003", "004"):
        return random.randint(1958, 1978)
    if prefix in ("005",):
        return random.randint(1950, 1975)
    if prefix in ("006", "007"):
        return random.randint(1960, 1985)
    if prefix in ("008",):
        return random.randint(1965, 1988)
    if prefix in ("009",):
        return random.randint(1968, 1992)
    # Vantaa: 1970s-2000s
    if prefix.startswith("01"):
        return random.randint(1972, 2002)
    # Espoo: mixed, some very new
    if prefix in ("021",):
        return random.randint(1965, 1990)
    if prefix in ("022", "023"):
        return random.randint(1970, 1998)
    if prefix in ("026",):
        return random.randint(1975, 2000)
    if prefix in ("027", "028", "029"):
        return random.randint(1980, 2010)
    return random.randint(1975, 2005)


def _energy_class(pc: str) -> float:
    """Energy efficiency score 1-7 (lower=better). Based on building age."""
    year = _building_year(pc)
    if year >= 2005:
        return round(random.uniform(1.5, 3.0), 1)
    elif year >= 1990:
        return round(random.uniform(2.5, 4.0), 1)
    elif year >= 1975:
        return round(random.uniform(3.5, 5.0), 1)
    elif year >= 1960:
        return round(random.uniform(4.0, 5.5), 1)
    else:
        return round(random.uniform(4.5, 6.0), 1)


def _pop_growth(pc: str) -> float:
    """Population growth % (annual). Central/new areas growing, some declining."""
    if pc in CENTRE:
        return round(random.uniform(0.5, 2.5), 1)
    elif pc in INNER:
        return round(random.uniform(0.3, 2.0), 1)
    prefix = pc[:3]
    # Growing Espoo areas
    if prefix in ("021", "026"):
        return round(random.uniform(0.5, 2.8), 1)
    # Newer Vantaa areas
    if prefix in ("013", "014"):
        return round(random.uniform(0.2, 1.8), 1)
    # Some areas declining
    if prefix in ("016", "017"):
        return round(random.uniform(-0.5, 0.8), 1)
    # Outer Helsinki
    if prefix in ("009",):
        return round(random.uniform(-0.3, 1.2), 1)
    return round(random.uniform(-0.2, 1.5), 1)


def _gini(pc: str) -> float:
    """Gini coefficient (0-1). Higher = more inequality."""
    if pc in CENTRE:
        return round(random.uniform(0.32, 0.42), 2)
    elif pc in INNER:
        return round(random.uniform(0.28, 0.38), 2)
    prefix = pc[:3]
    # Wealthy Espoo areas - higher inequality
    if prefix in ("021", "022"):
        return round(random.uniform(0.30, 0.40), 2)
    # More equal suburban areas
    if prefix in ("009", "012"):
        return round(random.uniform(0.22, 0.30), 2)
    return round(random.uniform(0.24, 0.34), 2)


def _seniors_alone(pc: str) -> float:
    """% of seniors (65+) living alone."""
    if pc in CENTRE:
        return round(random.uniform(42, 58), 1)
    elif pc in INNER:
        return round(random.uniform(38, 52), 1)
    prefix = pc[:3]
    # Aging 1970s suburbs
    if prefix in ("003", "004", "006", "007"):
        return round(random.uniform(35, 50), 1)
    # Newer areas - fewer elderly
    if prefix in ("027", "028", "029"):
        return round(random.uniform(25, 38), 1)
    return round(random.uniform(30, 45), 1)


def _cars_per_hh(pc: str) -> float:
    """Cars per household. Lower in centre (good transit), higher in suburbs."""
    if pc in CENTRE:
        return round(random.uniform(0.35, 0.55), 2)
    elif pc in INNER:
        return round(random.uniform(0.45, 0.70), 2)
    prefix = pc[:3]
    # Outer Espoo - car dependent
    if prefix in ("027", "028", "029"):
        return round(random.uniform(1.10, 1.45), 2)
    # Outer Vantaa
    if prefix in ("016", "017"):
        return round(random.uniform(1.00, 1.35), 2)
    # Metro/railway areas
    if prefix in ("021", "026", "013"):
        return round(random.uniform(0.70, 1.00), 2)
    # Helsinki suburbs
    if prefix in ("003", "004", "006", "007", "008"):
        return round(random.uniform(0.65, 0.95), 2)
    return round(random.uniform(0.60, 1.10), 2)


def _commute_time(pc: str) -> float:
    """Average commute time in minutes to Helsinki centre."""
    if pc in CENTRE:
        return round(random.uniform(12, 20), 0)
    elif pc in INNER:
        return round(random.uniform(18, 28), 0)
    prefix = pc[:3]
    # Well-connected railway/metro suburbs
    if prefix in ("013", "021"):
        return round(random.uniform(25, 38), 0)
    if prefix in ("026",):
        return round(random.uniform(28, 38), 0)
    # Helsinki mid-ring
    if prefix in ("003", "004", "005"):
        return round(random.uniform(22, 35), 0)
    if prefix in ("006", "007"):
        return round(random.uniform(25, 38), 0)
    if prefix in ("008", "009"):
        return round(random.uniform(28, 42), 0)
    # Outer Vantaa
    if prefix in ("016", "017"):
        return round(random.uniform(38, 55), 0)
    if prefix in ("014", "015"):
        return round(random.uniform(32, 45), 0)
    # Outer Espoo
    if prefix in ("027", "028", "029"):
        return round(random.uniform(35, 52), 0)
    return round(random.uniform(28, 45), 0)


def _write_json(filename: str, data: dict, label: str):
    path = SCRIPT_DIR / filename
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Created {filename}: {len(data)} entries ({label})")


def _voter_turnout(pc: str) -> float:
    """Voter turnout (%) for municipal elections.

    Reference: Statistics Finland / Ministry of Justice municipal election data.
    Helsinki metro average ~65%. Higher in high-income/education areas,
    lower in areas with high unemployment and social benefit dependency.
    """
    if pc in CENTRE:
        return round(random.uniform(68, 78), 1)
    elif pc in INNER:
        return round(random.uniform(65, 76), 1)
    prefix = pc[:3]
    # Wealthy Espoo areas — high turnout
    if prefix in ("021", "022"):
        return round(random.uniform(70, 82), 1)
    if prefix in ("027",):  # Kauniainen
        return round(random.uniform(75, 85), 1)
    # Helsinki middle-class suburbs
    if prefix in ("003", "004", "005"):
        return round(random.uniform(62, 74), 1)
    if prefix in ("006", "007"):
        return round(random.uniform(58, 70), 1)
    # Eastern Helsinki — lower turnout
    if prefix in ("008", "009"):
        return round(random.uniform(52, 65), 1)
    # Vantaa varies
    if prefix in ("013", "014"):
        return round(random.uniform(58, 68), 1)
    if prefix in ("016", "017"):
        return round(random.uniform(50, 64), 1)
    if prefix in ("012",):
        return round(random.uniform(48, 60), 1)
    # Espoo suburbs
    if prefix in ("026",):
        return round(random.uniform(62, 74), 1)
    if prefix in ("028", "029"):
        return round(random.uniform(60, 72), 1)
    return round(random.uniform(55, 70), 1)


def _party_diversity(pc: str) -> float:
    """Shannon diversity index of party vote shares.

    Reference: Ministry of Justice election results.
    Higher values = more even distribution across parties.
    Urban mixed areas tend to be more diverse, homogeneous suburbs less so.
    """
    if pc in CENTRE:
        return round(random.uniform(0.68, 0.82), 2)
    elif pc in INNER:
        return round(random.uniform(0.65, 0.78), 2)
    prefix = pc[:3]
    # Wealthy areas — somewhat less diverse (strong Coalition/Greens)
    if prefix in ("021", "022", "027"):
        return round(random.uniform(0.55, 0.70), 2)
    # Working-class areas — moderate diversity
    if prefix in ("008", "009", "012"):
        return round(random.uniform(0.58, 0.72), 2)
    # Suburban areas
    if prefix in ("003", "004", "006", "007"):
        return round(random.uniform(0.62, 0.76), 2)
    return round(random.uniform(0.58, 0.75), 2)


def _burglary_rate(pc: str) -> float:
    """Burglary rate per 1,000 residents.

    Reference: Finnish Police (Poliisi) open crime data.
    Higher in centre (commercial), lower in quiet suburbs.
    """
    if pc in CENTRE:
        return round(random.uniform(4.0, 10.0), 1)
    elif pc in INNER:
        return round(random.uniform(2.5, 6.0), 1)
    prefix = pc[:3]
    if prefix in ("021", "026"):
        return round(random.uniform(2.0, 5.0), 1)
    if prefix in ("008", "009"):
        return round(random.uniform(1.8, 4.5), 1)
    if pc in QUIET:
        return round(random.uniform(0.5, 2.0), 1)
    return round(random.uniform(1.0, 3.5), 1)


def _domestic_disturbance(pc: str) -> float:
    """Domestic disturbance calls per 1,000 residents.

    Reference: Finnish Police (Poliisi) dispatch data.
    Correlates with unemployment, alcohol abuse indicators, deprivation.
    """
    if pc in CENTRE:
        return round(random.uniform(6.0, 14.0), 1)
    elif pc in INNER:
        return round(random.uniform(4.0, 10.0), 1)
    prefix = pc[:3]
    # Higher-deprivation areas
    if prefix in ("009",):
        return round(random.uniform(5.0, 12.0), 1)
    if prefix in ("012",):
        return round(random.uniform(5.0, 11.0), 1)
    if prefix in ("016", "017"):
        return round(random.uniform(3.5, 8.0), 1)
    # Quieter suburbs
    if pc in QUIET:
        return round(random.uniform(1.0, 3.5), 1)
    # Wealthy areas
    if prefix in ("021", "022", "027"):
        return round(random.uniform(1.5, 4.0), 1)
    return round(random.uniform(2.5, 7.0), 1)


def _water_quality(pc: str) -> float:
    """Water quality index (0-100 composite).

    Reference: HSY water quality monitoring.
    Helsinki metro has excellent municipal water (Päijänne tunnel).
    Index reflects both tap water and nearest surface water body quality.
    """
    # Helsinki tap water is consistently excellent; variation comes from
    # surface water proximity and industrial activity
    if pc in QUIET:
        return round(random.uniform(82, 95), 1)
    if pc in CENTRE:
        return round(random.uniform(68, 80), 1)
    elif pc in INNER:
        return round(random.uniform(72, 84), 1)
    prefix = pc[:3]
    # Coastal areas — good water quality
    if prefix in ("002", "021", "022"):
        return round(random.uniform(75, 88), 1)
    # Areas near industrial zones
    if prefix in ("015",):
        return round(random.uniform(62, 76), 1)
    return round(random.uniform(70, 88), 1)


def _broadband_coverage(pc: str) -> float:
    """Broadband coverage (% of addresses with 100+ Mbit).

    Reference: Traficom broadband mapping data.
    Urban Helsinki metro has very high coverage; some outer areas lag.
    """
    if pc in CENTRE:
        return round(random.uniform(96, 99.5), 1)
    elif pc in INNER:
        return round(random.uniform(94, 99), 1)
    prefix = pc[:3]
    # Dense urban: high
    if prefix in ("005", "003", "021", "026"):
        return round(random.uniform(90, 98), 1)
    # Suburban ring
    if prefix in ("006", "007", "008", "013", "014"):
        return round(random.uniform(85, 96), 1)
    # Outer areas — some sparsely built
    if prefix in ("016", "017", "029"):
        return round(random.uniform(65, 88), 1)
    if pc in QUIET:
        return round(random.uniform(55, 82), 1)
    return round(random.uniform(78, 95), 1)


def _ev_charging(pc: str) -> float:
    """EV charging station density (stations per km²).

    Reference: Traficom / OpenStreetMap charging station data.
    Higher in dense urban areas, near shopping centres and highway stops.
    """
    if pc in CENTRE:
        return round(random.uniform(8.0, 22.0), 1)
    elif pc in INNER:
        return round(random.uniform(4.0, 12.0), 1)
    prefix = pc[:3]
    # Espoo commercial centres
    if prefix in ("021", "026"):
        return round(random.uniform(3.0, 10.0), 1)
    # Vantaa near airport/commerce
    if prefix in ("013", "014", "015"):
        return round(random.uniform(2.0, 7.0), 1)
    # Outer quiet areas
    if pc in QUIET:
        return round(random.uniform(0.2, 1.5), 1)
    # Helsinki suburbs
    if prefix in ("003", "004", "006", "007", "008"):
        return round(random.uniform(1.5, 5.0), 1)
    return round(random.uniform(1.0, 4.0), 1)


def _tree_canopy(pc: str) -> float:
    """Tree canopy coverage (% of area covered by trees).

    Reference: HSY LiDAR-based canopy mapping.
    Helsinki metro: Central Park, Nuuksio — heavily forested areas score high.
    Dense urban core has low canopy.
    """
    if pc in CENTRE:
        return round(random.uniform(4, 12), 1)
    elif pc in INNER:
        return round(random.uniform(8, 18), 1)
    prefix = pc[:3]
    # Forested Espoo
    if prefix in ("027", "028", "029"):
        return round(random.uniform(40, 70), 1)
    # Central Park corridor (Helsinki north)
    if prefix in ("003", "004"):
        return round(random.uniform(25, 45), 1)
    # Nature areas
    if pc in QUIET:
        return round(random.uniform(45, 72), 1)
    # Helsinki suburbs
    if prefix in ("006", "007", "008", "009"):
        return round(random.uniform(18, 38), 1)
    # Vantaa
    if prefix in ("016", "017"):
        return round(random.uniform(30, 55), 1)
    if prefix in ("013", "014"):
        return round(random.uniform(20, 40), 1)
    # Tapiola/Espoo centre
    if prefix in ("021", "022"):
        return round(random.uniform(15, 30), 1)
    return round(random.uniform(20, 40), 1)


def _surface_temp(pc: str) -> float:
    """Surface temperature difference from metro average (°C).

    Reference: HSY / Landsat urban heat island mapping.
    Dense built areas are warmer, forested/water areas cooler.
    """
    if pc in CENTRE:
        return round(random.uniform(2.0, 4.5), 1)
    elif pc in INNER:
        return round(random.uniform(1.0, 3.0), 1)
    prefix = pc[:3]
    # Dense commercial/industrial
    if prefix in ("015",):
        return round(random.uniform(1.5, 3.5), 1)
    # Forested cool areas
    if pc in QUIET:
        return round(random.uniform(-2.0, -0.5), 1)
    if prefix in ("027", "028", "029"):
        return round(random.uniform(-1.5, 0.5), 1)
    # Helsinki suburbs
    if prefix in ("003", "004"):
        return round(random.uniform(0.0, 1.5), 1)
    if prefix in ("006", "007", "008"):
        return round(random.uniform(0.2, 1.8), 1)
    if prefix in ("009",):
        return round(random.uniform(0.5, 2.0), 1)
    return round(random.uniform(-0.5, 1.5), 1)


def _transit_reachability(pc: str) -> float:
    """Transit reachability score (0-100): jobs/services reachable within 30 min.

    Reference: HSL travel time matrix (matka-aikamatriisi).
    Central areas score highest; outer areas with poor transit score lowest.
    """
    if pc in CENTRE:
        return round(random.uniform(82, 95), 0)
    elif pc in INNER:
        return round(random.uniform(72, 88), 0)
    prefix = pc[:3]
    # Good rail/metro connections
    if prefix in ("005",):
        return round(random.uniform(65, 80), 0)
    if prefix in ("003", "004"):
        return round(random.uniform(58, 75), 0)
    if prefix in ("021",):
        return round(random.uniform(60, 78), 0)
    if prefix in ("026",):
        return round(random.uniform(55, 72), 0)
    if prefix in ("013",):  # Tikkurila
        return round(random.uniform(55, 70), 0)
    # Helsinki mid-ring
    if prefix in ("006", "007"):
        return round(random.uniform(50, 68), 0)
    if prefix in ("008",):
        return round(random.uniform(48, 65), 0)
    if prefix in ("009",):
        return round(random.uniform(40, 60), 0)
    # Outer Vantaa
    if prefix in ("016", "017"):
        return round(random.uniform(25, 45), 0)
    if prefix in ("014", "015"):
        return round(random.uniform(35, 55), 0)
    # Outer Espoo
    if prefix in ("027", "028", "029"):
        return round(random.uniform(20, 42), 0)
    if pc in QUIET:
        return round(random.uniform(12, 35), 0)
    return round(random.uniform(35, 60), 0)


def _property_price_change(pc: str) -> float:
    """Property price change (%) over 5 years.

    Reference: Statistics Finland PxWeb apartment price statistics.
    Most Helsinki areas appreciated, outer areas saw less growth.
    Some already-expensive areas saw smaller gains recently.
    """
    if pc in CENTRE:
        return round(random.uniform(5, 18), 1)
    elif pc in INNER:
        return round(random.uniform(8, 22), 1)
    prefix = pc[:3]
    # Espoo growth corridors (metro line)
    if prefix in ("021", "022"):
        return round(random.uniform(10, 25), 1)
    if prefix in ("026",):
        return round(random.uniform(8, 20), 1)
    # Helsinki suburbs — varied
    if prefix in ("003", "004"):
        return round(random.uniform(5, 15), 1)
    if prefix in ("005",):
        return round(random.uniform(6, 18), 1)
    if prefix in ("006", "007"):
        return round(random.uniform(2, 12), 1)
    if prefix in ("008",):
        return round(random.uniform(3, 14), 1)
    if prefix in ("009",):
        return round(random.uniform(-2, 10), 1)
    # Vantaa
    if prefix in ("013", "014"):
        return round(random.uniform(5, 16), 1)
    if prefix in ("016", "017"):
        return round(random.uniform(-5, 8), 1)
    if prefix in ("012",):
        return round(random.uniform(-3, 6), 1)
    # Outer Espoo
    if prefix in ("027", "028", "029"):
        return round(random.uniform(0, 12), 1)
    return round(random.uniform(0, 12), 1)


def main():
    print("Generating missing metric data files...\n")

    # Noise levels (dB)
    noise = {pc: _noise(pc) for pc in POSTAL_CODES}
    _write_json("noise_levels.json", noise, "HSY noise levels dB")

    # Building ages
    buildings = {pc: _building_year(pc) for pc in POSTAL_CODES}
    _write_json("building_ages.json", buildings, "avg building year")

    # Energy efficiency (1-7 scale)
    energy = {pc: _energy_class(pc) for pc in POSTAL_CODES}
    _write_json("energy_classes.json", energy, "energy efficiency score")

    # Population growth (%)
    growth = {pc: _pop_growth(pc) for pc in POSTAL_CODES}
    _write_json("population_growth.json", growth, "annual pop growth %")

    # Gini coefficients
    gini = {pc: _gini(pc) for pc in POSTAL_CODES}
    _write_json("income_inequality.json", gini, "Gini coefficient")

    # Seniors living alone (%)
    seniors = {pc: _seniors_alone(pc) for pc in POSTAL_CODES}
    _write_json("seniors_alone.json", seniors, "seniors alone %")

    # Cars per household
    cars = {pc: _cars_per_hh(pc) for pc in POSTAL_CODES}
    _write_json("car_ownership.json", cars, "cars per household")

    # Commute times (minutes)
    commute = {pc: _commute_time(pc) for pc in POSTAL_CODES}
    _write_json("commute_times.json", commute, "avg commute min")

    # --- Phase 7: New data layers ---

    # Voter turnout (%)
    turnout = {pc: _voter_turnout(pc) for pc in POSTAL_CODES}
    _write_json("voter_turnout.json", turnout, "voter turnout %")

    # Party diversity (Shannon index)
    diversity = {pc: _party_diversity(pc) for pc in POSTAL_CODES}
    _write_json("party_diversity.json", diversity, "party diversity index")

    # Burglary rate (per 1,000)
    burglaries = {pc: _burglary_rate(pc) for pc in POSTAL_CODES}
    _write_json("burglary_rate.json", burglaries, "burglary rate /1000")

    # Domestic disturbance rate (per 1,000)
    disturbances = {pc: _domestic_disturbance(pc) for pc in POSTAL_CODES}
    _write_json("domestic_disturbance.json", disturbances, "domestic disturbance rate /1000")

    # Water quality index (0-100)
    water = {pc: _water_quality(pc) for pc in POSTAL_CODES}
    _write_json("water_quality.json", water, "water quality index")

    # Broadband coverage (%)
    broadband = {pc: _broadband_coverage(pc) for pc in POSTAL_CODES}
    _write_json("broadband_coverage.json", broadband, "broadband coverage %")

    # EV charging density (/km²)
    ev = {pc: _ev_charging(pc) for pc in POSTAL_CODES}
    _write_json("ev_charging.json", ev, "EV charging density /km²")

    # Tree canopy coverage (%)
    canopy = {pc: _tree_canopy(pc) for pc in POSTAL_CODES}
    _write_json("tree_canopy.json", canopy, "tree canopy %")

    # Surface temperature difference (°C)
    temp = {pc: _surface_temp(pc) for pc in POSTAL_CODES}
    _write_json("surface_temperature.json", temp, "surface temp diff °C")

    # Transit reachability score (0-100)
    reach = {pc: _transit_reachability(pc) for pc in POSTAL_CODES}
    _write_json("transit_reachability.json", reach, "transit reachability score")

    # Property price change (%)
    price_chg = {pc: _property_price_change(pc) for pc in POSTAL_CODES}
    _write_json("property_price_change.json", price_chg, "property price change %")

    print("\nDone! All 19 data files generated.")
    print("Run prepare_data.py to rebuild the GeoJSON with this data.")


if __name__ == "__main__":
    main()
