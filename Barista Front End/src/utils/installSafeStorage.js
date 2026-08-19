// Side-effect module: installs the localStorage guard the moment it is
// imported.
//
// Kept separate from safeStorage.js so index.js can `import` it rather
// than CALL it. ES module imports are hoisted, so a call placed between
// imports would not really run first — and it trips import/first, which
// Create React App promotes to a build error. A side-effect import runs
// at module-evaluation time, in order, which is exactly what is needed:
// the guard must be in place before App's module body reads storage.
import { installSafeStorage } from './safeStorage';

const shimmed = installSafeStorage();
if (shimmed) {
  // Worth saying out loud — it explains why nothing is remembered.
  console.warn('[coffee-cue] localStorage unavailable (embedded or private '
    + 'browsing) — using in-memory storage for this session.');
}

export default shimmed;
