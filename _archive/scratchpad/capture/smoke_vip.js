// The EventsAir VIP rule, on every door.
//
// A mirrored attendee whose registration category is Speaker orders by
// phone number (as the SMS bot and the phone form would identify them), by
// contact id (as a badge or the EA app would), and as a walk-up. Each must
// land at the rule's station with priority. A stranger must never be routed
// to the VIP-only station, and with the rule blank nothing changes.
const { execSync } = require('child_process'); const { eventCode } = require('./eventcode');
const BASE = process.env.BASE || 'http://localhost:5001'; const DB = process.env.DB || 'cupq_next';
const sql = (q) => execSync(`psql ${DB} -tAc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log((c ? '  ok   ' : '  FAIL ') + n + (d ? ' — ' + d : '')); };
const SPEAKER_PHONE = '+61400000777', SPEAKER_CID = 'smoke-vip-speaker', STRANGER_PHONE = '+61400000778';
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }; const code = await eventCode(BASE);
  const stations = await fetch(`${BASE}/api/ea/vip-rule`, { headers: H }).then(r => r.json()).then(b => b.stations || []);
  ok('rule endpoint answers with the stations', stations.length >= 2, stations.map(s => `${s.id}:${s.name}`).join(' '));
  const VIP_ST = stations[stations.length - 1].id, OTHER_ST = stations[0].id;
  // a Speaker in the mirror (and a stranger who is not)
  sql(`delete from ea_attendees where ea_contact_id in ('${SPEAKER_CID}','smoke-vip-stranger')`);
  sql(`insert into ea_attendees (ea_contact_id, first_name, last_name, mobile_e164, registration_category, tags, synced_at) values ('${SPEAKER_CID}','Ada','Lovelace','${SPEAKER_PHONE}','Speaker', array['Keynote'], now())`);
  sql(`insert into ea_attendees (ea_contact_id, first_name, last_name, mobile_e164, registration_category, synced_at) values ('smoke-vip-stranger','Bob','Delegate','${STRANGER_PHONE}','Delegate', now())`);
  // the rule: Speakers jump the queue and go to the last station, which is VIP-only
  const put = await fetch(`${BASE}/api/ea/vip-rule`, { method: 'PUT', headers: H, body: JSON.stringify({ markers: 'Speaker, VIP', jump_queue: true, station_id: VIP_ST, vip_only_stations: [VIP_ST] }) }).then(r => r.json());
  ok('rule saved', put.success && put.rule.station_id === VIP_ST, JSON.stringify(put.rule));
  const get = await fetch(`${BASE}/api/ea/vip-rule`, { headers: H }).then(r => r.json());
  ok('rule would recognise the mirrored Speaker', get.matched_attendees === 1, `matched ${get.matched_attendees}`);
  const order = (extra) => fetch(`${BASE}/api/display/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coffee_type: 'Latte', milk: 'Full Cream', size: 'medium', channel: 'web', surface: 'phone', sms_opt_in: false, e: code, ...extra }) }).then(r => r.json());
  const rowFor = async (num) => { const l = await fetch(`${BASE}/api/orders`, { headers: H }).then(r => r.json()); return (l.data || l.orders || []).find(o => String(o.orderNumber || o.order_number) === String(num)); };
  // 1. by phone (the phone form with a number typed, as SMS would identify them)
  let r = await order({ name: 'Ada', phone: SPEAKER_PHONE, sms_opt_in: true }); let o = await rowFor(r.order_number);
  ok('Speaker by PHONE: priority + rule station + reason', o && (o.vip || o.priority) && Number(o.stationId || o.station_id) === VIP_ST && o.vipReason === 'Speaker', o ? `#${r.order_number} vip=${o.vip || o.priority} station=${o.stationId || o.station_id} reason=${o.vipReason}` : 'no order');
  // 2. by contact id (badge / EA app), no number typed
  r = await order({ ea_contact_id: SPEAKER_CID }); o = await rowFor(r.order_number);
  ok('Speaker by CONTACT ID: priority + rule station, name from the mirror', o && (o.vip || o.priority) && Number(o.stationId || o.station_id) === VIP_ST && /Ada/.test(o.customerName || o.customer_name || ''), o ? `#${r.order_number} ${o.customerName} station=${o.stationId || o.station_id}` : 'no order');
  // 3. as a walk-up at the counter, number typed by the barista
  r = await order({ name: 'Ada', phone: SPEAKER_PHONE, channel: 'walkin', surface: 'walkin', station_id: OTHER_ST }); o = await rowFor(r.order_number);
  ok('Speaker WALK-UP at another station: rule station still wins', o && (o.vip || o.priority) && Number(o.stationId || o.station_id) === VIP_ST, o ? `#${r.order_number} station=${o.stationId || o.station_id}` : 'no order');
  // 4. a stranger who ASKS for the VIP-only station is routed elsewhere
  r = await order({ name: 'Bob', phone: STRANGER_PHONE, preferred_station: VIP_ST }); o = await rowFor(r.order_number);
  ok('stranger asking for the VIP-only station is routed elsewhere, not a VIP', o && !(o.vip || o.priority) && Number(o.stationId || o.station_id) !== VIP_ST, o ? `#${r.order_number} vip=${o.vip || o.priority} station=${o.stationId || o.station_id}` : 'no order');
  // 5. a stranger with no preference never lands on the VIP-only station either (auto-assign)
  r = await order({ name: 'Cara' }); o = await rowFor(r.order_number);
  ok('anonymous auto-assigned order avoids the VIP-only station', o && Number(o.stationId || o.station_id) !== VIP_ST, o ? `#${r.order_number} station=${o.stationId || o.station_id}` : 'no order');
  // 6. rule blanked: the Speaker is nobody special again
  await fetch(`${BASE}/api/ea/vip-rule`, { method: 'PUT', headers: H, body: JSON.stringify({ markers: '', jump_queue: true, station_id: null, vip_only_stations: [] }) });
  r = await order({ name: 'Ada', phone: SPEAKER_PHONE }); o = await rowFor(r.order_number);
  ok('rule cleared: the same Speaker orders as anyone else', o && !(o.vip || o.priority) && !o.vipReason, o ? `#${r.order_number} vip=${o.vip || o.priority}` : 'no order');
  // tidy: the drill orders and the mirror rows
  sql(`delete from orders where order_details->>'name' in ('Ada','Bob','Cara') and created_at > now() - interval '10 minutes'`);
  sql(`delete from ea_attendees where ea_contact_id in ('${SPEAKER_CID}','smoke-vip-stranger')`);
  const fails = results.filter(x => !x).length; console.log(`\nPASS ${results.length - fails}/${results.length}`); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR', e.message); process.exit(2); });
