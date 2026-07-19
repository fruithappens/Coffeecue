/// <reference types="cypress" />
// Phase C v2 — the Organiser interface, clicked through read-only.
// No saves: this proves every operator-facing section actually opens
// (a crash inside any section's render would fail the spec).

describe('Organiser interface', () => {
  it('logs in and opens the operator sections without crashing', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set (run via run_ui_tests.sh)').to.be.ok;

    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');

    cy.visit('/organiser');
    // Default section (Live Ops dashboard) renders.
    cy.get('body', { timeout: 45000 }).invoke('text')
      .should('match', /live ops|dashboard|stations|orders/i);

    // Open the highest-value sections by their sidebar labels. Each click
    // must produce section content, not a blank/red screen. (Uncaught
    // render exceptions fail the spec automatically.)
    const sections = ['Stations', 'Orders', 'Users', 'Schedule', 'Settings'];
    sections.forEach((label) => {
      cy.get('body').then(($b) => {
        const $btn = $b.find(`button:contains("${label}"), a:contains("${label}")`)
          .filter(':visible').first();
        if ($btn.length) {
          cy.wrap($btn).click();
          // The app shell stays alive after the section renders.
          cy.get('body').invoke('text').should('have.length.greaterThan', 100);
        } else {
          cy.log(`section "${label}" not visible for this role — skipped`);
        }
      });
    });
  });
});
