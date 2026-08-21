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
        '/System/Library/Fonts/Helvetica.ttc',          # macOS
        '/System/Library/Fonts/Supplemental/Arial.ttf',  # macOS
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',  # Linux
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
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


def render_label_png(order: dict, branding: Optional[dict] = None,
                     width_px: int = DEFAULT_WIDTH_PX,
                     qr_url: Optional[str] = None) -> bytes:
    """Render an order label to PNG bytes.

    order: dict with order_number, order_details (or flattened fields),
           station_id, customer name.
    branding: optional dict with event_name.
    qr_url: optional URL to encode as a pickup QR (right side).
    """
    from PIL import Image, ImageDraw

    branding = branding or {}
    od = order.get('order_details') or {}
    if isinstance(od, str):
        import json
        try:
            od = json.loads(od)
        except Exception:
            od = {}

    order_number = str(order.get('order_number') or order.get('id') or '?')
    name = (od.get('name') or order.get('customer_name')
            or od.get('customer_name') or 'Customer')
    drink = od.get('type') or od.get('coffee_type') or 'Coffee'
    size = od.get('size') or ''
    milk = od.get('milk') or od.get('milk_type') or ''
    sugar = od.get('sugar') or ''
    strength = od.get('strength') or ''
    station_id = order.get('station_id') or od.get('station_id') or ''
    event_name = (branding.get('event_name') or branding.get('eventName') or '')

    drink_line = ' '.join([b for b in [size, drink] if b]).strip() or drink
    extras = []
    if milk and milk not in ('no milk', 'standard', 'none', 'None'):
        extras.append(f"{milk} milk")
    if strength:
        extras.append(str(strength))
    if sugar and sugar not in ('no sugar', 'none', 'None', '0'):
        extras.append(str(sugar))
    extras_line = ', '.join(extras)

    # Canvas. Height grows with content; start tall enough and crop.
    W = width_px
    H = 420
    img = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(img)

    f_event = _load_font(26)
    f_num = _load_font(96)
    f_name = _load_font(46)
    f_drink = _load_font(40)
    f_extras = _load_font(30)
    f_foot = _load_font(24)

    y = 12
    if event_name:
        draw.text((16, y), event_name[:34], fill='black', font=f_event)
        y += 34
    # Big order number — the thing the barista reads across the bench.
    draw.text((16, y), f"#{order_number}", fill='black', font=f_num)
    # Station badge top-right.
    if station_id:
        draw.text((W - 150, y + 10), f"St {station_id}", fill='black', font=f_drink)
    y += 104
    draw.text((16, y), _fit_to_width(draw, name, f_name, W - 32), fill='black', font=f_name)
    y += 54
    draw.text((16, y), _fit_to_width(draw, drink_line, f_drink, W - 32), fill='black', font=f_drink)
    y += 46
    if extras_line:
        draw.text((16, y), _fit_to_width(draw, extras_line, f_extras, W - 32), fill='black', font=f_extras)
        y += 36

    # Pickup QR bottom-right, if a URL was supplied.
    if qr_url:
        try:
            import qrcode
            qr = qrcode.QRCode(border=1, box_size=4)
            qr.add_data(qr_url)
            qr.make(fit=True)
            qr_img = qr.make_image(fill_color='black', back_color='white').convert('RGB')
            qs = min(150, W // 4)
            qr_img = qr_img.resize((qs, qs))
            img.paste(qr_img, (W - qs - 12, H - qs - 12))
        except Exception as e:
            logger.warning(f"label QR render failed: {e}")

    draw.text((16, H - 30), "Coffee Cue", fill='gray', font=f_foot)

    # Crop trailing whitespace below the content (keep QR area).
    content_bottom = max(y + 12, H)
    if content_bottom < H:
        img = img.crop((0, 0, W, content_bottom))

    buf = io.BytesIO()
    img.save(buf, format='PNG')
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

PRINT_WIDTH_DOTS = int(os.environ.get('PRINT_WIDTH_DOTS', '406'))
LABEL_MIN_HEIGHT = int(os.environ.get('LABEL_MIN_HEIGHT', '380'))
# Ceiling for GROW mode (label_scale_mode='grow'): the sticker gets
# longer instead of the text getting smaller. 4800 dots ≈ 60cm at
# 203dpi — a full sentence's worth of stock, per Steve.
LABEL_GROW_MAX_HEIGHT = int(os.environ.get('LABEL_GROW_MAX_HEIGHT', '4800'))
# 640 dots ≈ 80mm of stock — leaves room for the optional logo + event
# name + footer line without cropping; plain labels still cut short
# because height is content-driven.
LABEL_MAX_HEIGHT = int(os.environ.get('LABEL_MAX_HEIGHT', '640'))

# LID mode: a half-height sticker for the top of a takeaway lid instead of
# the side of the cup. 40mm at 203dpi = 320 dots, on the same 58mm stock.
# It fits because the order number and name come down a long way — on a lid
# the label is read from directly above, not picked out of a line-up of
# cups on a bench. 30mm floor so a short order does not pad blank stock.
LID_MAX_HEIGHT = int(os.environ.get('LID_MAX_HEIGHT', '320'))
LID_MIN_HEIGHT = int(os.environ.get('LID_MIN_HEIGHT', '240'))


def _wrap_to_width(draw, text, font, max_px):
    """Word-wrap `text` so no line exceeds max_px at `font`. Used by
    GROW mode, where long text takes MORE STOCK instead of shrinking
    (Steve: 'a really long sentence might use 50-60cm of sticker where
    COFFEE only uses 15'). Long single words are hard-split."""
    words, lines, current = str(text or '').split(), [], ''
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
    return lines or ['']


def _fit_to_width(draw, text, font, max_px):
    """Shorten `text` with an ellipsis until it fits max_px at `font`.

    Character caps (`text[:24]`) can't do this job: 24 narrow characters
    and 24 wide ones are very different widths, so a cap chosen to suit
    one drink silently clipped another off the edge of the label. A real
    order came out as 'Medium Cappuccino * Sk' / 'Milk' — the 'im' fell
    off the roll. Losing characters from a drink name is worse than an
    ellipsis, because the barista can't tell it happened.
    """
    text = str(text or '')

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
    while cut > 1 and width_of(text[:cut] + '...') > max_px:
        cut -= 1
    return text[:cut].rstrip() + '...'


def label_display_name(full_name: str) -> str:
    """'Stephanie Routley' -> 'Stephanie R.' — cup-label privacy."""
    parts = [p for p in str(full_name or '').strip().split() if p]
    if not parts:
        return 'Customer'
    if len(parts) == 1:
        return parts[0][:18]
    return f"{parts[0][:16]} {parts[1][0].upper()}."


def _decode_logo_to_1bit(logo_data_uri: str, max_width: int, max_height: int = 120):
    """Branding logo (base64 data URI) → 1-bit dithered PIL image sized to
    the label, or None on any problem. Never raises — a broken logo must
    never break a label."""
    try:
        import base64
        import io as _io
        from PIL import Image
        raw = logo_data_uri.split(',', 1)[1] if ',' in logo_data_uri else logo_data_uri
        img = Image.open(_io.BytesIO(base64.b64decode(raw)))
        # Flatten transparency onto white before thresholding.
        if img.mode in ('RGBA', 'LA', 'P'):
            bg = Image.new('RGB', img.size, 'white')
            img = img.convert('RGBA')
            bg.paste(img, mask=img.split()[-1])
            img = bg
        img = img.convert('L')
        ratio = min(max_width / img.width, max_height / img.height, 1.0)
        img = img.resize((max(1, int(img.width * ratio)),
                          max(1, int(img.height * ratio))))
        return img.convert('1')  # Floyd-Steinberg dither — thermal-friendly
    except Exception:
        return None


def render_label(payload: dict, width_dots: int = None,
                 options: dict = None) -> bytes:
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
    from PIL import Image, ImageDraw
    from datetime import datetime

    W = int(width_dots or PRINT_WIDTH_DOTS)
    payload = payload or {}
    options = options or {}

    order_number = str(payload.get('order_number') or '—')
    name = label_display_name(payload.get('name'))
    size = str(payload.get('size') or '').strip()
    drink = str(payload.get('drink') or 'Coffee').strip()
    milk = str(payload.get('milk') or '').strip()
    modifiers = [str(m) for m in (payload.get('modifiers') or []) if m]
    station = str(payload.get('station_name') or '').strip()
    ts = str(payload.get('ts') or '')[:16]
    try:
        hhmm = datetime.fromisoformat(ts).strftime('%H:%M') if ts else datetime.now().strftime('%H:%M')
    except Exception:
        hhmm = datetime.now().strftime('%H:%M')

    drink_line_parts = [p for p in (size.title(), drink.title()) if p]
    drink_line = ' '.join(drink_line_parts)
    if milk and milk.lower() not in ('no milk', 'none', 'standard', ''):
        drink_line += f" · {milk.title()}"

    # Sizing mode (Steve): 'compact' shrinks text to fit a short label
    # (the original behaviour); 'grow' keeps the text big and lets the
    # LABEL get longer — a long sentence eats more stock instead of
    # becoming unreadable.
    _mode = str((options or {}).get('label_scale_mode') or 'compact').lower()
    grow = _mode == 'grow'
    lid = _mode == 'lid'
    canvas_h = (LABEL_GROW_MAX_HEIGHT if grow
                else LID_MAX_HEIGHT if lid
                else LABEL_MAX_HEIGHT)

    # Oversized canvas; crop to content at the end.
    img = Image.new('1', (W, canvas_h), 1)  # 1-bit, white
    draw = ImageDraw.Draw(img)

    if lid:
        # Roughly half of each, so the same elements fit 40mm.
        f_num, f_name = _load_font(64), _load_font(34)
        f_drink, f_mods, f_foot = _load_font(26), _load_font(22), _load_font(18)
        A_NUM, A_NAME, A_DRINK, A_DRINK1, A_MODS, A_FOOT = 68, 40, 30, 28, 26, 22
    else:
        f_num, f_name = _load_font(120), _load_font(52)
        f_drink, f_mods, f_foot = _load_font(36), _load_font(30), _load_font(24)
        A_NUM, A_NAME, A_DRINK, A_DRINK1, A_MODS, A_FOOT = 126, 60, 42, 40, 36, 32

    margin = 10
    y = 4 if lid else 8

    # Design controls: whole-label alignment + divider rules between
    # sections (Steve: "a bit more overall design control").
    centred = str(options.get('align') or 'left').lower() == 'center'

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

    if payload.get('test'):
        # Calibration header + ruler ticks every 50 dots so the operator
        # can verify PRINT_WIDTH_DOTS against the physical stock.
        draw.text((margin, y), 'TEST LABEL', fill=0, font=f_drink)
        y += 44
        for x in range(0, W, 50):
            draw.line([(x, y), (x, y + 12)], fill=0)
            draw.text((x + 2, y + 12), str(x), fill=0, font=f_foot)
        y += 40

    # 0a. Logo (branding, dithered to 1-bit), always centred.
    if options.get('show_logo') and options.get('logo_data'):
        logo = _decode_logo_to_1bit(options['logo_data'], W - 2 * margin,
                                    max_height=56 if lid else 120)
        if logo is not None:
            img.paste(logo, ((W - logo.width) // 2, y))
            y += logo.height + (4 if lid else 8)
            rule('rule_below_logo')

    # 0b. Event name header.
    if options.get('show_event_name') and (options.get('event_name') or '').strip():
        _f_ev = _load_font(20 if lid else 28)
        put(_fit_to_width(draw, str(options['event_name']).strip(),
                          _f_ev, W - 2 * margin), _f_ev, 24 if lid else 36)

    # 1. Order number — the arm's-length element.
    put(f"#{order_number}", f_num, A_NUM)
    rule('rule_below_number')

    # 2. Customer name (toggleable — some events run number-only cups).
    if options.get('show_name', True):
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
            put(_fit_to_width(draw, ' '.join(d_lines[1:]), f_drink, W - 2 * margin),
                f_drink, A_DRINK)

    # 4. Modifiers.
    if modifiers:
        mods_text = ', '.join(modifiers)
        if grow:
            for ln in _wrap_to_width(draw, mods_text, f_mods, W - 2 * margin):
                put(ln, f_mods, A_MODS)
        else:
            put(_fit_to_width(draw, mods_text, f_mods, W - 2 * margin), f_mods, A_MODS)
    rule('rule_below_drink')

    # 5. Station + time. The rule above it used to be hardcoded —
    # Steve's review: every divider should be a choice. Default ON so
    # existing labels look unchanged until the operator says otherwise.
    if options.get('show_station_time', True):
        rule('rule_above_station', default=True)
        y += 2
        foot = ' · '.join([p for p in (station, hhmm) if p]) or hhmm
        put(foot[:40], f_foot, A_FOOT)

    # 6. Ordering instructions + branding footer — both optional,
    # centred, small. instructions_text is the "how to order again"
    # line ('Order: SMS 0489 263 333 or the event app'); footer_text is
    # branding/reseller ('CoffeeCue - coffeecue.com', Wallfly, ...).
    # Shrink-to-fit: try smaller fonts before truncating — the first
    # live render clipped 'or the event app' off the right edge.
    # Optional dividers: one above the whole block, one between the
    # instructions and sponsor/footer lines.
    # No room for the ordering/branding footer on a 40mm lid, and the height
    # cap would slice it mid-word — which reads as a printer fault rather
    # than a design choice. Drop it deliberately instead.
    footer_lines = [] if lid else [ln for ln in
                    (str(options.get('instructions_text') or '').strip(),
                     str(options.get('footer_text') or '').strip()) if ln]
    if footer_lines:
        rule('rule_above_footer')
    for idx, line in enumerate(footer_lines):
        if idx == 1:
            rule('rule_between_footer_lines')
        line = line[:400] if grow else line[:60]
        if grow:
            # GROW: keep the size, wrap onto more lines (more stock).
            f_grow = _load_font(22)
            for ln in _wrap_to_width(draw, line, f_grow, W - 2 * margin):
                try:
                    tw_g = draw.textlength(ln, font=f_grow)
                except Exception:
                    tw_g = len(ln) * 11
                draw.text((max(margin, (W - int(tw_g)) // 2), y),
                          ln, fill=0, font=f_grow)
                y += 28
            continue
        fitted, tw = None, W
        for size in (22, 20, 18, 16):
            f_try = _load_font(size)
            try:
                tw = draw.textlength(line, font=f_try)
            except Exception:
                tw = len(line) * (size // 2 + 1)
            if tw <= W - 2 * margin:
                fitted = f_try
                break
        if fitted is None:
            fitted = _load_font(16)
            while line and tw > W - 2 * margin:
                line = line[:-1]
                try:
                    tw = draw.textlength(line, font=fitted)
                except Exception:
                    tw = len(line) * 9
        draw.text((max(margin, (W - int(tw)) // 2), y),
                  line, fill=0, font=fitted)
        y += 28

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
        floor = int(options.get('min_height_dots') or _floor_default)
    except (TypeError, ValueError):
        floor = _floor_default
    floor = max(120, min(floor, canvas_h))   # never below ~15mm
    height = max(floor, min(canvas_h, y))
    img = img.crop((0, 0, W, height))

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def render_ticket(payload: dict, width_dots: int = None,
                  options: dict = None) -> bytes:
    """Customer ticket stub — the deli-counter number, on sticky stock.

    Printed for walk-up/kiosk customers so they leave the counter with
    their order number in hand (or stuck to a laptop lid). Distinct from
    the cup label: the NUMBER is the hero, the drink is a reminder line,
    and it says where to collect. Honours event name / instructions /
    footer from the same label_settings the designer edits.
    """
    from PIL import Image, ImageDraw
    from datetime import datetime

    W = int(width_dots or PRINT_WIDTH_DOTS)
    payload = payload or {}
    options = options or {}

    order_number = str(payload.get('order_number') or '—')
    drink = str(payload.get('drink') or '').strip()
    size = str(payload.get('size') or '').strip()
    station = str(payload.get('station_name') or '').strip()
    drink_line = ' '.join(p for p in (size.title(), drink.title()) if p)
    try:
        hhmm = datetime.fromisoformat(
            str(payload.get('ts') or '')[:16]).strftime('%H:%M')
    except Exception:
        hhmm = datetime.now().strftime('%H:%M')

    img = Image.new('1', (W, LABEL_MAX_HEIGHT), 1)
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
    ev = str(options.get('event_name') or '').strip()
    if options.get('show_event_name') and ev:
        centred(ev[:26], _load_font(26), 32)
    centred('YOUR ORDER', _load_font(28), 40)
    centred(f"#{order_number}", _load_font(150), 158)
    if drink_line:
        centred(drink_line[:24], _load_font(30), 38)
    if station:
        centred(f"Collect: {station}"[:30], _load_font(26), 34)
    y += 2
    draw.line([(margin, y), (W - margin, y)], fill=0)
    y += 8
    instructions = str(options.get('instructions_text') or '').strip()
    if instructions:
        f_small = _load_font(20)
        try:
            tw = draw.textlength(instructions[:44], font=f_small)
        except Exception:
            tw = len(instructions[:44]) * 9
        draw.text((max(margin, (W - int(tw)) // 2), y),
                  instructions[:44], fill=0, font=f_small)
        y += 26
    centred(hhmm, _load_font(20), 26)

    height = max(280, min(LABEL_MAX_HEIGHT, y + 6))
    img = img.crop((0, 0, W, height))
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


# Longest banner the cutter will be asked for: 2400 dots ≈ 30cm at
# 203dpi. Env-tunable for shops with longer rolls or nerves.
BANNER_MAX_DOTS = int(os.environ.get('BANNER_MAX_DOTS', '2400'))


def render_banner(payload: dict, width_dots: int = None,
                  options: dict = None) -> bytes:
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
    text = str((payload or {}).get('text') or 'COFFEE').strip()[:60] or 'COFFEE'
    # GROW (default for banners — the whole point of a banner is big
    # text): keep the glyphs as tall as the roll allows and let the
    # strip run as long as it needs, up to the length cap. COMPACT
    # shrinks the text so a long phrase stays on a short strip.
    grow = str((options or {}).get('banner_scale_mode')
               or (options or {}).get('label_scale_mode') or 'grow').lower() != 'compact'
    max_len = BANNER_MAX_DOTS if not grow else int(
        os.environ.get('BANNER_GROW_MAX_DOTS', '6000'))  # ~75cm

    # Find the biggest font whose glyph height fits the roll width and
    # whose length fits the cap. Measured with a scratch canvas.
    scratch = Image.new('1', (8, 8), 1)
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
    horiz = Image.new('1', (text_w + 32, W), 1)
    hdraw = ImageDraw.Draw(horiz)
    try:
        l, t, _r, _b = hdraw.textbbox((16, 0), text, font=chosen_font)
        y_off = (W - text_h) // 2 - (t - 0)
    except Exception:
        y_off = (W - text_h) // 2
    hdraw.text((16, y_off), text, fill=0, font=chosen_font)
    banner = horiz.rotate(90, expand=True)  # (W wide x length tall)

    buf = io.BytesIO()
    banner.save(buf, format='PNG')
    return buf.getvalue()


def send_png_to_printer(ip: str, port: int, png_bytes: bytes,
                        timeout: float = 5.0) -> tuple[bool, str]:
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
        return False, 'no printer IP configured'
    try:
        with socket.create_connection((ip, int(port)), timeout=timeout) as sock:
            sock.sendall(png_bytes)
        return True, f'sent {len(png_bytes)} bytes to {ip}:{port}'
    except OSError as e:
        logger.warning(f"label print to {ip}:{port} failed: {e}")
        return False, f'printer unreachable ({ip}:{port}): {e}'
    except Exception as e:  # noqa: BLE001
        logger.error(f"label print unexpected error: {e}")
        return False, f'print error: {e}'
