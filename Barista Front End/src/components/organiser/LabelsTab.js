import React, { useEffect, useState, useCallback } from 'react';
import { Upload, Printer, ExternalLink } from 'lucide-react';
import LabelDesignCard from '../shared/LabelDesignCard';
import printService from '../../services/PrintService';
import { fetchBranding, patchBranding } from '../../utils/brandingPatch';
import { readLogoFile } from '../../utils/imageCompress';

// Branding -> Labels: everything about the sticker on the cup, together.
//
// Before this the sticker LOGO was on the Branding form (a screen away
// from the label it prints on) and the label DESIGN was in Support ->
// Printers (a different interface altogether). Steve: "sponsors and logos
// for stickers, all in illogical places and submenus." Printer hardware —
// connection, roll width, offset, the queue — stays in Support -> Printers:
// that is the machine, this is what it prints.

const StickerLogoCard = ({ onChanged }) => {
  const [logo, setLogo] = useState('');
  const [screenLogo, setScreenLogo] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const b = await fetchBranding();
        setLogo(b.labelLogo || '');
        setScreenLogo(b.clientLogo || '');
      } catch (e) { /* start empty */ }
      setLoaded(true);
    })();
  }, []);

  // Saves straight away — one asset, no form to fill, nothing else to
  // remember to press. The server merges, so only labelLogo changes.
  const saveLogo = async (dataUrl) => {
    setBusy(true); setErr(''); setMsg('');
    const ok = await patchBranding({ labelLogo: dataUrl });
    setBusy(false);
    if (!ok) { setErr('Save failed — check your connection and try again.'); return; }
    setLogo(dataUrl);
    setMsg(dataUrl ? 'Sticker logo saved — the preview below will update.' : 'Sticker logo removed — labels use the screen logo instead.');
    if (onChanged) onChanged();
  };

  const onUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file (PNG, JPG, SVG).'); return; }
    try {
      const dataUrl = await readLogoFile(file);
      await saveLogo(dataUrl);
    } catch (er) {
      setErr('That image could not be read. Please try a PNG or JPG.');
    }
  };

  return (
    <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
      <h2 className="text-lg font-bold text-cq-roast mb-1">Sticker logo</h2>
      <p className="text-sm text-cq-ink-3 mb-4 max-w-[62ch]">
        Printed about 7mm tall in black and white on a cup or lid, so keep it
        simple and high-contrast — fine detail and pale colours vanish. Leave
        it empty to print the screen logo from <em>Logo &amp; look</em> instead.
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        {logo ? (
          <img src={logo} alt="Sticker logo" className="h-16 w-auto max-w-[160px] object-contain border border-cq-line rounded-cq-md bg-cq-milk p-1" />
        ) : screenLogo ? (
          <div className="flex items-center gap-2">
            <img src={screenLogo} alt="Screen logo" className="h-16 w-auto max-w-[160px] object-contain border border-dashed border-cq-line rounded-cq-md bg-cq-milk p-1 opacity-60" />
            <span className="text-xs text-cq-ink-3">screen logo<br />used until you add one</span>
          </div>
        ) : (
          <div className="h-16 w-28 flex items-center justify-center border border-dashed border-cq-line rounded-cq-md text-xs text-cq-ink-3 text-center px-1">
            No logo yet
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label className={`px-4 py-2.5 rounded-cq-md bg-cq-wash text-cq-roast font-semibold hover:bg-cq-caramel-wash flex items-center cursor-pointer text-sm w-fit ${(!loaded || busy) ? 'opacity-50 pointer-events-none' : ''}`}>
            <Upload className="mr-2" size={16} />
            {busy ? 'Saving…' : (logo ? 'Replace sticker logo' : 'Upload sticker logo')}
            <input type="file" accept="image/*" onChange={onUpload} className="hidden" disabled={!loaded || busy} />
          </label>
          {logo && (
            <button type="button" onClick={() => saveLogo('')} disabled={busy}
              className="text-xs text-cq-alert hover:underline w-fit disabled:opacity-50">
              Remove sticker logo
            </button>
          )}
        </div>
      </div>
      {msg && <p className="text-sm text-cq-ready mt-3">{msg}</p>}
      {err && <p className="text-sm text-cq-alert mt-3">{err}</p>}
    </div>
  );
};

const LabelsTab = () => {
  const [printers, setPrinters] = useState([]);
  // Remount the design card after the logo changes so its preview (which
  // it fetches itself) shows the new sticker.
  const [designKey, setDesignKey] = useState(0);

  const loadPrinters = useCallback(async () => {
    try {
      const list = await printService.getPrinters();
      setPrinters(Array.isArray(list) ? list : []);
    } catch (e) { setPrinters([]); }
  }, []);

  useEffect(() => { loadPrinters(); }, [loadPrinters]);

  const enabled = printers.filter((p) => p.enabled);
  const online = enabled.filter((p) => p.online);

  return (
    <div className="space-y-6">
      <StickerLogoCard onChanged={() => setDesignKey((k) => k + 1)} />
      <LabelDesignCard key={designKey} printers={printers} onPrinted={loadPrinters} />
      {/* Was "Support → Integrations → Printers" pointing at /support -- the
          old four-interface model. Support and Organiser became the one runner
          app; the redirect still worked but the words sent you looking for a
          menu that no longer exists. */}
      <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5 flex items-start gap-3 text-sm">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-cq-md
                         bg-cq-caramel-wash text-cq-roast flex-shrink-0">
          <Printer size={20} strokeWidth={2.25} />
        </span>
        <div>
          <div className="font-bold text-cq-roast">
            {printers.length === 0
              ? 'No printers set up yet'
              : `${enabled.length} printer${enabled.length === 1 ? '' : 's'} on, ${online.length} answering`}
          </div>
          <div className="text-cq-ink-3 mt-0.5">
            The machines themselves — connecting one, roll width, offset,
            calibration and the queue — live in{' '}
            <a href="/run#printers" className="inline-flex items-center gap-1 text-cq-caramel-deep hover:underline font-semibold">
              Printers <ExternalLink size={13} />
            </a>.
          </div>
        </div>
      </div>
    </div>
  );
};

export default LabelsTab;
