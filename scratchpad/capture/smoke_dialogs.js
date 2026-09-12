// Finding 8: no browser dialogs on the tablet or the runner. The app's own
// dialog (design-system Modal) answers every confirm / prompt / alert, and
// a browser dialog appearing anywhere fails this harness outright.
const { chromium } = require('playwright-core');
const BASE = 'http://localhost:5001'; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'coffeecue', password: 'adminpassword' }) }).then(r => r.json());
  const browser = await chromium.launch({ channel: 'chrome' }); const errs = []; const native = [];
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await c.addInitScript((t) => { localStorage.setItem('coffee_system_token', t); localStorage.setItem('coffee_system_user', JSON.stringify({ username: 'coffeecue', role: 'admin', id: 1 })); localStorage.setItem('coffee_cue_selected_station', '1'); }, login.token);
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  p.on('dialog', async (d) => { native.push(`${d.type()}: ${d.message().slice(0, 60)}`); await d.dismiss(); });
  const body = () => p.evaluate(() => document.body.innerText);
  const dialog = () => p.getByRole('dialog');

  // 1. Blocked numbers: Unblock asks through the app's dialog, Cancel leaves it blocked.
  await p.goto(`${BASE}/run#messages/blocked`, { waitUntil: 'load' }); await sleep(3000);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
  await fetch(`${BASE}/api/sms/block`, { method: 'POST', headers: H, body: JSON.stringify({ phone: '+61400000099', reason: 'dialog drill' }) });
  await p.reload({ waitUntil: 'load' }); await sleep(3000);
  const unblockBtn = p.getByRole('button', { name: /Unblock/ }).first();
  check('blocked list shows the drill number', await unblockBtn.count() > 0);
  await unblockBtn.click(); await sleep(600);
  check('Unblock opens the app dialog, not a browser confirm', await dialog().count() === 1 && /Unblock \+61400000099\?/.test(await dialog().innerText()), (await dialog().innerText().catch(() => '')).replace(/\n/g, ' | ').slice(0, 100));
  await dialog().getByRole('button', { name: 'Cancel' }).click(); await sleep(800);
  check('Cancel keeps it blocked', /\+61400000099/.test(await body()) && await dialog().count() === 0);
  await unblockBtn.click(); await sleep(500); await p.keyboard.press('Escape'); await sleep(500);
  check('Escape closes it too', await dialog().count() === 0);
  await unblockBtn.click(); await sleep(500); await dialog().getByRole('button', { name: 'Unblock' }).click(); await sleep(2500);
  check('confirming unblocks it', !/\+61400000099/.test(await body()));

  // 2. Quick Setup: Save as a template goes through askText -- Cancel returns null, nothing saved.
  await p.goto(`${BASE}/run#quickSetup`, { waitUntil: 'load' }); await sleep(3500);
  const saveTpl = p.getByRole('button', { name: /Save as template|Save current|Save template/i }).first();
  if (await saveTpl.count()) {
    await saveTpl.click(); await sleep(600);
    const d = dialog();
    check('template save asks for a name in the app dialog', await d.count() === 1 && await d.getByRole('textbox').count() === 1, (await d.innerText().catch(() => '')).replace(/\n/g, ' | ').slice(0, 80));
    await d.getByRole('button', { name: 'Save' }).click(); await sleep(400);
    check('an empty name is refused with a message, not saved', await dialog().count() === 1 && /Give the template a name/.test(await dialog().innerText()));
    await dialog().getByRole('button', { name: 'Cancel' }).click(); await sleep(400);
    check('Cancel closes without saving', await dialog().count() === 0);
  } else { console.log('  (no Save-as-template button on this build; skipped)'); }

  // 3. System > Health: the restart-that-only-alerted is gone.
  await p.goto(`${BASE}/run#system/health`, { waitUntil: 'load' }); await sleep(4000);
  check('Health tiles have no "Restart component" button', (await p.getByTitle('Restart component').count()) === 0);

  // 4. Barista: the Stock tab's "restock all" asks in the app dialog.
  await p.goto(`${BASE}/barista`, { waitUntil: 'load' }); await sleep(4000);
  await p.getByRole('tab', { name: /Stock/ }).first().click().catch(async () => { await p.getByRole('button', { name: /^Stock/ }).first().click().catch(() => {}); }); await sleep(2500);
  const restock = p.getByRole('button', { name: /Restock all|to full/i }).first();
  if (await restock.count()) {
    await restock.click(); await sleep(600);
    check('restock-all asks in the app dialog', await dialog().count() === 1 && /Restock all/.test(await dialog().innerText()));
    await dialog().getByRole('button', { name: 'Cancel' }).click(); await sleep(400);
  } else { console.log('  (no restock-all button visible; skipped)'); }

  await browser.close();
  check('no browser dialogs appeared anywhere', native.length === 0, native.join(' | '));
  check('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
