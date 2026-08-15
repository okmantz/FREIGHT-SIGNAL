import customtkinter as ctk

from .. import csv_io, db, theme
from ..ui_widgets import Table, Toast, ask_open_filename, confirm, error


class ZipMapTab(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        c = theme.colors(app.mode)

        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=theme.PAD, pady=(theme.PAD, 8))
        ctk.CTkLabel(header, text="ZIP Map", font=theme.font(20, "bold")).pack(side="left")
        self.toast = Toast(header, font=theme.font(12))
        self.toast.pack(side="right")

        ctk.CTkLabel(
            self, text="Used to find alternate nearby origin/destination cities (20-60 mile ring) for the "
                       "3x3 posting matrix. Import a CSV with columns: Zip, City, State, Latitude, Longitude, Population.",
            font=theme.font(12), text_color=c["text_muted"], wraplength=900, justify="left",
        ).pack(anchor="w", padx=theme.PAD, pady=(0, 8))

        toolbar = ctk.CTkFrame(self, fg_color="transparent")
        toolbar.pack(fill="x", padx=theme.PAD, pady=(0, 8))
        ctk.CTkButton(toolbar, text="Import ZIP Map CSV", width=170, command=self.import_csv,
                      fg_color=c["accent"], text_color=theme.SILVER_100).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Clear ZIP Map", width=140, command=self.clear_all,
                      fg_color=c["danger"]).pack(side="left", padx=(0, 8))
        self.count_label = ctk.CTkLabel(toolbar, text="", font=theme.font(12), text_color=c["text_muted"])
        self.count_label.pack(side="left", padx=(16, 0))

        columns = [("zip", "ZIP", 80), ("city", "City", 180), ("state", "State", 60),
                   ("lat", "Latitude", 100), ("lon", "Longitude", 100), ("pop", "Population", 100)]
        self.table = Table(self, columns, mode=app.mode)
        self.table.pack(fill="both", expand=True, padx=theme.PAD, pady=(0, theme.PAD))
        self.refresh()

    def refresh(self):
        conn = db.connect()
        rows = conn.execute("SELECT * FROM zip_map ORDER BY state, city LIMIT 2000").fetchall()
        total = conn.execute("SELECT COUNT(*) c FROM zip_map").fetchone()["c"]
        conn.close()
        self.table.load_rows(rows, lambda r: (r["zip"], r["city"], r["state"], r["latitude"], r["longitude"], r["population"]),
                              lambda r: r["zip"])
        self.count_label.configure(text=f"{total:,} ZIP rows loaded" + (" (showing first 2,000)" if total > 2000 else ""))

    def import_csv(self):
        path = ask_open_filename(self, [("CSV files", "*.csv")])
        if not path:
            return
        try:
            rows = csv_io.import_zip_map_csv(path)
        except Exception as exc:  # noqa: BLE001
            error(self, "Import Failed", str(exc))
            return
        conn = db.connect()
        with conn:
            for r in rows:
                conn.execute(
                    "INSERT INTO zip_map (zip, city, state, latitude, longitude, population) VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(zip) DO UPDATE SET city=excluded.city, state=excluded.state, "
                    "latitude=excluded.latitude, longitude=excluded.longitude, population=excluded.population",
                    (r["zip"], r["city"], r["state"], r["latitude"], r["longitude"], r["population"]),
                )
        conn.close()
        self.refresh()
        self.toast.show(f"Imported {len(rows)} ZIP Map rows.", theme.colors(self.app.mode)["success"])

    def clear_all(self):
        if not confirm(self, "Clear ZIP Map", "Delete every row from the ZIP Map? This cannot be undone."):
            return
        conn = db.connect()
        with conn:
            conn.execute("DELETE FROM zip_map")
        conn.close()
        self.refresh()
