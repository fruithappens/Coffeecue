// Scan the badge instead of typing the name.
//
// The badge is already round their neck with a QR on it, and typing a name
// on a phone is the slowest, most mis-spelled step of the order. This opens
// the camera in the browser (HTTPS, one permission prompt, nothing to
// install), reads the QR, and hands the text to the server, which answers
// the same way it answers an EA app link: first name and whether they have
// a number on file -- never the number itself.
//
// Decoding: Chrome on Android has BarcodeDetector built in; Safari on iPhone
// does not, so jsQR (10 kB) is loaded on demand the first time it is needed.
// Roughly five frames a second is plenty for a badge held still; the loop
// stops on the first read, on Cancel, or when the sheet unmounts.
import React, { useEffect, useRef, useState } from 'react';
import { X, ScanLine } from 'lucide-react';

const hasCamera = () => typeof navigator !== 'undefined'
  && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export const canScanBadges = hasCamera;

export default function BadgeScanner({ onFound, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [state, setState] = useState('starting'); // starting | scanning | denied | error | looking-up | unknown
  const [message, setMessage] = useState('');

  useEffect(() => {
    let stream = null;
    let stop = false;
    let detector = null;
    let jsQR = null;
    let timer = null;

    const cleanup = () => {
      stop = true;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };

    const lookup = async (text) => {
      setState('looking-up');
      try {
        const r = await fetch('/api/ea/badge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: text }),
        });
        const b = await r.json().catch(() => ({}));
        if (r.ok && b.success && b.first_name) {
          cleanup();
          onFound({ cid: b.cid, firstName: b.first_name, hasPhone: !!b.has_phone });
          return;
        }
        setMessage(b.disabled ? 'Badge scanning is not on for this event.' : "That badge isn't on the list — type your name instead.");
        setState('unknown');
      } catch (e) {
        setMessage("Couldn't check that badge — type your name instead.");
        setState('unknown');
      }
    };

    const tick = async () => {
      if (stop) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState >= 2 && v.videoWidth) {
        try {
          let text = '';
          if (detector) {
            const codes = await detector.detect(v);
            text = (codes && codes[0] && codes[0].rawValue) || '';
          } else if (jsQR) {
            const w = Math.min(640, v.videoWidth);
            const h = Math.round(v.videoHeight * (w / v.videoWidth));
            c.width = w; c.height = h;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            text = (code && code.data) || '';
          }
          if (text && text.trim()) { await lookup(text.trim()); return; }
        } catch (e) { /* try the next frame */ }
      }
      timer = setTimeout(tick, 200);
    };

    (async () => {
      try {
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
          try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
        }
        if (!detector) {
          const mod = await import('jsqr');
          jsQR = mod.default || mod;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play().catch(() => undefined); }
        setState('scanning');
        tick();
      } catch (e) {
        const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        setMessage(denied ? 'Camera permission was refused — type your name instead.' : "Couldn't open the camera — type your name instead.");
        setState(denied ? 'denied' : 'error');
      }
    })();

    return cleanup;
  }, [onFound]);

  return (
    <div className="fixed inset-0 z-[60] bg-cq-roast-deep flex flex-col" role="dialog" aria-modal="true" aria-label="Scan your badge">
      <div className="flex items-center gap-2 p-4 text-cq-cream">
        <ScanLine size={22} className="text-cq-tan" />
        <div className="font-bold text-lg">Scan your badge</div>
        <button type="button" onClick={onClose} aria-label="Cancel"
          className="ml-auto p-2 rounded-cq-md text-cq-cream hover:bg-white/10">
          <X size={24} />
        </button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        <video ref={videoRef} playsInline muted className="max-h-full max-w-full rounded-cq-lg" />
        <canvas ref={canvasRef} className="hidden" />
        {state === 'scanning' ? (
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 aspect-square max-h-[60%] mx-auto
                          border-4 border-cq-tan/80 rounded-cq-xl pointer-events-none" style={{ maxWidth: '70vmin' }} />
        ) : null}
      </div>
      <div className="p-5 text-center text-cq-cream">
        {state === 'starting' ? <p className="text-base">Opening the camera…</p> : null}
        {state === 'scanning' ? <p className="text-base">Point it at the QR code on your badge.</p> : null}
        {state === 'looking-up' ? <p className="text-base">Checking…</p> : null}
        {(state === 'unknown' || state === 'denied' || state === 'error') ? (
          <>
            <p className="text-base font-semibold text-cq-tan">{message}</p>
            <button type="button" onClick={onClose}
              className="mt-3 h-12 px-6 rounded-cq-md bg-cq-caramel text-white font-bold">
              Type it instead
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
