import customtkinter as ctk

from .. import db, theme
from ..ui_widgets import Table, Toast, error, info

FIELDS = [
    ("carrier_name", "Carrier Name"), ("mc_dot", "MC/DOT"), ("email", "Email"), ("phone", "Phone"),
    ("origin_city", "Origin City"), ("origin_state", "Origin State"),
    ("dest_city", "Destination City"), ("dest_state", "Destination State"),
    ("equipment", "Equipment"), ("preferred_pickup_dates", "Preferred Pickup Dates"), ("rate", "Rate"),
]


class InquiryAddDialog(ctk.CTkToplevel):
    def __init__(self, master, app, on_save):
        super().__init__(master)
        self.title("Log Carrier Inquiry")
        self.geometry("400x560")
        c = theme.colors(app.mode)
        self.configure(fg_color=c["bg"])
        self.vars = {}
        for key, label in FIELDS:
            ctk.CTkLabel(self, text=label, font=theme.font(12)).pack(anchor="w", padx=16, pady=(10, 0))
            var = ctk.StringVar()
            ctk.CTkEntry(self, textvariable=var).pack(fill="x", padx=16)
            self.vars[key] = var
        ctk.CTkButton(self, text="Save Inquiry", command=lambda: (on_save({k: v.get().strip() for k, v in self.vars.items()}), self.destroy()),
                      fg_color=c["accent"], text_color=theme.SILVER_100).pack(pady=18, padx=16, fill="x")


class InquiryTab(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        c = theme.colors(app.mode)
        self._watcher = None

        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=theme.PAD, pady=(theme.PAD, 8))
        ctk.CTkLabel(header, text="Inquiry Log", font=theme.font(20, "bold")).pack(side="left")
        self.toast = Toast(header, font=theme.font(12))
        self.toast.pack(side="right")

        toolbar = ctk.CTkFrame(self, fg_color="transparent")
        toolbar.pack(fill="x", padx=theme.PAD, pady=(0, 8))
        ctk.CTkButton(toolbar, text="Log Inquiry Manually", width=170, command=self.add_inquiry,
                      fg_color=c["surface_alt"], text_color=c["text"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Approve Selected -> Add to Carrier DB", width=260,
                      command=lambda: self.set_approved("Yes"),
                      fg_color=c["success"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Mark Not Approved", width=170, command=lambda: self.set_approved("No"),
                      fg_color=c["surface_alt"], text_color=c["text"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Scan Outlook Inbox Now", width=200, command=self.scan_now,
                      fg_color=c["info"]).pack(side="left", padx=(0, 8))
        ctk.CTkButton(toolbar, text="Draft Reply in Outlook", width=180, command=self.draft_reply,
                      fg_color=c["accent"], text_color=theme.SILVER_100).pack(side="left", padx=(0, 8))

        self.watcher_switch_var = ctk.StringVar(value="off")
        self.watcher_switch = ctk.CTkSwitch(toolbar, text="Inbox Watcher", variable=self.watcher_switch_var,
                                             onvalue="on", offvalue="off", command=self.toggle_watcher,
                                             progress_color=c["accent"])
        self.watcher_switch.pack(side="left", padx=(16, 0))

        settings_row = ctk.CTkFrame(self, fg_color="transparent")
        settings_row.pack(fill="x", padx=theme.PAD, pady=(0, 8))
        ctk.CTkLabel(settings_row, text="Rate proximity ($):", font=theme.font(11),
                     text_color=c["text_muted"]).pack(side="left")
        self.rate_proximity_var = ctk.StringVar(value=db.get_setting("rate_proximity_dollars", "200"))
        rp_entry = ctk.CTkEntry(settings_row, textvariable=self.rate_proximity_var, width=70)
        rp_entry.pack(side="left", padx=(6, 20))
        rp_entry.bind("<FocusOut>", lambda e: db.set_setting("rate_proximity_dollars", self.rate_proximity_var.get().strip() or "200"))

        ctk.CTkLabel(settings_row, text="Blocked sender domains (comma-separated):", font=theme.font(11),
                     text_color=c["text_muted"]).pack(side="left")
        self.blocked_domains_var = ctk.StringVar(value=db.get_setting("blocked_sender_domains", ""))
        bd_entry = ctk.CTkEntry(settings_row, textvariable=self.blocked_domains_var, width=260)
        bd_entry.pack(side="left", padx=(6, 0))
        bd_entry.bind("<FocusOut>", lambda e: db.set_setting("blocked_sender_domains", self.blocked_domains_var.get().strip()))

        columns = [
            ("group", "Load Group", 100), ("carrier", "Carrier", 140), ("email", "Email", 180),
            ("lane", "Lane", 220), ("equip", "Equip", 60), ("rate", "Rate", 70),
            ("within", "Within Target", 100), ("stage", "Stage", 130), ("approved", "Approved", 80),
            ("date", "Date Added", 130), ("source", "Source", 130),
        ]
        self.table = Table(self, columns, mode=app.mode)
        self.table.pack(fill="both", expand=True, padx=theme.PAD, pady=(0, theme.PAD))
        self.refresh()

    def refresh(self):
        conn = db.connect()
        rows = conn.execute("SELECT * FROM inquiries ORDER BY id DESC").fetchall()
        conn.close()

        def display(r):
            lane = f"{r['origin_city']}, {r['origin_state']} -> {r['dest_city']}, {r['dest_state']}"
            return (r["load_group_id"], r["carrier_name"], r["email"], lane, r["equipment"],
                    r["rate"], r["quoted_within_target"], r["stage"], r["approved"], r["date_added"], r["source"])

        self.table.load_rows(rows, display, lambda r: r["id"])

    def add_inquiry(self):
        def save(data):
            conn = db.connect()
            with conn:
                conn.execute(
                    """INSERT INTO inquiries (carrier_name, mc_dot, email, phone, origin_city, origin_state,
                        dest_city, dest_state, equipment, preferred_pickup_dates, rate, approved, date_added, source)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (data["carrier_name"], data["mc_dot"], data["email"], data["phone"], data["origin_city"],
                     data["origin_state"], data["dest_city"], data["dest_state"], data["equipment"],
                     data["preferred_pickup_dates"], data["rate"], "No", db.now_str(), "Manual"),
                )
            conn.close()
            self.refresh()
        InquiryAddDialog(self, self.app, save)

    def set_approved(self, value):
        iid = self.table.selected_id()
        if not iid:
            error(self, "No selection", "Select an inquiry row first.")
            return
        conn = db.connect()
        row = conn.execute("SELECT * FROM inquiries WHERE id=?", (iid,)).fetchone()
        with conn:
            conn.execute("UPDATE inquiries SET approved=?, date_added=COALESCE(date_added, ?) WHERE id=?",
                         (value, db.now_str(), iid))
        if value == "Yes":
            self._add_or_update_carrier(conn, row)
        conn.close()
        self.refresh()
        self.app.refresh_tab("carriers")
        self.toast.show("Inquiry approved and added to Carrier Database." if value == "Yes" else "Marked not approved.",
                         theme.colors(self.app.mode)["success"])

    def _add_or_update_carrier(self, conn, inquiry_row):
        existing = None
        if inquiry_row["mc_dot"]:
            existing = conn.execute("SELECT * FROM carriers WHERE mc_dot=? AND mc_dot!=''", (inquiry_row["mc_dot"],)).fetchone()
        if not existing and inquiry_row["email"]:
            existing = conn.execute("SELECT * FROM carriers WHERE lower(email)=? AND email!=''", (inquiry_row["email"].lower(),)).fetchone()

        with conn:
            if existing:
                conn.execute(
                    "UPDATE carriers SET cover_count=cover_count+1, last_covered=?, status='Active', "
                    "notes=COALESCE(notes,'') || ' | Approved from Inquiry Log ' || ? WHERE id=?",
                    (db.now_str(), db.now_str(), existing["id"]),
                )
            else:
                conn.execute(
                    """INSERT INTO carriers (carrier_name, mc_dot, email, phone, origin_city, origin_state,
                        dest_city, dest_state, equipment, preferred_pickup_dates, rate, last_covered,
                        cover_count, status, notes)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (inquiry_row["carrier_name"], inquiry_row["mc_dot"], inquiry_row["email"], inquiry_row["phone"],
                     inquiry_row["origin_city"], inquiry_row["origin_state"], inquiry_row["dest_city"],
                     inquiry_row["dest_state"], inquiry_row["equipment"], inquiry_row["preferred_pickup_dates"],
                     inquiry_row["rate"], db.now_str(), 1, "Active", f"Approved from Inquiry Log {db.now_str()}"),
                )

    def draft_reply(self):
        iid = self.table.selected_id()
        if not iid:
            error(self, "No selection", "Select an inquiry row first.")
            return
        from .. import outlook_integration as ol
        conn = db.connect()
        try:
            row = conn.execute("SELECT * FROM inquiries WHERE id=?", (iid,)).fetchone()
            ol.draft_reply_for_inquiry(conn, row)
            info(self, "Draft Created", "A reply draft was created in Outlook, keeping the original thread.")
        except ol.OutlookUnavailableError as exc:
            error(self, "Outlook Unavailable", str(exc))
        finally:
            conn.close()

    def scan_now(self):
        from .. import outlook_integration as ol
        conn = db.connect()
        try:
            count = ol.scan_inbox_once(conn)
            info(self, "Inbox Scan Complete", f"{count} new carrier inquiry email(s) logged.")
        except ol.OutlookUnavailableError as exc:
            error(self, "Outlook Unavailable", str(exc))
        finally:
            conn.close()
        self.refresh()

    def toggle_watcher(self):
        from .. import outlook_integration as ol
        if self.watcher_switch_var.get() == "on":
            interval = int(db.get_setting("inbox_watcher_interval_sec", "60"))
            self._watcher = ol.InboxWatcher(
                db.connect, interval_sec=interval,
                on_result=lambda n: self.after(0, lambda: (self.refresh() if n else None)),
                on_error=lambda e: None,
            )
            self._watcher.start()
            db.set_setting("inbox_watcher_enabled", "1")
            self.toast.show("Inbox Watcher started - polling Outlook every "
                             f"{interval}s for tagged carrier replies.", theme.colors(self.app.mode)["success"])
        else:
            if self._watcher:
                self._watcher.stop()
            db.set_setting("inbox_watcher_enabled", "0")
            self.toast.show("Inbox Watcher stopped.", theme.colors(self.app.mode)["text_muted"])
