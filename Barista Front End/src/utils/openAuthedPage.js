// openAuthedPage.js — open a page that needs a login (the printable event
// report) in a new tab, without putting the login token in the address.
//
// A link or window.open can't send the Authorization header, so these pages
// used ?jwt=TOKEN, and the server accepted a token in the address on every
// route (audit SEC-023): it then sat in browser history and proxy logs. The
// Runner's "Print or save as PDF" link sent no token at all and answered
// "Authentication required". Instead: fetch with the header, then show the
// page from a blob.

function token() {
  return localStorage.getItem('coffee_system_token') || localStorage.getItem('coffee_auth_token')
    || localStorage.getItem('token') || '';
}

export default async function openAuthedPage(path) {
  // Open the tab now, inside the click, or the browser blocks it as a pop-up.
  const win = window.open('', '_blank');
  try {
    const resp = await fetch(path, { headers: { Authorization: `Bearer ${token()}` } });
    if (!resp.ok) throw new Error(resp.status === 401 ? 'Sign in again, then retry.' : `The server answered ${resp.status}.`);
    let html = await resp.text();
    // A blob page has no address of its own: point relative links back here.
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${window.location.origin}/">`);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    if (win) {
      win.document.title = 'Report';
      win.document.body.textContent = `Couldn't open the report. ${e.message || ''}`;
    }
  }
}
