import { SIGNED_IN, SIGNED_OUT, isSignedOut, reportSignedIn, reportSignedOut } from './signedOut';

test('says so once, and clears when the login is renewed', () => {
  const seen = [];
  window.addEventListener(SIGNED_OUT, () => seen.push('out'));
  window.addEventListener(SIGNED_IN, () => seen.push('in'));
  reportSignedOut();
  reportSignedOut();
  expect(isSignedOut()).toBe(true);
  reportSignedIn();
  reportSignedIn();
  expect(isSignedOut()).toBe(false);
  expect(seen).toEqual(['out', 'in']);
});
