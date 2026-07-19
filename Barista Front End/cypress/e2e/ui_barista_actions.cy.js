/// <reference types="cypress" />
// Phase C v2 — the barista's Start and COMPLETE ORDER buttons, clicked for
// real. A phoneless order is created via the kiosk API (pinned to station 1
// so it appears on the default barista view), then driven through the
// lifecycle with real clicks. Phoneless = no SMS at any transition.
// Cleanup: picked up + swept via API.

describe('Barista order actions', () => {
  const TAG = 'ZZBenchUIAct';
  let orderNumber = null;
  let token = null;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  before(() => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set (run via run_ui_tests.sh)').to.be.ok;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
      });
    cy.request('POST', '/api/display/order', {
      name: TAG, coffee_type: 'latte', milk: 'full cream',
      size: 'medium', sugar: 'No sugar', phone: '', preferred_station: 1,
    }).then((resp) => {
      expect(resp.body.success, 'setup order created').to.be.true;
      orderNumber = resp.body.order_number;
    });
  });

  after(() => {
    if (orderNumber && token) {
      // Whatever state the test reached, tidy up: pickup if completed,
      // cancel if it never got there. Both are no-ops when inapplicable.
      cy.request({ method: 'POST', url: `/api/orders/${orderNumber}/pickup`,
                   headers: auth(), failOnStatusCode: false });
      cy.request({ method: 'POST', url: `/api/orders/${orderNumber}/cancel`,
                   headers: auth(), failOnStatusCode: false });
    }
  });

  it('Start moves the order to in-progress; COMPLETE ORDER finishes it', () => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');

    cy.visit('/barista');

    // The pending card for our order, with its Start button.
    cy.contains(new RegExp(TAG, 'i'), { timeout: 45000 })
      .closest('div')
      .parents()
      .filter((i, el) => /Start/.test(Cypress.$(el).find('button').text()))
      .first()
      .as('pendingCard');
    // Click the Start button nearest our order's card. Scope tightly: find
    // the card element containing the tag, walk up until a Start button is
    // inside, click that one (not another order's).
    cy.contains(new RegExp(TAG, 'i')).then(($tagEl) => {
      const $card = $tagEl.parents().filter((i, el) =>
        Cypress.$(el).find('button:contains("Start")').length > 0).first();
      expect($card.length, 'a card containing the order and a Start button').to.be.gt(0);
      cy.wrap($card.find('button:contains("Start")').first()).click();
    });

    // The order leaves pending and shows in the current/in-progress area
    // with the COMPLETE ORDER button available.
    cy.contains('button', /COMPLETE ORDER/i, { timeout: 30000 }).should('be.visible');
    cy.contains(new RegExp(TAG, 'i'), { timeout: 15000 }).should('be.visible');

    // Complete it with a real click.
    cy.contains(new RegExp(TAG, 'i')).then(($tagEl) => {
      const $card = $tagEl.parents().filter((i, el) =>
        Cypress.$(el).find('button:contains("COMPLETE ORDER")').length > 0).first();
      const $btn = ($card.length ? $card : Cypress.$('body'))
        .find('button:contains("COMPLETE ORDER")').first();
      cy.wrap($btn).click();
    });

    // The backend agrees: the order is completed.
    cy.request({ url: '/api/orders/pending', headers: auth() }).then((resp) => {
      const rows = resp.body.orders || resp.body.data || resp.body || [];
      const still = (Array.isArray(rows) ? rows : []).some((o) =>
        String(o.order_number || o.orderNumber || o.id) === String(orderNumber));
      expect(still, 'order no longer pending').to.be.false;
    });
    cy.request('/api/display/orders').then((resp) => {
      const ready = (resp.body.orders && resp.body.orders.ready) || [];
      const onReady = ready.some((o) =>
        String(o.order_number || o.orderNumber || o.id) === String(orderNumber));
      expect(onReady, `order ${orderNumber} on the ready board after COMPLETE`).to.be.true;
    });
  });
});
