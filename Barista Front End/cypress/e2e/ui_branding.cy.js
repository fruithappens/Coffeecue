/// <reference types="cypress" />
// Phase C v4 — the branding save, including the BIG-IMAGE TRAP that once
// bit a real event: a huge logo made the save fail with a cheerful
// "saved locally" while the display kept the old branding. The guard now
// lives client-side (400KB cap + visible error, canvas compression) —
// this spec proves the guard SPEAKS UP and that a valid save truly
// persists to the backend blob. Original branding restored exactly.

describe('Organiser branding save (big-image trap)', () => {
  let token = null;
  let origBlob = null;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // a valid 1x1 transparent PNG
  const TINY_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  before(() => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set').to.be.ok;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
        cy.request({ url: '/api/settings/branding', headers: auth() })
          .then((r) => { origBlob = r.body.settings || {}; });
      });
  });

  after(() => {
    if (token && origBlob) {
      cy.request({ method: 'PUT', url: '/api/settings/branding',
                   headers: auth(), body: { settings: origBlob },
                   failOnStatusCode: false });
    }
  });

  it('rejects an oversized logo LOUDLY, accepts a small one, and the backend hears the save', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');

    cy.visit('/organiser');
    cy.contains('button, a', 'Settings', { timeout: 45000 }).first().click();
    cy.contains(/logo/i, { timeout: 30000 }).should('exist');

    // 1) OVERSIZED (600KB of noise typed as PNG) → the guard must speak.
    const big = Cypress.Buffer.alloc(600 * 1024, 7);
    cy.contains(/logo/i).parents('div').first().parent()
      .find('input[type="file"]').first()
      .selectFile({ contents: big, fileName: 'huge.png', mimeType: 'image/png' },
                  { force: true });
    cy.contains(/under 400KB|too large|resize|compress/i, { timeout: 10000 })
      .should('be.visible');

    // 2) VALID tiny PNG → loads, and Save persists to the BACKEND blob.
    const tiny = Cypress.Buffer.from(TINY_PNG_B64, 'base64');
    cy.contains(/logo/i).parents('div').first().parent()
      .find('input[type="file"]').first()
      .selectFile({ contents: tiny, fileName: 'tiny.png', mimeType: 'image/png' },
                  { force: true });
    cy.contains(/logo loaded|click save/i, { timeout: 10000 }).should('be.visible');
    cy.contains('button', 'Save Branding Settings').click();
    // The REAL effect (and the only oracle that matters): the BACKEND blob
    // now carries our tiny data-URI logo. Poll — the save may race a page
    // reload, and network-layer intercepts proved unreliable for this
    // component's fetch path.
    const checkBlob = (attempt) => {
      cy.wait(3000);
      cy.request({ url: '/api/settings/branding', headers: auth() }).then((r) => {
        const blob = (r.body && r.body.settings) || {};
        const logo = String(blob.clientLogo || blob.logo || '');
        if (logo.startsWith('data:image') && logo.length < 5000) return;
        if (attempt < 4) return checkBlob(attempt + 1);
        expect(logo.startsWith('data:image') && logo.length < 5000,
          `backend blob carries the tiny logo (got ${logo.slice(0, 40)}… len ${logo.length})`)
          .to.be.true;
      });
    };
    checkBlob(1);
  });
});
