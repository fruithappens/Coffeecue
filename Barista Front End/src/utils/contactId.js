// The EventsAir contact id, however it arrives on the URL.
//
// Our own links say ?cid=. EventsAir's Thank You "Link Button" has an
// "Append contact ID to URL" switch and does not say what it appends -- so
// any key that reads as a contact id is accepted (cid, contactId, ContactID,
// contact_id, id-with-a-GUID-in-it), and a bare GUID with no key at all.
// An unexpanded merge token ({ContactID}) is no identity: ignored.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^(cid|contact[_-]?id|contactid|contact|id)$/i;

export function contactIdFromSearch(search) {
  let params;
  try { params = new URLSearchParams(search || ''); } catch (e) { return null; }
  const clean = (v) => {
    const s = String(v || '').trim();
    return s && !/[{}[\]%]/.test(s) ? s : null;
  };
  for (const [k, v] of params.entries()) {
    if (KEY.test(k)) {
      const c = clean(v);
      if (c && (k.toLowerCase() !== 'id' || GUID.test(c) || /^\d+$/.test(c))) return c;
    }
  }
  for (const [k, v] of params.entries()) {
    // ?e=treenet26&7B713AED-... : the id appended with no key
    if (!v && GUID.test(k)) return k;
  }
  return null;
}
