// BoardLookCard.js -- Runner > Screens > How the boards look.
//
// These lived on the barista screen behind the PIN ("Change the look" opened
// the barista's order queue), and theme and text size had no control at all.
// Event-wide: every order board reads them from /api/display/config.
import React, { useEffect, useRef, useState } from 'react';
import { Palette, Type, Monitor, RotateCw, Layers, Clock, Grid, Hand, Eye, FileText } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { SettingGroup, SettingRow, Segmented, SelectRow, TextField, Toggle } from '../../design';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();

// setting key -> the name it has in /api/display/config
const READ = {
  displayTheme: 'display_theme',
  displayFontSize: 'display_font_size',
  displayMode: 'display_mode',
  displayRotation: 'display_rotation',
  displayOverflowMode: 'display_overflow_mode',
  displayFlipSeconds: 'display_flip_seconds',
  displayCardsPerPage: 'display_cards_per_page',
  displayTouchOrdering: 'display_touch_ordering',
  showNameOnDisplay: 'show_customer_name',
  displayCustomMessage: 'custom_message',
};

const BoardLookCard = () => {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const latest = useRef({});

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await fetch('/api/display/config');
        const b = await r.json();
        const c = b.config || b;
        if (!gone) setS(Object.fromEntries(Object.entries(READ).map(([k, n]) => [k, c[n]])));
      } catch (e) { if (!gone) setError('Could not read the current settings.'); }
    })();
    return () => { gone = true; };
  }, []);

  if (error) return <p className="text-sm text-cq-alert">{error}</p>;
  if (!s) return <p className="text-sm text-cq-ink-3">Reading the current settings…</p>;

  // Shown straight away, put back if the server says no: the boards are
  // other devices and only ever see what the server has.
  const save = async (key, value) => {
    const before = s[key];
    latest.current[key] = value;
    setS((p) => ({ ...p, [key]: value }));
    try {
      const r = await api.request('/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }),
      });
      if (!r || r.success === false) throw new Error((r && r.message) || 'refused');
    } catch (e) {
      if (latest.current[key] === value) setS((p) => ({ ...p, [key]: before }));
      showToast("Not saved, so the boards haven't changed.", 'error', 6000);
    }
  };
  const num = (key) => (v) => save(key, parseInt(v, 10));

  return (
    <SettingGroup title="Every order board at this event">
      <SettingRow Icon={Palette} label="Theme">
        <SelectRow ariaLabel="Theme" value={s.displayTheme} onChange={(v) => save('displayTheme', v)}
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'coffee', label: 'Coffee' }, { value: 'minimal', label: 'Minimal' }]} />
      </SettingRow>
      <SettingRow Icon={Type} label="Text size" hint="Tall bar screens keep their own size">
        <SelectRow ariaLabel="Text size" value={s.displayFontSize} onChange={(v) => save('displayFontSize', v)}
          options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'extra-large', label: 'Extra large' }]} />
      </SettingRow>
      <SettingRow Icon={Monitor} label="Layout" hint="How the board is arranged">
        <SelectRow ariaLabel="Layout" value={s.displayMode} onChange={(v) => save('displayMode', v)}
          options={[
            { value: 'auto', label: 'Auto: match screen shape' }, { value: 'landscape', label: 'Landscape: 3 columns' },
            { value: 'portrait', label: 'Portrait: stacked' }, { value: 'portrait-columns', label: 'Portrait: side by side' },
          ]} />
      </SettingRow>
      <SettingRow Icon={RotateCw} label="Rotate output" hint="Last resort: the device's own rotation is sharper">
        <SelectRow ariaLabel="Rotate output" value={s.displayRotation} onChange={num('displayRotation')}
          options={[{ value: 0, label: 'None' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }]} />
      </SettingRow>
      <SettingRow Icon={Layers} label="When orders overflow" hint="More orders than fit on the screen">
        <Segmented size="sm" value={s.displayOverflowMode} onChange={(v) => save('displayOverflowMode', v)}
          options={[{ value: 'flip', label: 'Page flip' }, { value: 'scroll', label: 'Scroll' }]} />
      </SettingRow>
      {s.displayOverflowMode === 'flip' ? (
        <SettingRow Icon={Clock} label="Seconds per page">
          <Segmented size="sm" value={s.displayFlipSeconds} onChange={num('displayFlipSeconds')} options={[5, 8, 10, 15, 20]} />
        </SettingRow>
      ) : null}
      <SettingRow Icon={Grid} label="Orders per page" hint="A number shrinks cards to fit">
        <SelectRow ariaLabel="Orders per page" value={s.displayCardsPerPage} onChange={num('displayCardsPerPage')}
          options={[{ value: 0, label: 'Auto: fit to screen' }, ...[3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) }))]} />
      </SettingRow>
      <SettingRow Icon={Hand} label="Customers can tap to order" hint="Off for a wall TV nobody can reach">
        <Toggle on={s.displayTouchOrdering} onChange={(v) => save('displayTouchOrdering', v)} />
      </SettingRow>
      <SettingRow Icon={Eye} label="Show customer names" hint="Off shows numbers only">
        <Toggle on={s.showNameOnDisplay} onChange={(v) => save('showNameOnDisplay', v)} />
      </SettingRow>
      <SettingRow Icon={FileText} label="Footer message" hint="A sponsor line takes its place">
        <TextField width="w-48" placeholder="Enjoy your coffee!" aria-label="Footer message" defaultValue={s.displayCustomMessage || ''}
          onBlur={(e) => { if (e.target.value !== (s.displayCustomMessage || '')) save('displayCustomMessage', e.target.value); }} />
      </SettingRow>
    </SettingGroup>
  );
};

export default BoardLookCard;
