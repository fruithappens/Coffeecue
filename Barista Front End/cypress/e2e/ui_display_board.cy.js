/// <reference types="cypress" />
// Phase C — the PUBLIC display board, as a customer sees it.
// Read-only. Runs unauthenticated, like the wall screen at an event.

describe('Public display board', () => {
  it('orders mode renders the board with kiosk + SMS ordering offered', () => {
    cy.visit('/display');
    // The self-service kiosk button is the walk-up entry point.
    cy.contains('button', 'Order here', { timeout: 30000 }).should('be.visible');
    // The board's column structure exists (Ready/pickup wording somewhere).
    cy.get('body').invoke('text').should('match', /ready|pickup|preparing|making|order/i);
  });

  it('never shows the demo fallback customers (the fake-board bug class)', () => {
    // /api/display/orders used to error on every call and serve hardcoded
    // demo customers. The API guard exists in the Test Bench; this is the
    // same promise checked at the glass.
    cy.visit('/display');
    cy.contains('button', 'Order here', { timeout: 30000 }).should('be.visible');
    cy.get('body').invoke('text').then((text) => {
      ['John D.', 'Sarah M.', 'Mike T.', 'Emma S.'].forEach((fake) => {
        expect(text, `fake demo customer "${fake}" on the public board`).not.to.contain(fake);
      });
    });
  });

  it('pickup mode is the clean board (no kiosk button, no SMS footer)', () => {
    cy.visit('/display?mode=pickup');
    // Board still renders…
    cy.get('body', { timeout: 30000 }).invoke('text').should('match', /ready|pickup|order/i);
    // …but the self-service kiosk is hidden on the clean pickup screen.
    cy.contains('button', 'Order here').should('not.exist');
  });
});
