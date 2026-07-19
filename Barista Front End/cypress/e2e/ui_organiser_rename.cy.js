/// <reference types="cypress" />
// Phase C v3 — an organiser SAVE round-trip: rename a station through the
// real Stations form and prove the backend heard it. Uses a bench-created
// station so no real station's config is ever touched; deleted after.

describe('Organiser station rename (save round-trip)', () => {
  const NAME = 'ZZBench UI Rename';
  const RENAMED = 'ZZBench UI Renamed';
  let token = null;
  let sid = null;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  before(() => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set').to.be.ok;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
        cy.request({
          method: 'POST', url: '/api/stations', headers: auth(),
          body: { name: NAME, location: 'Bench', capacity: 1 },
        }).then((r) => {
          const st = r.body.station || r.body.data || r.body;
          sid = st.station_id || st.id;
          expect(sid, 'bench station created').to.be.ok;
        });
      });
  });

  after(() => {
    if (sid && token) {
      cy.request({ method: 'DELETE', url: `/api/stations/${sid}`,
                   headers: auth(), failOnStatusCode: false });
    }
  });

  it('renames the station through the form and the backend agrees', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');

    cy.visit('/organiser');
    cy.contains('button, a', 'Stations', { timeout: 45000 }).first().click();
    // Select the bench station in the list.
    cy.contains(NAME, { timeout: 30000 }).click();
    // The always-editable form: the input currently holding the name.
    cy.get(`input[value="${NAME}"]`, { timeout: 15000 })
      .clear().type(RENAMED);
    cy.contains('button', 'Save Changes', { timeout: 10000 })
      .should('not.be.disabled').click();
    cy.contains('button', /Saved|Save Changes/, { timeout: 20000 });

    // The REAL effect: the backend station list carries the new name.
    cy.request({ url: '/api/stations', headers: auth() }).then((resp) => {
      const rows = resp.body.stations || resp.body.data || [];
      const mine = rows.find((s) => String(s.id || s.station_id) === String(sid));
      expect(mine, 'bench station still listed').to.exist;
      expect(String(mine.name), 'renamed on the backend').to.contain('Renamed');
    });
  });
});
