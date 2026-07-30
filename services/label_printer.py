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
    draw.text((16, y), name[:22], fill='black', font=f_name)
    y += 54
    draw.text((16, y), drink_line[:26], fill='black', font=f_drink)
    y += 46
    if extras_line:
        draw.text((16, y), extras_line[:40], fill='black', font=f_extras)
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
LABEL_MAX_HEIGHT = int(os.environ.get('LABEL_MAX_HEIGHT', '520'))


def label_display_name(full_name: str) -> str:
    """'Stephanie Routley' -> 'Stephanie R.' — cup-label privacy."""
    parts = [p for p in str(full_name or '').strip().split() if p]
    if not parts:
        return 'Customer'
    if len(parts) == 1:
        return parts[0][:18]
    return f"{parts[0][:16]} {parts[1][0].upper()}."


def render_label(payload: dict, width_dots: int = None) -> bytes:
    """Render a print-job payload snapshot to a 1-bit PNG.

    payload keys (all optional, sensible fallbacks):
      order_number, name, drink, size, milk, modifiers (list[str]),
      station_name, ts (ISO time string), test (bool).
    """
    from PIL import Image, ImageDraw
    from datetime import datetime

    W = int(width_dots or PRINT_WIDTH_DOTS)
    payload = payload or {}

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

    # Oversized canvas; crop to content at the end.
    img = Image.new('1', (W, LABEL_MAX_HEIGHT), 1)  # 1-bit, white
    draw = ImageDraw.Draw(img)

    f_num = _load_font(120)
    f_name = _load_font(52)
    f_drink = _load_font(36)
    f_mods = _load_font(30)
    f_foot = _load_font(24)

    margin = 10
    y = 8
    if payload.get('test'):
        # Calibration header + ruler ticks every 50 dots so the operator
        # can verify PRINT_WIDTH_DOTS against the physical stock.
        draw.text((margin, y), 'TEST LABEL', fill=0, font=f_drink)
        y += 44
        for x in range(0, W, 50):
            draw.line([(x, y), (x, y + 12)], fill=0)
            draw.text((x + 2, y + 12), str(x), fill=0, font=f_foot)
        y += 40

    # 1. Order number — the arm's-length element.
    draw.text((margin, y), f"#{order_number}", fill=0, font=f_num)
    y += 126

    # 2. Customer name.
    draw.text((margin, y), name, fill=0, font=f_name)
    y += 60

    # 3. Drink line (wraps once if long).
    if len(drink_line) > 24:
        draw.text((margin, y), drink_line[:24], fill=0, font=f_drink)
        y += 40
        draw.text((margin, y), drink_line[24:48], fill=0, font=f_drink)
        y += 42
    else:
        draw.text((margin, y), drink_line, fill=0, font=f_drink)
        y += 42

    # 4. Modifiers.
    if modifiers:
        draw.text((margin, y), ', '.join(modifiers)[:34], fill=0, font=f_mods)
        y += 36

    # 5. Footer: station + time, separated by a rule.
    y += 4
    draw.line([(margin, y), (W - margin, y)], fill=0)
    y += 6
    foot = ' · '.join([p for p in (station, hhmm) if p]) or hhmm
    draw.text((margin, y), foot[:40], fill=0, font=f_foot)
    y += 32

    height = max(LABEL_MIN_HEIGHT, min(LABEL_MAX_HEIGHT, y))
    img = img.crop((0, 0, W, height))

    buf = io.BytesIO()
    img.save(buf, format='PNG')
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
