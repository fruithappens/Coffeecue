describe('Auto-refresh picker', () => {
  it('clicking 15 seconds sets the pill to 15s', () => {
    const user = Cypress.env('BENCH_USER');
    cy.visit('/login');
    cy.get('input[placeholder="Username"]', { timeout: 30000 }).type(user);
    cy.get('input[placeholder="Password"]').type(Cypress.env('BENCH_PASS'), { log: false });
    cy.get('button[type="submit"]').click();
    cy.url({ timeout: 30000 }).should('not.include', '/login');
    cy.viewport(1400, 900); // desktop — control is hidden on mobile
    cy.visit('/barista');
    // The pill shows "Off" or "Ns" with a chevron
    cy.get('button[title*="Auto-refresh"]', { timeout: 45000 }).should('be.visible').click();
    cy.contains('button', '15 seconds', { timeout: 10000 }).should('be.visible').click();
    cy.get('button[title*="Auto-refresh"]').should('contain.text', '15s');
    // survives a reload (persisted)?
    cy.reload();
    cy.get('button[title*="Auto-refresh"]', { timeout: 45000 })
      .invoke('text').then((t) => cy.log(`after reload pill shows: ${t}`));
  });
});
