import { SEARCH_INDEX, searchRunner } from './runnerSearchIndex';
import { SECTIONS, TABS } from './runnerNav';

const titles = (q) => searchRunner(q).map((r) => r.title);

test('every Runner page can be found', () => {
  // A page added to the nav must get a search entry too.
  const has = (section, tab) => SEARCH_INDEX.some((e) => e.section === section && (!tab || e.tab === tab));
  SECTIONS.forEach((s) => {
    if (TABS[s]) TABS[s].forEach((t) => expect([s, t.id, has(s, t.id)]).toEqual([s, t.id, true]));
    else expect([s, has(s)]).toEqual([s, true]);
  });
});

test('every entry points at a real page or a link', () => {
  SEARCH_INDEX.forEach((e) => {
    if (e.href) { expect(e.href.startsWith('/')).toBe(true); expect(e.app).toBeTruthy(); return; }
    expect(SECTIONS).toContain(e.section);
    if (e.tab) expect(TABS[e.section].map((t) => t.id)).toContain(e.tab);
  });
});

test('the Texts off switch is found the ways people ask', () => {
  ['sms off', 'texts off', 'turn off texts', 'no sms'].forEach((q) => {
    expect(titles(q)[0]).toBe('Texts off');
  });
});

test('sponsor finds every place sponsors live', () => {
  const t = titles('sponsor');
  expect(t).toEqual(expect.arrayContaining(['Sponsors', 'Labels', 'Sponsor wall', 'Screens']));
});

test('other parts of CupQ are labelled with where they open', () => {
  const r = searchRunner('shot timer')[0];
  expect(r.app).toBe('Barista');
  expect(r.href).toBe('/barista');
});

test('nonsense finds nothing, empty finds nothing', () => {
  expect(searchRunner('zzqqxx')).toEqual([]);
  expect(searchRunner('   ')).toEqual([]);
});
