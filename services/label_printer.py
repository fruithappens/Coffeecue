"""Thermal label rendering + network-printer dispatch.

Two halves:

1. render_label_png(order, branding, width_px) — builds a 62mm-style
   order label as a PNG (order number, customer, drink, station, event
   branding, pickup QR). FULLY TESTABLE and useful on its own: the PNG
   can be viewed in a browser and AirPrinted to a Brother QL-820NWB
   (which supports AirPrint), so an operator gets working labels with
   zero raster-protocol code.

2. send_png_to_printer(ip, port, png_bytes) — best-effort raw-socket
   dispatch to a network printer's JetDirect/AppSocket port (9100).
   ⚠️ HARDWARE-PENDING: raw 9100 expects the printer's *native* raster
   format, which is model-specific (Brother QL uses its own raster
   command set). Sending a PNG over 9100 will NOT print correctly on
   most printers without conversion. This function is wired and
   structured but must be validated against the actual printer before
   relying on it. Until then, the AirPrint-the-PNG path (open the
   label.png and Cmd+P) is the supported workflow. See README note in
   the print-label endpoint.

Pillow is already a dependency (qrcode pulls it in), so no new install.
"""
from __future__ import annotations

import io
import logging
import socket
from typing import Optional

logger = logging.getLogger(__name__)


# 62mm at ~96dpi screen ≈ 235px; we render larger for crispness and
# let the print pipeline scale. Brother QL 62mm tape is 696px @ 300dpi.
DEFAULT_WIDTH_PX = 696


def _load_font(size: int):
    """Best-effort font load. Falls back to PIL's bitmap default if no
    TrueType font is found (still renders, just less pretty)."""
    from PIL import ImageFont

    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",  # macOS
        "/System/Library/Fonts/Supplemental/Arial.ttf",  # macOS
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        # Pillow >= 10.1 embeds a scalable font (Aileron Regular), so
        # containers with no system TTFs (e.g. Railway) still render at
        # the requested size instead of the ~10px bitmap default.
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def render_label_png(
    order: dict,
    branding: Optional[dict] = None,
    width_px: int = DEFAULT_WIDTH_PX,
    qr_url: Optional[str] = None,
) -> bytes:
    """Render an order label to PNG bytes.

    order: dict with order_number, order_details (or flattened fields),
           station_id, customer name.
    branding: optional dict with event_name.
    qr_url: optional URL to encode as a pickup QR (right side).
    """
    from PIL import Image, ImageDraw

    branding = branding or {}
    od = order.get("order_details") or {}
    if isinstance(od, str):
        import json

        try:
            od = json.loads(od)
        except Exception:
            od = {}

    order_number = str(order.get("order_number") or order.get("id") or "?")
    # Group cups share the LEAD order's number with a position suffix, so a
    # round reads 281-1 / 281-2 / 281-3 on the cups (Steve). Solo orders
    # keep their plain number.
    _gid = od.get("group_id")
    _gpos = od.get("group_position")
    if _gid and _gpos and str(_gid) != order_number:
        label_number = f"{_gid}-{_gpos}"
    elif _gid and _gpos:
        # The lead order of a group: its own number IS the group id.
        label_number = f"{order_number}-{_gpos}"
    else:
        label_number = order_number
    name = (
        od.get("name")
        or order.get("customer_name")
        or od.get("customer_name")
        or "Customer"
    )
    drink = od.get("type") or od.get("coffee_type") or "Coffee"
    size = od.get("size") or ""
    milk = od.get("milk") or od.get("milk_type") or ""
    sugar = od.get("sugar") or ""
    strength = od.get("strength") or ""
    station_id = order.get("station_id") or od.get("station_id") or ""
    event_name = branding.get("event_name") or branding.get("eventName") or ""

    drink_line = " ".join([b for b in [size, drink] if b]).strip() or drink
    extras = []
    if milk and milk not in ("no milk", "standard", "none", "None"):
        extras.append(f"{milk} milk")
    if strength:
        extras.append(str(strength))
    if sugar and sugar not in ("no sugar", "none", "None", "0"):
        extras.append(str(sugar))
    extras_line = ", ".join(extras)

    # Canvas. Height grows with content; start tall enough and crop.
    W = width_px
    H = 420
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    f_event = _load_font(26)
    f_num = _load_font(96)
    f_name = _load_font(46)
    f_drink = _load_font(40)
    f_extras = _load_font(30)
    f_foot = _load_font(24)

    y = 12
    # Event name and station share the top strip. The station badge used
    # to sit beside the order number, which is the widest thing on the
    # label -- so it took the space the name now uses.
    if event_name or station_id:
        if event_name:
            draw.text((16, y), event_name[:34], fill="black", font=f_event)
        if station_id:
            badge = f"St {station_id}"
            try:
                bw = draw.textlength(badge, font=f_event)
            except Exception:
                bw = len(badge) * 14
            draw.text((W - 16 - bw, y), badge, fill="black", font=f_event)
        y += 34

    # Order number and name on ONE line, which is the whole point of this
    # layout. The number used to have a line to itself with the entire
    # right-hand side blank (Steve: "there is lots of white space on the
    # RHS"), and the name had its own line underneath. Putting them side
    # by side frees a whole row, which goes to making both bigger.
    num_text = f"#{label_number}"
    draw.text((16, y), num_text, fill="black", font=f_num)
    try:
        num_w = draw.textlength(num_text, font=f_num)
    except Exception:
        num_w = len(num_text) * 52

    # Side by side ONLY when there is room to make it worth doing.
    #
    # On a wide label the number leaves plenty of room and the name goes
    # beside it, freeing a whole row. On a narrow one -- the 406-dot lid
    # stock -- a 96pt "#142" eats most of the width and the name would be
    # squeezed to something SMALLER than it was on its own line. That is
    # the opposite of the point, so below a readable threshold it stays
    # stacked. Rendering both widths is what caught this.
    name_x = 16 + num_w + 20
    avail = W - name_x - 16
    name_font = _largest_font_fitting(draw, name, avail, 62, min_size=34)
    try:
        fits_beside = draw.textlength(name, font=name_font) <= avail
    except Exception:
        fits_beside = False

    if fits_beside:
        # Share a BASELINE, not a top edge. Two sizes hung from the same
        # top look like a mistake; sitting on one line is what makes
        # "#142 Alexandra" read as a single thing.
        try:
            baseline = y + f_num.getbbox(num_text)[3]
            draw.text(
                (name_x, baseline), name, fill="black", font=name_font, anchor="ls"
            )
        except Exception:
            draw.text((name_x, y + 40), name, fill="black", font=name_font)
        y += 104
    else:
        y += 104
        draw.text(
            (16, y),
            _fit_to_width(draw, name, f_name, W - 32),
            fill="black",
            font=f_name,
        )
        y += 54
    draw.text(
        (16, y),
        _fit_to_width(draw, drink_line, f_drink, W - 32),
        fill="black",
        font=f_drink,
    )
    y += 46
    if extras_line:
        draw.text(
            (16, y),
            _fit_to_width(draw, extras_line, f_extras, W - 32),
            fill="black",
            font=f_extras,
        )
        y += 36

    # Pickup QR bottom-right, if a URL was supplied.
    if qr_url:
        try:
            import qrcode

            qr = qrcode.QRCode(border=1, box_size=4)
            qr.add_data(qr_url)
            qr.make(fit=True)
            qr_img = qr.make_image(fill_color="black", back_color="white").convert(
                "RGB"
            )
            qs = min(150, W // 4)
            qr_img = qr_img.resize((qs, qs))
            img.paste(qr_img, (W - qs - 12, H - qs - 12))
        except Exception as e:
            logger.warning(f"label QR render failed: {e}")

    # Footer: whatever the operator calls the system, not a name baked
    # into the renderer. The newer render_label() already takes this from
    # label_settings.footer_text; this path only gets `branding`, so read
    # the same systemName out of that and fall back to the product name.
    footer = (
        str(branding.get("systemName") or branding.get("system_name") or "").strip()
        or "CupQ"
    )
    draw.text((16, H - 30), footer, fill="gray", font=f_foot)

    # Crop trailing whitespace below the content (keep QR area).
    content_bottom = max(y + 12, H)
    if content_bottom < H:
        img = img.crop((0, 0, W, content_bottom))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Spec renderer for the Star mC-Label3 (58mm linerless, 203dpi).
#
# Differences from render_label_png above (kept for the AirPrint path):
#  - Renders from a PAYLOAD SNAPSHOT (never re-reads the live order).
#  - 1-bit monochrome output — no greys, maximum thermal contrast.
#  - Width = printers.width_dots (default PRINT_WIDTH_DOTS 406 ≈ 50.8mm
#    printable at 8 dots/mm) — verified by test print on hardware.
#  - Height is content-driven, clamped to [LABEL_MIN_HEIGHT,
#    LABEL_MAX_HEIGHT]; the cutter cuts at image end, so image height IS
#    the physical label length.
#  - Privacy: first name + last initial only (labels sit on cups in a
#    public venue).
# ---------------------------------------------------------------------------
import os

PRINT_WIDTH_DOTS = int(os.environ.get("PRINT_WIDTH_DOTS", "406"))
LABEL_MIN_HEIGHT = int(os.environ.get("LABEL_MIN_HEIGHT", "380"))
# Ceiling for GROW mode (label_scale_mode='grow'): the sticker gets
# longer instead of the text getting smaller. 4800 dots ≈ 60cm at
# 203dpi — a full sentence's worth of stock, per Steve.
LABEL_GROW_MAX_HEIGHT = int(os.environ.get("LABEL_GROW_MAX_HEIGHT", "4800"))
# 640 dots ≈ 80mm of stock — leaves room for the optional logo + event
# name + footer line without cropping; plain labels still cut short
# because height is content-driven.
LABEL_MAX_HEIGHT = int(os.environ.get("LABEL_MAX_HEIGHT", "640"))

# LID mode: a half-height sticker for the top of a takeaway lid instead of
# the side of the cup. 40mm at 203dpi = 320 dots, on the same 58mm stock.
# It fits because the order number and name come down a long way — on a lid
# the label is read from directly above, not picked out of a line-up of
# cups on a bench. 30mm floor so a short order does not pad blank stock.
LID_MAX_HEIGHT = int(os.environ.get("LID_MAX_HEIGHT", "320"))
LID_MIN_HEIGHT = int(os.environ.get("LID_MIN_HEIGHT", "240"))


def _int_or(value, fallback):
    """int(value), or the fallback for anything that is not a number.

    Settings arrive from a JSON blob an operator can edit, so a width of
    "wide" is a thing that happens. Falling back beats raising: a sticker
    at the default length is a sticker, and an exception is a batch that
    never prints.
    """
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _wrap_to_width(draw, text, font, max_px):
    """Word-wrap `text` so no line exceeds max_px at `font`. Used by
    GROW mode, where long text takes MORE STOCK instead of shrinking
    (Steve: 'a really long sentence might use 50-60cm of sticker where
    COFFEE only uses 15'). Long single words are hard-split."""
    words, lines, current = str(text or "").split(), [], ""

    def width_of(s):
        try:
            return draw.textlength(s, font=font)
        except Exception:
            return len(s) * 10

    for word in words:
        candidate = f"{current} {word}".strip()
        if width_of(candidate) <= max_px or not current:
            current = candidate
            # A single word longer than the roll: split it.
            while width_of(current) > max_px and len(current) > 1:
                cut = len(current) - 1
                while cut > 1 and width_of(current[:cut]) > max_px:
                    cut -= 1
                lines.append(current[:cut])
                current = current[cut:]
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def _largest_font_fitting(draw, text, max_px, max_size, min_size=22):
    """The biggest font size at which `text` fits `max_px`.

    Used for the customer NAME, which sits beside the order number and
    therefore has whatever width the number leaves. Shrinking beats
    ellipsising here: "Alexand..." on a cup is worse than the same name
    two points smaller, because the barista is calling it out loud.
    """
    size = max_size
    while size > min_size:
        f = _load_font(size)
        try:
            if draw.textlength(str(text or ""), font=f) <= max_px:
                return f
        except Exception:
            return f
        size -= 2
    return _load_font(min_size)


def _fit_to_width(draw, text, font, max_px):
    """Shorten `text` with an ellipsis until it fits max_px at `font`.

    Character caps (`text[:24]`) can't do this job: 24 narrow characters
    and 24 wide ones are very different widths, so a cap chosen to suit
    one drink silently clipped another off the edge of the label. A real
    order came out as 'Medium Cappuccino * Sk' / 'Milk' — the 'im' fell
    off the roll. Losing characters from a drink name is worse than an
    ellipsis, because the barista can't tell it happened.
    """
    text = str(text or "")

    def width_of(s):
        try:
            return draw.textlength(s, font=font)
        except Exception:
            return len(s) * 10

    if width_of(text) <= max_px:
        return text
    # ASCII '...' rather than a single-glyph ellipsis: the embedded
    # fallback font used on Railway has no guaranteed U+2026.
    cut = len(text)
    while cut > 1 and width_of(text[:cut] + "...") > max_px:
        cut -= 1
    return text[:cut].rstrip() + "..."


def label_display_name(full_name: str) -> str:
    """'Stephanie Routley' -> 'Stephanie R.' — cup-label privacy.

    Long single names are shortened VISIBLY. The cap has always been
    there, but it cut silently: "Bartholomew-Fitzgerald-Smythe" printed
    as "Bartholomew-Fitzge", which reads as a printer fault rather than
    a deliberate shortening — the barista sees a broken label and the
    customer hears a mangled name called out. The rest of this renderer
    already ellipsises for exactly this reason (see _fit_to_width); this
    function was the one place that did not.

    ASCII dots, not a Unicode ellipsis, matching _fit_to_width. Railway
    has no system fonts and labels render through Pillow's embedded
    face -- a character that face lacks prints as a box or as nothing,
    which would be a worse lie than the silent cut it replaced.
    """
    parts = [p for p in str(full_name or "").strip().split() if p]
    if not parts:
        return "Customer"
    if len(parts) == 1:
        one = parts[0]
        return one if len(one) <= 18 else one[:15] + "..."
    first = parts[0]
    if len(first) > 16:
        first = first[:13] + "..."
    return f"{first} {parts[1][0].upper()}."


# How far a small logo may be enlarged to fill the label. Past roughly
# 3x the source there is no detail left to enlarge and a 1-bit thermal
# head turns it into blocks -- at which point it reads as a mistake
# rather than as branding.
MAX_LOGO_UPSCALE = float(os.environ.get("MAX_LOGO_UPSCALE", "3.0"))

# Vertical room the logo may take. Steve: "Logo of sponsor was quite
# small and could be much larger". A cup label has the stock to spare;
# a lid does not, so it keeps a tighter box.
LOGO_MAX_HEIGHT_CUP = int(os.environ.get("LOGO_MAX_HEIGHT_CUP", "170"))
LOGO_MAX_HEIGHT_LID = int(os.environ.get("LOGO_MAX_HEIGHT_LID", "64"))


def _decode_logo_to_1bit(
    logo_data_uri: str, max_width: int, max_height: int = LOGO_MAX_HEIGHT_CUP
):
    """Branding logo (base64 data URI) → 1-bit dithered PIL image sized to
    the label, or None on any problem. Never raises — a broken logo must
    never break a label."""
    try:
        import base64
        import io as _io

        from PIL import Image

        raw = logo_data_uri.split(",", 1)[1] if "," in logo_data_uri else logo_data_uri
        img = Image.open(_io.BytesIO(base64.b64decode(raw)))
        # Flatten transparency onto white before thresholding.
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, "white")
            img = img.convert("RGBA")
            bg.paste(img, mask=img.split()[-1])
            img = bg
        img = img.convert("L")
        # Fill the space, do not merely fit inside it.
        #
        # The old ratio was capped at 1.0, so a logo SMALLER than the box
        # was never enlarged -- it printed at whatever pixel size it
        # happened to be uploaded at, which is why Steve's sponsor came
        # out "quite small" on a label with room to spare. A sponsor is
        # paying for that space; leaving it blank is the wrong default.
        #
        # Upscaling a small raster onto a 1-bit thermal head does get
        # blocky, so it is capped: past about 3x the source there is no
        # detail left to enlarge and it starts to look like a mistake
        # rather than a logo. LANCZOS keeps the edges as clean as the
        # source allows before dithering.
        ratio = min(max_width / img.width, max_height / img.height)
        ratio = min(ratio, MAX_LOGO_UPSCALE)
        img = img.resize(
            (max(1, int(img.width * ratio)), max(1, int(img.height * ratio))),
            Image.LANCZOS,
        )
        return img.convert("1")  # Floyd-Steinberg dither — thermal-friendly
    except Exception:
        return None


def render_label(
    payload: dict,
    width_dots: int = None,
    options: dict = None,
    _measure_only: bool = False,
):
    """Render a print-job payload snapshot to a 1-bit PNG.

    payload keys (all optional, sensible fallbacks):
      order_number, name, drink, size, milk, modifiers (list[str]),
      station_name, ts (ISO time string), test (bool).

    options (label_settings KV — presentation only, applied at RENDER
    time so a design change affects queued jobs too):
      show_event_name (bool), event_name (str),
      show_logo (bool), logo_data (base64 data URI, from branding),
      show_station_time (bool, default True),
      footer_text (str — e.g. 'CoffeeCue - coffeecue.com' or a
      sponsor/reseller line; empty = no footer line).
    """
    from datetime import datetime

    from PIL import Image, ImageDraw

    W = int(width_dots or PRINT_WIDTH_DOTS)
    payload = payload or {}
    options = options or {}

    order_number = str(payload.get("order_number") or "—")
    name = label_display_name(payload.get("name"))
    size = str(payload.get("size") or "").strip()
    drink = str(payload.get("drink") or "Coffee").strip()
    milk = str(payload.get("milk") or "").strip()
    modifiers = [str(m) for m in (payload.get("modifiers") or []) if m]
    station = str(payload.get("station_name") or "").strip()
    ts = str(payload.get("ts") or "")[:16]
    try:
        hhmm = (
            datetime.fromisoformat(ts).strftime("%H:%M")
            if ts
            else datetime.now().strftime("%H:%M")
        )
    except Exception:
        hhmm = datetime.now().strftime("%H:%M")

    drink_line_parts = [p for p in (size.title(), drink.title()) if p]
    drink_line = " ".join(drink_line_parts)
    if milk and milk.lower() not in ("no milk", "none", "standard", ""):
        drink_line += f" · {milk.title()}"

    # Optional milk shape, per station, at the START of the drink line.
    #
    # It sat next to the milk word first, which was the obvious place and
    # the wrong one: on a real label the line wrapped between the mark
    # and "Oat", so the two halves of one idea landed on separate rows.
    # At the line start it cannot be separated from its line, and — the
    # actual point — it lands in the SAME position on every label, so a
    # row of cups on the bench has its marks in a column. That is the
    # behaviour Steve was describing: "like how there is colour ID in
    # the batching process". A mark you have to hunt for is not one.
    #
    # The words are untouched either way. The symbol is a second way to
    # read the same thing, never a replacement, so a barista who has not
    # learned the shapes loses nothing.
    #
    # Only the CloudPRNT path (this function) carries them. The AirPrint
    # renderer above is deliberately left alone: it is handed branding,
    # not label_settings, and inventing a second place to configure this
    # for a path Steve's printers do not use would be two switches for
    # one feature.
    try:
        from utils.milk_glyph import enabled_for, label_prefix

        drink_line = (
            label_prefix(milk, enabled_for(options, payload.get("station_id")))
            + drink_line
        )
    except Exception as _glyph_err:
        # A symbol is a nicety; the label is not. Never lose a cup over one.
        logger.debug(f"milk symbol skipped: {_glyph_err}")

    # Sizing mode (Steve): 'compact' shrinks text to fit a short label
    # (the original behaviour); 'grow' keeps the text big and lets the
    # LABEL get longer — a long sentence eats more stock instead of
    # becoming unreadable.
    _mode = str((options or {}).get("label_scale_mode") or "compact").lower()
    grow = _mode == "grow"
    lid = _mode == "lid"
    canvas_h = (
        LABEL_GROW_MAX_HEIGHT if grow else LID_MAX_HEIGHT if lid else LABEL_MAX_HEIGHT
    )

    # LOGO GETS THE LEFTOVER.
    #
    # A lid label is always the same length whatever it says: the floor is
    # clamped to the ceiling, so every sticker is 320 dots of media whether
    # the text fills it or not. Measured on Steve's own printed label, the
    # ink stopped at y=245 and the bottom 9.4mm -- 23% of a sticker he had
    # already paid for -- was blank. Steve: "it could do down the page a
    # lot and sticker wouldnt even need to be bigger and would leave more
    # space for the logo".
    #
    # So instead of a fixed allowance, lay the TEXT out first with no logo
    # at all, see where it ends, and give the logo whatever is left. A long
    # drink name that wraps takes its room back automatically -- which is
    # the part a fixed bigger number could not do without shearing the
    # sponsor line off the bottom of the busiest labels.
    #
    # The measuring pass runs this same function with the logo suppressed,
    # so the two can never drift apart the way a hand-computed text height
    # would.
    if (
        not _measure_only
        and options.get("show_logo")
        and options.get("logo_data")
        and not grow
    ):
        try:
            probe_opts = dict(options)
            probe_opts["show_logo"] = False
            text_bottom = render_label(payload, W, probe_opts, _measure_only=True)
            spare = canvas_h - int(text_bottom or 0)
            # Keep a couple of millimetres of air under the last line, and
            # never shrink below what the fixed allowance already gave.
            floor_allow = LOGO_MAX_HEIGHT_LID if lid else LOGO_MAX_HEIGHT_CUP
            allow = max(floor_allow, spare - 24)
            options = dict(options)
            options["logo_max_height_lid" if lid else "logo_max_height"] = allow
        except Exception as _probe_err:
            # A failed measurement must never cost a label. Fall through
            # on the fixed allowance, which is what shipped before.
            logger.debug(f"logo autosize skipped: {_probe_err}")

    # Oversized canvas; crop to content at the end.
    img = Image.new("1", (W, canvas_h), 1)  # 1-bit, white
    draw = ImageDraw.Draw(img)

    if lid:
        # Roughly half of each, so the same elements fit 40mm.
        # Order number deliberately smaller than half the cup size. On a
        # lid the sticker is read from above at arm's length at most, not
        # across a counter, so 64 was bigger than the job needs and it was
        # crowding out the sponsor lines.
        f_num, f_name = _load_font(48), _load_font(32)
        f_drink, f_mods, f_foot = _load_font(24), _load_font(20), _load_font(17)
        # Advances are tight on purpose. The lid has a hard 40mm ceiling
        # and the sponsor line is the last thing drawn, so every dot spent
        # on leading above is a dot the sponsor line might not get. A
        # large macchiato with three modifiers — routine, not exotic —
        # was enough to push it off before this was tightened.
        A_NUM, A_NAME, A_DRINK, A_DRINK1, A_MODS, A_FOOT = 48, 34, 26, 24, 24, 21
    else:
        f_num, f_name = _load_font(120), _load_font(52)
        f_drink, f_mods, f_foot = _load_font(36), _load_font(30), _load_font(24)
        A_NUM, A_NAME, A_DRINK, A_DRINK1, A_MODS, A_FOOT = 126, 60, 42, 40, 36, 32

    margin = 10
    y = 4 if lid else 8

    # Design controls: whole-label alignment + divider rules between
    # sections (Steve: "a bit more overall design control").
    centred = str(options.get("align") or "left").lower() == "center"

    def put(text, font, dy):
        """Draw one line honouring the alignment; advance y by dy."""
        nonlocal y
        x = margin
        if centred:
            try:
                tw = draw.textlength(text, font=font)
            except Exception:
                tw = len(text) * 10
            x = max(margin, (W - int(tw)) // 2)
        draw.text((x, y), text, fill=0, font=font)
        y += dy

    def rule(flag_key, default=False):
        """Optional horizontal divider between sections."""
        nonlocal y
        if options.get(flag_key, default):
            y += 4
            draw.line([(margin, y), (W - margin, y)], fill=0)
            y += 8

    if payload.get("test"):
        # Calibration header + ruler ticks every 50 dots so the operator
        # can verify PRINT_WIDTH_DOTS against the physical stock.
        draw.text((margin, y), "TEST LABEL", fill=0, font=f_drink)
        y += 44
        for x in range(0, W, 50):
            draw.line([(x, y), (x, y + 12)], fill=0)
            draw.text((x + 2, y + 12), str(x), fill=0, font=f_foot)
        y += 40

    # 0a. Logo (branding, dithered to 1-bit), always centred.
    if options.get("show_logo") and options.get("logo_data"):
        # Full usable width, not a fraction of it -- the margin is the
        # only thing held back.
        logo = _decode_logo_to_1bit(
            options["logo_data"],
            W - 2 * margin,
            max_height=(
                int(options.get("logo_max_height_lid") or LOGO_MAX_HEIGHT_LID)
                if lid
                else int(options.get("logo_max_height") or LOGO_MAX_HEIGHT_CUP)
            ),
        )
        if logo is not None:
            img.paste(logo, ((W - logo.width) // 2, y))
            y += logo.height + (4 if lid else 8)
            rule("rule_below_logo")

    # 0b. Event name header.
    if options.get("show_event_name") and (options.get("event_name") or "").strip():
        _f_ev = _load_font(20 if lid else 28)
        put(
            _fit_to_width(
                draw, str(options["event_name"]).strip(), _f_ev, W - 2 * margin
            ),
            _f_ev,
            24 if lid else 36,
        )

    # 1 + 2. Order number, with the name beside it when there is room.
    #
    # The number used to have a whole line to itself with the right-hand
    # side blank, and the name a second line underneath (Steve: "name
    # could go to the Right of the order number and as such save a line
    # and could increase number and name size ... there is lots of white
    # space on the RHS").
    #
    # Only when it FITS, though. On narrow stock a big "#142" eats most
    # of the width and the name beside it would end up smaller than it
    # was on its own line -- the opposite of the point. Below a readable
    # floor it stays stacked. Left-aligned labels only: centred layouts
    # are a deliberate look and pairing them sideways breaks it.
    num_text = f"#{order_number}"
    want_name = options.get("show_name", True) and str(name or "").strip()
    placed_beside = False

    # Pairing works CENTRED too -- the pair is centred as one unit rather
    # than the number being centred and the name pushed off to its right.
    # It used to be left-only, which meant choosing between a centred
    # label and the line the pairing saves. There is no reason to choose:
    # a centred "#1546 Fred" is one object, and measuring the whole group
    # before placing it is all that was missing.
    if want_name:
        gap = 10 if lid else 18
        try:
            num_w = draw.textlength(num_text, font=f_num)
        except Exception:
            num_w = len(num_text) * (A_NUM // 2)
        # Centred labels have the full width to play with, minus margins;
        # left-aligned ones only have what the number leaves.
        avail = (
            (W - 2 * margin - int(num_w) - gap)
            if centred
            else (W - (margin + int(num_w) + gap) - margin)
        )
        floor = max(20, int(A_NAME * 0.8))
        name_font = _largest_font_fitting(
            draw, name, avail, int(A_NAME * 1.25), min_size=floor
        )
        try:
            name_w = draw.textlength(name, font=name_font)
            placed_beside = name_w <= avail
        except Exception:
            name_w, placed_beside = 0, False

        if placed_beside:
            if centred:
                group_w = int(num_w) + gap + int(name_w)
                num_x = max(margin, (W - group_w) // 2)
            else:
                num_x = margin
            name_x = num_x + int(num_w) + gap
            draw.text((num_x, y), num_text, fill=0, font=f_num)
            # Same baseline, not the same top edge: two sizes hung from
            # the top read as a mistake, one baseline reads as one line.
            try:
                draw.text(
                    (name_x, y + f_num.getbbox(num_text)[3]),
                    name,
                    fill=0,
                    font=name_font,
                    anchor="ls",
                )
            except Exception:
                draw.text((name_x, y + (A_NUM // 4)), name, fill=0, font=name_font)
            y += A_NUM
            rule("rule_below_number")

    if not placed_beside:
        put(num_text, f_num, A_NUM)
        rule("rule_below_number")
        if want_name:
            put(name, f_name, A_NAME)

    # 3. Drink line. GROW mode wraps every word onto as many lines as it
    # needs (label gets longer); compact keeps the original two-line cap.
    if grow:
        for ln in _wrap_to_width(draw, drink_line, f_drink, W - 2 * margin):
            put(ln, f_drink, 42)
    else:
        # Compact still caps at two lines, but both are measured, not
        # counted — see _fit_to_width for what counting cost us.
        d_lines = _wrap_to_width(draw, drink_line, f_drink, W - 2 * margin)
        put(d_lines[0], f_drink, A_DRINK1 if len(d_lines) > 1 else A_DRINK)
        if len(d_lines) > 1:
            put(
                _fit_to_width(draw, " ".join(d_lines[1:]), f_drink, W - 2 * margin),
                f_drink,
                A_DRINK,
            )

    # 4. Modifiers.
    if modifiers:
        mods_text = ", ".join(modifiers)
        if grow:
            for ln in _wrap_to_width(draw, mods_text, f_mods, W - 2 * margin):
                put(ln, f_mods, A_MODS)
        else:
            put(_fit_to_width(draw, mods_text, f_mods, W - 2 * margin), f_mods, A_MODS)
    rule("rule_below_drink")

    # 5. Station + time. The rule above it used to be hardcoded —
    # Steve's review: every divider should be a choice. Default ON so
    # existing labels look unchanged until the operator says otherwise.
    if options.get("show_station_time", True):
        rule("rule_above_station", default=True)
        y += 2
        foot = " · ".join([p for p in (station, hhmm) if p]) or hhmm
        put(foot[:40], f_foot, A_FOOT)

    # 6. Ordering instructions + branding footer — both optional,
    # centred, small. instructions_text is the "how to order again"
    # line ('Order: SMS 0489 263 333 or the event app'); footer_text is
    # branding/reseller ('CoffeeCue - coffeecue.com', Wallfly, ...).
    # Shrink-to-fit: try smaller fonts before truncating — the first
    # live render clipped 'or the event app' off the right edge.
    # Optional dividers: one above the whole block, one between the
    # instructions and sponsor/footer lines.
    # The lid used to drop this block entirely, on the assumption that a
    # 40mm sticker had no room for it. It does: the lid label is padded to
    # a fixed 320 dots (see the floor/ceiling note below), so a short order
    # was leaving ~12mm of blank stock under the station line. The sponsor
    # line is most of the reason the sticker exists, so it goes back — at
    # a smaller size, and guarded by _fits_remaining so it is never sliced
    # mid-word by the height cap.
    footer_lines = [
        ln
        for ln in (
            str(options.get("instructions_text") or "").strip(),
            str(options.get("footer_text") or "").strip(),
        )
        if ln
    ]
    if footer_lines:
        rule("rule_above_footer")
    for idx, line in enumerate(footer_lines):
        if idx == 1:
            rule("rule_between_footer_lines")
        line = line[:400] if grow else line[:60]
        if grow:
            # GROW: keep the size, wrap onto more lines (more stock).
            f_grow = _load_font(22)
            for ln in _wrap_to_width(draw, line, f_grow, W - 2 * margin):
                try:
                    tw_g = draw.textlength(ln, font=f_grow)
                except Exception:
                    tw_g = len(ln) * 11
                draw.text(
                    (max(margin, (W - int(tw_g)) // 2), y), ln, fill=0, font=f_grow
                )
                y += 28
            continue
        # Lid runs a smaller ladder and a tighter advance — the cup sizes
        # would spill past the 40mm cap with two footer lines.
        sizes = (18, 17, 16, 15) if lid else (22, 20, 18, 16)
        advance = 22 if lid else 28
        # Never start a line the label cannot finish. The canvas is cropped
        # at canvas_h, so without this an overlong drink name silently
        # shears the sponsor line in half and it reads as a printer fault.
        if y + advance > canvas_h:
            break
        fitted, tw = None, W
        for size in sizes:
            f_try = _load_font(size)
            try:
                tw = draw.textlength(line, font=f_try)
            except Exception:
                tw = len(line) * (size // 2 + 1)
            if tw <= W - 2 * margin:
                fitted = f_try
                break
        if fitted is None:
            fitted = _load_font(sizes[-1])
            while line and tw > W - 2 * margin:
                line = line[:-1]
                try:
                    tw = draw.textlength(line, font=fitted)
                except Exception:
                    tw = len(line) * 9
        draw.text((max(margin, (W - int(tw)) // 2), y), line, fill=0, font=fitted)
        y += advance

    # Minimum label LENGTH. The cutter cuts at the image end, so this is
    # literally how much media each label consumes — a floor of 380 dots
    # (47.5mm) left 14mm blank on a short label ("Steve / Small Flat
    # White"), about 5.6 metres of stock across a 400-cup event, while a
    # long label wasted only 4.5mm. Settable so it can be tuned against a
    # real cutter rather than guessed: too short risks the cut landing
    # awkwardly, too long wastes media on every single cup.
    # The cup label's 380-dot floor is taller than an entire lid label, so
    # lid mode carries its own 30mm floor / 40mm ceiling.
    _floor_default = LID_MIN_HEIGHT if lid else LABEL_MIN_HEIGHT
    try:
        floor = int(options.get("min_height_dots") or _floor_default)
    except (TypeError, ValueError):
        floor = _floor_default
    floor = max(120, min(floor, canvas_h))  # never below ~15mm

    # Measuring pass: the caller wants the content bottom, not a label.
    if _measure_only:
        return int(y)

    height = max(floor, min(canvas_h, y))
    img = img.crop((0, 0, W, height))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def render_ticket(payload: dict, width_dots: int = None, options: dict = None) -> bytes:
    """Customer ticket stub — the deli-counter number, on sticky stock.

    Printed for walk-up/kiosk customers so they leave the counter with
    their order number in hand (or stuck to a laptop lid). Distinct from
    the cup label: the NUMBER is the hero, the drink is a reminder line,
    and it says where to collect. Honours event name / instructions /
    footer from the same label_settings the designer edits.
    """
    from datetime import datetime

    from PIL import Image, ImageDraw

    W = int(width_dots or PRINT_WIDTH_DOTS)
    payload = payload or {}
    options = options or {}

    order_number = str(payload.get("order_number") or "—")
    drink = str(payload.get("drink") or "").strip()
    size = str(payload.get("size") or "").strip()
    station = str(payload.get("station_name") or "").strip()
    drink_line = " ".join(p for p in (size.title(), drink.title()) if p)
    try:
        hhmm = datetime.fromisoformat(str(payload.get("ts") or "")[:16]).strftime(
            "%H:%M"
        )
    except Exception:
        hhmm = datetime.now().strftime("%H:%M")

    img = Image.new("1", (W, LABEL_MAX_HEIGHT), 1)
    draw = ImageDraw.Draw(img)
    margin = 10

    def centred(text, font, dy):
        nonlocal y
        try:
            tw = draw.textlength(text, font=font)
        except Exception:
            tw = len(text) * 10
        draw.text((max(margin, (W - int(tw)) // 2), y), text, fill=0, font=font)
        y += dy

    y = 10
    ev = str(options.get("event_name") or "").strip()
    if options.get("show_event_name") and ev:
        centred(ev[:26], _load_font(26), 32)
    centred("YOUR ORDER", _load_font(28), 40)
    centred(f"#{order_number}", _load_font(150), 158)
    if drink_line:
        centred(drink_line[:24], _load_font(30), 38)
    if station:
        centred(f"Collect: {station}"[:30], _load_font(26), 34)
    y += 2
    draw.line([(margin, y), (W - margin, y)], fill=0)
    y += 8
    instructions = str(options.get("instructions_text") or "").strip()
    if instructions:
        f_small = _load_font(20)
        try:
            tw = draw.textlength(instructions[:44], font=f_small)
        except Exception:
            tw = len(instructions[:44]) * 9
        draw.text(
            (max(margin, (W - int(tw)) // 2), y),
            instructions[:44],
            fill=0,
            font=f_small,
        )
        y += 26
    centred(hhmm, _load_font(20), 26)

    height = max(280, min(LABEL_MAX_HEIGHT, y + 6))
    img = img.crop((0, 0, W, height))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# Longest banner the cutter will be asked for: 2400 dots ≈ 30cm at
# 203dpi. Env-tunable for shops with longer rolls or nerves.
BANNER_MAX_DOTS = int(os.environ.get("BANNER_MAX_DOTS", "2400"))


def render_sticker(
    payload: dict, width_dots: int = None, options: dict = None
) -> bytes:
    """A branded sticker with no order on it, for plain house cups.

    Steve: "Batch-print branded stickers for plain house cups, for
    smaller events with no custom cup run." A custom cup run has a
    minimum order and a lead time that a fifty-person morning cannot
    justify, so the cups stay plain and the branding is applied on the
    day -- or the night before, which is the actual point: these are
    printed in a batch and stuck on ahead of service, when there is time.

    It is the ordinary label with the order stripped out, drawn by the
    same code, so the sticker and the labels that follow it are the same
    design and the same size. Nothing here is unique to stickers except
    what is ABSENT.

    payload: {'headline': str} -- optional line under the logo. Falls
    back to the event name, and prints nothing at all if neither exists,
    because a sticker with a stray heading is worse than a plain one.
    """
    from PIL import Image, ImageDraw

    W = int(width_dots or PRINT_WIDTH_DOTS)
    options = options or {}
    payload = payload or {}

    headline = str(payload.get("headline") or "").strip()
    if not headline and options.get("show_event_name"):
        headline = str(options.get("event_name") or "").strip()
    headline = headline[:40]

    footer_text = str(options.get("footer_text") or "").strip()
    instructions = str(options.get("instructions_text") or "").strip()

    canvas_h = LABEL_MAX_HEIGHT
    img = Image.new("1", (W, canvas_h), 1)
    draw = ImageDraw.Draw(img)
    margin = 10
    y = 12

    f_head = _load_font(44)
    f_body = _load_font(28)

    drew = False

    def centred(text, font, dy):
        """Blank text draws nothing AND costs no height.

        _wrap_to_width returns a single empty line for empty input, and
        letting that through advanced y invisibly: it padded the sticker
        with phantom lines and convinced the blank-sticker guard below
        that something had been printed.
        """
        nonlocal y, drew
        if not str(text or "").strip():
            return
        try:
            tw = draw.textlength(text, font=font)
        except Exception:
            tw = len(text) * 10
        draw.text((max(margin, (W - int(tw)) // 2), y), text, fill=0, font=font)
        y += dy
        drew = True

    # THE LOGO IS THE POINT, so it gets the room the order data would
    # have used rather than the small allowance a cup label gives it.
    # On a label the logo is a courtesy under the drink; here it is the
    # entire reason the sticker exists.
    if options.get("show_logo") and options.get("logo_data"):
        logo = _decode_logo_to_1bit(
            options["logo_data"],
            W - 2 * margin,
            max_height=_int_or(options.get("logo_max_height_sticker"), 300),
        )
        if logo is not None:
            img.paste(logo, ((W - logo.width) // 2, y))
            y += logo.height + 16
            drew = True

    if headline:
        centred(headline, f_head, 54)

    for line in _wrap_to_width(draw, instructions, f_body, W - 2 * margin)[:3]:
        centred(line, f_body, 34)

    if footer_text:
        y += 6
        draw.line([(margin, y), (W - margin, y)], fill=0)
        y += 12
        drew = True
        for line in _wrap_to_width(draw, footer_text, f_body, W - 2 * margin)[:3]:
            centred(line, f_body, 34)

    # An entirely blank sticker would waste stock silently, so give a
    # branding-less event something to hold instead of feeding out paper.
    if not drew:
        centred("Enjoy your coffee", f_head, 54)

    # CENTRE THE CONTENT IN WHATEVER LENGTH THE STICKER ENDS UP.
    #
    # The cutter needs a minimum length, so a short sticker gets padded
    # up to it either way -- the only question is where the blank goes.
    # Top-aligned put all of it underneath, and a batch of three hundred
    # cups each wearing a sticker with an empty bottom third looks like a
    # printing fault rather than a design. Centred, the same stock reads
    # as deliberate. This is the same waste Steve spotted on the lid
    # label ("it could go down the page a lot"), seen from the other end:
    # there the fix was to give the space to the logo, and here, when
    # there is no logo to give it to, the fix is to split it evenly.
    content_h = min(canvas_h, y + 14)
    content = img.crop((0, 0, W, content_h))
    final_h = max(content_h, _int_or(options.get("min_height_dots"), 380))
    if final_h > content_h:
        out = Image.new("1", (W, final_h), 1)
        out.paste(content, (0, (final_h - content_h) // 2))
    else:
        out = content
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def render_banner(payload: dict, width_dots: int = None, options: dict = None) -> bytes:
    """Sideways banner on the label roll (Steve): free text rendered
    SIDEWAYS so the stock width (40-80mm depending on the roll) becomes
    the banner's HEIGHT and the length is whatever the text needs — a
    30cm FLAT WHITE sticker for the express table, cut straight off the
    printer.

    payload: {'text': 'FLAT WHITE'} (anything else ignored).
    width_dots comes from the printer row (58mm roll ≈ 406 printable
    dots; 40mm ≈ 320; 80mm ≈ 640), so every stock size just works.
    Shrink-to-fit: the font fills the roll width; if the text would run
    past BANNER_MAX_DOTS the font steps down before truncating.
    """
    from PIL import Image, ImageDraw

    W = int(width_dots or PRINT_WIDTH_DOTS)
    text = str((payload or {}).get("text") or "COFFEE").strip()[:60] or "COFFEE"
    # GROW (default for banners — the whole point of a banner is big
    # text): keep the glyphs as tall as the roll allows and let the
    # strip run as long as it needs, up to the length cap. COMPACT
    # shrinks the text so a long phrase stays on a short strip.
    grow = (
        str(
            (options or {}).get("banner_scale_mode")
            or (options or {}).get("label_scale_mode")
            or "grow"
        ).lower()
        != "compact"
    )
    max_len = (
        BANNER_MAX_DOTS
        if not grow
        else int(os.environ.get("BANNER_GROW_MAX_DOTS", "6000"))
    )  # ~75cm

    # Find the biggest font whose glyph height fits the roll width and
    # whose length fits the cap. Measured with a scratch canvas.
    scratch = Image.new("1", (8, 8), 1)
    sdraw = ImageDraw.Draw(scratch)
    chosen_font, text_w, text_h = None, 0, 0
    size = int(W * 0.9)
    while size >= 40:
        f = _load_font(size)
        try:
            l, t, r, b = sdraw.textbbox((0, 0), text, font=f)
            tw, th = r - l, b - t
        except Exception:
            tw, th = len(text) * size // 2, size
        if th <= W - 16 and tw <= max_len - 32:
            chosen_font, text_w, text_h = f, tw, th
            break
        size -= 10
    if chosen_font is None:
        chosen_font = _load_font(40)
        while text and True:
            try:
                l, t, r, b = sdraw.textbbox((0, 0), text, font=chosen_font)
                text_w, text_h = r - l, b - t
            except Exception:
                text_w, text_h = len(text) * 20, 40
            if text_w <= BANNER_MAX_DOTS - 32:
                break
            text = text[:-1]

    # Draw horizontally, then rotate 90° so the strip prints lengthwise.
    horiz = Image.new("1", (text_w + 32, W), 1)
    hdraw = ImageDraw.Draw(horiz)
    try:
        l, t, _r, _b = hdraw.textbbox((16, 0), text, font=chosen_font)
        y_off = (W - text_h) // 2 - (t - 0)
    except Exception:
        y_off = (W - text_h) // 2
    hdraw.text((16, y_off), text, fill=0, font=chosen_font)
    banner = horiz.rotate(90, expand=True)  # (W wide x length tall)

    buf = io.BytesIO()
    banner.save(buf, format="PNG")
    return buf.getvalue()


def send_png_to_printer(
    ip: str, port: int, png_bytes: bytes, timeout: float = 5.0
) -> tuple[bool, str]:
    """Best-effort raw-socket dispatch to a network printer.

    ⚠️ HARDWARE-PENDING — see module docstring. Most printers on port
    9100 want native raster, not PNG. This opens the socket, writes the
    bytes, and reports success/failure of the *transport* — it does NOT
    guarantee the printer renders the PNG. Validate against the real
    printer; if it doesn't print, convert via brother_ql (Brother QL
    family) or ESC/POS raster before sending.

    Returns (ok, detail). Never raises — printer offline must never
    block an order.
    """
    if not ip:
        return False, "no printer IP configured"
    try:
        with socket.create_connection((ip, int(port)), timeout=timeout) as sock:
            sock.sendall(png_bytes)
        return True, f"sent {len(png_bytes)} bytes to {ip}:{port}"
    except OSError as e:
        logger.warning(f"label print to {ip}:{port} failed: {e}")
        return False, f"printer unreachable ({ip}:{port}): {e}"
    except Exception as e:  # noqa: BLE001
        logger.error(f"label print unexpected error: {e}")
        return False, f"print error: {e}"
