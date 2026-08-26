import React, { useEffect, useState } from 'react';
import { Megaphone, Save } from 'lucide-react';

/**
 * The event's editable SMS wording — sponsor line and venue café name.
 *
 * Steve, on the sponsor: "make sure its only written in a ui field not
 * hardcoded somewhere". These two fields ARE the source: the backend
 * reads them fresh per message (no restart needed), and an empty field
 * means the line simply doesn't exist.
 *
 * The sponsor meter tells the truth about cost: SMS bills per 160-char
 * segment, and a sponsor line usually tips the order confirmation from
 * one segment to two — every character of goodwill is paid for across
 * ~400 attendees. The meter shows it while you type instead of the
 * bill showing it after the event.
 */

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

// A typical confirmation, used to estimate the segment cost live.
const TYPICAL_CONFIRM =
  "Order #123 confirmed. You're #4 in line (~10 min wait).\n" +
  "That's: medium flat white with skim milk, no sugar. " +
  'Wrong? CHANGE or OOPS. Add another with FRIEND.';

const GSM = new Set(
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà\n\r'
);
const EXT = new Set('^{}\\[~]|€');

const segments = (msg) => {
  let gsm = true;
  let septets = 0;
  for (const c of msg) {
    if (GSM.has(c)) septets += 1;
    else if (EXT.has(c)) septets += 2;
    else { gsm = false; break; }
  }
  if (!gsm) return msg.length <= 70 ? 1 : Math.ceil(msg.length / 67);
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
};

const EventWordingCard = () => {
  const [sponsor, setSponsor] = useState('');
  const [cafe, setCafe] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/settings', { headers: authHeaders() });
        const b = r.ok ? await r.json() : {};
        const st = b.settings || b.data || b || {};
        setSponsor(String(st.sponsor_line || ''));
        setCafe(String(st.venue_cafe_name || ''));
      } catch (e) { /* fields start blank; save still works */ }
      setLoaded(true);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          sponsor_line: sponsor.trim(),
          venue_cafe_name: cafe.trim(),
        }),
      });
      if (r.ok) setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  };

  const baseSegs = segments(TYPICAL_CONFIRM);
  const withSponsor = sponsor.trim()
    ? segments(`${TYPICAL_CONFIRM}\n${sponsor.trim()}`)
    : baseSegs;
  const costsExtra = withSponsor > baseSegs;
  const nonAscii = Array.from(sponsor).some((c) => c.charCodeAt(0) > 127);

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <Megaphone className="w-5 h-5 text-amber-700" />
        <h3 className="text-lg font-semibold">Event wording</h3>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Lines the SMS messages build in. Leave a field empty and that line
        simply doesn't exist. Changes apply to the next message — no restart.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sponsor line
            <span className="text-gray-400 font-normal"> — added to the order confirmation</span>
          </label>
          <input
            value={sponsor}
            onChange={(e) => setSponsor(e.target.value)}
            placeholder="e.g. Coffee proudly supported by Green Adelaide"
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
            disabled={!loaded}
          />
          <div className="mt-1 text-xs">
            {sponsor.trim() ? (
              <span className={costsExtra ? 'text-amber-700' : 'text-green-700'}>
                Confirmation: {withSponsor} segment{withSponsor > 1 ? 's' : ''}
                {costsExtra
                  ? ` — the sponsor line adds a paid segment to every confirmation (~400 attendees)`
                  : ' — fits in the existing segment'}
              </span>
            ) : (
              <span className="text-gray-400">Empty — no sponsor line, no cost</span>
            )}
            {nonAscii && (
              <span className="text-red-600 block">
                Non-ASCII character detected — this makes every confirmation
                cost double. Plain letters only.
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Venue café name
            <span className="text-gray-400 font-normal"> — for off-menu requests</span>
          </label>
          <input
            value={cafe}
            onChange={(e) => setCafe(e.target.value)}
            placeholder="e.g. Wined Bar"
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
            disabled={!loaded}
          />
          <div className="mt-1 text-xs text-gray-500">
            {cafe.trim()
              ? `"Sorry, we don't have oat milk… Or grab it yourself from the ${cafe.trim()}."`
              : 'Empty — refusals just list what we do have'}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !loaded}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-semibold"
        >
          <Save size={16} /> {saving ? 'Saving…' : 'Save wording'}
        </button>
        {savedAt && (
          <span className="text-sm text-green-700">
            Saved {savedAt.toLocaleTimeString()} — live on the next SMS
          </span>
        )}
      </div>
    </div>
  );
};

export default EventWordingCard;
