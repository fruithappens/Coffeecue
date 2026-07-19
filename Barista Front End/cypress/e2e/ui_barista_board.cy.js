/// <reference types="cypress" />
// Phase C — the barista's screen shows what customers actually ordered.
// Creates a phoneless order via the public kiosk API (the same call the
// kiosk UI makes), then logs in through the real UI and asserts the order —
// INCLUDING its decaf modifier — is visible on the barista board. Cancels
// the order afterwards.

describe('Barista board', () => {
  const TAG = 'ZZBenchUIBoard';
  let orderNumber = null;
  let token = null;

  before(() => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set (run via run_ui_tests.sh)').to.be.ok;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
      });
    // Phoneless decaf order via the public kiosk endpoint — the decaf must
    // survive to the barista's card (the #111 bug class, checked at the glass).
    cy.request('POST', '/api/display/order', {
      name: TAG, coffee_type: 'decaf latte', milk: 'full cream',
      size: 'medium', sugar: 'No sugar', phone: '',
    }).then((resp) => {
      expect(resp.body.success, 'kiosk API order created').to.be.true;
      orderNumber = resp.body.order_number;
    });
  });

  after(() => {
    if (orderNumber && token) {
      cy.request({
        method: 'POST',
        url: `/api/orders/${orderNumber}/cancel`,
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
    }
  });

  it('shows the pending order with its decaf modifier on the real barista screen', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');

    cy.visit('/barista');
    // The order card renders with the customer's name…
    cy.contains(new RegExp(TAG, 'i'), { timeout: 45000 }).should('be.visible');
    // …and the board shows the drink WITH its decaf modifier (the #111 bug
    // class, verified at the glass: the card is what the barista makes).
    cy.get('body').invoke('text').then((text) => {
      expect(text.toLowerCase(), 'barista board shows "decaf latte"')
        .to.match(/decaf\s+latte/);
    });
  });
});
