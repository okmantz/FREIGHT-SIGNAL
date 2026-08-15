"""
Freight Signal (c) - visual design tokens.

Palette is drawn directly from the Freight Signal mark: near-black,
brushed silver, and signal blue. Kept deliberately restrained - one
accent color, generous spacing, subtle borders instead of heavy fills -
for a high-end, understated instrument-panel feel rather than a
generic bright-colored dashboard.
"""
import os
import sys

import customtkinter as ctk

# ---------------------------------------------------------------------------
# Brand palette
# ---------------------------------------------------------------------------
INK_950 = "#06070A"   # app background (near-black, matches the logo backdrop)
INK_900 = "#0B0D12"   # sidebar
INK_800 = "#101319"   # surface / cards
INK_700 = "#181C24"   # surface alt / hover
INK_600 = "#22262F"   # borders / dividers
INK_500 = "#2B303B"   # stronger borders

SILVER_100 = "#F5F7FA"  # primary text (brushed-silver white from the mark)
SILVER_300 = "#C9CFD9"  # secondary headings
SILVER_500 = "#8A8F99"  # muted text
SILVER_700 = "#5B606B"  # faint text / disabled

SIGNAL_BLUE = "#2F8CFF"       # primary brand accent (the logo's road/S blue)
SIGNAL_BLUE_BRIGHT = "#5AA6FF"
SIGNAL_BLUE_DARK = "#1D6FE0"
SIGNAL_BLUE_DIM = "#173257"   # low-emphasis blue fill (selected rows, chips)

SIGNAL_GREEN = "#2ECC8F"
SIGNAL_AMBER = "#F2A93B"
SIGNAL_RED = "#E1554C"

PRIORITY_LOW = SILVER_500
PRIORITY_MEDIUM = SIGNAL_AMBER
PRIORITY_HIGH = SIGNAL_RED

# Light-mode counterparts
CLOUD_000 = "#FFFFFF"
CLOUD_050 = "#F6F8FB"
CLOUD_100 = "#EBEEF3"
CLOUD_200 = "#DCE1E9"
SLATE_900 = "#12151B"
SLATE_600 = "#565C68"

FONT_FAMILY = "Segoe UI"
FONT_FAMILY_MONO = "Consolas"

RADIUS = 14
RADIUS_SM = 9
PAD = 20

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
if getattr(sys, "frozen", False):
    # Inside a PyInstaller --onefile .exe, bundled data (via --add-data)
    # is extracted to sys._MEIPASS at runtime, not next to this file.
    ASSETS_DIR = os.path.join(getattr(sys, "_MEIPASS", ASSETS_DIR), "assets")
LOGO_MARK_PATH = os.path.join(ASSETS_DIR, "logo_mark_256.png")

_logo_image_cache = {}


def get_logo_image(size=34):
    """Returns a CTkImage of the small logo mark, cached by size. Used
    only as a small sidebar/header mark - never blown up large."""
    if size not in _logo_image_cache:
        try:
            from PIL import Image
            pil_img = Image.open(LOGO_MARK_PATH)
            _logo_image_cache[size] = ctk.CTkImage(light_image=pil_img, dark_image=pil_img,
                                                     size=(size, size))
        except Exception:  # noqa: BLE001
            _logo_image_cache[size] = None
    return _logo_image_cache[size]


def apply_appearance(mode: str = "dark"):
    ctk.set_appearance_mode("Dark" if mode == "dark" else "Light")
    ctk.set_default_color_theme("blue")


def colors(mode: str) -> dict:
    """Returns a dict of semantic colors for the given mode ('dark'/'light')."""
    if mode == "dark":
        return dict(
            bg=INK_950,
            surface=INK_800,
            surface_alt=INK_700,
            border=INK_600,
            border_strong=INK_500,
            text=SILVER_100,
            text_secondary=SILVER_300,
            text_muted=SILVER_500,
            accent=SIGNAL_BLUE,
            accent_bright=SIGNAL_BLUE_BRIGHT,
            accent_hover=SIGNAL_BLUE_DARK,
            accent_dim=SIGNAL_BLUE_DIM,
            success=SIGNAL_GREEN,
            danger=SIGNAL_RED,
            info=SIGNAL_BLUE,
            sidebar=INK_900,
            row_alt="#0E1015",
        )
    return dict(
        bg=CLOUD_050,
        surface=CLOUD_000,
        surface_alt=CLOUD_100,
        border=CLOUD_200,
        border_strong="#C3CAD5",
        text=SLATE_900,
        text_secondary="#333844",
        text_muted=SLATE_600,
        accent=SIGNAL_BLUE_DARK,
        accent_bright=SIGNAL_BLUE,
        accent_hover=SIGNAL_BLUE,
        accent_dim="#DCE9FF",
        success="#1E9E71",
        danger="#C8433B",
        info=SIGNAL_BLUE_DARK,
        sidebar=SLATE_900,
        row_alt="#F1F4F9",
    )


def font(size=13, weight="normal", mono=False):
    return ctk.CTkFont(family=FONT_FAMILY_MONO if mono else FONT_FAMILY, size=size, weight=weight)


def priority_color(priority: str) -> str:
    return {
        "Low": PRIORITY_LOW,
        "Medium": PRIORITY_MEDIUM,
        "High": PRIORITY_HIGH,
    }.get(priority, PRIORITY_LOW)
