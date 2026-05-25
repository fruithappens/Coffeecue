// utils/consoleSilencer.js
//
// Production-only no-op for console.log / .debug / .info / .trace.
// Imported once at app boot (src/index.js).
//
// Why this exists
// ---------------
// We currently have ~700 console.log calls in the React app that
// were useful during development but ship to production bundles. They:
//   - leak internal field names + IDs to anyone with DevTools open
//   - clutter operators' / customers' consoles
//   - slow down hot paths trivially (e.g. console.log inside the
//     order-list filter that runs every render)
//
// Why not babel-plugin-transform-remove-console?
// ---------------------------------------------
// We're on Create React App (react-scripts 5). Adding a babel plugin
// requires CRACO or eject — both add complexity. This file is the
// pragmatic 5-line alternative: silence at runtime in production,
// behave exactly as before in dev.
//
// console.warn and console.error are PRESERVED — real problems still
// surface. Operators staring at production DevTools should see the
// red/yellow stuff, just not the firehose of debug noise.
//
// To restore noise temporarily in production (e.g. debugging a
// reported issue without redeploying), open DevTools and run:
//   window.__expressoEnableConsole()
// — that puts the real console.log etc. back for the current session.

const _isProd = process.env.NODE_ENV === 'production';

if (_isProd && typeof window !== 'undefined') {
  const _real = {
    log:   console.log,
    debug: console.debug,
    info:  console.info,
    trace: console.trace,
  };
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const _noop = () => { /* intentional no-op for production console silencing */ };
  console.log = _noop;
  console.debug = _noop;
  console.info = _noop;
  console.trace = _noop;

  // Escape hatch — restore the original console functions on demand
  // without a redeploy. Useful when debugging a customer-reported
  // issue against a production build.
  window.__expressoEnableConsole = () => {
    console.log = _real.log;
    console.debug = _real.debug;
    console.info = _real.info;
    console.trace = _real.trace;
    console.log('[expresso] verbose console restored for this session.');
  };
}
