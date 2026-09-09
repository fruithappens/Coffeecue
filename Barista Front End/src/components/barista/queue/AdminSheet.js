// The station admin sheet, behind the event PIN: mode, station, sound,
// zoom, refresh, version, sign out -- and the way out of an iPad's
// standalone mode. Device things live here; menu things live in the runner.
import React, { useEffect, useState } from 'react';
import { X, Zap, Users, Volume2, VolumeX, ZoomIn, ZoomOut, RefreshCw, LogOut, Radio, Settings, Monitor, BarChart3, ExternalLink, Maximize2, Minimize2, Check, Package, Calendar, Brain, Scale, UserCog } from 'lucide-react';
import { PinPanel, Button } from '../../../design';

const Row = ({ Icon, label, hint, children }) => (
  <div className="flex items-center gap-3 py-3 border-b border-cq-line last:border-0">
    <span className="inline-flex items-center justify-center w-10 h-10 rounded-cq-md bg-cq-caramel-wash text-cq-roast flex-shrink-0"><Icon size={20} strokeWidth={2.25} /></span>
    <div className="flex-1 min-w-0">
      <div className="font-bold text-cq-roast leading-tight">{label}</div>
      {hint ? <div className="text-sm text-cq-ink-3 truncate">{hint}</div> : null}
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
  </div>
);

const Toggle = ({ on, onChange, labels = ['Off', 'On'] }) => (
  <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
    className={`h-10 px-3 rounded-full font-bold text-sm min-w-[4.5rem] ${on ? 'bg-cq-caramel text-white' : 'bg-cq-wash text-cq-ink-2'}`}>
    {on ? labels[1] : labels[0]}
  </button>
);

export default function AdminSheet({ open, onClose, state = {}, actions = {}, unlocked = false, onUnlock, onLock, unlockedMinutes = 0 }) {
  const [stage, setStage] = useState('pin');
  const [pinError, setPinError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState('');
  const [defaultPin, setDefaultPin] = useState(false);
  // A correct PIN unlocks this tablet for a while (see BaristaInterface):
  // the sheet then opens straight to the panel until it is locked again.
  useEffect(() => { if (open) { setStage(unlocked ? 'panel' : 'pin'); setPinError(false); } }, [open, unlocked]);
  useEffect(() => {
    if (stage !== 'panel') return;
    fetch('/api/app-version').then((r) => (r.ok ? r.json() : {})).then((b) => setVersion(b.bundle || '')).catch(() => {});
  }, [stage]);
  if (!open) return null;

  const tryPin = async (pin) => {
    setChecking(true); setPinError(false);
    try {
      const r = await fetch('/api/kiosk/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const b = r.ok ? await r.json() : { success: false };
      if (b.success) { setDefaultPin(!!b.default_pin); setStage('panel'); if (onUnlock) onUnlock(); } else { setPinError(true); setTimeout(() => setPinError(false), 1200); }
    } catch (e) { setPinError(true); setTimeout(() => setPinError(false), 1200); }
    finally { setChecking(false); }
  };
  const { rushMode, teamMode, soundEnabled, zoom = 1, zoomMin = 0.7, zoomMax = 1.6, refreshSeconds = 0, stationName } = state;
  const isStandalone = typeof navigator !== 'undefined' && (window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Station admin">
      <div className="absolute inset-0 bg-cq-roast/60" onClick={onClose} />
      {stage === 'pin' ? (
        <div className="relative m-4">
          <PinPanel title="Station admin" hint={`Enter the event PIN${checking ? '…' : ''}`} onSubmit={tryPin} error={pinError} />
          <button type="button" onClick={onClose} className="mt-3 w-full text-center text-cq-cream/90 font-semibold underline underline-offset-4">Cancel</button>
        </div>
      ) : (
        <div className="relative w-full sm:max-w-md bg-cq-cream rounded-t-cq-xl sm:rounded-cq-xl shadow-cq-raised max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-cq-cream/95 backdrop-blur px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-cq-line">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-cq-ink-3">Station admin</div>
              <h2 className="text-xl font-extrabold text-cq-roast mt-0.5">{stationName || 'This tablet'}</h2>
              {defaultPin ? <div className="text-sm text-cq-alert font-semibold mt-1">The PIN is still the default (1234). Set one in the organiser.</div> : null}
              {unlocked ? <div className="text-sm text-cq-ink-3 mt-1">Unlocked for {unlockedMinutes} more min · <button type="button" onClick={() => { if (onLock) onLock(); onClose(); }} className="font-bold text-cq-caramel-deep underline underline-offset-4">Lock now</button></div> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 inline-flex items-center justify-center rounded-cq-md text-cq-ink-2 hover:bg-cq-wash"><X size={22} /></button>
          </div>
          <div className="px-5">
            <Row Icon={Zap} label="Rush mode" hint="Hide the menus, pack the cards, go fullscreen"><Toggle on={!!rushMode} onChange={actions.setRush} /></Row>
            <Row Icon={Users} label="Team mode" hint="Two baristas share this tablet: shots and milk are ticked separately"><Toggle on={!!teamMode} onChange={actions.setTeam} /></Row>
            <Row Icon={Radio} label="Station" hint="Move this tablet to another cart, or watch others"><Button size="sm" variant="secondary" onClick={actions.openPicker}>Change</Button></Row>
            <Row Icon={soundEnabled ? Volume2 : VolumeX} label="Sound" hint="New order and ready chimes on this tablet"><Toggle on={!!soundEnabled} onChange={actions.setSound} /></Row>
            <Row Icon={ZoomIn} label="Screen size" hint="Bigger for easier taps, smaller for more orders">
              <button type="button" onClick={() => actions.setZoom(zoom - 0.1)} disabled={zoom <= zoomMin} aria-label="Smaller" className="h-10 w-10 rounded-cq-md bg-cq-wash text-cq-roast disabled:opacity-40"><ZoomOut size={18} className="mx-auto" /></button>
              <button type="button" onClick={() => actions.setZoom(1)} className="h-10 px-2 rounded-cq-md text-sm font-bold tabular-nums text-cq-roast hover:bg-cq-wash" title="Reset to 100%">{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => actions.setZoom(zoom + 0.1)} disabled={zoom >= zoomMax} aria-label="Bigger" className="h-10 w-10 rounded-cq-md bg-cq-wash text-cq-roast disabled:opacity-40"><ZoomIn size={18} className="mx-auto" /></button>
            </Row>
            <Row Icon={RefreshCw} label="Refresh the queue" hint="How often this tablet checks for new orders">
              <div className="flex gap-1">
                {[0, 5, 15, 30, 60].map((s) => (
                  <button key={s} type="button" onClick={() => actions.setRefresh(s)} className={`h-10 px-2.5 rounded-cq-md text-sm font-bold tabular-nums ${refreshSeconds === s ? 'bg-cq-caramel text-white' : 'bg-cq-wash text-cq-ink-2'}`}>{s === 0 ? 'Off' : `${s}s`}</button>
                ))}
              </div>
            </Row>
            <Row Icon={Settings} label="Station settings" hint="Name, location, barista, sounds, board layout"><Button size="sm" variant="secondary" onClick={actions.openStationSettings}>Open</Button></Row>
            <Row Icon={Monitor} label="Screens" hint="Display settings and screen links"><Button size="sm" variant="secondary" onClick={actions.openDisplaySettings}>Open</Button></Row>
            <Row Icon={BarChart3} label="Session so far" hint="What has been made here today"><Button size="sm" variant="secondary" onClick={actions.openSession}>Open</Button></Row>
            <Row Icon={ExternalLink} label="Runner" hint="Menu, stock, schedule, people, printers, the report"><Button size="sm" variant="secondary" onClick={() => { window.location.href = '/run'; }}>Go</Button></Row>
            {/* The manager tabs that used to sit on the barista's tab bar.
                Nothing is lost: they are here, behind the PIN, until the
                runner app (phase 5) takes them over. */}
            {actions.openTab ? (
              <div className="py-3 border-b border-cq-line">
                <div className="font-bold text-cq-roast leading-tight">Manager tools on this tablet</div>
                {/* Was seven. Completed orders, Inventory, Schedule, Capabilities
                    and Staff now live in the runner app (Orders, Menu, Schedule,
                    Stations, People), so a barista's tablet no longer carries a
                    second copy of each. The two left have no runner home yet. */}
                <div className="text-sm text-cq-ink-3">Everything else is in the runner app</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    ['queue', 'Queue rules', Brain], ['balance', 'Balance', Scale],
                  ].map(([id, label, Icon]) => (
                    <button key={id} type="button" onClick={() => actions.openTab(id)} className="h-11 px-3 rounded-cq-md bg-cq-wash text-cq-roast font-semibold text-sm inline-flex items-center gap-2 hover:bg-cq-caramel-wash">
                      <Icon size={16} strokeWidth={2.25} /><span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {(isStandalone || document.fullscreenElement) ? (
              <Row Icon={document.fullscreenElement ? Minimize2 : Maximize2} label={document.fullscreenElement ? 'Exit fullscreen' : 'Open in the browser'} hint="The way out of an iPad's home-screen app">
                <Button size="sm" variant="secondary" onClick={() => { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); else window.open(window.location.href, '_blank'); }}>Go</Button>
              </Row>
            ) : null}
            <Row Icon={RefreshCw} label="Reload the app" hint={version ? `Version ${version}` : 'Version …'}><Button size="sm" variant="secondary" onClick={() => window.location.reload()}>Reload</Button></Row>
            <Row Icon={LogOut} label="Sign out" hint="This tablet forgets its login and station"><Button size="sm" variant="danger" onClick={actions.signOut}>Sign out</Button></Row>
          </div>
          <div className="px-5 py-4"><Button block variant="dark" onClick={onClose}>Back to the queue</Button></div>
        </div>
      )}
    </div>
  );
}
