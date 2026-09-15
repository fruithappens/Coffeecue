import { contactIdFromSearch } from './contactId';

const G = '7B713AED-2385-4F13-8223-60C9EC6EE8D0';
test('our own ?cid= and every spelling EventsAir might append', () => {
  expect(contactIdFromSearch(`?e=treenet26&cid=${G}`)).toBe(G);
  expect(contactIdFromSearch(`?e=treenet26&ContactID=${G}`)).toBe(G);
  expect(contactIdFromSearch(`?e=treenet26&contactId=${G}`)).toBe(G);
  expect(contactIdFromSearch(`?e=treenet26&contact_id=${G}`)).toBe(G);
  expect(contactIdFromSearch(`?e=treenet26&id=${G}`)).toBe(G);
  expect(contactIdFromSearch(`?cid=330`)).toBe('330');            // the badge number
  expect(contactIdFromSearch(`?e=treenet26&${G}`)).toBe(G);       // bare, no key
});
test('what is not an identity', () => {
  expect(contactIdFromSearch('?e=treenet26')).toBeNull();
  expect(contactIdFromSearch('?cid={ContactID}')).toBeNull();     // unexpanded merge token
  expect(contactIdFromSearch('?id=foyer')).toBeNull();            // "id" only counts when it looks like one
  expect(contactIdFromSearch('')).toBeNull();
});
