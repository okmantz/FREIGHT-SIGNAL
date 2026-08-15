import customtkinter as ctk

from .. import db, engine, parsing, theme
from ..ui_widgets import Toast, error, info


PLACEHOLDER = (
    "Pickup: Aiken, SC 29801\n"
    "Delivery: Fletcher, OK 73541\n"
    "Pickup Date/Time: 8/14/2026 8:00 AM\n"
    "Delivery Date/Time: 8/15/2026\n"
    "Weight: 40,000 lbs\n"
    "Trailer Type: Dry Van"
)


class ManualInputTab(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        self.app = app
        c = theme.colors(app.mode)
        self._parsed = None

        ctk.CTkLabel(self, text="Manual Load Input", font=theme.font(20, "bold")).pack(
            anchor="w", padx=theme.PAD, pady=(theme.PAD, 4))
        ctk.CTkLabel(self, text="Paste load-board details below, or type them in the same labeled format.",
                     font=theme.font(12), text_color=c["text_muted"]).pack(anchor="w", padx=theme.PAD, pady=(0, 12))

        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=theme.PAD)
        body.grid_columnconfigure(0, weight=3)
        body.grid_columnconfigure(1, weight=2)
        body.grid_rowconfigure(0, weight=1)

        left = ctk.CTkFrame(body, fg_color=c["surface"], corner_radius=theme.RADIUS)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        ctk.CTkLabel(left, text="Load Details", font=theme.font(14, "bold")).pack(anchor="w", padx=16, pady=(14, 4))
        self.text_box = ctk.CTkTextbox(left, font=theme.font(12, mono=True), wrap="word")
        self.text_box.pack(fill="both", expand=True, padx=16, pady=(0, 12))
        self.text_box.insert("1.0", PLACEHOLDER)

        btn_row = ctk.CTkFrame(left, fg_color="transparent")
        btn_row.pack(fill="x", padx=16, pady=(0, 16))
        ctk.CTkButton(btn_row, text="Parse Load", command=self.parse_load,
                      fg_color=c["surface_alt"], text_color=c["text"]).pack(side="left", padx=(0, 8))
        self.parse_status = ctk.CTkLabel(btn_row, text="", font=theme.font(12))
        self.parse_status.pack(side="left")

        right = ctk.CTkFrame(body, fg_color=c["surface"], corner_radius=theme.RADIUS)
        right.grid(row=0, column=1, sticky="nsew")
        ctk.CTkLabel(right, text="Posting Options", font=theme.font(14, "bold")).pack(anchor="w", padx=16, pady=(14, 8))

        self.parsed_preview = ctk.CTkLabel(right, text="Parse a load to preview the parsed fields.",
                                            font=theme.font(11, mono=True), text_color=c["text_muted"],
                                            justify="left", anchor="w")
        self.parsed_preview.pack(anchor="w", padx=16, pady=(0, 12), fill="x")

        self.priority_var = ctk.StringVar(value="Low")
        ctk.CTkLabel(right, text="Priority", font=theme.font(12)).pack(anchor="w", padx=16)
        ctk.CTkOptionMenu(right, values=["Low", "Medium", "High"], variable=self.priority_var,
                          fg_color=c["surface_alt"], button_color=c["accent"]).pack(anchor="w", padx=16, pady=(2, 12))

        self.target_rate_var = ctk.StringVar()
        ctk.CTkLabel(right, text="Target Rate ($, optional)", font=theme.font(12)).pack(anchor="w", padx=16)
        ctk.CTkEntry(right, textvariable=self.target_rate_var, placeholder_text="e.g. 2100").pack(
            anchor="w", padx=16, pady=(2, 12), fill="x")

        self.rate_fraction_var = ctk.StringVar(value="6 of 9 (2/3)")
        ctk.CTkLabel(right, text="Postings With a Rate", font=theme.font(12)).pack(anchor="w", padx=16)
        ctk.CTkOptionMenu(right, values=["6 of 9 (2/3)", "3 of 9 (1/3)", "9 of 9 (all)", "0 of 9 (none)"],
                          variable=self.rate_fraction_var, fg_color=c["surface_alt"],
                          button_color=c["accent"]).pack(anchor="w", padx=16, pady=(2, 12), fill="x")

        self.comment_var = ctk.StringVar()
        ctk.CTkLabel(right, text="Comment (optional)", font=theme.font(12)).pack(anchor="w", padx=16)
        ctk.CTkEntry(right, textvariable=self.comment_var).pack(anchor="w", padx=16, pady=(2, 12), fill="x")

        self.commodity_var = ctk.StringVar()
        ctk.CTkLabel(right, text="Commodity (optional)", font=theme.font(12)).pack(anchor="w", padx=16)
        ctk.CTkEntry(right, textvariable=self.commodity_var).pack(anchor="w", padx=16, pady=(2, 12), fill="x")

        self.reference_var = ctk.StringVar()
        ctk.CTkLabel(right, text="Reference ID (optional)", font=theme.font(12)).pack(anchor="w", padx=16)
        ctk.CTkEntry(right, textvariable=self.reference_var).pack(anchor="w", padx=16, pady=(2, 16), fill="x")

        ctk.CTkButton(right, text="Generate 9 Postings", height=42, font=theme.font(14, "bold"),
                      fg_color=c["accent"], text_color=theme.SILVER_100, hover_color=c["accent_hover"],
                      command=self.generate).pack(fill="x", padx=16, pady=(0, 16))

        self.toast = Toast(right, font=theme.font(12), wraplength=260, justify="left")
        self.toast.pack(anchor="w", padx=16, pady=(0, 16), fill="x")

    def parse_load(self):
        raw = self.text_box.get("1.0", "end").strip()
        parsed = parsing.parse_load_details(raw)
        self._parsed = parsed
        preview = (
            f"Origin:      {parsed.origin_city}, {parsed.origin_state} {parsed.origin_zip}\n"
            f"Destination: {parsed.dest_city}, {parsed.dest_state} {parsed.dest_zip}\n"
            f"Pickup:      {parsed.pickup_earliest}\n"
            f"Weight:      {parsed.weight_lbs} lbs\n"
            f"Equipment:   {parsed.equipment}"
        )
        self.parsed_preview.configure(text=preview)
        if parsed.warnings:
            self.parse_status.configure(text="⚠ " + " ".join(parsed.warnings), text_color=theme.SIGNAL_RED)
        else:
            self.parse_status.configure(text="✓ Parsed successfully.", text_color=theme.colors(self.app.mode)["success"])

    def generate(self):
        if not self._parsed or not self._parsed.origin_city or not self._parsed.dest_city:
            error(self, "Parse Required", "Click 'Parse Load' first, and make sure origin/destination were found.")
            return

        fraction_map = {
            "6 of 9 (2/3)": 2 / 3, "3 of 9 (1/3)": 1 / 3, "9 of 9 (all)": 1.0, "0 of 9 (none)": 0.0,
        }
        conn = db.connect()
        group_id, warnings = engine.generate_postings(
            conn, self._parsed,
            priority=self.priority_var.get(),
            rate_fraction_with_rate=fraction_map[self.rate_fraction_var.get()],
            target_rate=self.target_rate_var.get().strip() or None,
            comment=self.comment_var.get().strip(),
            commodity=self.commodity_var.get().strip(),
            reference_id=self.reference_var.get().strip(),
        )
        count = conn.execute(
            "SELECT COUNT(*) c FROM postings WHERE load_group_id=?", (group_id,)
        ).fetchone()["c"]
        conn.close()

        c = theme.colors(self.app.mode)
        if warnings:
            self.toast.show(
                f"Generated {count} posting(s) for {group_id} - ZIP Map coverage was limited near this "
                "lane, see popup for details.", c["danger"], ms=9000,
            )
        else:
            self.toast.show(f"Generated {count} unique postings for load group {group_id}.",
                             c["success"], ms=8000)
        self.app.refresh_tab("engine")

        detail = f"{count} unique posting(s) created for load group {group_id}."
        if warnings:
            detail += "\n\n" + "\n\n".join(warnings)
        else:
            detail += " (3 origins x 3 destinations, all distinct - no lane was duplicated.)"
        detail += ("\n\nOpen the 'Freight Signal Engine' tab to review, adjust priority, draft carrier "
                   "outreach, or export to CSV for DAT.")
        info(self, "Postings Generated", detail)
