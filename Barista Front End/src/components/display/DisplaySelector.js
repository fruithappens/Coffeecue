// Screens — every screen CupQ can put on a wall, a tablet or a phone, in
// one place, with the address for each and what it is for.
//
// The old page was a blue "Display Screen Selector" that listed the order
// board per station and nothing else: no sponsor wall, no how-to poster, no
// customer page, and nothing about how any of it is configured. Steve:
// "looking a bit original, was a bit wordy, and I don't even know if it gave
// all the options and how to turn some areas on or make them look
// different."
import React, { useEffect, useMemo, useState } from 'react';
import { Monitor, Hand, Eye, Copy, Check, QrCode, ExternalLink, Sparkles, Smartphone, Image as ImageIcon, HelpCircle, Activity, Sliders } from 'lucide-react';
import { AreaMark, Button, Pill, useEventBrand, EventHeader } from '../../design';
import useStations from '../../hooks/useStations';
import AdminViewSwitcher from '../shared/AdminViewSwitcher';

const origin = () => (typeof window !== 'undefined' ? window.location.origin : '');

// One row: what the screen is, where it lives, and the three things you ever
// want to do with an address — open it, copy it, or scan it onto a device.
const ScreenRow = ({ Icon, title, what, path, badge, extra }) => {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const url = origin() + path;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); }
    catch (e) { window.prompt('Copy this address for the other screen:', url); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="bg-cq-milk rounded-cq-lg shadow-cq-card border border-cq-line p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-11 h-11 rounded-cq-md bg-cq-caramel-wash text-cq-roast flex-shrink-0">
          <Icon size={20} strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-extrabold text-lg text-cq-roast leading-tight">{title}</h3>
            {badge}
          </div>
          <p className="text-sm text-cq-ink-2 mt-0.5">{what}</p>
          <code className="inline-block mt-1.5 text-xs text-cq-ink-3 break-all">{path}</code>
          {extra}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" Icon={ExternalLink} onClick={() => window.open(path, '_blank')}>Open</Button>
        <Button size="sm" variant="secondary" Icon={copied ? Check : Copy} onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button size="sm" variant="ghost" Icon={QrCode} onClick={() => setQr((v) => !v)}>
          {qr ? 'Hide code' : 'Scan'}
        </Button>
      </div>
      {qr ? (
        <div className="mt-3 flex items-center gap-3">
          <img src={`/api/qr?size=6&data=${encodeURIComponent(url)}`} alt="" className="w-28 h-28 rounded bg-white p-1 border border-cq-line" />
          <p className="text-sm text-cq-ink-2 max-w-[24ch]">Point another device&rsquo;s camera at this to open the screen there.</p>
        </div>
      ) : null}
    </div>
  );
};

const Section = ({ title, hint, children }) => (
  <section className="mt-8 first:mt-0">
    <div className="flex items-baseline gap-3 border-b border-cq-line pb-2 mb-4">
      <h2 className="text-xl font-extrabold text-cq-roast">{title}</h2>
      {hint ? <span className="text-sm text-cq-ink-3">{hint}</span> : null}
    </div>
    {children}
  </section>
);

export default function DisplaySelector({ embedded = false }) {
  const { stations } = useStations();
  const brand = useEventBrand();
  const [look, setLook] = useState(null);
  const [orientation, setOrientation] = useState('auto');

  useEffect(() => {
    fetch('/api/display/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setLook((b && (b.config || b)) || null))
      .catch(() => {});
  }, []);

  // The board's address, built from the choices on this page rather than
  // typed by hand. `mode=viewer` drops the Order here button; the rest is
  // only ever needed on a screen that is mounted sideways or fixed.
  const boardPath = (stationId, kind) => {
    const q = [];
    q.push(`station=${stationId}`);
    if (kind === 'viewer') q.push('mode=viewer');
    if (orientation !== 'auto') q.push(`orientation=${orientation}`);
    return `/display?${q.join('&')}`;
  };

  const active = useMemo(() => (stations || []).filter((s) => (s.status || 'active') === 'active'), [stations]);

  const body = (
    <div className="max-w-4xl mx-auto w-full">
      <Section title="The order board" hint="one per cart, or one for the room">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-cq-ink-3">Screen sits</span>
          {[['auto', 'However it is turned'], ['landscape', 'Landscape'], ['portrait', 'Portrait']].map(([v, label]) => (
            <button key={v} type="button" onClick={() => setOrientation(v)} aria-pressed={orientation === v}
              className={`h-8 px-3 rounded-full font-semibold ${orientation === v ? 'bg-cq-roast text-cq-cream' : 'bg-cq-wash text-cq-ink-2 hover:bg-cq-caramel-wash'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <ScreenRow
            Icon={Monitor}
            title="Every cart on one screen"
            what="The whole room's orders. Best for a foyer or a big wall."
            path={boardPath('all', 'viewer')}
            badge={<Pill tone="outline" size="sm">All stations</Pill>}
          />
          {(active.length ? active : stations || []).map((s) => (
            <ScreenRow
              key={s.id}
              Icon={Monitor}
              title={s.name || `Station ${s.id}`}
              what={s.location ? `The board beside ${s.location}.` : 'The board beside this cart.'}
              path={boardPath(s.id, 'touch')}
              badge={<Pill tone="outline" size="sm">{(s.status || 'active') === 'active' ? 'Taking orders' : 'Not active'}</Pill>}
              extra={
                <p className="text-xs text-cq-ink-3 mt-1.5">
                  <Hand size={12} className="inline mr-1" />With the <b>Order here</b> button.
                  {' '}<button type="button" className="underline text-cq-caramel-deep"
                    onClick={() => window.open(boardPath(s.id, 'viewer'), '_blank')}>
                    <Eye size={12} className="inline mr-0.5" />Open it without the button
                  </button> if people should text instead.
                </p>
              }
            />
          ))}
        </div>
      </Section>

      <Section title="The other screens">
        <div className="space-y-3">
          <ScreenRow Icon={Sparkles} title="Sponsor wall" path="/sponsors"
            what="Your sponsors, full screen, on a loop. One screen for the whole event." />
          <ScreenRow Icon={HelpCircle} title="How to order poster" path="/how"
            what="A printable, scannable page for a table or a stand." />
          <ScreenRow Icon={Smartphone} title="The customer's page" path="/my"
            what="What a delegate gets from a QR code: order, then watch it." />
          <ScreenRow Icon={Activity} title="Ops board" path="/opsboard"
            what="For you, not the room. Leave it open and glance at it." />
        </div>
      </Section>

      <Section title="How they look">
        <div className="bg-cq-milk rounded-cq-lg shadow-cq-card border border-cq-line p-4">
          {look ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {[
                ['Theme', look.display_theme || 'light'],
                ['Text size', look.display_font_size || 'large'],
                ['Layout', look.display_mode || 'auto'],
                ['When it overflows', look.display_overflow_mode || 'flip'],
                ['Background', look.background_landscape || look.background_portrait ? 'an image is set' : 'none'],
                ['Sponsors on the board', look.sponsor && look.sponsor.enabled ? 'on' : 'off'],
              ].map(([k, v]) => (
                <div key={k}><span className="text-cq-ink-3">{k}: </span><b className="text-cq-roast">{String(v)}</b></div>
              ))}
            </div>
          ) : <p className="text-sm text-cq-ink-3">Reading the current settings…</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" Icon={Sliders} onClick={() => { window.location.href = '/barista'; }}>
              Change the look
            </Button>
            <Button size="sm" variant="ghost" Icon={ImageIcon} onClick={() => { window.location.href = '/run#branding/logo'; }}>
              Logo, colours and backgrounds
            </Button>
          </div>
          <p className="text-xs text-cq-ink-3 mt-2">
            Theme, text size, layout and what happens when there are more orders than fit live on
            the barista screen behind the lock, under <b>Screens</b>. The logo, colours and full-screen
            backgrounds are in Branding.
          </p>
        </div>
      </Section>
    </div>
  );

  if (embedded) return body;

  return (
    <div className="cq min-h-screen flex flex-col">
      <header className="bg-cq-roast text-cq-cream px-4 py-3 flex items-center gap-3">
        <AreaMark area="display" inverse />
        <div className="flex-1" />
        <EventHeader brand={brand} className="hidden sm:flex" />
        {/* In the header, not floating over the corner (Steve). */}
        <AdminViewSwitcher embedded />
      </header>
      <main className="flex-1 overflow-y-auto p-4">{body}</main>
    </div>
  );
}
