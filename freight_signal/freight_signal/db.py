"""
Freight Signal (c) - local persistence layer.

Everything lives in a single SQLite file (freight_signal_data.db) that is
created next to the running .exe / script on first launch. No external
database or internet connection is required - the app is fully local and
self-contained, matching the "no coding necessary / works immediately"
requirement.
"""
import os
import sqlite3
import sys
from datetime import datetime

DB_FILENAME = "freight_signal_data.db"


def _base_dir() -> str:
    """Directory the .exe (or script) is running from, so the database
    travels with the app when Owen copies the folder to another machine."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


DB_PATH = os.path.join(_base_dir(), DB_FILENAME)

SCHEMA = """
CREATE TABLE IF NOT EXISTS postings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    load_group_id TEXT NOT NULL,
    variant_name TEXT NOT NULL,
    pickup_earliest TEXT,
    pickup_latest TEXT,
    length_ft TEXT DEFAULT '53',
    weight_lbs TEXT,
    full_partial TEXT DEFAULT 'Full',
    equipment TEXT,
    use_private_network TEXT DEFAULT 'no',
    private_network_rate TEXT,
    allow_pn_booking TEXT DEFAULT 'no',
    allow_pn_bidding TEXT DEFAULT 'no',
    use_dat_loadboard TEXT DEFAULT 'yes',
    dat_loadboard_rate TEXT,
    allow_dat_booking TEXT DEFAULT 'no',
    use_extended_network TEXT DEFAULT 'no',
    contact_method TEXT DEFAULT 'Email',
    origin_city TEXT,
    origin_state TEXT,
    origin_zip TEXT,
    dest_city TEXT,
    dest_state TEXT,
    dest_zip TEXT,
    comment TEXT,
    commodity TEXT,
    reference_id TEXT,
    origin_miles REAL DEFAULT 0,
    dest_miles REAL DEFAULT 0,
    inquiry_count REAL DEFAULT 0,
    load_status TEXT DEFAULT 'Active',
    priority TEXT DEFAULT 'Low',
    outreach_target INTEGER DEFAULT 2,
    carrier_outreach TEXT DEFAULT 'No',
    posted_with_rate TEXT DEFAULT 'No',
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS carriers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier_name TEXT,
    mc_dot TEXT,
    email TEXT,
    phone TEXT,
    origin_city TEXT,
    origin_state TEXT,
    dest_city TEXT,
    dest_state TEXT,
    equipment TEXT,
    preferred_pickup_dates TEXT,
    rate TEXT,
    last_covered TEXT,
    cover_count INTEGER DEFAULT 0,
    last_contacted TEXT,
    response_rate TEXT,
    status TEXT DEFAULT 'Active',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    load_group_id TEXT,
    carrier_name TEXT,
    mc_dot TEXT,
    email TEXT,
    phone TEXT,
    origin_city TEXT,
    origin_state TEXT,
    dest_city TEXT,
    dest_state TEXT,
    equipment TEXT,
    preferred_pickup_dates TEXT,
    rate TEXT,
    quoted_within_target TEXT,
    approved TEXT DEFAULT 'No',
    date_added TEXT,
    source TEXT DEFAULT 'Manual',
    notes TEXT,
    stage TEXT DEFAULT 'NEW',
    conversation_id TEXT,
    entry_id TEXT
);

CREATE TABLE IF NOT EXISTS outreach_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    load_group_id TEXT,
    carrier_id INTEGER,
    carrier_email TEXT,
    contacted_at TEXT
);

CREATE TABLE IF NOT EXISTS zip_map (
    zip TEXT PRIMARY KEY,
    city TEXT,
    state TEXT,
    latitude REAL,
    longitude REAL,
    population REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

DEFAULT_SETTINGS = {
    "appearance_mode": "dark",
    "target_rate_default": "",
    "outlook_account": "",
    "inbox_watcher_enabled": "0",
    "inbox_watcher_interval_sec": "60",
    "blocked_sender_domains": "",
    "rate_proximity_dollars": "200",
}

# Columns added after the first release - applied with ALTER TABLE so an
# existing freight_signal_data.db from an older version of the app
# upgrades in place instead of losing data.
_MIGRATIONS = [
    ("inquiries", "stage", "TEXT DEFAULT 'NEW'"),
    ("inquiries", "conversation_id", "TEXT"),
    ("inquiries", "entry_id", "TEXT"),
]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = connect()
    with conn:
        conn.executescript(SCHEMA)
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v)
            )
        existing_cols = {
            row["name"] for row in conn.execute("PRAGMA table_info(inquiries)").fetchall()
        }
        for table, column, coltype in _MIGRATIONS:
            if column not in existing_cols:
                try:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
                except Exception:  # noqa: BLE001 - column may already exist under a race
                    pass
    conn.close()


def get_setting(key: str, default: str = "") -> str:
    conn = connect()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    conn = connect()
    with conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
    conn.close()


def now_str() -> str:
    return datetime.now().strftime("%m/%d/%Y %I:%M %p")
