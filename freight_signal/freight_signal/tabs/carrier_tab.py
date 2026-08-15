import customtkinter as ctk

from .. import csv_io, db, theme
from ..ui_widgets import Table, Toast, ask_open_filename, confirm, error, info

FIELDS = [
    ("carrier_name", "Carrier Name"), ("mc_dot", "MC/DOT"), ("email", "Email"), ("phone", "Phone"),
    ("origin_city", "Origin City"), ("origin_state", "Origin State"),
    ("dest_city", "Destination City"), ("dest_state", "Destination State"),
    ("equipment", "Equipment"), ("preferred_pickup_dates", "Preferred Pickup Dates"),
    ("rate", "Rate"), ("status", "Status"), ("notes", "Notes"),
]


class CarrierEditDialog(ctk.CTkToplevel):
    def __init__(self, master, app, row=None, on_save=None):
        super().__init__(master)
        self.title("Carrier" if row else "Add Carrier")
        self.geometry("420x620")
        self.on_save = on_save
        self.row_id = row["id"] if row else None
        c = theme.colors(app.mode)
        self.configure(fg_color=c["bg"])
        self.vars = {}

        for key, label in FIELDS:
            ctk.CTkLabel(self, text=label, font=theme.font(12)).pack(anchor="w", padx=16, pady=(10, 0))
            var = ctk.StringVar(value=(row[key] if row and row[key] else ""))
            ctk.CTkEntry(self, textvariable=var).pack(fill="x", padx=16)
            self.vars[key] = var

        ctk.CTkButton(self, text="Save", command=self._save, fg_color=c["accent"], text_color=theme.SILVER_100).pack(
            pady=18, padx=16, fill="x")

    def _save(self):
        data = {k: v.get().strip() for k, v in self.vars.items()}
        if self.on_save:
            self.on_save(self.row_id, data)
        self.destroy()


class CarrierTab(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        c = theme.colors(app.mode)

        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=theme.PAD, pady=(theme.PAD, 8))
        ctk.CTkLabel(header, text="Carrier Database", font=theme.font(20, "bold")).pack(side="left")
        self.toast = Toast(header, font=theme.font(12))
        self.toast.pack(side="right")

        toolbar = ctk.CTkFrame(self, fg_color="transparent")
        toolbar.pack(fill="x", padx=theme.PAD, pady=(0, 8))
        ctk.CTkButton(toolbar, text="Import Carrier CSV", width=170, command=self.import_csv,
                      fg_color=c["accent"], text_color=theme.SILVER_100).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Add Carrier", width=120, command=self.add_carrier,
                      fg_color=c["surface_alt"], text_color=c["text"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Edit Selected", width=130, command=self.edit_selected,
                      fg_color=c["surface_alt"], text_color=c["text"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Delete Selected", width=140, command=self.delete_selected,
                      fg_color=c["danger"]).pack(side="left", padx=(0, 8))

        columns = [
            ("name", "Carrier Name", 150), ("mc", "MC/DOT", 90), ("email", "Email", 190),
            ("phone", "Phone", 110), ("lane", "Lane", 220), ("equip", "Equip", 60),
            ("rate", "Rate", 70), ("covers", "Covers", 60), ("status", "Status", 70),
        ]
        self.table = Table(self, columns, on_double_click=lambda rid: self.edit_selected(), mode=app.mode)
        self.table.pack(fill="both", expand=True, padx=theme.PAD, pady=(0, theme.PAD))
        self.refresh()

    def refresh(self):
        conn = db.connect()
        rows = conn.execute("SELECT * FROM carriers ORDER BY carrier_name").fetchall()
        conn.close()

        def display(r):
            lane = f"{r['origin_city']}, {r['origin_state']} -> {r['dest_city']}, {r['dest_state']}"
            return (r["carrier_name"], r["mc_dot"], r["email"], r["phone"], lane,
                    r["equipment"], r["rate"], r["cover_count"], r["status"])

        self.table.load_rows(rows, display, lambda r: r["id"])

    def import_csv(self):
        path = ask_open_filename(self, [("CSV files", "*.csv")])
        if not path:
            return
        try:
            rows = csv_io.import_carrier_csv(path)
        except Exception as exc:  # noqa: BLE001
            error(self, "Import Failed", str(exc))
            return
        conn = db.connect()
        with conn:
            for r in rows:
                conn.execute(
                    """INSERT INTO carriers (carrier_name, mc_dot, email, phone, origin_city, origin_state,
                        dest_city, dest_state, equipment, preferred_pickup_dates, rate, status, notes)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (r["carrier_name"], r["mc_dot"], r["email"], r["phone"], r["origin_city"], r["origin_state"],
                     r["dest_city"], r["dest_state"], r["equipment"], r["preferred_pickup_dates"], r["rate"],
                     r["status"] or "Active", r["notes"]),
                )
        conn.close()
        self.refresh()
        self.toast.show(f"Imported {len(rows)} carriers.", theme.colors(self.app.mode)["success"])

    def add_carrier(self):
        CarrierEditDialog(self, self.app, on_save=self._save_carrier)

    def edit_selected(self):
        cid = self.table.selected_id()
        if not cid:
            error(self, "No selection", "Select a carrier row first.")
            return
        conn = db.connect()
        row = conn.execute("SELECT * FROM carriers WHERE id=?", (cid,)).fetchone()
        conn.close()
        CarrierEditDialog(self, self.app, row=row, on_save=self._save_carrier)

    def _save_carrier(self, row_id, data):
        conn = db.connect()
        with conn:
            if row_id:
                sets = ", ".join(f"{k}=?" for k in data)
                conn.execute(f"UPDATE carriers SET {sets} WHERE id=?", (*data.values(), row_id))
            else:
                cols = ", ".join(data.keys())
                qs = ", ".join("?" for _ in data)
                conn.execute(f"INSERT INTO carriers ({cols}) VALUES ({qs})", tuple(data.values()))
        conn.close()
        self.refresh()

    def delete_selected(self):
        cid = self.table.selected_id()
        if not cid:
            error(self, "No selection", "Select a carrier row first.")
            return
        if not confirm(self, "Delete Carrier", "Remove this carrier from the database?"):
            return
        conn = db.connect()
        with conn:
            conn.execute("DELETE FROM carriers WHERE id=?", (cid,))
        conn.close()
        self.refresh()
