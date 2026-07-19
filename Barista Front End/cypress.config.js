// Cypress config for the Coffee Cue UI tests (Phase C).
//
// Deliberately dependency-free: no require('cypress') — defineConfig is
// just an identity helper, and skipping it lets this config load in a git
// worktree or CI box that has the Cypress BINARY but no local
// node_modules. Override CYPRESS_BASE_URL to target any environment:
//   CYPRESS_BASE_URL=https://web-production-4cc9c.up.railway.app \
//     npx cypress run --spec 'cypress/e2e/ui_*.cy.js'
module.exports = {
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:3000',
    supportFile: false,
    // Only the ui_* specs are live; legacy/ holds pre-Phase-C drafts that
    // reference test users and debug endpoints that don't exist.
    specPattern: 'cypress/e2e/ui_*.cy.js',
    setupNodeEvents(on, config) {
      return config;
    },
  },
  video: false,
  screenshotOnRunFailure: true,
  defaultCommandTimeout: 10000,
  pageLoadTimeout: 90000,
};
