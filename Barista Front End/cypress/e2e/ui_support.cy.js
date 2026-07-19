/// <reference types="cypress" />
// Phase C v5 — the Support interface, every tab opened for real.
// OPEN ONLY: no button inside any tab is pressed (the Emergency tab has
// live controls; SMS Test can send). A render crash in any tab fails the
// spec via Cypress's uncaught-exception rule.

describe('Support interface click-through', () => {
  it('opens all nine support tabs without crashing', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set').to.be.ok;

    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');

    cy.visit('/support');
    cy.get('body', { timeout: 45000 }).invoke('text')
      .should('match', /dashboard|operations|support/i);

    const tabs = ['Dashboard', 'Operations', 'Health', 'Comms', 'SMS Test',
                  'SMS Block', 'Users', 'Diagnose', 'Emergency'];
    tabs.forEach((label) => {
      cy.contains('button', label, { timeout: 20000 }).click();
      // The shell survives the tab's render (content present, not blank).
      cy.get('body').invoke('text').should('have.length.greaterThan', 200);
    });
  });
});
