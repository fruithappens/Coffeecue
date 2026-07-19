/// <reference types="cypress" />
// Phase C — the real login form with real credentials.
// Credentials come from the environment (CYPRESS_BENCH_USER / _PASS via
// testbench/run_ui_tests.sh) — never from this file.

describe('Login', () => {
  it('rejects a wrong password with a visible error (stays logged out)', () => {
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type('nobody');
    cy.get('input[placeholder="Password"]').type('definitely-wrong');
    cy.get('button[type="submit"]').click();
    // Still on the login page, and no auth token was stored.
    cy.url({ timeout: 15000 }).should('include', '/login');
    cy.window().then((win) => {
      expect(win.localStorage.getItem('coffee_system_token')).to.be.null;
    });
  });

  it('signs in with real credentials and lands on an authed interface', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set (run via run_ui_tests.sh)').to.be.ok;

    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();

    // Off the login page…
    cy.url({ timeout: 30000 }).should('not.include', '/login');
    // …with a real token stored under the key the app actually reads.
    cy.window().then((win) => {
      expect(win.localStorage.getItem('coffee_system_token'),
        'coffee_system_token in localStorage').to.be.a('string').and.not.be.empty;
    });

    // The Barista interface is reachable for this (admin) user and renders
    // its order board chrome.
    cy.visit('/barista');
    cy.get('body', { timeout: 30000 }).invoke('text')
      .should('match', /pending|in progress|upcoming|orders/i);
  });
});
