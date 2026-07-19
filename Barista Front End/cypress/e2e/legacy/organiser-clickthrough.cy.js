/// <reference types="cypress" />

// Organiser Interface clickthrough smoke test.
//
// What this catches: any React component crash that fires the Error
// Boundary when an operator clicks a tab, opens an Edit form, or
// triggers an Add dialog. This is the EXACT class of bug that hit
// Steve when he clicked the Edit pencil on a treenet1 user — the
// previous test suite (backend API smoke + JSON contracts) couldn't
// see it because the bug is purely React.
//
// What this does NOT catch: business-logic bugs, race conditions,
// data-mutation correctness. It's a "does anything explode?" check.
// Pairs with the production error-capture endpoint
// (/api/client-errors) — together they bracket frontend crashes:
// this catches them before they ship, the endpoint catches the ones
// that slipped through.
//
// Usage:
//   cd "Barista Front End"
//   npm install      # first time only — installs cypress
//   CYPRESS_BASE_URL=http://localhost:3000 npx cypress run --spec cypress/e2e/organiser-clickthrough.cy.js
// Or interactively:
//   npx cypress open

const ADMIN = {
  username: Cypress.env('ADMIN_USERNAME') || 'coffeecue',
  password: Cypress.env('ADMIN_PASSWORD') || 'adminpassword',
};

// Tab labels as they appear in OrganiserInterface.js's sidebar (see
// the span text — emojis are part of the visible label). When the
// sidebar changes, update this list. Each entry is a substring match
// via cy.contains, so partial labels are fine.
const ORGANISER_TABS = [
  'Quick Setup',
  'Live Ops',
  'Stations',
  'Queue AI',
  'Event Phases',
  'Orders',
  'Group Orders',
  'Users',
  'Schedule',
  'Analytics',
  'Comms Hub',
  'AI Predict',
  'Settings',
];

/**
 * Assert NO React Error Boundary is currently visible.
 *
 * ErrorBoundary.js renders a banner whose heading reads
 *   "Component Error: {componentName}"
 * — that string is the canonical signal. We also check the fallback
 * "Service Temporarily Unavailable" heading in case a component sets
 * its own componentName to empty.
 */
function assertNoCrash(context) {
  cy.get('body').then($body => {
    const text = $body.text();
    expect(text, `${context} should not show an Error Boundary`).not.to.match(
      /Component Error:|Service Temporarily Unavailable/
    );
  });
}

describe('Organiser clickthrough — smoke', () => {
  before(() => {
    // Fail loud on any uncaught exception. By default Cypress catches
    // these and fails the test — we just want to be explicit and
    // surface a clearer message for the smoke-test scenario.
    Cypress.on('uncaught:exception', (err) => {
      // Returning false would swallow the error. We don't — let the
      // test fail with the original stack.
      console.error('Uncaught exception during smoke test:', err);
      return true;
    });
  });

  beforeEach(() => {
    cy.clearLocalStorage();
    cy.session([ADMIN.username], () => {
      cy.visit('/login');
      cy.get('input[name="username"], input[type="text"]').first().type(ADMIN.username);
      cy.get('input[name="password"], input[type="password"]').first().type(ADMIN.password);
      cy.get('button[type="submit"]').click();
      // Auth landed somewhere — could be /barista, /organiser, /support.
      // Just confirm we left /login.
      cy.url().should('not.include', '/login');
    });
  });

  it('clicks every Organiser sidebar tab without firing an Error Boundary', () => {
    cy.visit('/organiser');
    assertNoCrash('Initial /organiser load');

    ORGANISER_TABS.forEach(label => {
      // The sidebar sometimes hides labels behind icons when collapsed.
      // Force the click in case the visible target is the parent button.
      cy.contains('button', label, { matchCase: false })
        .should('exist')
        .click({ force: true });
      // Give React a beat to mount the section.
      cy.wait(400);
      assertNoCrash(`After clicking "${label}" tab`);
    });
  });

  it('opens every Edit pencil in User Management without crashing', () => {
    cy.visit('/organiser');
    cy.contains('button', 'Users').click({ force: true });
    cy.wait(500);
    assertNoCrash('After landing on Users tab');

    // Walk every Edit button visible in the user table. Selector
    // hierarchy: prefer aria-label (the accessible path), fall back
    // to title attribute, then to any button containing a pencil
    // icon via the Lucide class. Each click is wrapped so a single
    // missing user doesn't abort the whole loop.
    cy.get('body').then($body => {
      const editButtons = $body.find(
        '[aria-label*="Edit" i], [title*="Edit" i], button:has(svg.lucide-pencil), button:has(svg.lucide-edit), button:has(svg.lucide-edit-2), button:has(svg.lucide-edit-3)'
      );
      if (editButtons.length === 0) {
        // No users to edit — log it but don't fail. A fresh DB has zero.
        cy.log('No Edit buttons found in Users tab — DB has no users yet.');
        return;
      }
      cy.log(`Found ${editButtons.length} Edit-style buttons. Clicking each.`);
      // Click first 10 only — past that is diminishing returns and
      // the same code path is exercised every time.
      const limit = Math.min(editButtons.length, 10);
      for (let i = 0; i < limit; i++) {
        cy.get('[aria-label*="Edit" i], [title*="Edit" i], button:has(svg.lucide-pencil), button:has(svg.lucide-edit), button:has(svg.lucide-edit-2), button:has(svg.lucide-edit-3)')
          .eq(i)
          .click({ force: true });
        cy.wait(300);
        assertNoCrash(`After opening Edit form for user #${i + 1}`);
        // Close the form before the next iteration. Cancel is the
        // standard label across UserManagementTab; if missing, hit
        // Escape and move on.
        cy.get('body').then($b => {
          if ($b.text().includes('Cancel')) {
            cy.contains('button', 'Cancel').first().click({ force: true });
          } else {
            cy.get('body').type('{esc}');
          }
        });
        cy.wait(200);
      }
    });
  });

  it('opens every Add button without crashing', () => {
    cy.visit('/organiser');

    // Walk each tab, look for an "Add" / "+ Add" / "New" button, click
    // it, verify no crash, close. Catches the common "Add User form
    // crashes" / "Add Station crashes" bug class.
    const TABS_WITH_ADD = ['Stations', 'Users'];
    TABS_WITH_ADD.forEach(tabLabel => {
      cy.contains('button', tabLabel).click({ force: true });
      cy.wait(500);
      cy.get('body').then($body => {
        const addBtns = $body.find('button').filter((_, el) => {
          const t = (el.textContent || '').toLowerCase().trim();
          return /^(\+\s*)?add\b|^new\b/.test(t);
        });
        if (addBtns.length === 0) {
          cy.log(`No Add button visible on ${tabLabel} — skipping.`);
          return;
        }
        cy.wrap(addBtns.first()).click({ force: true });
        cy.wait(400);
        assertNoCrash(`After clicking Add on ${tabLabel}`);
        // Close
        cy.get('body').then($b => {
          if ($b.text().includes('Cancel')) {
            cy.contains('button', 'Cancel').first().click({ force: true });
          } else {
            cy.get('body').type('{esc}');
          }
        });
      });
    });
  });
});
