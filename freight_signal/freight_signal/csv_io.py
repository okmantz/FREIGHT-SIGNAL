"""
Freight Signal (c) - CSV import / export.

DAT_HEADERS is the exact, unchanged header row (order matters) required so
the exported CSV can be uploaded straight to DAT.
"""
import csv

DAT_HEADERS = [
    "Pickup Earliest*", "Pickup Latest", "Length (ft)", "Weight (lbs)",
    "Full/Partial*", "Equipment*", "Use Private Network*", "Private Network Rate",
    "Allow Private Network Booking", "Allow Private Network Bidding",
    "Use DAT Loadboard*", "DAT Loadboard Rate", "Allow DAT Loadboard Booking",
    "Use Extended Network", "Contact Method*", "Origin City*", "Origin State*",
    "Origin Postal Code", "Destination City*", "Destination State*",
    "Destination Postal Code", "Comment", "Commodity", "Reference ID",
]

_ROW_FIELD_ORDER = [
    "pickup_earliest", "pickup_latest", "length_ft", "weight_lbs",
    "full_partial", "equipment", "use_private_network", "private_network_rate",
    "allow_pn_booking", "allow_pn_bidding",
    "use_dat_loadboard", "dat_loadboard_rate", "allow_dat_booking",
    "use_extended_network", "contact_method", "origin_city", "origin_state",
    "origin_zip", "dest_city", "dest_state",
    "dest_zip", "comment", "commodity", "reference_id",
]


def export_postings_csv(postings, filepath: str, only_group_id: str = None):
    """postings: iterable of sqlite Rows (from the postings table)."""
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(DAT_HEADERS)
        for p in postings:
            if only_group_id and p["load_group_id"] != only_group_id:
                continue
            writer.writerow([p[field] if p[field] is not None else "" for field in _ROW_FIELD_ORDER])


def import_zip_map_csv(filepath: str):
    """Expects columns (case-insensitive, any order): Zip, City, State,
    Latitude, Longitude, Population. Returns list of dict rows."""
    rows = []
    with open(filepath, "r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        field_map = {k.lower().strip(): k for k in (reader.fieldnames or [])}

        def col(*names):
            for n in names:
                if n in field_map:
                    return field_map[n]
            return None

        zip_col = col("zip", "zipcode", "zip code", "postal code")
        city_col = col("city")
        state_col = col("state", "state code")
        lat_col = col("latitude", "lat")
        lon_col = col("longitude", "lon", "lng")
        pop_col = col("population", "pop")

        for r in reader:
            if not zip_col or not r.get(zip_col):
                continue
            try:
                lat = float(r[lat_col]) if lat_col and r.get(lat_col) else None
                lon = float(r[lon_col]) if lon_col and r.get(lon_col) else None
            except ValueError:
                lat, lon = None, None
            try:
                pop = float(r[pop_col]) if pop_col and r.get(pop_col) else 0
            except ValueError:
                pop = 0
            rows.append(dict(
                zip=str(r[zip_col]).strip().zfill(5)[:5],
                city=(r.get(city_col) or "").strip(),
                state=(r.get(state_col) or "").strip().upper(),
                latitude=lat, longitude=lon, population=pop,
            ))
    return rows


def import_carrier_csv(filepath: str):
    """Expects headers matching (case-insensitive) the Carrier Database
    columns: Carrier Name, MC/DOT, Email, Phone, Origin City, Origin State,
    Destination City, Destination State, Equipment, Preferred Pickup Dates,
    Rate, Status, Notes."""
    rows = []
    with open(filepath, "r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        field_map = {k.lower().strip(): k for k in (reader.fieldnames or [])}

        def col(*names):
            for n in names:
                if n in field_map:
                    return field_map[n]
            return None

        mapping = {
            "carrier_name": col("carrier name", "carrier"),
            "mc_dot": col("mc/dot", "mc", "dot"),
            "email": col("email", "sender email", "carrier email"),
            "phone": col("phone", "carrier phone"),
            "origin_city": col("origin city"),
            "origin_state": col("origin state"),
            "dest_city": col("destination city", "dest city"),
            "dest_state": col("destination state", "dest state"),
            "equipment": col("equipment", "equipment type"),
            "preferred_pickup_dates": col("preferred pickup dates", "pickup date", "pickup dates"),
            "rate": col("rate", "carrier rate"),
            "status": col("status"),
            "notes": col("notes"),
        }
        for r in reader:
            row = {}
            for key, src in mapping.items():
                row[key] = (r.get(src) or "").strip() if src else ""
            if row.get("carrier_name") or row.get("email") or row.get("mc_dot"):
                rows.append(row)
    return rows
