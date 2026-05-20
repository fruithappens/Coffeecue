// SoundNotificationService.js
//
// Distinct chimes per event type — operator picks which sound goes
// with which alert from a library of synthesized presets. No asset
// files needed; everything's generated via the Web Audio API so
// there's nothing to download and it works offline.
//
// Events that play sounds:
//   - app:newOrder        → "new order" chime
//   - order_updated (completed/picked_up) → corresponding chime
//   - (extensible — add more event hooks below as needed)
//
// Operator UI lives in BaristaInterface Settings tab. Persisted in
// localStorage.coffee_cue_settings (the canonical settings store
// after the May 2026 consolidation) under `soundChoices`.
//
// History: the previous version had `window.coffeeSounds.play()`
// firing essentially identical base64 WAV blobs that differed only
// in the last 2 characters — they sounded the same. Steve flagged
// that there used to be more distinct sounds. This rewrite gives
// real differentiation via short synthesized melodies.

// ---- Sound library --------------------------------------------------------
// Each entry is a function that takes (audioCtx, baseTime, volume) and
// schedules its tones. Keep them short (<= 1 second) so the operator
// can use them frequently without fatigue.
//
// Adding a new sound? Just add another key here AND list it in
// SOUND_PRESETS so the picker shows it.

const _envelope = (gainNode, t0, attack, hold, release, peak) => {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
  g.setValueAtTime(Math.max(0.0001, peak), t0 + attack + hold);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
};

const _tone = (ctx, t0, freq, durationS, volume, type = 'sine') => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.connect(gain);
  gain.connect(ctx.destination);
  _envelope(gain, t0, 0.005, Math.max(0, durationS - 0.06), 0.05, volume);
  osc.start(t0);
  osc.stop(t0 + durationS + 0.06);
};

const SOUNDS = {
  // Bright ascending two-note — "something new just landed"
  chime_up: (ctx, t0, v) => {
    _tone(ctx, t0,        523.25, 0.16, v, 'sine');  // C5
    _tone(ctx, t0 + 0.13, 659.25, 0.20, v, 'sine');  // E5
  },
  // Descending two-note — "we're done with that one"
  chime_down: (ctx, t0, v) => {
    _tone(ctx, t0,        783.99, 0.14, v, 'sine');  // G5
    _tone(ctx, t0 + 0.11, 523.25, 0.20, v, 'sine');  // C5
  },
  // Soft single bell — "ready for collection"
  bell: (ctx, t0, v) => {
    _tone(ctx, t0,        880.00, 0.45, v * 0.8, 'sine');  // A5
    _tone(ctx, t0 + 0.01, 1318.51, 0.45, v * 0.3, 'sine'); // E6 — overtone
  },
  // Sharp triangle blip — "low stock" warning, urgent but not alarming
  warning_blip: (ctx, t0, v) => {
    _tone(ctx, t0,         440.00, 0.10, v, 'triangle');
    _tone(ctx, t0 + 0.15,  440.00, 0.10, v, 'triangle');
  },
  // Low buzzer — "something went wrong"
  error_buzz: (ctx, t0, v) => {
    _tone(ctx, t0, 165.00, 0.30, v, 'sawtooth');  // E3
  },
  // Three rising notes — celebratory "first order of the day" vibe
  fanfare: (ctx, t0, v) => {
    _tone(ctx, t0,        523.25, 0.10, v, 'triangle');  // C5
    _tone(ctx, t0 + 0.09, 659.25, 0.10, v, 'triangle');  // E5
    _tone(ctx, t0 + 0.18, 783.99, 0.18, v, 'triangle');  // G5
  },
  // Square-wave retro beep — "game-style" alert
  retro_beep: (ctx, t0, v) => {
    _tone(ctx, t0,        660.00, 0.06, v * 0.6, 'square');
    _tone(ctx, t0 + 0.07, 880.00, 0.10, v * 0.6, 'square');
  },
  // Two soft thumps — "muffled, won't disturb the next room"
  soft_knock: (ctx, t0, v) => {
    _tone(ctx, t0,        220.00, 0.06, v * 0.5, 'sine');
    _tone(ctx, t0 + 0.12, 220.00, 0.06, v * 0.5, 'sine');
  },
  // Silent — useful as a "this event makes no sound" option
  none: () => { /* no-op */ },
};

// Names that show up in the chooser, ordered for the dropdown.
export const SOUND_PRESETS = [
  { key: 'chime_up',     label: 'Chime up (default new order)' },
  { key: 'chime_down',   label: 'Chime down' },
  { key: 'bell',         label: 'Bell (single soft)' },
  { key: 'fanfare',      label: 'Fanfare (three rising notes)' },
  { key: 'soft_knock',   label: 'Soft knock' },
  { key: 'retro_beep',   label: 'Retro beep' },
  { key: 'warning_blip', label: 'Warning blip' },
  { key: 'error_buzz',   label: 'Error buzz' },
  { key: 'none',         label: 'No sound for this event' },
];

// Default assignment per alert type. Operator overrides via UI;
// stored under `soundChoices` in the settings blob.
export const DEFAULT_SOUND_CHOICES = {
  newOrder:      'chime_up',
  orderComplete: 'chime_down',
  orderPickedUp: 'bell',
  lowStock:      'warning_blip',
  error:         'error_buzz',
};

// ---- Service --------------------------------------------------------------

class SoundNotificationService {
  constructor() {
    this._initialised = false;
    this._lastPlayed = new Map();      // throttle map
    this._minIntervalMs = 1500;
    this._audioCtx = null;             // lazy
  }

  _ctx() {
    if (this._audioCtx) return this._audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._audioCtx = new AC();
      return this._audioCtx;
    } catch (e) {
      console.warn('SoundNotificationService: AudioContext unavailable:', e);
      return null;
    }
  }

  // Read settings from the canonical store. Returns a fully-merged
  // object so callers don't have to handle the partial-blob case.
  _readSettings() {
    try {
      const raw = localStorage.getItem('coffee_cue_settings');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  _isEnabled() {
    const s = this._readSettings();
    const enabled = s.soundEnabled ?? s?.settings?.soundEnabled
                ?? s?.notifications?.soundEnabled;
    return enabled !== false;  // default ON
  }

  _getVolume() {
    const s = this._readSettings();
    const vol = s.soundVolume ?? s?.settings?.soundVolume ?? 70;
    return Math.max(0, Math.min(1, vol / 100));
  }

  // Look up the operator's chosen sound key for a given event name.
  _resolveSoundKey(eventName) {
    const s = this._readSettings();
    const choices = { ...DEFAULT_SOUND_CHOICES, ...(s.soundChoices || {}) };
    return choices[eventName] || DEFAULT_SOUND_CHOICES[eventName] || 'chime_up';
  }

  /**
   * Play a sound. `eventName` is the semantic alert (newOrder,
   * orderComplete, …). `options.force` bypasses the throttle (useful
   * for preview-from-settings buttons).
   */
  play(eventName, options = {}) {
    if (!options.force && !this._isEnabled()) return;
    // Throttle per event so a burst doesn't overlap on top of itself.
    const now = Date.now();
    const last = this._lastPlayed.get(eventName) || 0;
    if (!options.force && now - last < this._minIntervalMs) return;
    this._lastPlayed.set(eventName, now);

    const ctx = this._ctx();
    if (!ctx) return;

    // Resume on user gesture chain — autoplay policies sometimes
    // leave the context suspended until the first click.
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* harmless */ }
    }

    const soundKey = options.soundKey || this._resolveSoundKey(eventName);
    const fn = SOUNDS[soundKey] || SOUNDS.chime_up;
    const volume = options.volume != null ? options.volume : this._getVolume();
    try {
      fn(ctx, ctx.currentTime + 0.01, volume);
    } catch (e) {
      console.warn('SoundNotificationService: synth failed:', e);
    }
  }

  // Preview a specific sound (used by the settings UI's [Test] buttons).
  preview(soundKey, volume) {
    this.play('__preview', { force: true, soundKey, volume });
  }

  init() {
    if (this._initialised) return;
    this._initialised = true;

    if (typeof window !== 'undefined') {
      // Backward-compat shim: existing settings panels and tests call
      // window.coffeeSounds.play('newOrder', {volume}).
      window.coffeeSounds = {
        play: (eventName, opts = {}) => {
          // The old API used 'orderComplete'/'orderPickedUp' as event
          // names; same map our internal event names use.
          this.play(eventName, opts);
        },
        preview: (key, vol) => this.preview(key, vol),
        listSounds: () => SOUND_PRESETS,
        defaults: () => ({ ...DEFAULT_SOUND_CHOICES }),
      };
    }

    // Hooks: window events emitted elsewhere in the app.
    window.addEventListener('app:newOrder', () => this.play('newOrder'));

    window.addEventListener('order_updated', (e) => {
      try {
        const status = e?.detail?.status || e?.detail?.order?.status;
        if (status === 'completed') this.play('orderComplete');
        else if (status === 'picked_up' || status === 'picked-up') {
          this.play('orderPickedUp');
        }
      } catch (_) { /* ignore */ }
    });

    // Stock alerts forwarded by WebSocketService.
    window.addEventListener('stock:alert', () => this.play('lowStock'));

    console.log('[SoundNotificationService] initialised — window.coffeeSounds active');
  }
}

const service = new SoundNotificationService();
export default service;
