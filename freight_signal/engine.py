"""
Freight Signal (c) - Freight Signal Engine core.

Self-contained rewrite matching the VBA macro's matrix logic directly
(GetBandLimits / CalculateCandidateScore / SaturateHistoricalValue /
FindNearbyCitiesAdaptive / WriteNearbyPosting / DeleteEntireLoadGroup /
SetGroupPriority), with no dependency on a separate geo module:

  1. A parsed load becomes the "Original" posting.
  2. Alternate cities are searched in sequential mile BANDS, closest
     first: 20-30, then 30-40, then 40-60. Each band is only searched if
     the closer band(s) didn't already turn up enough distinct cities -
     so a strong nearby match is always preferred over reaching further
     out. If NOTHING is found anywhere in 20-60 miles (e.g. a rural
     origin like Lovell, WY), the search falls back to a wide 100-150
     mile ring rather than failing outright.
  3. Within whichever band is being searched, cities that have performed
     well historically - i.e. generated carrier email inquiries on this
     exact lane, or on that city as a market, in the Inquiry Log - are
     ranked ABOVE cities that are merely closer. Distance only breaks
     ties between cities with equal (often zero, for a brand-new lane)
     history. This is what makes the matrix continually self-optimize:
     the more a lane gets replies, the more it gets favored on every
     future posting run.
  4. The 3 origins (Original + up to 2 alternates) are crossed with the
     3 destinations to build up to 9 postings. The matrix NEVER repeats
     the same lane twice - if a band search can't find enough distinct
     cities, the matrix is simply smaller than 3x3 and a warning explains
     why, instead of duplicating a lane to force 9 rows.
  5. Which of the 9 postings carry a rate is ALSO decided by historical
     inquiry count first, distance second - the lanes that have proven
     to get carrier replies are offered a rate before any others.
  6. Marking any single posting "Covered" removes the whole Load Group
     (DeleteEntireLoadGroup). Marking any single posting's priority
     propagates that priority to the whole Load Group (SetGroupPriority).
"""
import math
import uuid
from dataclasses import dataclass

from . import db

# ---------------------------------------------------------------------------
# Band configuration - searched closest-first, exactly as requested:
# 20-30 miles, then 30-40, then 40-60. If the whole 20-60 mile range turns
# up nothing at all, fall back to a 100-150 mile ring for rural origins/
# destinations (e.g. Lovell, WY) that simply don't have anything closer.
# ---------------------------------------------------------------------------
BANDS = [
    (20.0, 30.0),
    (30.0, 40.0),
    (40.0, 60.0),
]
FALLBACK_BAND = (100.0, 150.0)

# Scoring weights (mirrors the macro's EXACT_LANE_WEIGHT / ORIGIN_MARKET_WEIGHT /
# DESTINATION_MARKET_WEIGHT / POPULATION_WEIGHT / HISTORICAL_SATURATION).
# These feed an informational composite score only - actual ranking uses
# the (lane_history, market_history, -distance) tuple below them, so
# historical performance always outranks distance, not just outweighs it.
EXACT_LANE_WEIGHT = 100.0
ORIGIN_MARKET_WEIGHT = 15.0
DESTINATION_MARKET_WEIGHT = 10.0
POPULATION_WEIGHT = 0.01
DISTANCE_PENALTY = 0.05
HISTORICAL_SATURATION = 25.0

PRIORITY_TARGETS = {"Low": 2, "Medium": 5, "High": 10}


# ---------------------------------------------------------------------------
# Distance + historical-performance scoring
# ---------------------------------------------------------------------------
def haversine_miles(lat1, lon1, lat2, lon2) -> float:
    if None in (lat1, lon1, lat2, lon2):
        return 0.0
    r = 3958.8  # earth radius, miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return r * 2 * math.asin(min(1, math.sqrt(a)))


def saturate_historical_value(inquiry_count: float) -> float:
    """Diminishing returns as a lane/market accumulates more historical
    inquiries, so one hot lane can't monopolize every posting slot
    forever - but it still ranks above anything with less history."""
    if inquiry_count <= 0:
        return 0.0
    return HISTORICAL_SATURATION * (1 - math.exp(-inquiry_count / HISTORICAL_SATURATION))


@dataclass
class Candidate:
    city: str
    state: str
    zip: str
    lat: float
    lon: float
    population: float
    distance: float
    lane_history: float = 0.0
    market_history: float = 0.0
    score: float = 0.0


def _lane_lookup_factory(conn):
    def lookup(city, state, other_city, other_state, origin_side=True):
        if origin_side:
            row = conn.execute(
                "SELECT COUNT(*) c FROM inquiries WHERE lower(origin_city)=? AND lower(origin_state)=? "
                "AND lower(dest_city)=? AND lower(dest_state)=?",
                (city.lower(), state.lower(), other_city.lower(), other_state.lower()),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) c FROM inquiries WHERE lower(dest_city)=? AND lower(dest_state)=? "
                "AND lower(origin_city)=? AND lower(origin_state)=?",
                (city.lower(), state.lower(), other_city.lower(), other_state.lower()),
            ).fetchone()
        return float(row["c"] or 0)
    return lookup


def _market_lookup_factory(conn, origin_side=True):
    def lookup(city, state):
        col_city, col_state = ("origin_city", "origin_state") if origin_side else ("dest_city", "dest_state")
        row = conn.execute(
            f"SELECT COUNT(*) c FROM inquiries WHERE lower({col_city})=? AND lower({col_state})=?",
            (city.lower(), state.lower()),
        ).fetchone()
        return float(row["c"] or 0)
    return lookup


def lane_inquiry_count(conn, origin_city, origin_state, dest_city, dest_state):
    return _lane_lookup_factory(conn)(origin_city, origin_state, dest_city, dest_state, origin_side=True)


def _zip_row_for(conn, city, state, zip_code=None):
    """Looks up a ZIP Map row to use as the center point for a nearby-city
    search. Prefers an exact ZIP code match (most reliable - a load's
    origin/destination ZIP is always known from parsing), then falls back
    to a city/state text match if no ZIP code is available or it isn't in
    the imported ZIP Map."""
    if zip_code:
        row = conn.execute("SELECT * FROM zip_map WHERE zip=? LIMIT 1", (zip_code,)).fetchone()
        if row and row["latitude"] is not None:
            return row
    return conn.execute(
        "SELECT * FROM zip_map WHERE lower(city)=? AND lower(state)=? AND latitude IS NOT NULL LIMIT 1",
        (city.lower(), state.lower()),
    ).fetchone()


def _find_candidates_in_band(zip_rows, center_lat, center_lon, seen_cities, min_miles, max_miles):
    """zip_rows: sqlite Rows with city/state/zip/latitude/longitude/population.
    seen_cities: set of (city_lower, state_lower) tuples already claimed
    elsewhere in this matrix, so no city is ever picked twice."""
    out = []
    for row in zip_rows:
        lat, lon = row["latitude"], row["longitude"]
        if lat is None or lon is None:
            continue
        dist = haversine_miles(center_lat, center_lon, lat, lon)
        if dist < min_miles or dist > max_miles:
            continue
        key = (row["city"].strip().lower(), row["state"].strip().lower())
        if key in seen_cities:
            continue
        out.append(Candidate(
            city=row["city"], state=row["state"], zip=row["zip"],
            lat=lat, lon=lon, population=row["population"] or 0, distance=dist,
        ))
    return out


def _score_and_rank(candidates, other_side_city, other_side_state, lane_lookup, market_lookup, selecting_origin):
    """Ranks candidates by historical performance FIRST, distance only as
    a tiebreaker - a city with any inquiry history outranks a closer city
    with none. This is the "prioritize cities that have performed well
    historically" behavior, applied within whichever band is currently
    being searched."""
    for c in candidates:
        lane_count = lane_lookup(c.city, c.state, other_side_city, other_side_state)
        market_count = market_lookup(c.city, c.state)
        c.lane_history = saturate_historical_value(lane_count)
        c.market_history = saturate_historical_value(market_count)
        weight = ORIGIN_MARKET_WEIGHT if selecting_origin else DESTINATION_MARKET_WEIGHT
        # Informational composite only (not used for ranking - see sort_key).
        c.score = (
            EXACT_LANE_WEIGHT * c.lane_history
            + weight * c.market_history
            + POPULATION_WEIGHT * c.population
            - DISTANCE_PENALTY * c.distance
        )

    def sort_key(c: Candidate):
        return (c.lane_history, c.market_history, -c.distance)

    return sorted(candidates, key=sort_key, reverse=True)


def _find_alternates(conn, zip_rows, center_lat, center_lon, self_city, self_state,
                      other_city, other_state, origin_side, count=2):
    """Searches BANDS in order (20-30, then 30-40, then 40-60 miles),
    collecting the best-performing distinct cities as it goes and only
    reaching into the next, wider band if the closer one(s) didn't
    already provide enough. Falls back to a 100-150 mile ring only if
    the entire 20-60 mile range came back completely empty."""
    lane_lookup = lambda c, s, oc, os_: _lane_lookup_factory(conn)(c, s, oc, os_, origin_side=origin_side)  # noqa: E731
    market_lookup = _market_lookup_factory(conn, origin_side=origin_side)

    seen = {(self_city.strip().lower(), self_state.strip().lower())}
    chosen = []
    any_candidates_seen = False

    for min_miles, max_miles in BANDS:
        if len(chosen) >= count:
            break
        candidates = _find_candidates_in_band(zip_rows, center_lat, center_lon, seen, min_miles, max_miles)
        if candidates:
            any_candidates_seen = True
        ranked = _score_and_rank(candidates, other_city, other_state, lane_lookup, market_lookup, origin_side)
        for c in ranked:
            if len(chosen) >= count:
                break
            key = (c.city.lower(), c.state.lower())
            if key in seen:
                continue
            seen.add(key)
            chosen.append(c)

    if not any_candidates_seen and len(chosen) < count:
        # Nothing at all within 20-60 miles (e.g. Lovell, WY) - widen to
        # the 100-150 mile fallback ring rather than giving up.
        min_miles, max_miles = FALLBACK_BAND
        candidates = _find_candidates_in_band(zip_rows, center_lat, center_lon, seen, min_miles, max_miles)
        ranked = _score_and_rank(candidates, other_city, other_state, lane_lookup, market_lookup, origin_side)
        for c in ranked:
            if len(chosen) >= count:
                break
            key = (c.city.lower(), c.state.lower())
            if key in seen:
                continue
            seen.add(key)
            chosen.append(c)

    return chosen


def find_alternate_origins(conn, origin_city, origin_state, dest_city, dest_state, origin_zip=None, count=2):
    center = _zip_row_for(conn, origin_city, origin_state, origin_zip)
    if not center:
        return [], False
    zip_rows = conn.execute("SELECT * FROM zip_map").fetchall()
    chosen = _find_alternates(
        conn, zip_rows, center["latitude"], center["longitude"],
        origin_city, origin_state, dest_city, dest_state, origin_side=True, count=count,
    )
    return chosen, True


def find_alternate_destinations(conn, dest_city, dest_state, origin_city, origin_state, dest_zip=None, count=2):
    center = _zip_row_for(conn, dest_city, dest_state, dest_zip)
    if not center:
        return [], False
    zip_rows = conn.execute("SELECT * FROM zip_map").fetchall()
    chosen = _find_alternates(
        conn, zip_rows, center["latitude"], center["longitude"],
        dest_city, dest_state, origin_city, origin_state, origin_side=False, count=count,
    )
    return chosen, True


# ---------------------------------------------------------------------------
# Matrix assembly
# ---------------------------------------------------------------------------
def _variant_label(origin_index: int, dest_index: int) -> str:
    """origin_index/dest_index are 0 for the original city, 1/2 for the
    1st/2nd alternate. Correctly reflects which axis (or both) changed."""
    if origin_index == 0 and dest_index == 0:
        return "Original"
    if origin_index == 0:
        return f"Alt Dest {dest_index}"
    if dest_index == 0:
        return f"Alt Origin {origin_index}"
    return f"Alt O{origin_index}/D{dest_index}"


def generate_postings(conn, parsed, priority="Low", rate_fraction_with_rate=2 / 3, target_rate=None,
                       comment="", commodity="", reference_id=""):
    """Builds the posting matrix for a Load Group from a ParsedLoad and
    writes it to the postings table. Returns (load_group_id, warnings).

    Never pads the matrix with duplicate cities - if band search (20-30,
    30-40, 40-60, then 100-150 as a rural fallback) can't find enough
    distinct cities, the matrix is simply smaller than 3x3 and a warning
    explains why."""
    group_id = "LG-" + uuid.uuid4().hex[:8].upper()
    warnings = []

    alt_origins, origin_center_found = find_alternate_origins(
        conn, parsed.origin_city, parsed.origin_state, parsed.dest_city, parsed.dest_state,
        origin_zip=parsed.origin_zip,
    )
    alt_dests, dest_center_found = find_alternate_destinations(
        conn, parsed.dest_city, parsed.dest_state, parsed.origin_city, parsed.origin_state,
        dest_zip=parsed.dest_zip,
    )

    if not origin_center_found:
        warnings.append(
            f"'{parsed.origin_city}, {parsed.origin_state} {parsed.origin_zip}' was not found in the ZIP "
            "Map (by ZIP code or city/state), so no alternate origin cities could be found. Only the "
            "original origin will be used."
        )
    elif len(alt_origins) < 2:
        warnings.append(
            f"Only {len(alt_origins)} alternate origin city(ies) found near "
            f"{parsed.origin_city}, {parsed.origin_state} even after widening to the 100-150 mile fallback "
            "ring. Import a denser ZIP Map for full 3x3 coverage."
        )

    if not dest_center_found:
        warnings.append(
            f"'{parsed.dest_city}, {parsed.dest_state} {parsed.dest_zip}' was not found in the ZIP Map "
            "(by ZIP code or city/state), so no alternate destination cities could be found. Only the "
            "original destination will be used."
        )
    elif len(alt_dests) < 2:
        warnings.append(
            f"Only {len(alt_dests)} alternate destination city(ies) found near "
            f"{parsed.dest_city}, {parsed.dest_state} even after widening to the 100-150 mile fallback "
            "ring. Import a denser ZIP Map for full 3x3 coverage."
        )

    origins = [(parsed.origin_city, parsed.origin_state, parsed.origin_zip, 0.0)]
    origins += [(c.city, c.state, c.zip, round(c.distance, 1)) for c in alt_origins]

    dests = [(parsed.dest_city, parsed.dest_state, parsed.dest_zip, 0.0)]
    dests += [(c.city, c.state, c.zip, round(c.distance, 1)) for c in alt_dests]

    combos = []
    for oi, o in enumerate(origins):
        for di, d in enumerate(dests):
            combos.append((o, d, oi, di))

    if len(combos) < 9:
        warnings.append(
            f"Generated {len(combos)} unique posting(s) instead of 9 - see above for why. No lane was "
            "duplicated."
        )

    target = PRIORITY_TARGETS.get(priority, 2)
    num_with_rate = round(len(combos) * rate_fraction_with_rate)
    posted_rate = None
    if target_rate:
        try:
            posted_rate = round(float(target_rate) * 0.9, 2)
        except ValueError:
            posted_rate = None

    # Self-optimizing rate allocation: decide WHICH postings carry a rate
    # by how many carrier email inquiries that exact lane has generated
    # historically, not by grid position - so the lanes that have proven
    # to get replies are the ones offered a rate first. Total origin+dest
    # distance is only the tiebreaker for lanes with equal (often zero,
    # for brand-new lanes) history, which is why the original lane
    # (0 miles from itself) naturally still wins ties before any history
    # exists.
    combo_history = []
    for idx, (o, d, oi, di) in enumerate(combos):
        (oc, ost, ozip, omiles), (dc, dst, dzip, dmiles) = o, d
        history = lane_inquiry_count(conn, oc, ost, dc, dst)
        combo_history.append((idx, history, omiles + dmiles))
    ranked = sorted(combo_history, key=lambda t: (-t[1], t[2]))
    rate_indexes = {idx for idx, _hist, _dist in ranked[:num_with_rate]} if posted_rate is not None else set()

    now = db.now_str()
    rows = []
    for idx, ((oc, ost, ozip, omiles), (dc, dst, dzip, dmiles), oi, di) in enumerate(combos):
        variant = _variant_label(oi, di)
        has_rate = idx in rate_indexes
        rows.append((
            group_id, variant,
            parsed.pickup_earliest, parsed.pickup_latest, "53", parsed.weight_lbs,
            "Full", parsed.equipment,
            "no", "", "no", "no",
            "yes", str(posted_rate) if has_rate else "", "no", "no",
            "Email", oc, ost.upper(), ozip, dc, dst.upper(), dzip,
            comment, commodity, reference_id,
            omiles, dmiles, lane_inquiry_count(conn, oc, ost, dc, dst),
            "Active", priority, target, "No", "Yes" if has_rate else "No", now,
        ))

    with conn:
        conn.executemany(
            """INSERT INTO postings (
                load_group_id, variant_name, pickup_earliest, pickup_latest, length_ft, weight_lbs,
                full_partial, equipment, use_private_network, private_network_rate,
                allow_pn_booking, allow_pn_bidding, use_dat_loadboard, dat_loadboard_rate,
                allow_dat_booking, use_extended_network, contact_method,
                origin_city, origin_state, origin_zip, dest_city, dest_state, dest_zip,
                comment, commodity, reference_id, origin_miles, dest_miles, inquiry_count,
                load_status, priority, outreach_target, carrier_outreach, posted_with_rate, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
    return group_id, warnings


def mark_group_covered(conn, group_id):
    with conn:
        conn.execute("DELETE FROM postings WHERE load_group_id=?", (group_id,))


def set_group_priority(conn, group_id, priority):
    target = PRIORITY_TARGETS.get(priority, 2)
    with conn:
        conn.execute(
            "UPDATE postings SET priority=?, outreach_target=? WHERE load_group_id=?",
            (priority, target, group_id),
        )


def set_row_carrier_outreach(conn, posting_id, value):
    with conn:
        conn.execute("UPDATE postings SET carrier_outreach=? WHERE id=?", (value, posting_id))
