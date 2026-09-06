// LabelDesignCard — see the cup label EXACTLY as it will print (same
// renderer, same pixels) and choose what appears on it. Lives under
// Organiser -> Branding -> Labels; extracted from the Support Printers tab
// so the design of the sticker sits with the other branding, and the
// printer hardware stays with Support. Presentation options apply at
// render time, so even already-queued jobs pick up a change.
import React, { useState, useEffect, useCallback } from 'react';
import printService from '../../services/PrintService';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from './Toast';

const api = new ApiServiceClass();

// Label design card — see the label EXACTLY as it will print (same
// renderer, same pixels) and toggle what appears on it. Presentation
// options apply at render time, so even already-queued jobs pick up a
// change.
const LabelDesignCard = ({ printers = [], onPrinted }) => {
  const [settings, setSettings] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bannerText, setBannerText] = useState('FLAT WHITE');
  // Preview at any roll width (Steve: the design card was stuck at
  // 58mm even though printers can declare 40-80mm rolls).
  const [previewWidth, setPreviewWidth] = useState(406);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState(null);
  const [bannerPrinterId, setBannerPrinterId] = useState('');
  const enabledPrinters = (printers || []).filter((pr) => pr.enabled);

  const refreshBannerPreview = async () => {
    const text = bannerText.trim();
    if (!text) return;
    try {
      const token = localStorage.getItem('coffee_system_token');
      const r = await fetch(`/api/print/preview?banner=${encodeURIComponent(text)}&width=${previewWidth}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return;
      const blob = await r.blob();
      setBannerPreviewUrl(old => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e) { /* stays stale */ }
  };

  const loadSettings = useCallback(async () => {
    try {
      const r = await api.request('/print/label-settings');
      setSettings(r?.settings || {});
    } catch (e) { setSettings({}); }
  }, []);

  const [ticketPreviewUrl, setTicketPreviewUrl] = useState(null);

  const refreshPreview = useCallback(async () => {
    const token = localStorage.getItem('coffee_system_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const grab = async (url, setter) => {
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) return;
        const blob = await r.blob();
        setter(old => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      } catch (e) { /* preview stays stale */ }
    };
    grab(`/api/print/preview?sample=1&width=${previewWidth}`, setPreviewUrl);
    grab(`/api/print/preview?sample=1&ticket=1&width=${previewWidth}`, setTicketPreviewUrl);
  }, [previewWidth]);

  useEffect(() => { loadSettings(); refreshPreview(); }, [loadSettings, refreshPreview]);

  const save = async (patch) => {
    setBusy(true);
    const r = await api.request('/print/label-settings',
      { method: 'PUT', body: JSON.stringify(patch) })
      .catch(e => ({ success: false, message: e?.message }));
    setBusy(false);
    if (r?.success) {
      setSettings(s => ({ ...s, ...r.settings }));
      refreshPreview();
    } else {
      showToast(`Save failed: ${r?.message || 'unknown'}`, 'error');
    }
  };

  const toggle = (key, label, hint) => (
    <label className="flex items-center space-x-2 text-sm py-1">
      <input
        type="checkbox"
        disabled={busy || !settings}
        checked={!!settings?.[key]}
        onChange={(e) => save({ [key]: e.target.checked })}
      />
      <span>{label}</span>
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h2 className="text-xl font-bold mb-1">Label design</h2>
      <p className="text-sm text-gray-500 mb-3">
        Exactly what the printer will produce — preview any roll width
        below (each printer carries its own in the table). The label cuts
        at the image height, so "keep text big" makes long text use more
        sticker instead of shrinking. Order number, name and drink always
        print; the rest is yours:
      </p>
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 min-w-[16rem]">
          {toggle('show_event_name', 'Event name',
            settings?.event_name_effective ? `("${settings.event_name_effective}")` : '')}
          {toggle('show_logo', 'Logo',
            settings?.logo_available ? '(the sticker logo above, or the screen logo if none)' : '(no logo yet — add one above)')}
          {toggle('show_name', 'Customer name', '(off = number-only cups)')}
          {toggle('show_station_time', 'Station + time line')}
          {/* WHEN the coffee label prints. One control, three answers.
              This used to be a per-device checkbox on a different screen
              (barista > Display), which meant swapping the tablet silently
              stopped auto-printing and the organiser could not set it at
              all. Now it is per event and lives with the rest of the
              label settings. */}
          <div className="text-sm text-gray-600 mt-1 mb-1">Printing the coffee label</div>
          <label className="flex items-center space-x-2 text-sm py-1">
            <span>Print automatically</span>
            <select
              className="border rounded px-2 py-1"
              disabled={busy || !settings}
              value={settings?.auto_print_mode || 'off'}
              onChange={(e) => save({ auto_print_mode: e.target.value })}
            >
              <option value="off">Never — I'll press print</option>
              <option value="arrival">When the order arrives</option>
              <option value="start">When a barista starts it</option>
            </select>
          </label>
          <p className="text-xs text-gray-500 mb-2 ml-1">
            {settings?.auto_print_mode === 'arrival'
              ? 'Every order prints as it comes in, so the labels queue up ready to make — good for working ahead of a break. Nobody is texted until the drink is completed.'
              : settings?.auto_print_mode === 'start'
                ? 'One label at a time, as each barista picks the order up.'
                : 'Use the Print queue button on the barista screen when you want a batch.'}
          </p>

          <label className="flex items-center space-x-2 text-sm py-1">
            <span>Text alignment</span>
            <select
              className="border rounded px-2 py-1"
              disabled={busy || !settings}
              value={settings?.align || 'left'}
              onChange={(e) => save({ align: e.target.value })}
            >
              <option value="left">Left</option>
              <option value="center">Centred</option>
            </select>
          </label>
          <label className="flex items-center space-x-2 text-sm py-1">
            <span>Label size</span>
            <select
              className="border rounded px-2 py-1"
              disabled={busy || !settings}
              value={settings?.label_scale_mode || 'compact'}
              onChange={(e) => save({ label_scale_mode: e.target.value })}
            >
              <option value="compact">Shrink text (short label)</option>
              <option value="grow">Keep text big (longer label)</option>
              <option value="lid">Half height — for a cup lid (~40mm)</option>
            </select>
          </label>
          <label className="flex items-center space-x-2 text-sm py-1">
            <span>Preview roll</span>
            <select
              className="border rounded px-2 py-1"
              value={String(previewWidth)}
              onChange={(e) => setPreviewWidth(parseInt(e.target.value, 10))}
            >
              <option value="320">40mm</option>
              <option value="406">58mm</option>
              <option value="576">72mm</option>
              <option value="640">80mm</option>
            </select>
          </label>
          <div className="text-sm text-gray-600 mt-2 mb-1">Divider lines</div>
          {toggle('rule_below_logo', 'Below logo')}
          {toggle('rule_below_number', 'Below order number')}
          {toggle('rule_below_drink', 'Below drink details')}
          {toggle('rule_above_station', 'Above station + time')}
          {toggle('rule_above_footer', 'Above instructions/footer')}
          {toggle('rule_between_footer_lines', 'Between instructions and footer')}
          <div className="text-sm text-gray-600 mt-2 mb-1">Customer ticket stubs</div>
          {toggle('ticket_on_walkup', 'Also print a number stub the CUSTOMER takes away',
            '(the deli-counter slip, right preview — not the coffee label)')}
          <label className="block text-sm mt-2">
            <span className="text-gray-600">Ordering instructions line</span>
            <input
              className="mt-1 w-full border rounded px-2 py-1.5"
              defaultValue={settings?.instructions_text || ''}
              placeholder="e.g. Order: SMS 0489 263 333 or the event app"
              disabled={busy || !settings}
              onBlur={(e) => {
                if ((settings?.instructions_text || '') !== e.target.value.trim()) {
                  save({ instructions_text: e.target.value.trim() });
                }
              }}
            />
          </label>
          <label className="block text-sm mt-2">
            <span className="text-gray-600">Footer line (website / sponsor)</span>
            <input
              className="mt-1 w-full border rounded px-2 py-1.5"
              defaultValue={settings?.footer_text || ''}
              placeholder="e.g. CoffeeCue - coffeecue.com  or  Wallfly - wallfly.com.au"
              disabled={busy || !settings}
              onBlur={(e) => {
                if ((settings?.footer_text || '') !== e.target.value.trim()) {
                  save({ footer_text: e.target.value.trim() });
                }
              }}
            />
          </label>
          <label className="block text-sm mt-2">
            <span className="text-gray-600">Event name override (blank = use the event's name)</span>
            <input
              className="mt-1 w-full border rounded px-2 py-1.5"
              defaultValue={settings?.event_name || ''}
              placeholder={settings?.event_name_effective || ''}
              disabled={busy || !settings}
              onBlur={(e) => {
                if ((settings?.event_name || '') !== e.target.value.trim()) {
                  save({ event_name: e.target.value.trim() });
                }
              }}
            />
          </label>
          <button
            className="mt-3 bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300"
            onClick={refreshPreview}
          >
            Refresh preview
          </button>
          {/* Sideways banner: preview it here, print it to any enabled
              printer. Stock width (40-80mm per printer) = banner height,
              length up to ~30cm. */}
          <div className="mt-4 pt-3 border-t">
            <div className="text-sm text-gray-600 mb-1">Sideways banner (roll signage)</div>
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded px-2 py-1.5 text-sm"
                value={bannerText}
                maxLength={60}
                placeholder="e.g. FLAT WHITE"
                onChange={(e) => setBannerText(e.target.value)}
              />
              <select
                className="border rounded px-2 py-1 text-sm"
                disabled={busy || !settings}
                value={settings?.banner_scale_mode || 'grow'}
                onChange={(e) => save({ banner_scale_mode: e.target.value })}
                title="Grow: keep the letters big and run the strip longer. Compact: shrink to a short strip."
              >
                <option value="grow">Big letters</option>
                <option value="compact">Short strip</option>
              </select>
              <button
                className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300"
                onClick={refreshBannerPreview}
              >
                Preview
              </button>
              {/* The endpoint existed from the start but nothing called it,
                  so banners could only ever be previewed. Target defaults to
                  the first enabled printer; with several, pick one. */}
              <select
                className="border rounded px-2 py-1 text-sm"
                value={bannerPrinterId || ''}
                onChange={(e) => setBannerPrinterId(e.target.value)}
                title="Which printer to print the banner on"
              >
                {enabledPrinters.length === 0 && <option value="">No enabled printer</option>}
                {enabledPrinters.map((pr) => (
                  <option key={pr.id} value={pr.id}>{pr.name}</option>
                ))}
              </select>
              <button
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-40"
                disabled={!bannerText.trim() || enabledPrinters.length === 0}
                onClick={async () => {
                  const target = bannerPrinterId || enabledPrinters[0]?.id;
                  const r = await printService.printBanner(bannerText.trim(), target);
                  if (r?.warning) {
                    showToast(r.warning, 'warning', 9000);
                  } else {
                    showToast(r?.success ? 'Banner sent to printer'
                      : `Banner failed: ${r?.message || 'unknown'}`,
                      r?.success ? 'success' : 'error');
                  }
                  if (onPrinted) onPrinted();
                }}
              >
                Print banner
              </button>
            </div>
            {bannerPreviewUrl && (
              <div className="mt-2 overflow-x-auto border rounded bg-gray-50 p-2">
                {/* Shown rotated back to horizontal so it reads like the
                    physical banner will when peeled off. */}
                <img
                  src={bannerPreviewUrl}
                  alt="Banner preview"
                  style={{ height: '60px', width: 'auto', imageRendering: 'pixelated',
                           transform: 'rotate(-90deg) translateX(-100%)',
                           transformOrigin: 'top left', display: 'none' }}
                  onLoad={(e) => {
                    // Simpler: draw rotated onto a canvas sized for it.
                    const img = e.target;
                    const canvas = document.getElementById('bannerPreviewCanvas');
                    if (!canvas) return;
                    canvas.width = img.naturalHeight;
                    canvas.height = img.naturalWidth;
                    const ctx = canvas.getContext('2d');
                    ctx.save();
                    ctx.translate(0, img.naturalWidth);
                    ctx.rotate(-Math.PI / 2);
                    ctx.drawImage(img, 0, 0);
                    ctx.restore();
                  }}
                />
                <canvas id="bannerPreviewCanvas" style={{ height: '60px', width: 'auto' }} />
              </div>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 flex gap-4">
          <div className="text-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Cup label preview"
                className="border rounded shadow-sm mx-auto"
                style={{ width: '203px', imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="w-[203px] h-48 border rounded flex items-center justify-center text-gray-400 text-sm">
                Loading preview…
              </div>
            )}
            <div className="text-xs text-gray-400 mt-1">cup label · 50% · 58mm</div>
          </div>
          {settings?.ticket_on_walkup && (
            <div className="text-center">
              {ticketPreviewUrl ? (
                <img
                  src={ticketPreviewUrl}
                  alt="Ticket stub preview"
                  className="border rounded shadow-sm mx-auto"
                  style={{ width: '203px', imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-[203px] h-40 border rounded flex items-center justify-center text-gray-400 text-sm">
                  Loading…
                </div>
              )}
              <div className="text-xs text-gray-400 mt-1">customer ticket · 50%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabelDesignCard;
