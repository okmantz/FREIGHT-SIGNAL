"""
Freight Signal (c) - load detail text parser.

Reproduces the behavior of the VBA routines ParseLoadDetailsIntoRow /
GetLineValue / ParseCityStateZip / ExtractFirstDate / ExtractWeight /
GetEquipmentCode / NormalizeZip from the original Excel macro, so pasting
the same load-board text into the app produces the same fields.

Expected pasted text contains labeled lines such as:
    Pickup: Aiken, SC 29801
    Delivery: Fletcher, OK 73541
    Pickup Date/Time: 8/14/2026 8:00 AM
    Delivery Date/Time: 8/15/2026
    Weight: 40,000 lbs
    Trailer Type: Dry Van
Lines can appear in any order and extra lines are ignored.
"""
import re
from dataclasses import dataclass, field

EQUIPMENT_MAP = {
    "van": "V", "dry van": "V", "v": "V",
    "reefer": "R", "refrigerated": "R", "r": "R",
    "flatbed": "F", "flat": "F", "f": "F",
    "stepdeck": "SD", "step deck": "SD",
    "power only": "PO",
    "conestoga": "CN",
    "rgn": "RGN", "removable gooseneck": "RGN",
    "box truck": "BT",
    "hotshot": "HS",
}

DATE_PATTERN = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b")
WEIGHT_PATTERN = re.compile(r"([\d,]+)\s*(lbs|lb|pounds)?", re.IGNORECASE)


@dataclass
class ParsedLoad:
    pickup_earliest: str = ""
    pickup_latest: str = ""
    weight_lbs: str = ""
    equipment: str = ""
    origin_city: str = ""
    origin_state: str = ""
    origin_zip: str = ""
    dest_city: str = ""
    dest_state: str = ""
    dest_zip: str = ""
    raw_text: str = ""
    warnings: list = field(default_factory=list)


def get_line_value(full_text: str, label: str) -> str:
    """Mirrors GetLineValue: finds a line starting with `label` and returns
    the remainder of that line."""
    for line in full_text.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith(label.lower()):
            return stripped[len(label):].strip()
    return ""


def normalize_zip(raw: str) -> str:
    digits = re.sub(r"[^0-9]", "", raw or "")
    if not digits:
        return ""
    return digits[:5].zfill(5)


def parse_city_state_zip(location_text: str):
    """Mirrors ParseCityStateZip. Expects 'City, ST 12345'."""
    city, state, zip_code = "", "", ""
    location_text = (location_text or "").strip()
    if "," not in location_text:
        return city, state, zip_code
    comma_pos = location_text.index(",")
    city = location_text[:comma_pos].strip()
    after_comma = location_text[comma_pos + 1:].strip()
    after_comma = after_comma.replace("\t", " ")
    while "  " in after_comma:
        after_comma = after_comma.replace("  ", " ")
    parts = after_comma.split(" ") if after_comma else []
    if len(parts) >= 1 and parts[0]:
        state = parts[0].strip().upper()
    if len(parts) >= 2 and parts[1]:
        zip_code = normalize_zip(parts[1])
    return city, state, zip_code


def extract_first_date(text_value: str) -> str:
    if not text_value:
        return ""
    match = DATE_PATTERN.search(text_value)
    if not match:
        return ""
    m, d, y = match.groups()
    if len(y) == 2:
        y = "20" + y
    try:
        return f"{int(m)}/{int(d)}/{int(y)}"
    except ValueError:
        return ""


def extract_weight(text_value: str) -> str:
    if not text_value:
        return ""
    match = WEIGHT_PATTERN.search(text_value)
    if not match:
        return ""
    return match.group(1).replace(",", "")


def get_equipment_code(trailer_text: str) -> str:
    if not trailer_text:
        return ""
    key = trailer_text.strip().lower()
    if key in EQUIPMENT_MAP:
        return EQUIPMENT_MAP[key]
    for phrase, code in EQUIPMENT_MAP.items():
        if phrase in key:
            return code
    return trailer_text.strip()[:4].upper()


def parse_load_details(raw_text: str) -> ParsedLoad:
    result = ParsedLoad(raw_text=raw_text)

    pickup_line = get_line_value(raw_text, "Pickup:")
    delivery_line = get_line_value(raw_text, "Delivery:")
    pickup_date_line = get_line_value(raw_text, "Pickup Date/Time:")
    weight_line = get_line_value(raw_text, "Weight:")
    trailer_line = get_line_value(raw_text, "Trailer Type:")

    origin_city, origin_state, origin_zip = parse_city_state_zip(pickup_line)
    dest_city, dest_state, dest_zip = parse_city_state_zip(delivery_line)

    pickup_date = extract_first_date(pickup_date_line)
    weight_value = extract_weight(weight_line)
    equipment_code = get_equipment_code(trailer_line)

    result.pickup_earliest = pickup_date
    result.pickup_latest = pickup_date
    result.weight_lbs = weight_value
    result.equipment = equipment_code
    result.origin_city = origin_city
    result.origin_state = origin_state
    result.origin_zip = origin_zip
    result.dest_city = dest_city
    result.dest_state = dest_state
    result.dest_zip = dest_zip

    if not origin_city:
        result.warnings.append("Could not find a 'Pickup:' line with a City, ST ZIP format.")
    if not dest_city:
        result.warnings.append("Could not find a 'Delivery:' line with a City, ST ZIP format.")
    if not weight_value:
        result.warnings.append("Could not find a 'Weight:' value.")
    if not equipment_code:
        result.warnings.append("Could not find a 'Trailer Type:' value.")
    if not pickup_date:
        result.warnings.append("Could not find a 'Pickup Date/Time:' value.")

    return result
