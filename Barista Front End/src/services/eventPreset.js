// eventPreset.js -- apply a Quick Setup preset (a saved event) to this CupQ.
//
// One definition, two callers: Quick Setup's Apply and the Demo Room's
// Load demo. Before this, "recall a saved event" lived only inside the
// Quick Setup screen, and a second copy would drift the first time either
// changed (the branding/event-name stores below have bitten before).
//
// Covers the event itself: menu, stations, the event's look, quick picks,
// sugar rule (all via /quick-setup), the "started" text policy, and the
// event name in both stores. Event ACCOUNTS stay in Quick Setup: they need
// a password typed on that screen.
//
// Returns { resp, warnings }: resp is /quick-setup's answer; warnings are
// the parts that failed without stopping the rest, for the caller to show.
export async function applyEventPreset(api, preset) {
  const warnings = [];
  const resp = await api.request('/quick-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset }),
  });

  // Persist the "started" SMS policy separately — it lives in its
  // own settings/sms-policy endpoint so the policy gate can read
  // it from anywhere (not just after Quick Setup runs).
  try {
    await api.request('/settings/sms-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policy: preset.started_sms_policy || 'queue_only',
        threshold_seconds: 60,
      }),
    });
  } catch (smsPolErr) {
    // Non-fatal — the main Quick Setup still succeeded.
    console.warn('Could not save started_sms_policy:', smsPolErr);
  }

  // Event identity — only push if the operator actually typed a
  // name. Blank means "preserve existing", which matters when
  // re-running Quick Setup to add a new milk without wiping the
  // event branding.
  //
  // Two endpoints, two stores: SMS welcome copy reads from the
  // top-level `settings` table (admin_routes.py:692 hardcodes
  // SELECT value FROM settings WHERE key = 'event_name'), while
  // the Branding tab UI reads from the `branding_settings` JSON
  // blob via _kv_get. Push to both so neither view goes stale.
  const eventName = (preset.event_name || '').trim();
  if (eventName) {
    try {
      await api.request('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: eventName }),
      });
    } catch (brandErr) {
      // Same treatment as the branding save below: recorded and shown.
      // This is the key the SMS welcome copy reads, so a silent
      // failure here means texts keep naming the previous event.
      console.warn('Could not save event_name to /settings:', brandErr);
      warnings.push(
        `Event name not saved to SMS settings: ${brandErr?.message || brandErr}`
      );
    }
    try {
      // Send ONLY the field this screen owns. The server merges under
      // a row lock, so the Branding tab's logo and colours survive.
      // This used to be a client-side GET-then-PUT read-merge-write,
      // which had a gap: a branding save landing between the two was
      // silently overwritten.
      await api.request('/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { event_name: eventName } }),
      });
    } catch (brandErr) {
      // Recorded and shown, not just logged. NOT thrown: the main
      // /quick-setup call above has already created stations and
      // inventory, and account creation still has to run below —
      // failing the whole apply over the event name would cost more
      // than it saves.
      console.warn('Could not save event_name to /settings/branding:', brandErr);
      warnings.push(
        `Event name not saved: ${brandErr?.message || brandErr}`
      );
    }
  }
  return { resp, warnings };
}
