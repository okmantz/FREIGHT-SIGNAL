"""
Freight Signal (c) - shared UI building blocks used across all tabs:
a themed table (ttk.Treeview wrapped for CTk), a toast/status bar, and
small modal helpers for editing/importing.
"""
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

import customtkinter as ctk

from . import theme


def style_treeview(root: ctk.CTk, mode: str):
    c = theme.colors(mode)
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure(
        "Freight.Treeview",
        background=c["surface"],
        fieldbackground=c["surface"],
        foreground=c["text"],
        rowheight=30,
        borderwidth=0,
        relief="flat",
        font=(theme.FONT_FAMILY, 11),
    )
    style.map("Freight.Treeview", background=[("selected", c["accent_dim"])],
              foreground=[("selected", c["accent_bright"] if mode == "dark" else c["accent"])])
    style.configure(
        "Freight.Treeview.Heading",
        background=c["surface_alt"],
        foreground=c["text_muted"],
        borderwidth=0,
        relief="flat",
        font=(theme.FONT_FAMILY, 10, "bold"),
    )
    style.map("Freight.Treeview.Heading", background=[("active", c["surface_alt"])],
              foreground=[("active", c["text_secondary"])])
    style.layout("Freight.Treeview", [("Freight.Treeview.treearea", {"sticky": "nswe"})])

    style.configure("Freight.Vertical.TScrollbar", background=c["surface_alt"], troughcolor=c["surface"],
                     bordercolor=c["surface"], arrowcolor=c["text_muted"], relief="flat")
    style.configure("Freight.Horizontal.TScrollbar", background=c["surface_alt"], troughcolor=c["surface"],
                     bordercolor=c["surface"], arrowcolor=c["text_muted"], relief="flat")


class Table(ctk.CTkFrame):
    """A scrollable, sortable table backed by ttk.Treeview, styled to
    match the app theme, with an optional double-click callback."""

    def __init__(self, master, columns, on_double_click=None, on_select=None, mode="dark", **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.columns = columns
        self._on_double_click = on_double_click
        self._on_select = on_select
        self._row_ids = {}
        c = theme.colors(mode)

        container = ctk.CTkFrame(self, fg_color=c["surface"], corner_radius=theme.RADIUS,
                                  border_width=1, border_color=c["border"])
        container.pack(fill="both", expand=True)
        inner = ctk.CTkFrame(container, fg_color="transparent")
        inner.pack(fill="both", expand=True, padx=1, pady=1)
        container = inner

        self.tree = ttk.Treeview(
            container, columns=[c2[0] for c2 in columns], show="headings",
            style="Freight.Treeview", selectmode="browse",
        )
        for key, label, width in columns:
            self.tree.heading(key, text=label.upper(), command=lambda k=key: self._sort_by(k))
            self.tree.column(key, width=width, anchor="w", stretch=True)

        vsb = ttk.Scrollbar(container, orient="vertical", command=self.tree.yview,
                             style="Freight.Vertical.TScrollbar")
        hsb = ttk.Scrollbar(container, orient="horizontal", command=self.tree.xview,
                             style="Freight.Horizontal.TScrollbar")
        self.tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

        self.tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        container.grid_rowconfigure(0, weight=1)
        container.grid_columnconfigure(0, weight=1)

        if on_double_click:
            self.tree.bind("<Double-1>", lambda e: self._fire_double_click())
        if on_select:
            self.tree.bind("<<TreeviewSelect>>", lambda e: self._fire_select())

        self._sort_state = {}
        self.tree.tag_configure("evenrow", background=c["surface"])
        self.tree.tag_configure("oddrow", background=c["row_alt"])

    def _fire_double_click(self):
        sel = self.tree.selection()
        if sel and self._on_double_click:
            self._on_double_click(self._row_ids.get(sel[0]))

    def _fire_select(self):
        sel = self.tree.selection()
        if sel and self._on_select:
            self._on_select(self._row_ids.get(sel[0]))

    def _sort_by(self, key):
        reverse = self._sort_state.get(key, False)
        items = [(self.tree.set(k, key), k) for k in self.tree.get_children("")]
        try:
            items.sort(key=lambda t: float(str(t[0]).replace(",", "")), reverse=reverse)
        except ValueError:
            items.sort(key=lambda t: str(t[0]).lower(), reverse=reverse)
        for index, (_, k) in enumerate(items):
            self.tree.move(k, "", index)
        self._sort_state[key] = not reverse

    def load_rows(self, rows, row_key_fn, row_id_fn, tag_fn=None):
        """rows: list of sqlite Row / dict. row_key_fn(row)->tuple of display
        values matching self.columns order. row_id_fn(row)-> primary key
        object stored for callbacks."""
        self.tree.delete(*self.tree.get_children())
        self._row_ids.clear()
        for i, row in enumerate(rows):
            values = row_key_fn(row)
            extra_tags = tag_fn(row) if tag_fn else ()
            stripe = "evenrow" if i % 2 == 0 else "oddrow"
            iid = self.tree.insert("", "end", values=values, tags=(stripe, *extra_tags))
            self._row_ids[iid] = row_id_fn(row)

    def selected_id(self):
        sel = self.tree.selection()
        if not sel:
            return None
        return self._row_ids.get(sel[0])

    def tag_color(self, tag, color, mode="dark"):
        self.tree.tag_configure(tag, foreground=color)


class Toast(ctk.CTkLabel):
    """A small self-clearing status label used for inline confirmations
    ('9 postings generated', 'Imported 14,203 ZIP rows', etc.)."""

    def __init__(self, master, **kwargs):
        super().__init__(master, text="", **kwargs)
        self._after_id = None

    def show(self, message, color=None, ms=4000):
        if self._after_id:
            self.after_cancel(self._after_id)
        self.configure(text=message, text_color=color)
        self._after_id = self.after(ms, lambda: self.configure(text=""))


def confirm(root, title, message) -> bool:
    return messagebox.askyesno(title, message, parent=root)


def info(root, title, message):
    messagebox.showinfo(title, message, parent=root)


def error(root, title, message):
    messagebox.showerror(title, message, parent=root)


def ask_open_filename(root, filetypes):
    return filedialog.askopenfilename(parent=root, filetypes=filetypes)


def ask_save_filename(root, defaultextension, filetypes, initialfile=""):
    return filedialog.asksaveasfilename(
        parent=root, defaultextension=defaultextension, filetypes=filetypes, initialfile=initialfile,
    )
