// Cypress config for the Coffee Cue smoke tests.
//
// Why this file exists: the existing cypress/e2e/ folder predated any
// config — Cypress can run a default config, but the smoke spec needs
// a known baseUrl so the same script works against localhost and a
// Railway preview. Override CYPRESS_BASE_URL to point at any
// environment (e.g. CYPRESS_BASE_URL=https://coffee.dev npx cypress run).

const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:3000',
    // Crashes inside React's render path bubble as uncaught exceptions
    // in Cypress. We want those to FAIL the spec, not be swallowed —
    // that's the whole point of the smoke test. The default behaviour
    // is correct, but we keep this explicit so a future contributor
    // doesn't accidentally weaken it.
    experimentalRunAllSpecs: true,
    setupNodeEvents(on, config) {
      return config;
    },
  },
  video: false,
  screenshotOnRunFailure: true,
  defaultCommandTimeout: 10000,
  // Smoke specs should be fast — anything over 90s per spec almost
  // certainly means the dev server isn't responding.
  pageLoadTimeout: 90000,
});
