// Belt-and-braces device memory for the two things a customer's phone
// must not forget: the live order (the beacon) and who punched in.
//
// The EventsAir app opens CupQ in an in-app browser, and a FULL app
// quit can wipe that webview's localStorage while leaving cookies
// alone (or the other way around) -- Steve watched the beacon vanish
// exactly that way. So every remembered value is written to BOTH
// stores and recalled from whichever survived. If the webview wipes
// both, only identity (?cid on the link, or re-entering a badge
// number) can bring an order back -- that path lives server-side.

const cookieGet = (name) => {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch (e) { return null; }
};

const cookieSet = (name, value, maxAge) => {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  } catch (e) { /* cookies off entirely */ }
};

export const remember = (key, value, maxAgeSeconds) => {
  try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  cookieSet(key, value, maxAgeSeconds);
};

export const recall = (key) => {
  try {
    const v = localStorage.getItem(key);
    if (v !== null && v !== undefined) return v;
  } catch (e) { /* fall through to the cookie */ }
  return cookieGet(key);
};

export const forget = (key) => {
  try { localStorage.removeItem(key); } catch (e) { /* nothing stored */ }
  cookieSet(key, '', 0);
};
