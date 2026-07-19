/// <reference types="cypress" />
// Phase C v2 — the phone-sized experience (PR #46 made all three staff
// interfaces responsive; nothing has ever verified it stays that way).
// Read-only: renders, navigable, and — the #47 regression — the page must
// not be broken by a transform on <body> (position:fixed anchors).

describe('Mobile viewports', () => {
  beforeEach(() => {
    cy.viewport('iphone-x');
  });

  it('public display board renders on a phone', () => {
    cy.visit('/display');
    cy.contains('button', 'Order here', { timeout: 30000 }).should('be.visible');
    // The #47 class: display-scaling once put a transform on <body>, which
    // silently broke every position:fixed element app-wide.
    cy.get('body').should(($b) => {
      const t = getComputedStyle($b[0]).transform;
      expect(t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)',
        `body transform is identity/none (got ${t})`).to.be.true;
    });
  });

  it('kiosk wizard is usable on a phone (first two steps)', () => {
    cy.visit('/display');
    cy.contains('button', 'Order here', { timeout: 30000 }).click();
    cy.get('input[placeholder="Type your name"]', { timeout: 15000 })
      .should('be.visible').type('ZZBenchUIMob');
    cy.contains('button', 'Next').should('be.visible').click();
    cy.contains(/What would you like|drink/i, { timeout: 15000 }).should('exist');
    // Back out — nothing ordered, nothing to clean up.
  });

  it('barista interface renders with its mobile navigation after login', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');
    cy.visit('/barista');
    cy.get('body', { timeout: 30000 }).invoke('text')
      .should('match', /pending|orders|upcoming/i);
    // The mobile bottom tab bar (or at minimum, tappable nav) exists.
    cy.get('button, a').filter(':visible').should('have.length.greaterThan', 3);
  });
});
