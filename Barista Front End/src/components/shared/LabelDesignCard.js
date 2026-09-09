// LabelDesignCard — see the cup label EXACTLY as it will print (same
// renderer, same pixels) and choose what appears on it. Lives under
// Organiser -> Branding -> Labels; extracted from the Support Printers tab
// so the design of the sticker sits with the other branding, and the
// printer hardware stays with Support. Presentation options apply at
// render time, so even already-queued jobs pick up a change.
import React, { useState, useEffect, useCallback } from 'react';
import {
  AlignLeft, Clock, Globe, Image as ImageIcon, Maximize2, MessageSquare,
  Minus, Printer, Receipt, Ruler, Tag, User,
} from 'lucide-react';
import { SettingGroup, SettingRow, Toggle, Segmented, SelectRow, TextField, SettingNote } from '../../design';
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

  // One row per switch. Was a bare checkbox with the hint trailing off the
  // end of the line in grey; now it reads like every other setting in the app.
  const toggle = (key, label, hint, Icon) => (
    <SettingRow Icon={Icon} label={label} hint={hint}>
      <Toggle
        on={!!settings?.[key]}
        disabled={busy || !settings}
        onChange={(v) => save({ [key]: v })}
      />
    </SettingRow>
  );

  return (
    <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
      <h2 className="text-lg font-bold text-cq-roast mb-1">Label design</h2>
      <p className="text-sm text-cq-ink-3 mb-4 max-w-[62ch]">
        Exactly what the printer will produce. Order number, name and drink
        always print; the rest is yours.
      </p>
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 min-w-[16rem]">
          <SettingGroup title="What prints on it">
            {toggle('show_event_name', 'Event name',
              settings?.event_name_effective ? `Currently "${settings.event_name_effective}"` : 'No event name set',
              Tag)}
            {toggle('show_logo', 'Logo',
              settings?.logo_available ? 'The sticker logo, or the screen one if none' : 'No logo yet — add one above',
              ImageIcon)}
            {toggle('show_name', 'Customer name', 'Off gives number-only cups', User)}
            {toggle('show_station_time', 'Station and time', 'A line at the foot of the label', Clock)}
          </SettingGroup>

          <SettingGroup title="Printing">
            <SettingRow Icon={Printer} label="Print automatically"
                        hint="When the coffee label comes out">
              <Segmented
                size="sm"
                value={settings?.auto_print_mode || 'off'}
                onChange={(v) => save({ auto_print_mode: v })}
                options={[
                  { value: 'off', label: 'Never' },
                  { value: 'arrival', label: 'On arrival' },
                  { value: 'start', label: 'On start' },
                ]}
              />
            </SettingRow>
            <SettingRow Icon={AlignLeft} label="Text alignment">
              <Segmented
                size="sm"
                value={settings?.align || 'left'}
                onChange={(v) => save({ align: v })}
                options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centred' }]}
              />
            </SettingRow>
            <SettingRow Icon={Maximize2} label="Label size"
                        hint="The label cuts at the image height">
              <Segmented
                size="sm"
                value={settings?.label_scale_mode || 'compact'}
                onChange={(v) => save({ label_scale_mode: v })}
                options={[
                  { value: 'compact', label: 'Shrink text' },
                  { value: 'grow', label: 'Keep text big' },
                  { value: 'lid', label: 'Lid (40mm)' },
                ]}
              />
            </SettingRow>
            <SettingRow Icon={Ruler} label="Preview roll"
                        hint="Each printer carries its own width">
              <Segmented
                size="sm"
                value={String(previewWidth)}
                onChange={(v) => setPreviewWidth(parseInt(v, 10))}
                options={[
                  { value: '320', label: '40mm' }, { value: '406', label: '58mm' },
                  { value: '576', label: '72mm' }, { value: '640', label: '80mm' },
                ]}
              />
            </SettingRow>
          </SettingGroup>

          {/* The one explanation that carries real information: what each
              auto-print mode actually does to the queue. One note under the
              group it belongs to, not a paragraph under every field. */}
          <SettingNote>
            {settings?.auto_print_mode === 'arrival'
              ? 'Every order prints as it comes in, so labels queue up ready to make — good for working ahead of a break. Nobody is texted until the drink is finished.'
              : settings?.auto_print_mode === 'start'
                ? 'One label at a time, as each barista picks the order up.'
                : 'Use the Print queue button on the barista screen when you want a batch.'}
          </SettingNote>

          <SettingGroup title="Divider lines" className="mt-5">
            {toggle('rule_below_logo', 'Below the logo', null, Minus)}
            {toggle('rule_below_number', 'Below the order number', null, Minus)}
            {toggle('rule_below_drink', 'Below the drink', null, Minus)}
            {toggle('rule_above_station', 'Above station and time', null, Minus)}
            {toggle('rule_above_footer', 'Above the footer', null, Minus)}
            {toggle('rule_between_footer_lines', 'Between instructions and footer', null, Minus)}
          </SettingGroup>

          <SettingGroup title="Customer ticket stub">
            {toggle('ticket_on_walkup', 'Print a stub the customer takes',
              'The deli-counter slip on the right — not the coffee label', Receipt)}
          </SettingGroup>

          {/* Uncontrolled on purpose: these commit on blur so typing does not
              fire a PUT per keystroke. Same behaviour as before, styled. */}
          <SettingGroup title="Lines of text">
            <SettingRow Icon={MessageSquare} label="Ordering instructions"
                        hint="Printed under the drink" stack>
              <TextField
                width="w-full"
                placeholder="e.g. Order: SMS 0489 263 333 or the event app"
                defaultValue={settings?.instructions_text || ''}
                disabled={busy || !settings}
                onBlur={(e) => {
                  if ((settings?.instructions_text || '') !== e.target.value.trim()) {
                    save({ instructions_text: e.target.value.trim() });
                  }
                }}
              />
            </SettingRow>
            <SettingRow Icon={Globe} label="Footer line"
                        hint="Website or sponsor, at the very bottom" stack>
              <TextField
                width="w-full"
                placeholder="e.g. CupQ - cupq.app  or  Wallfly - wallfly.com.au"
                defaultValue={settings?.footer_text || ''}
                disabled={busy || !settings}
                onBlur={(e) => {
                  if ((settings?.footer_text || '') !== e.target.value.trim()) {
                    save({ footer_text: e.target.value.trim() });
                  }
                }}
              />
            </SettingRow>
            <SettingRow Icon={Tag} label="Event name override"
                        hint="Leave blank to use the event's own name" stack>
              <TextField
                width="w-full"
                placeholder={settings?.event_name_effective || ''}
                defaultValue={settings?.event_name || ''}
                disabled={busy || !settings}
                onBlur={(e) => {
                  if ((settings?.event_name || '') !== e.target.value.trim()) {
                    save({ event_name: e.target.value.trim() });
                  }
                }}
              />
            </SettingRow>
          </SettingGroup>

          <button
            className="mt-3 px-4 py-2 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm hover:bg-cq-caramel-wash"
            onClick={refreshPreview}
          >
            Refresh preview
          </button>
          {/* Sideways banner: preview it here, print it to any enabled
              printer. Stock width (40-80mm per printer) = banner height,
              length up to ~30cm. */}
          {/* A sideways strip printed down the roll -- 'FLAT WHITE' to stand
              beside the jug. Was a row of five bare controls jammed together;
              now it reads as one job with a name. */}
          <div className="mt-6 pt-4 border-t border-cq-line">
            <div className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-2">
              Sideways banner
            </div>
            <p className="text-sm text-cq-ink-3 mb-3 max-w-[52ch]">
              A strip printed down the roll — a drink name to stand beside the
              jug. The roll width is its height.
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <TextField
                width="flex-1 min-w-[12rem]"
                value={bannerText}
                maxLength={60}
                placeholder="e.g. FLAT WHITE"
                onChange={setBannerText}
              />
              <Segmented
                size="sm"
                value={settings?.banner_scale_mode || 'grow'}
                onChange={(v) => save({ banner_scale_mode: v })}
                options={[{ value: 'grow', label: 'Big letters' },
                          { value: 'compact', label: 'Short strip' }]}
              />
              <button
                type="button"
                className="h-10 px-4 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm hover:bg-cq-caramel-wash"
                onClick={refreshBannerPreview}
              >
                Preview
              </button>
              {/* The endpoint existed from the start but nothing called it,
                  so banners could only ever be previewed. Target defaults to
                  the first enabled printer; with several, pick one. */}
              <SelectRow
                ariaLabel="Which printer to print the banner on"
                value={bannerPrinterId || ''}
                onChange={setBannerPrinterId}
                options={enabledPrinters.length === 0
                  ? [{ value: '', label: 'No printer on' }]
                  : enabledPrinters.map((pr) => ({ value: pr.id, label: pr.name }))}
              />
              <button
                className="h-10 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-semibold text-sm hover:bg-cq-caramel-deep disabled:opacity-40"
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
              <div className="mt-2 overflow-x-auto border border-cq-line rounded-cq-md bg-cq-wash p-2">
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
                className="border border-cq-line rounded-cq-md shadow-sm mx-auto bg-cq-milk"
                style={{ width: '203px', imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="w-[203px] h-48 border border-cq-line rounded-cq-md flex items-center justify-center text-cq-ink-3 text-sm">
                Loading preview…
              </div>
            )}
            <div className="text-xs text-cq-ink-3 mt-1">cup label · 50% · 58mm</div>
          </div>
          {settings?.ticket_on_walkup && (
            <div className="text-center">
              {ticketPreviewUrl ? (
                <img
                  src={ticketPreviewUrl}
                  alt="Ticket stub preview"
                  className="border border-cq-line rounded-cq-md shadow-sm mx-auto bg-cq-milk"
                  style={{ width: '203px', imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-[203px] h-40 border border-cq-line rounded-cq-md flex items-center justify-center text-cq-ink-3 text-sm">
                  Loading…
                </div>
              )}
              <div className="text-xs text-cq-ink-3 mt-1">customer ticket · 50%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabelDesignCard;
