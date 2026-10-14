import { SECTION_HELP, GUIDES } from './helpArticles';
import { SECTIONS } from './runnerNav';

test('every Runner section has a help page (U4-2)', () => {
  const missing = SECTIONS.filter((id) => !SECTION_HELP[id]);
  expect(missing).toEqual([]);
});

test('every page says something, and points at a section that exists', () => {
  [...Object.values(SECTION_HELP), ...GUIDES].forEach((p) => {
    expect(p.title).toBeTruthy();
    expect(p.summary).toBeTruthy();
    if (p.open) expect(SECTIONS).toContain(p.open.section);
  });
});
