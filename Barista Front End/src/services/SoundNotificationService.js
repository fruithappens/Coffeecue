// SoundNotificationService.js
//
// The barista settings panel has had a "play sound on new order"
// toggle for ages, plus a row of "Test" buttons that call
// `window.coffeeSounds.play(...)`. But `window.coffeeSounds` was
// never initialised — so the toggle did nothing and the Test buttons
// only worked via their fallback `new Audio(...)` path. That's why
// Steve reported "sounds in barista station settings not working".
//
// This service:
//   1. Installs `window.coffeeSounds` so the existing buttons fire.
//   2. Listens for `app:newOrder` (already dispatched by useOrders
//      when it detects new pending orders) and plays the new-order
//      chime if `settings.soundEnabled` is true.
//   3. Listens for `order_updated` events with status === 'completed'
//      and plays an order-complete chime — handy for the customer
//      display.
//
// Sounds are short base64 WAVs (same data the inline preview
// buttons use). Keeping them inline means zero asset-loading +
// works offline + survives the worktree shuffle.
//
// Imported once in App.js — init() is idempotent.

// Short ascending chime — used for new pending orders.
const SOUND_NEW_ORDER = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhCEGdyfPo';

// Same pitch, slight tail variation — used for "complete" so the
// barista can tell them apart over background noise.
const SOUND_COMPLETE = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhCEGdyfPg';

const SOUND_PICKUP = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhCEGdyfPl';

const SOUNDS = {
  newOrder:      SOUND_NEW_ORDER,
  orderComplete: SOUND_COMPLETE,
  orderPickedUp: SOUND_PICKUP,
  // Aliases the existing UI uses interchangeably.
  complete:      SOUND_COMPLETE,
  pickup:        SOUND_PICKUP,
};

class SoundNotificationService {
  constructor() {
    this._initialised = false;
    // Throttle so a flurry of WebSocket updates doesn't trigger
    // 30 chimes in two seconds.
    this._lastPlayed = new Map(); // sound key → timestamp
    this._minIntervalMs = 1500;
  }

  // Read the current toggle state. The settings hook stores its
  // blob in `coffee_system_settings` (see SettingsService); reading
  // straight from localStorage means we don't need a React subscription.
  _isEnabled() {
    try {
      const raw = localStorage.getItem('coffee_system_settings');
      if (!raw) return true;  // default ON if settings not yet saved
      const parsed = JSON.parse(raw);
      // Several different layouts exist in the wild — check all of them.
      const enabled = parsed.soundEnabled
                   ?? parsed?.settings?.soundEnabled
                   ?? parsed?.notifications?.soundEnabled;
      return enabled !== false;
    } catch (e) {
      return true;  // fail open
    }
  }

  _getVolume() {
    try {
      const raw = localStorage.getItem('coffee_system_settings');
      if (!raw) return 0.7;
      const parsed = JSON.parse(raw);
      const vol = parsed.soundVolume ?? parsed?.settings?.soundVolume ?? 70;
      return Math.max(0, Math.min(1, vol / 100));
    } catch (e) {
      return 0.7;
    }
  }

  // The window.coffeeSounds API the existing settings UI was
  // already calling. options.volume overrides the saved volume so
  // the "Test" buttons can still preview at their slider's value.
  play(soundKey, options = {}) {
    const src = SOUNDS[soundKey];
    if (!src) {
      console.warn(`SoundNotificationService: unknown sound "${soundKey}"`);
      return;
    }
    // Throttle.
    const now = Date.now();
    const last = this._lastPlayed.get(soundKey) || 0;
    if (!options.force && now - last < this._minIntervalMs) return;
    this._lastPlayed.set(soundKey, now);

    try {
      const audio = new Audio(src);
      audio.volume = options.volume != null ? options.volume : this._getVolume();
      audio.play().catch(err => {
        // Most common case: user hasn't interacted with the page yet
        // so the browser blocks autoplay. Harmless — they'll click
        // something soon and the next chime will go through.
        console.log('SoundNotificationService: audio.play blocked:', err.message);
      });
    } catch (e) {
      console.warn('SoundNotificationService: failed to play sound', e);
    }
  }

  init() {
    if (this._initialised) return;
    this._initialised = true;

    // Expose the API the existing settings panel + tests expect.
    if (typeof window !== 'undefined') {
      window.coffeeSounds = this;
    }

    // New pending order detected.
    window.addEventListener('app:newOrder', () => {
      if (!this._isEnabled()) return;
      this.play('newOrder');
    });

    // Order transitioned to completed — useful for both the barista
    // station (audible confirmation) and the customer display.
    window.addEventListener('order_updated', (e) => {
      if (!this._isEnabled()) return;
      try {
        const data = e?.detail;
        const status = data?.status || data?.order?.status;
        if (status === 'completed') this.play('orderComplete');
        else if (status === 'picked-up' || status === 'picked_up') {
          this.play('orderPickedUp');
        }
      } catch (err) {
        // ignore
      }
    });

    console.log('[SoundNotificationService] initialised — window.coffeeSounds is live');
  }
}

const soundService = new SoundNotificationService();
export default soundService;
