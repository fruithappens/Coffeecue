/// <reference types="cypress" />
// Phase C v5 — station chat send/receive through the real panel, and a
// backend-created roster shift appearing on the barista's Schedule tab.
// Chat message deleted via the API afterwards; shift deleted too.

describe('Station chat + schedule tab', () => {
  let token = null;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const MSG = `ZZBench chat ping ${Date.now()}`;
  let shiftId = null;

  const uiLogin = () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');
  };

  before(() => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set').to.be.ok;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
        // A roster shift for TODAY (server's day, read from the schedule
        // endpoint itself so timezones can't lie to us).
        cy.request({ url: '/api/schedule/today', headers: auth() }).then((r) => {
          const dow = r.body.day_of_week;
          cy.request({
            method: 'POST', url: '/api/schedule/shifts', headers: auth(),
            // barista_name is silently dropped by the handler; the name
            // lives in notes (matches how the app itself labels shifts).
            body: { station_id: 1, day_of_week: dow, start_time: '00:05',
                    end_time: '23:55', notes: 'ZZBench Roster' },
          }).then((sr) => {
            const s = sr.body.schedule || sr.body.shift || sr.body.data || sr.body;
            shiftId = s && s.id;
            expect(shiftId, 'bench shift created').to.be.ok;
          });
        });
      });
  });

  after(() => {
    if (shiftId && token) {
      cy.request({ method: 'DELETE', headers: auth(), failOnStatusCode: false,
                   url: `/api/schedule/shifts/${shiftId}` });
    }
    if (token) {
      // Delete the bench chat message wherever it landed.
      cy.request({ url: '/api/chat/messages', headers: auth(),
                   failOnStatusCode: false }).then((r) => {
        const rows = (r.body && (r.body.messages || r.body.data)) || [];
        (Array.isArray(rows) ? rows : []).forEach((m) => {
          if (String(m.content || m.message || '').includes('ZZBench chat ping')) {
            cy.request({ method: 'DELETE', headers: auth(), failOnStatusCode: false,
                         url: `/api/chat/messages/${m.id}` });
          }
        });
      });
    }
  });

  it('a chat message sent from the panel reaches the backend chat log', () => {
    uiLogin();
    cy.visit('/barista');
    cy.get('button[title*="Messages"]', { timeout: 30000 }).click();
    cy.contains('button', 'Station chat', { timeout: 15000 }).click();
    cy.get('input[placeholder^="Type a message"]', { timeout: 15000 })
      .type(MSG);
    cy.get('input[placeholder^="Type a message"]').closest('form')
      .find('button[type="submit"]').click();
    // Visible in the panel…
    cy.contains(MSG, { timeout: 15000 }).should('be.visible');
    // …and REAL: it reached the backend chat log.
    cy.request({ url: '/api/chat/messages', headers: auth() }).then((r) => {
      const rows = (r.body && (r.body.messages || r.body.data)) || [];
      const mine = (Array.isArray(rows) ? rows : []).some((m) =>
        String(m.content || m.message || '').includes(MSG));
      expect(mine, 'chat message persisted server-side').to.be.true;
    });
  });

  it('a backend roster shift shows on the barista Schedule tab', function () {
    if (!shiftId) this.skip();
    uiLogin();
    cy.visit('/barista');
    cy.contains('button, a', 'Schedule', { timeout: 30000 }).first().click();
    cy.contains(/ZZBench Roster|00:05|12:0?5?\s*AM/i, { timeout: 30000 })
      .should('exist');
  });
});
