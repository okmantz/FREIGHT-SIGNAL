"""
Freight Signal (c) - adaptive nearby-city engine.

Reproduces the intent of the VBA FindNearbyCitiesAdaptive /
CalculateCandidateScore / GetBandLimits / SaturateHistoricalValue routines:

  * Candidate cities are pulled from the imported ZIP Map within a
    20-60 mile ring of the original city (MIN/MAX_ALTERNATE_CITY_MILES).
  * Candidates are scored using exact-lane historical inquiry weight,
    origin/destination market weight, a small population tiebreaker, and
    a distance penalty, then the top scorers are chosen.
  * Because the lane/origin/destination inquiry counts come from the
    Inquiry Log (which grows as carriers reply), the same lane naturally
    scores higher over time and gets selected more often - this is the
    "adaptive / learns and improves with use" behavior Owen described.
  * The 9 total postings are produced as a 3x3 matrix: the original
    origin + 2 best-scoring alternate origins, crossed with the original
    destination + 2 best-scoring alternate destinations.
"""
import math
from dataclasses import dataclass

MIN_ALTERNATE_CITY_MILES = 20.0
MAX_ALTERNATE_CITY_MILES = 60.0

EXACT_LANE_WEIGHT = 100.0
ORIGIN_MARKET_WEIGHT = 15.0
DESTINATION_MARKET_WEIGHT = 10.0
POPULATION_WEIGHT = 0.01
DISTANCE_PENALTY = 0.05
HISTORICAL_SATURATION = 25.0


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
    """Mirrors SaturateHistoricalValue: diminishing returns as a lane
    accumulates more historical inquiries, so one hot lane can't
    monopolize every posting slot forever."""
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


def find_candidates(zip_rows, center_lat, center_lon, exclude_cities,
                     min_miles=MIN_ALTERNATE_CITY_MILES, max_miles=MAX_ALTERNATE_CITY_MILES):
    """zip_rows: iterable of sqlite Rows/dicts with city, state, zip,
    latitude, longitude, population. exclude_cities: set of (city, state)
    tuples (lowercased) already used elsewhere in this matrix, so the
    same city can never be picked twice."""
    out = []
    for row in zip_rows:
        lat, lon = row["latitude"], row["longitude"]
        if lat is None or lon is None:
            continue
        dist = haversine_miles(center_lat, center_lon, lat, lon)
        if dist < min_miles or dist > max_miles:
            continue
        key = (row["city"].strip().lower(), row["state"].strip().lower())
        if key in exclude_cities:
            continue
        out.append(Candidate(
            city=row["city"], state=row["state"], zip=row["zip"],
            lat=lat, lon=lon, population=row["population"] or 0, distance=dist,
        ))
    return out


# Progressive radius rings tried in order until enough *distinct* cities
# are found - fixes the "same lane posted 9 times" problem that happens
# when the ZIP Map is sparse right around the original city.
RADIUS_RINGS = [
    (20.0, 60.0),
    (10.0, 100.0),
    (5.0, 150.0),
    (0.0, 250.0),
]


def score_candidates(candidates, other_side_city, other_side_state, lane_lookup,
                      market_lookup, selecting_origin: bool):
    """
    lane_lookup(city, state, other_city, other_state) -> historical inquiry count for that exact lane
    market_lookup(city, state) -> historical inquiry count for that city as an origin/destination market

    Self-optimizing / adaptive ranking: cities that have generated more
    carrier email inquiries are ranked strictly ABOVE distance, not just
    blended in with it. A candidate with any inquiry history outranks a
    candidate with none, no matter which one is closer. Distance is only
    the tiebreaker among candidates with equal (often zero, for brand-new
    lanes) history - this is what makes the matrix "learn": once a lane
    starts generating replies, Freight Signal favors it more and more on
    every future posting run, and only falls back to pure distance for
    lanes it has no track record on yet.
    """
    for c in candidates:
        lane_count = lane_lookup(c.city, c.state, other_side_city, other_side_state)
        market_count = market_lookup(c.city, c.state)
        c.lane_history = saturate_historical_value(lane_count)
        c.market_history = saturate_historical_value(market_count)
        # Kept as an informational composite for display purposes only -
        # actual ranking below uses the tuple sort key, not this number.
        weight = ORIGIN_MARKET_WEIGHT if selecting_origin else DESTINATION_MARKET_WEIGHT
        c.score = (
            EXACT_LANE_WEIGHT * c.lane_history
            + weight * c.market_history
            + POPULATION_WEIGHT * c.population
            - DISTANCE_PENALTY * c.distance
        )

    def sort_key(c: Candidate):
        # Sorted descending overall; distance ascending is achieved by
        # negating it before the (also-descending) tuple compare.
        return (c.lane_history, c.market_history, -c.distance)

    return sorted(candidates, key=sort_key, reverse=True)


def pick_top_alternates(candidates, count=2):
    chosen = []
    seen = set()
    for c in candidates:
        key = (c.city.lower(), c.state.lower())
        if key in seen:
            continue
        seen.add(key)
        chosen.append(c)
        if len(chosen) >= count:
            break
    return chosen


def find_and_score_alternates(zip_rows, center_lat, center_lon, exclude_cities,
                               other_side_city, other_side_state, lane_lookup, market_lookup,
                               selecting_origin, count=2):
    """Widens the search ring step by step (find_candidates/RADIUS_RINGS)
    until `count` distinct cities are found or every ring is exhausted.
    Returns (chosen_candidates, ring_used) so the caller can warn the user
    when even the widest ring couldn't find enough coverage."""
    for min_miles, max_miles in RADIUS_RINGS:
        candidates = find_candidates(zip_rows, center_lat, center_lon, exclude_cities,
                                      min_miles=min_miles, max_miles=max_miles)
        scored = score_candidates(candidates, other_side_city, other_side_state,
                                   lane_lookup, market_lookup, selecting_origin)
        chosen = pick_top_alternates(scored, count)
        if len(chosen) >= count:
            return chosen, (min_miles, max_miles)
    # Return whatever we found on the widest ring, even if short of `count`.
    return chosen, RADIUS_RINGS[-1]
