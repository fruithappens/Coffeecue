// The rule that makes a speaker or a tagged VIP one without a code.
//
// The organiser types what they see on the EventsAir record -- a
// registration category (Speaker), a tag (VIP), a custom field
// ("vip=yes") -- and says what should happen: jump the queue, go to a
// particular station, or both. Stations ticked as VIP-only never receive
// anyone else. Applied by the server on every door: text, phone, kiosk,
// walk-up, badge.
//
// "Would recognise N attendees right now" is the one line that matters:
// it is how the organiser finds out a marker is spelled the way EA spells
// it BEFORE the keynote speaker arrives and is not recognised.
import React, { useEffect, useState } from 'react';
import { Star, Save } from 'lucide-react';
import {
  SettingGroup, SettingRow, Toggle, SelectRow, TextField, Checkbox, SettingNote, Button,
} from '../../design';

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

const VipRuleCard = () => {
  const [markers, setMarkers] = useState('');
  const [jump, setJump] = useState(true);
  const [stationId, setStationId] = useState('');
  const [vipOnly, setVipOnly] = useState([]);
  const [stations, setStations] = useState([]);
  const [matched, setMatched] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await fetch('/api/ea/vip-rule', { headers: authHeaders() });
      const b = r.ok ? await r.json() : {};
      const rule = b.rule || {};
      setMarkers((rule.markers || []).join(', '));
      setJump(rule.jump_queue !== false);
      setStationId(rule.station_id ? String(rule.station_id) : '');
      setVipOnly((rule.vip_only_stations || []).map(String));
      setStations(b.stations || []);
      setMatched(typeof b.matched_attendees === 'number' ? b.matched_attendees : null);
    } catch (e) { /* the card still renders; save will say if it cannot */ }
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/ea/vip-rule', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({
          markers: markers.split(/[,\n]/).map((m) => m.trim()).filter(Boolean),
          jump_queue: jump,
          station_id: stationId ? Number(stationId) : null,
          vip_only_stations: vipOnly.map(Number),
        }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.success === false) throw new Error(b.message || `Could not save (${r.status})`);
      setSavedAt(new Date());
      await load();
    } catch (e) { setError(e.message || 'Could not save'); }
    setSaving(false);
  };

  const toggleOnly = (id) => setVipOnly((cur) => (
    cur.includes(String(id)) ? cur.filter((x) => x !== String(id)) : [...cur, String(id)]));

  const stationOptions = [{ value: '', label: 'Wherever is quickest' },
    ...stations.map((s) => ({ value: String(s.id), label: s.name }))];
  const hasRule = markers.trim().length > 0;

  return (
    <SettingGroup title="VIPs and speakers">
      <SettingRow Icon={Star} label="Who counts"
        hint="Category, tag or custom field, as EventsAir spells it — separate with commas">
        <TextField value={markers} onChange={setMarkers}
          placeholder="Speaker, VIP, Sponsor guest" width="w-full max-w-sm" />
      </SettingRow>
      <SettingRow label="Jump the queue" hint="Priority on the barista's screen, like typing the VIP code">
        <Toggle on={jump} onChange={setJump} disabled={!hasRule} />
      </SettingRow>
      <SettingRow label="Send them to" hint="A sponsor's cart, or the one with the shortest line">
        <SelectRow value={stationId} options={stationOptions} onChange={setStationId}
          ariaLabel="Station for VIPs" />
      </SettingRow>
      {stations.length ? (
        <SettingRow label="Only VIPs at" hint="Nobody else is ever routed to a ticked station" stack>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            {stations.map((s) => (
              <Checkbox key={s.id} label={s.name} checked={vipOnly.includes(String(s.id))}
                onChange={() => toggleOnly(s.id)} disabled={!hasRule} />
            ))}
          </div>
        </SettingRow>
      ) : null}
      <div className="flex items-center gap-3 pt-3">
        <Button variant="primary" size="sm" Icon={Save} onClick={save} disabled={saving || !loaded}>
          {saving ? 'Saving…' : 'Save rule'}
        </Button>
        {matched !== null && hasRule ? (
          <span className={`text-sm font-semibold ${matched > 0 ? 'text-cq-ready' : 'text-cq-warn'}`}>
            {matched > 0
              ? `Would recognise ${matched} attendee${matched === 1 ? '' : 's'} right now`
              : 'Recognises nobody yet — check the spelling against an EA record, or sync first'}
          </span>
        ) : null}
        {savedAt && !error ? <span className="text-sm text-cq-ink-3">Saved</span> : null}
        {error ? <span className="text-sm font-semibold text-cq-alert">{error}</span> : null}
      </div>
      <SettingNote>
        Applies to every way of ordering — a text, the phone, the kiosk, a walk-up, a scanned badge —
        once the attendee sync has run. A VIP still gets whatever the VIP code gives (priority, and free if pricing says so).
      </SettingNote>
    </SettingGroup>
  );
};

export default VipRuleCard;
