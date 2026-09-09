// The event code, fetched the way the real ordering pages fetch it.
//
// When an event switches its code ON (event_access.require), an order POSTed
// without one is refused -- which is the whole point, and it silently broke
// every harness that creates a drill order. A harness should behave like a
// customer who scanned the QR at the venue, not like a stranger typing the
// bare domain, so it reads the code from the public display config and sends
// it. Returns '' when the event has no code, which is also correct.
async function eventCode(base) {
  try {
    const r = await fetch(`${base}/api/display/config`);
    if (!r.ok) return '';
    const b = await r.json();
    const c = (b && (b.config || b) || {}).event_code;
    return String(c || '').trim();
  } catch (e) { return ''; }
}
module.exports = { eventCode };
