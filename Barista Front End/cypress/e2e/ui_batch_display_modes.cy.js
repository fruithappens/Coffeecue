/// <reference types="cypress" />
// Phase C v4 — the barista's "Process Batch" button clicked for real, and
// the display screen's orientation/rotate modes.

describe('Batch button + display modes', () => {
  let token = null;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const nums = [];

  before(() => {
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    expect(user, 'CYPRESS_BENCH_USER must be set').to.be.ok;
    cy.request('POST', '/api/auth/login', { username: user, password: pass })
      .then((resp) => {
        token = resp.body.token || resp.body.access_token
          || (resp.body.data && resp.body.data.token);
      });
    // Two IDENTICAL phoneless orders → same batch group on station 1.
    ['A', 'B'].forEach((x) => {
      cy.request('POST', '/api/display/order', {
        name: `ZZBenchUIBatch${x}`, coffee_type: 'latte', milk: 'full cream',
        size: 'medium', sugar: 'No sugar', phone: '', preferred_station: 1,
      }).then((r) => nums.push(r.body.order_number));
    });
  });

  after(() => {
    nums.forEach((n) => {
      cy.request({ method: 'POST', headers: auth(), failOnStatusCode: false,
                   url: `/api/orders/${n}/cancel` });
    });
  });

  it('Process Batch starts both identical orders with one click', function () {
    // SAFETY + sanity: both bench orders must exist in pending, share a
    // batch group, and no REAL customer's order may share it.
    cy.request({ url: '/api/orders/pending', headers: auth() }).then((resp) => {
      const rows = resp.body.orders || resp.body.data || resp.body || [];
      const mine = (Array.isArray(rows) ? rows : []).filter((o) =>
        nums.map(String).includes(String(o.order_number || o.orderNumber)));
      expect(mine.length, `both setup orders (${nums}) in pending`).to.eq(2);
      const group = mine[0].batchGroup || mine[0].batch_group;
      expect(group, 'orders carry a batch group').to.be.ok;
      const strangers = (Array.isArray(rows) ? rows : []).filter((o) =>
        (o.batchGroup || o.batch_group) === group
        && !nums.map(String).includes(String(o.order_number || o.orderNumber)));
      if (strangers.length) {
        cy.log(`skipping click — ${strangers.length} real order(s) share the batch`);
        this.skip();
      }
    });
    const user = Cypress.env('BENCH_USER');
    const pass = Cypress.env('BENCH_PASS');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(pass, { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');

    cy.visit('/barista');
    // The order cards themselves render first…
    cy.contains(/ZZBenchUIBatch/i, { timeout: 45000 }).should('be.visible');
    // …then the batch group with its Process Batch button. If this fails,
    // the assertion message carries what the section ACTUALLY shows.
    cy.contains('Upcoming Orders').closest('div').parent().invoke('text')
      .then((sectionText) => {
        expect(sectionText.slice(0, 400), 'Upcoming Orders section content')
          .to.match(/Process Batch|Batch:/);
      });
    cy.contains('button', 'Process Batch', { timeout: 15000 }).first().click();
    // The REAL effect: both orders leave pending (started together).
    cy.request({ url: '/api/orders/pending', headers: auth() }).then((resp) => {
      const rows = resp.body.orders || resp.body.data || resp.body || [];
      const stillPending = (Array.isArray(rows) ? rows : []).filter((o) =>
        nums.map(String).includes(String(o.order_number || o.orderNumber)));
      expect(stillPending.length, 'both batch orders left pending').to.eq(0);
    });
  });

  it('orientation + rotate display modes render without breaking fixed positioning', () => {
    ['/display?orientation=portrait', '/display?rotate=90', '/display?mode=pickup'].forEach((url) => {
      cy.visit(url);
      cy.get('body', { timeout: 30000 }).invoke('text')
        .should('match', /ready|pickup|order|coffee/i);
      // The #47 class: rotation/scaling must never land a transform on
      // <body> — it silently breaks every position:fixed element.
      cy.get('body').should(($b) => {
        const t = getComputedStyle($b[0]).transform;
        expect(t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)',
          `body transform identity on ${url} (got ${t})`).to.be.true;
      });
    });
  });
});
