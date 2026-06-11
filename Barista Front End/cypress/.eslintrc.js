// Lint config for the cypress/ tree only.
//
// Cypress globals (cy, Cypress, describe, it, before, beforeEach,
// expect) aren't visible to the project's main eslint config. This
// file scopes a narrow override to the cypress directory so the smoke
// spec doesn't trip 'no-undef' on standard Cypress identifiers.
//
// Not pulling in eslint-plugin-cypress because we want zero extra
// devDeps just for linting; declaring the globals + turning off the
// rule on this tree is enough.

module.exports = {
  env: {
    mocha: true,
    node: true,
  },
  globals: {
    cy: 'readonly',
    Cypress: 'readonly',
    expect: 'readonly',
    assert: 'readonly',
  },
  rules: {
    'no-undef': 'off',
  },
};
