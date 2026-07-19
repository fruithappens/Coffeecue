/// <reference types="cypress" />
// Phase C — the walk-up kiosk, clicked exactly like a customer.
// Places ONE real phoneless order (ZZBenchUI*, no SMS possible) through the
// touch wizard, reads the order number off the success screen, then cancels
// it via the API so nothing is left behind.

describe('Kiosk self-service order', () => {
  const TAG = 'ZZBenchUI';

  const apiCancel = (orderNumber) => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    if (!user || !orderNumber) return;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        const token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
        cy.request({
          method: 'POST',
          url: `/api/orders/${orderNumber}/cancel`,
          headers: { Authorization: `Bearer ${token}` },
          failOnStatusCode: false,
        });
      });
  };

  it('a customer can tap through name→drink→milk→size→sugar→review and get an order number', () => {
    cy.visit('/display');
    cy.contains('button', 'Order here', { timeout: 30000 }).click();

    // NAME
    cy.get('input[placeholder="Type your name"]', { timeout: 15000 }).type(TAG);
    cy.contains('button', 'Next').click();

    // DRINK — tap the latte tile (present on every menu we run).
    cy.contains('button', /latte/i, { timeout: 15000 }).first().click();

    // MILK — first real milk tile (menu-driven; "No milk" is always last-ish,
    // so pick a named dairy option if present, else the first tile).
    cy.get('body').then(($b) => {
      const text = $b.text();
      const pick = /full cream/i.test(text) ? /full cream/i
        : (/skim/i.test(text) ? /skim/i : /milk/i);
      cy.contains('button', pick).first().click();
    });

    // SIZE — medium if the menu offers sizes (step may be skipped when the
    // event has a single size).
    cy.get('body').then(($b) => {
      if (/How much sugar/i.test($b.text())) return; // size step was skipped
      cy.contains('button', /medium/i, { timeout: 10000 }).first().click();
    });

    // SUGAR — default 0, just continue.
    cy.contains(/How much sugar/i, { timeout: 15000 });
    cy.contains('button', 'Next').click();

    // LOCATION — only shown when 2+ stations can make it: pick the fastest,
    // else any station button.
    cy.get('body', { timeout: 15000 }).then(($b) => {
      const text = $b.text();
      if (/Collect from\?/i.test(text)) {
        if (/Fastest/i.test(text)) {
          cy.contains('button', 'Fastest').click();
        } else if (/Collect here/i.test(text)) {
          cy.contains('button', 'Collect here').click();
        } else {
          cy.contains(/Or pick a station/i).parent().find('button').first().click();
        }
      }
    });

    // PHONE — always optional; skip it (phoneless = zero SMS risk).
    cy.contains('button', 'No thanks', { timeout: 15000 }).click();

    // REVIEW → place the order.
    cy.contains('button', 'Place order', { timeout: 15000 }).click();

    // DONE — the success screen shows the big #number.
    cy.contains(/Your order number is/i, { timeout: 30000 }).should('be.visible');
    cy.contains(/#\s*[A-Za-z]{0,3}\d+/, { timeout: 15000 })
      .invoke('text')
      .then((numText) => {
        const m = numText.match(/#\s*([A-Za-z]{0,3}\d+)/);
        expect(m, `order number in "${numText}"`).to.be.ok;
        cy.log(`kiosk order placed: #${m[1]}`);
        apiCancel(m[1]); // leave nothing behind
      });
  });
});
