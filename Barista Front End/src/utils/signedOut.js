// signedOut.js -- a staff screen's login has ended for good.
//
// Found 24 Nov 2026: when a login ran out and could not be renewed (30 days,
// a password reset, signed out elsewhere) every poll was refused and nothing
// on screen said so. A barista was left with a queue that had quietly
// stopped updating. ApiService reports it here; SignedOutBanner shows it.
export const SIGNED_OUT = 'cq-signed-out';
export const SIGNED_IN = 'cq-signed-in';

let signedOut = false;
export const isSignedOut = () => signedOut;

function set(value) {
  if (signedOut === value) return;
  signedOut = value;
  window.dispatchEvent(new Event(value ? SIGNED_OUT : SIGNED_IN));
}
export const reportSignedOut = () => set(true);
export const reportSignedIn = () => set(false);
