// HowToOrderPage.js — the delegate splash screen: "how to get a coffee".
//
// Steve: "need a splash screen ready to go for showing delegates the
// best way to order their coffee." Two doors, side by side:
//
//   1. SCAN TO ORDER  -> opens the ordering page in their browser.
//      Works on venue WiFi with NO SIM and NO cell data, and the page
//      then shows their live status, so no text message is needed at
//      all. This is the one to point overseas guests at.
//   2. SCAN TO TEXT   -> opens their messaging app with our number and
//      an opening message ALREADY FILLED IN. No typing the number, no
//      creating a contact — the friction Steve called out.
//
// Project it, put it on a spare screen, or print it (Print button).
// Public page; the QR images come from /api/qr, which encodes only
// what it's handed.
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const HowToOrderPage = () => {
  const [params] = useSearchParams();
  const stationId = params.get('station');
  const [config, setConfig] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/display/config');
        const b = r.ok ? await r.json() : null;
        setConfig((b && (b.config || b)) || {});
      } catch (e) { setConfig({}); }
    })();
  }, []);

  const origin = window.location.origin;
  // ?src= names WHERE this poster is going to hang: /how?station=1&src=cart-1-ipad
  // prints a QR whose orders come back tagged 'cart-1-ipad'. Print one poster
  // per placement and the channel report tells you which sign people used.
  // Sanitised the same way the server will sanitise it, so what you see on
  // the poster is what appears on the report.
  const srcCode = (params.get('src') || '')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 32);
  // The event code, so a poster from this event cannot order coffee at
  // the next one. Read from the server rather than typed into the URL:
  // a poster is printed once and the operator should not have to
  // remember to add it by hand.
  const [eventCode, setEventCode] = useState('');
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch('/api/display/config');
        const b = r.ok ? await r.json() : null;
        const c = String((b?.config || b || {}).event_code || '').trim();
        if (!dead && c) setEventCode(c);
      } catch (e) { /* an unstamped poster still works unless enforcing */ }
    })();
    return () => { dead = true; };
  }, []);

  const orderQuery = [
    stationId ? `station=${encodeURIComponent(stationId)}` : '',
    srcCode ? `src=${encodeURIComponent(srcCode)}` : '',
    eventCode ? `e=${encodeURIComponent(eventCode)}` : '',
  ].filter(Boolean).join('&');
  const orderUrl = `${origin}/order${orderQuery ? `?${orderQuery}` : ''}`;
  const smsNumber = String(config.sms_number || '').replace(/\s/g, '');
  // sms: URI — Android honours ?body=, iOS opens the message to the
  // right number (it may drop the body on older versions). Either way
  // the number is filled in, which is the part that matters.
  const smsUri = smsNumber
    ? `sms:${smsNumber}?body=${encodeURIComponent('Hi, I would like to order a coffee')}`
    : '';
  const qr = (data, size = 12) =>
    `/api/qr?size=${size}&data=${encodeURIComponent(data)}`;

  const prettyNumber = (raw) => {
    const d = String(raw || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+61') && d.length === 12) {
      const local = '0' + d.slice(3);
      return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
    }
    return raw || '';
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <style>{`@media print { .no-print { display: none !important; } @page { size: A4 landscape; margin: 1cm; } }`}</style>

      <div className="text-center mb-6">
        {config.logo && (
          <img src={config.logo} alt="" className="h-20 mx-auto mb-3 object-contain" />
        )}
        <h1 className="text-5xl font-extrabold tracking-tight">
          {config.event_name || 'Coffee'}
        </h1>
        <p className="text-2xl text-gray-600 mt-1">Two ways to order — pick either</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
        {/* 1. Web ordering — the no-SIM / overseas-guest answer */}
        <div className="border-4 border-blue-600 rounded-3xl p-6 text-center">
          <div className="text-3xl font-extrabold text-blue-700 mb-1">SCAN TO ORDER</div>
          <div className="text-lg text-gray-600 mb-4">
            No SIM, no app — just WiFi
          </div>
          <img src={qr(orderUrl)} alt="Scan to order"
               className="mx-auto w-56 h-56" />
          <div className="text-base text-gray-500 mt-3">
            Tap your coffee, then <b>keep the page open</b> —<br />
            it counts down and turns green when ready.
          </div>
        </div>

        {/* 2. Pre-filled text message — no contact to create, no typing */}
        <div className="border-4 border-gray-800 rounded-3xl p-6 text-center">
          <div className="text-3xl font-extrabold mb-1">SCAN TO TEXT</div>
          <div className="text-lg text-gray-600 mb-4">
            We'll buzz your phone when it's ready
          </div>
          {smsUri ? (
            <img src={qr(smsUri)} alt="Scan to text us"
                 className="mx-auto w-56 h-56" />
          ) : (
            <div className="w-56 h-56 mx-auto flex items-center justify-center text-gray-400 border rounded">
              SMS number not set
            </div>
          )}
          <div className="text-base text-gray-500 mt-3">
            Opens a text with our number filled in — send it,
            then <b>pocket your phone</b> until it buzzes.
          </div>
          <div className="text-base text-gray-500 mt-2">
            Or text us directly:<br />
            <span className="text-2xl font-bold text-gray-800">
              {prettyNumber(config.sms_number)}
            </span>
          </div>
        </div>
      </div>

      {config.custom_message && (
        <div className="mt-6 text-xl text-gray-700 text-center">{config.custom_message}</div>
      )}

      <div className="no-print fixed bottom-4 right-4 flex gap-2">
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold shadow"
                onClick={() => window.print()}>Print A4</button>
        <button className="bg-gray-700 text-white px-4 py-2 rounded-lg font-semibold shadow"
                onClick={() => { const el = document.documentElement;
                                 if (el.requestFullscreen) el.requestFullscreen(); }}>
          Fullscreen
        </button>
      </div>
    </div>
  );
};

export default HowToOrderPage;
