import customtkinter as ctk

from .. import csv_io, db, engine, theme
from ..ui_widgets import Table, Toast, ask_save_filename, confirm, error, info


class EngineTab(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        c = theme.colors(app.mode)

        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=theme.PAD, pady=(theme.PAD, 8))
        ctk.CTkLabel(header, text="Freight Signal Engine", font=theme.font(20, "bold")).pack(side="left")
        self.toast = Toast(header, font=theme.font(12))
        self.toast.pack(side="right")

        toolbar = ctk.CTkFrame(self, fg_color="transparent")
        toolbar.pack(fill="x", padx=theme.PAD, pady=(0, 8))

        ctk.CTkButton(toolbar, text="Refresh", width=100, command=self.refresh,
                      fg_color=c["surface_alt"], text_color=c["text"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Mark Covered", width=130, command=self.mark_covered,
                      fg_color=c["danger"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Set High Priority", width=140, command=lambda: self.set_priority("High"),
                      fg_color=theme.PRIORITY_HIGH, text_color=theme.SILVER_100).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Set Medium Priority", width=160, command=lambda: self.set_priority("Medium"),
                      fg_color=theme.PRIORITY_MEDIUM, text_color=theme.INK_950).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Set Low Priority", width=140, command=lambda: self.set_priority("Low"),
                      fg_color=theme.PRIORITY_LOW, text_color=theme.SILVER_100).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Toggle Carrier Outreach", width=190, command=self.toggle_outreach,
                      fg_color=c["info"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Draft Outlook Outreach", width=180, command=self.draft_outreach,
                      fg_color=c["accent"], text_color=theme.SILVER_100).pack(side="left", padx=(0, 8))

        toolbar2 = ctk.CTkFrame(self, fg_color="transparent")
        toolbar2.pack(fill="x", padx=theme.PAD, pady=(0, 8))
        ctk.CTkButton(toolbar2, text="Export Selected Load Group to CSV", width=230,
                      command=self.export_group_csv, fg_color=c["success"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar2, text="Export ALL Active Postings to CSV", width=230,
                      command=self.export_all_csv, fg_color=c["success"]).pack(side="left", padx=(0, 8))

        columns = [
            ("group", "Load Group", 100), ("variant", "Variant", 110),
            ("origin", "Origin", 150), ("dest", "Destination", 150),
            ("equip", "Equip", 60), ("pickup", "Pickup", 90),
            ("weight", "Weight", 70), ("rate", "DAT Rate", 80),
            ("miles", "O/D mi", 90), ("inquiries", "Inquiries", 70),
            ("priority", "Priority", 80), ("outreach", "Outreach", 70),
            ("status", "Status", 70),
        ]
        self.table = Table(self, columns, on_select=self._on_select, mode=app.mode)
        self.table.pack(fill="both", expand=True, padx=theme.PAD, pady=(0, theme.PAD))
        self.table.tag_color("high", theme.PRIORITY_HIGH)
        self.table.tag_color("medium", theme.PRIORITY_MEDIUM)
        self.table.tag_color("low", theme.PRIORITY_LOW)

        self._selected_group = None
        self.refresh()

    def _on_select(self, posting_id):
        conn = db.connect()
        row = conn.execute("SELECT load_group_id FROM postings WHERE id=?", (posting_id,)).fetchone()
        conn.close()
        self._selected_group = row["load_group_id"] if row else None

    def refresh(self):
        conn = db.connect()
        rows = conn.execute(
            "SELECT * FROM postings WHERE load_status='Active' ORDER BY load_group_id, id"
        ).fetchall()
        conn.close()

        def display(r):
            return (
                r["load_group_id"], r["variant_name"],
                f"{r['origin_city']}, {r['origin_state']}", f"{r['dest_city']}, {r['dest_state']}",
                r["equipment"], r["pickup_earliest"], r["weight_lbs"],
                r["dat_loadboard_rate"] or "-", f"{r['origin_miles']}/{r['dest_miles']}",
                int(r["inquiry_count"] or 0), r["priority"], r["carrier_outreach"], r["load_status"],
            )

        def tag(r):
            return (r["priority"].lower(),) if r["priority"] else ()

        self.table.load_rows(rows, display, lambda r: r["id"], tag)

    def mark_covered(self):
        if not self._selected_group:
            error(self, "No selection", "Select a posting row first.")
            return
        if not confirm(self, "Mark Load Covered",
                        f"This removes ALL 9 postings in load group {self._selected_group}. Continue?"):
            return
        conn = db.connect()
        engine.mark_group_covered(conn, self._selected_group)
        conn.close()
        self.refresh()
        self.toast.show(f"Load group {self._selected_group} marked covered and removed.", theme.colors(self.app.mode)["success"])

    def set_priority(self, priority):
        if not self._selected_group:
            error(self, "No selection", "Select a posting row first.")
            return
        conn = db.connect()
        engine.set_group_priority(conn, self._selected_group, priority)
        conn.close()
        self.refresh()
        self.toast.show(f"Priority set to {priority} for {self._selected_group}.", theme.priority_color(priority))

    def toggle_outreach(self):
        pid = self.table.selected_id()
        if not pid:
            error(self, "No selection", "Select a posting row first.")
            return
        conn = db.connect()
        row = conn.execute("SELECT carrier_outreach FROM postings WHERE id=?", (pid,)).fetchone()
        new_val = "No" if row["carrier_outreach"] == "Yes" else "Yes"
        engine.set_row_carrier_outreach(conn, pid, new_val)
        conn.close()
        self.refresh()

    def draft_outreach(self):
        if not self._selected_group:
            error(self, "No selection", "Select a posting row first.")
            return
        from .. import outlook_integration as ol
        conn = db.connect()
        try:
            created = ol.generate_outreach_for_group(conn, self._selected_group)
            info(self, "Outlook Drafts Created", f"{len(created)} outreach draft(s) created in Outlook > Drafts.")
        except ol.OutlookUnavailableError as exc:
            error(self, "Outlook Unavailable", str(exc))
        finally:
            conn.close()
        self.refresh()

    def export_group_csv(self):
        if not self._selected_group:
            error(self, "No selection", "Select a posting row first.")
            return
        path = ask_save_filename(self, ".csv", [("CSV files", "*.csv")],
                                  initialfile=f"{self._selected_group}_DAT_export.csv")
        if not path:
            return
        conn = db.connect()
        rows = conn.execute("SELECT * FROM postings WHERE load_group_id=?", (self._selected_group,)).fetchall()
        conn.close()
        csv_io.export_postings_csv(rows, path)
        self.toast.show(f"Exported {len(rows)} postings to {path}", theme.colors(self.app.mode)["success"])

    def export_all_csv(self):
        path = ask_save_filename(self, ".csv", [("CSV files", "*.csv")], initialfile="FreightSignal_DAT_export.csv")
        if not path:
            return
        conn = db.connect()
        rows = conn.execute("SELECT * FROM postings WHERE load_status='Active'").fetchall()
        conn.close()
        csv_io.export_postings_csv(rows, path)
        self.toast.show(f"Exported {len(rows)} postings to {path}", theme.colors(self.app.mode)["success"])
