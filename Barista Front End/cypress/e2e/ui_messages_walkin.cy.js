/// <reference types="cypress" />
// Phase C v3 — the Messages bubble, the walk-in dialog, and the Delay
// button's honesty, all driven on the real barista screen.

describe('Barista messages, walk-in and delay', () => {
  let token = null;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const fakePhone = () => '+6140' + String(Date.now()).slice(-7);

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
    expect(user, 'CYPRESS_BENCH_USER must be set (run via run_ui_tests.sh)').to.be.ok;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
      });
  });

  it('a customer question lights the Messages bubble and shows in the inbox', () => {
    // Customer asks a question via the simulate harness (zero real SMS).
    cy.request({
      method: 'POST', url: '/api/sms/simulate', headers: auth(),
      body: { from: fakePhone(), body: 'BARISTA is the ZZBenchUIQ oat milk fresh today?' },
    }).its('status').should('eq', 200);

    uiLogin();
    cy.visit('/barista');
    // The bubble exists and carries a REAL pending-question badge.
    cy.get('button[title*="Messages"]', { timeout: 30000 }).should('be.visible')
      .within(() => {
        cy.get('span').should(($s) => {
          const n = parseInt($s.text(), 10);
          expect(n, 'pending-question badge count').to.be.greaterThan(0);
        });
      });
    // Open it — the question text is in the inbox.
    cy.get('button[title*="Messages"]').click();
    cy.contains(/ZZBenchUIQ oat milk fresh/i, { timeout: 15000 }).should('be.visible');
  });

  it('Add Walk-in Order creates a real order from the dialog', () => {
    uiLogin();
    // Watch the wire: the dialog must actually POST an order and the
    // backend must accept it — a "saved" that never leaves the browser is
    // the two-stores bug class.
    cy.intercept('POST', '**/orders*').as('walkinPost');
    cy.visit('/barista');
    cy.contains('button', 'Add Walk-in Order', { timeout: 30000 }).click();
    cy.get('form input[required]', { timeout: 15000 }).first()
      .clear().type('ZZBenchUIWalk');
    cy.contains('button', /^Add Order|Adding Order/, { timeout: 10000 }).click();
    cy.wait('@walkinPost', { timeout: 20000 }).then((i) => {
      expect(i.response, 'walk-in POST got a response').to.exist;
      expect(i.response.statusCode, `POST ${i.request.url} accepted`)
        .to.be.oneOf([200, 201]);
      const body = i.response.body || {};
      const num = body.order_number
        || (body.order && body.order.order_number)
        || (body.data && body.data.order_number) || body.id;
      expect(num, `order number in response ${JSON.stringify(body).slice(0, 150)}`)
        .to.be.ok;
      // The REAL effect: that order is in the backend pending queue.
      cy.request({ url: '/api/orders/pending', headers: auth() }).then((resp) => {
        const rows = resp.body.orders || resp.body.data || resp.body || [];
        const mine = (Array.isArray(rows) ? rows : []).some((o) =>
          String(o.order_number || o.orderNumber || o.id) === String(num));
        expect(mine, `order ${num} in the pending queue`).to.be.true;
        cy.request({ method: 'POST', headers: auth(), failOnStatusCode: false,
                     url: `/api/orders/${num}/cancel` });
      });
    });
  });

  it('Delay is honest: says not supported and changes nothing', () => {
    let orderNumber;
    cy.request('POST', '/api/display/order', {
      name: 'ZZBenchUIDel', coffee_type: 'latte', milk: 'full cream',
      size: 'medium', sugar: 'No sugar', phone: '', preferred_station: 1,
    }).then((resp) => { orderNumber = resp.body.order_number; });

    uiLogin();
    cy.visit('/barista');
    const alerts = [];
    cy.on('window:alert', (msg) => alerts.push(msg));
    cy.contains(/ZZBenchUIDel/i, { timeout: 45000 }).then(($el) => {
      const $card = $el.parents().filter((i, el) =>
        Cypress.$(el).find('button:contains("Delay")').length > 0).first();
      cy.wrap($card.find('button:contains("Delay")').first()).click();
    });
    cy.wrap(null).should(() => {
      expect(alerts.join(' '), 'Delay explains itself instead of pretending')
        .to.match(/isn't supported|not been changed|NOT been changed/i);
    });
    // Nothing changed: the order is still pending.
    cy.request({ url: '/api/orders/pending', headers: auth() }).then((resp) => {
      const rows = resp.body.orders || resp.body.data || resp.body || [];
      const still = (Array.isArray(rows) ? rows : []).some((o) =>
        String(o.order_number || o.orderNumber) === String(orderNumber));
      expect(still, 'order untouched by Delay').to.be.true;
      cy.request({ method: 'POST', headers: auth(), failOnStatusCode: false,
                   url: `/api/orders/${orderNumber}/cancel` });
    });
  });
});
