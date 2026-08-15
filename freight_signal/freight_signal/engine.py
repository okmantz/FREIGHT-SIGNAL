"""
Freight Signal (c) - Freight Signal Engine core.

Ties together parsing.py + geo.py + db.py to reproduce the VBA
CreateNearbyPostings / WriteNearbyPosting / BuildInquiryCaches behavior:

  1. A parsed load becomes the "original" posting (1 of 9).
  2. The ZIP Map is used to find the 2 best-scoring alternate origin
     cities and 2 best-scoring alternate destination cities within a
     20-60 mile ring, using historical Inquiry Log data to weight the
     scoring (adaptive / self-improving).
  3. The 3 origins x 3 destinations are crossed to build all 9 postings
     for the Load Group.
  4. Marking any single posting "Covered" removes the whole Load Group
     (same as VBA DeleteEntireLoadGroup). Marking any single posting
     "High" priority propagates High to the whole Load Group (same as
     VBA SetGroupPriority).
"""
import uuid
from datetime import datetime

from . import db, geo

PRIORITY_TARGETS = {"Low": 2, "Medium": 5, "High": 10}


def _variant_label(origin_index: int, dest_index: int) -> str:
    """origin_index/dest_index are 0 for the original city, 1/2 for the
    1st/2nd alternate. Correctly reflects which axis (or both) changed,
    unlike a fixed name list."""
    if origin_index == 0 and dest_index == 0:
        return "Original"
    if origin_index == 0:
        return f"Alt Dest {dest_index}"
    if dest_index == 0:
        return f"Alt Origin {origin_index}"
    return f"Alt O{origin_index}/D{dest_index}"


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


def find_alternate_origins(conn, origin_city, origin_state, dest_city, dest_state,
                            origin_zip=None, count=2):
    center = _zip_row_for(conn, origin_city, origin_state, origin_zip)
    if not center:
        return [], False
    zip_rows = conn.execute("SELECT * FROM zip_map").fetchall()
    exclude = {(origin_city.strip().lower(), origin_state.strip().lower())}
    chosen, _ring = geo.find_and_score_alternates(
        zip_rows, center["latitude"], center["longitude"], exclude,
        dest_city, dest_state,
        lane_lookup=lambda c, s, oc, os_: _lane_lookup_factory(conn)(c, s, oc, os_, origin_side=True),
        market_lookup=_market_lookup_factory(conn, origin_side=True),
        selecting_origin=True, count=count,
    )
    return chosen, True


def find_alternate_destinations(conn, dest_city, dest_state, origin_city, origin_state,
                                 dest_zip=None, count=2):
    center = _zip_row_for(conn, dest_city, dest_state, dest_zip)
    if not center:
        return [], False
    zip_rows = conn.execute("SELECT * FROM zip_map").fetchall()
    exclude = {(dest_city.strip().lower(), dest_state.strip().lower())}
    chosen, _ring = geo.find_and_score_alternates(
        zip_rows, center["latitude"], center["longitude"], exclude,
        origin_city, origin_state,
        lane_lookup=lambda c, s, oc, os_: _lane_lookup_factory(conn)(c, s, oc, os_, origin_side=False),
        market_lookup=_market_lookup_factory(conn, origin_side=False),
        selecting_origin=False, count=count,
    )
    return chosen, True


def lane_inquiry_count(conn, origin_city, origin_state, dest_city, dest_state):
    return _lane_lookup_factory(conn)(origin_city, origin_state, dest_city, dest_state, origin_side=True)


def generate_postings(conn, parsed, priority="Low", rate_fraction_with_rate=2 / 3, target_rate=None,
                       comment="", commodity="", reference_id=""):
    """Builds the posting matrix for a Load Group from a ParsedLoad and
    writes it to the postings table. Returns (load_group_id, warnings).

    Unlike a naive implementation, this NEVER pads the matrix with
    duplicate cities - if the ZIP Map doesn't have enough distinct nearby
    cities within any search ring, the matrix is simply smaller than 3x3
    (e.g. 2x3=6 or 1x3=3) and a warning is returned explaining why, rather
    than silently posting the same lane multiple times."""
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
            f"{parsed.origin_city}, {parsed.origin_state} even after widening the search radius. "
            "Import a denser ZIP Map for full 3x3 coverage."
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
            f"{parsed.dest_city}, {parsed.dest_state} even after widening the search radius. "
            "Import a denser ZIP Map for full 3x3 coverage."
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
