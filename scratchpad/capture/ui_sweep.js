// Walk every screen an operator can open, shoot each one, and score how much
// of it is still on the old world. The score is the triage list: a screen with
// raw <select>/<input> and grey helper text has not been converted yet.
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = 'http://localhost:5001';
const OUT = process.env.OUT || `${process.env.HOME}/cupq-next/docs/ui`;

const RUNNER = [
  ['quickSetup', 'Quick Setup'], ['menu/inventory', 'Menu · Event Inventory'],
  ['menu/stock', 'Menu · Event Stock'], ['menu/stationInventory', 'Menu · Station Inventory'],
  ['stations', 'Stations'], ['branding/logo', 'Branding · Logo & look'],
  ['branding/sponsors', 'Branding · Sponsors'], ['branding/labels', 'Branding · Labels'],
  ['branding/milk', 'Branding · Milk colours'], ['schedule', 'Schedule'],
  ['users/people', 'People'], ['users/access', 'People · Roles & access'],
  ['live/readiness', 'Live · Readiness'], ['live/board', 'Live · Board'],
  ['live/metrics', 'Live · Metrics'], ['orders/all', 'Orders · All'],
  ['orders/groups', 'Orders · Groups'], ['messages/notice', 'Messages · Tell everyone'],
  ['messages/broadcast', 'Messages · Text blast'], ['messages/test', 'Messages · Test a text'],
  ['messages/blocked', 'Messages · Blocked numbers'], ['screens', 'Screens'],
  ['printers', 'Printers'], ['report', 'Report'], ['system/health', 'System · Health'],
  ['system/diagnostics', 'System · Diagnostics'], ['eventsair', 'EventsAir'],
  ['settings', 'Settings'], ['emergency', 'Emergency'], ['help', 'Help'],
];

async function score(p) {
  return p.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const grey = [...document.querySelectorAll('p,span,div')]
      .filter(e => /text-(xs|sm)/.test(e.className || '') && /text-gray-[45]00/.test(e.className || '')).length;
    const legacy = [...document.querySelectorAll('*')]
      .filter(e => /\b(bg|text|border)-(blue|green|gray|red|yellow|indigo|purple)-\d00\b/.test(e.className || '')).length;
    const cq = [...document.querySelectorAll('*')]
      .filter(e => /\bcq-/.test(e.className || '')).length;
    // Count only RAW controls -- ones not wearing the design system. SelectRow
    // and TextField render a real <select>/<input> on purpose, so counting
    // every one of them marked a correctly converted screen as unfinished.
    // (Found by following our own prompt: Labels reached legacy 0 and still
    // reported "1 select, 5 inputs", all of them ours.)
    // ...and skip the invisible ones. A file picker behind a styled label is
    // <input type="file" class="hidden"> -- there is nothing to restyle.
    const raw = (sel) => [...document.querySelectorAll(sel)]
      .filter(e => !/\bcq-/.test(e.className || ''))
      // 'color' is a swatch the browser draws -- there is nothing to restyle,
      // same as the hidden file input behind an upload button.
      // 'checkbox' and 'radio' join them: the browser draws both, and
      // tokens.css sets accent-color for every one inside .cq at once. There
      // is no per-tag markup to convert, so counting them reported finished
      // screens as unfinished (Text blast, for two runs).
      .filter(e => !['file', 'hidden', 'color', 'checkbox', 'radio'].includes(e.type)
                   && !/\bhidden\b/.test(e.className || '')).length;
    const rawEls = (sel) => [...document.querySelectorAll(sel)]
      .filter(e => !/\bcq-/.test(e.className || ''))
      .filter(e => !['file', 'hidden', 'color', 'checkbox', 'radio'].includes(e.type)
                   && !/\bhidden\b/.test(e.className || ''));
    const names = [...rawEls('select'), ...rawEls('input')]
      .map(e => `${e.tagName.toLowerCase()}[${e.type}] ${(e.className||'(no class)').slice(0,48)}`);
    return { selects: raw('select'), inputs: raw('input'), grey, legacy, cq, names };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`${BASE}/run`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (/sign in|log in|password/i.test(await p.locator('body').innerText())) {
    await p.fill('input[name="username"], input[type="text"]', 'coffeecue');
    await p.fill('input[type="password"]', 'adminpassword');
    await p.click('button[type="submit"]'); await p.waitForTimeout(3500);
  }
  const rows = [];
  for (const [hash, label] of RUNNER) {
    const file = hash.replace(/\//g, '-') + '.png';
    try {
      await p.goto(`${BASE}/run#${hash}`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(1800);
      // Let the screen finish. Some screens mount a control and apply its
      // classes on a second render, and a sweep that measures in between
      // reports a raw input that a person will never see -- Text blast said
      // "1 input" for two runs while three separate direct checks found none.
      await p.waitForFunction(() => {
        const raw = [...document.querySelectorAll('input, select')]
          .filter(e => !/\bcq-/.test(e.className || ''))
          .filter(e => !['file', 'hidden', 'color'].includes(e.type)
                       && !/\bhidden\b/.test(e.className || ''));
        window.__cqRawWas = raw.length;
        return true;
      }, { timeout: 3000 }).catch(() => {});
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${OUT}/${file}`, fullPage: true });
      const s = await score(p);
      const old = s.selects + s.inputs + Math.floor(s.legacy / 4) + Math.floor(s.grey / 2);
      rows.push({ hash, label, file, ...s, old });
      console.log(`  ${label.padEnd(34)} legacy:${String(s.legacy).padStart(3)}  cq:${String(s.cq).padStart(3)}  select:${s.selects} input:${s.inputs}`);
    } catch (e) {
      console.log(`  ${label.padEnd(34)} FAILED ${String(e).slice(0, 60)}`);
    }
  }
  fs.writeFileSync(`${OUT}/_scores.json`, JSON.stringify(rows, null, 2));
  await browser.close();
})();
