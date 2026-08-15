import customtkinter as ctk

from . import db, theme
from .tabs.manual_tab import ManualTab
from .tabs.engine_tab import EngineTab
from .tabs.manual_input_tab import ManualInputTab
from .tabs.carrier_tab import CarrierTab
from .tabs.inquiry_tab import InquiryTab
from .tabs.zipmap_tab import ZipMapTab

NAV_ITEMS = [
    ("engine", "Freight Signal Engine"),
    ("input", "Manual Input"),
    ("carriers", "Carrier Database"),
    ("inquiries", "Inquiry Log"),
    ("zipmap", "ZIP Map"),
    ("manual", "User Manual"),
]

TAB_CLASSES = {
    "manual": ManualTab,
    "engine": EngineTab,
    "input": ManualInputTab,
    "carriers": CarrierTab,
    "inquiries": InquiryTab,
    "zipmap": ZipMapTab,
}


class FreightSignalApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        db.init_db()
        self.mode = db.get_setting("appearance_mode", "dark")
        theme.apply_appearance(self.mode)

        self.title("Freight Signal")
        self.geometry("1400x880")
        self.minsize(1100, 700)

        c = theme.colors(self.mode)
        self.configure(fg_color=c["bg"])

        from .ui_widgets import style_treeview
        style_treeview(self, self.mode)

        self._tab_instances = {}
        self._nav_buttons = {}
        self._active_key = None

        self._build_sidebar()
        self._build_content_area()
        self.show_tab("engine")

    # ------------------------------------------------------------------
    def _build_sidebar(self):
        c = theme.colors(self.mode)
        self.sidebar = ctk.CTkFrame(self, fg_color=c["sidebar"], width=248, corner_radius=0)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        # --- Brand block: small logo mark + wordmark, never large ---
        brand = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        brand.pack(fill="x", padx=22, pady=(26, 0))

        title_row = ctk.CTkFrame(brand, fg_color="transparent")
        title_row.pack(anchor="w", fill="x")

        logo_img = theme.get_logo_image(size=32)
        if logo_img:
            ctk.CTkLabel(title_row, image=logo_img, text="").pack(side="left", padx=(0, 10))

        name_col = ctk.CTkFrame(title_row, fg_color="transparent")
        name_col.pack(side="left")
        name_row = ctk.CTkFrame(name_col, fg_color="transparent")
        name_row.pack(anchor="w")
        ctk.CTkLabel(name_row, text="FREIGHT ", font=theme.font(16, "bold"),
                     text_color=theme.SILVER_100).pack(side="left")
        ctk.CTkLabel(name_row, text="SIGNAL", font=theme.font(16, "bold"),
                     text_color=theme.SIGNAL_BLUE_BRIGHT).pack(side="left")
        ctk.CTkLabel(name_row, text=" \u00A9", font=theme.font(10),
                     text_color=theme.SILVER_700).pack(side="left", anchor="n")
        ctk.CTkLabel(name_col, text="by O.K. Mantz", font=theme.font(10),
                     text_color=theme.SILVER_700).pack(anchor="w")

        ctk.CTkLabel(brand, text="INTELLIGENT CARRIER SOURCING\nOPTIMIZATION ENGINE",
                     font=theme.font(10, "bold"), text_color=theme.SILVER_500, justify="left") \
            .pack(anchor="w", pady=(14, 0))

        divider = ctk.CTkFrame(self.sidebar, height=1, fg_color=theme.INK_600)
        divider.pack(fill="x", padx=22, pady=20)

        # --- Navigation ---
        nav_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        nav_frame.pack(fill="x", padx=14)
        for key, label in NAV_ITEMS:
            btn = ctk.CTkButton(
                nav_frame, text=label, anchor="w", height=40, corner_radius=theme.RADIUS_SM,
                font=theme.font(12), fg_color="transparent", hover_color=theme.INK_700,
                text_color=theme.SILVER_300, command=lambda k=key: self.show_tab(k),
            )
            btn.pack(fill="x", pady=2)
            self._nav_buttons[key] = btn

        # --- Bottom: appearance toggle ---
        bottom = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        bottom.pack(side="bottom", fill="x", padx=22, pady=22)
        divider2 = ctk.CTkFrame(self.sidebar, height=1, fg_color=theme.INK_600)
        divider2.pack(side="bottom", fill="x", padx=22, pady=(0, 4))

        self.mode_switch_var = ctk.StringVar(value="on" if self.mode == "dark" else "off")
        row = ctk.CTkFrame(bottom, fg_color="transparent")
        row.pack(fill="x")
        ctk.CTkLabel(row, text="Dark Mode", font=theme.font(11),
                     text_color=theme.SILVER_500).pack(side="left")
        ctk.CTkSwitch(row, text="", variable=self.mode_switch_var, onvalue="on", offvalue="off",
                      command=self.toggle_appearance, progress_color=theme.SIGNAL_BLUE,
                      button_color=theme.SILVER_100, width=38).pack(side="right")

    def _build_content_area(self):
        c = theme.colors(self.mode)
        self.content = ctk.CTkFrame(self, fg_color=c["bg"], corner_radius=0)
        self.content.pack(side="left", fill="both", expand=True)

    # ------------------------------------------------------------------
    def show_tab(self, key):
        for frame in self._tab_instances.values():
            frame.pack_forget()
        if key not in self._tab_instances:
            self._tab_instances[key] = TAB_CLASSES[key](self.content, self)
        self._tab_instances[key].pack(fill="both", expand=True)
        self._active_key = key

        c = theme.colors(self.mode)
        for k, btn in self._nav_buttons.items():
            is_active = k == key
            btn.configure(
                fg_color=c["accent_dim"] if is_active else "transparent",
                text_color=c["accent_bright"] if is_active else theme.SILVER_300,
                font=theme.font(12, "bold" if is_active else "normal"),
            )

    def refresh_tab(self, key):
        if key in self._tab_instances and hasattr(self._tab_instances[key], "refresh"):
            self._tab_instances[key].refresh()

    def toggle_appearance(self):
        self.mode = "dark" if self.mode_switch_var.get() == "on" else "light"
        db.set_setting("appearance_mode", self.mode)
        theme.apply_appearance(self.mode)
        # Full rebuild is the most reliable way to re-theme every custom
        # widget/table color; state itself lives in SQLite so nothing is lost.
        for child in self.winfo_children():
            child.destroy()
        self._tab_instances = {}
        self._nav_buttons = {}
        c = theme.colors(self.mode)
        self.configure(fg_color=c["bg"])
        from .ui_widgets import style_treeview
        style_treeview(self, self.mode)
        self._build_sidebar()
        self._build_content_area()
        self.show_tab(self._active_key or "engine")


def run():
    app = FreightSignalApp()
    app.mainloop()
