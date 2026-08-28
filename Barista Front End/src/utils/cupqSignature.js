// The CupQ sound. One motif, everywhere a customer is told good news,
// so hearing it across a conference foyer eventually MEANS coffee.
//
// Steve: "lets do a gamafied sound that is unique to CupQ might even
// become synomis with the brand." A brand sound has to be ownable, not
// just pleasant -- generic two-beep chimes belong to every microwave.
// This one is built from what CupQ is:
//
//   1. THE DROP   -- a low sine "blub" bending downward, the sound of
//                    coffee dripping into a cup. No notification sound
//                    opens with a bubble; this is the fingerprint.
//   2. THE POUR   -- three quick notes rising through A major
//                    (E5, A5, C#6), lightly swung, each a warm triangle
//                    doubled by a detuned sine for sparkle. The classic
//                    "level-up" contour: reads as reward, not alarm.
//   3. THE "Q"    -- the landing note (E6) held a beat longer with a
//                    gentle vibrato and a faint octave shimmer -- the
//                    smile at the end of the jingle.
//   4. THE STEAM  -- a whisper of high-passed noise under the landing,
//                    like the last hiss off the milk wand. Felt more
//                    than heard.
//
// ~1.1 seconds end to end: long enough to be a motif, short enough to
// play forty times an hour without anyone hating it. All mid-high
// frequencies, so it carries on a phone speaker in a noisy room.
//
// Pure WebAudio, no samples: nothing to load, nothing to license, and
// it plays from a context the caller already unlocked (iOS rules --
// see useReadyChime for the context-lifecycle scars).

export default function playCupQSignature(ctx, master = 0.9) {
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = master;
  out.connect(ctx.destination);

  // --- 1. the drop ---------------------------------------------------
  {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t0);
    osc.frequency.exponentialRampToValueAtTime(170, t0 + 0.12);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.30, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(g); g.connect(out);
    osc.start(t0); osc.stop(t0 + 0.16);
  }

  // --- 2. the pour: E5 A5 C#6, lightly swung -------------------------
  const pour = [[659.3, 0.12], [880.0, 0.26], [1108.7, 0.42]];
  pour.forEach(([hz, at]) => {
    [['triangle', 0, 0.26], ['sine', 6, 0.10]].forEach(([type, cents, peak]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = hz;
      if (osc.detune) osc.detune.value = cents;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.24);
      osc.connect(g); g.connect(out);
      osc.start(t0 + at); osc.stop(t0 + at + 0.26);
    });
  });

  // --- 3. the "Q": E6, vibrato, octave shimmer -----------------------
  {
    const at = 0.58;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 1318.5;
    // gentle vibrato: 6 Hz, ±9 cents -- a voice, not a siren
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 6;
    lfoGain.gain.value = 7; // Hz of wobble
    lfo.connect(lfoGain);
    if (osc.frequency) lfoGain.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.30, t0 + at + 0.02);
    g.gain.setValueAtTime(0.30, t0 + at + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.52);
    osc.connect(g); g.connect(out);
    osc.start(t0 + at); osc.stop(t0 + at + 0.55);
    lfo.start(t0 + at); lfo.stop(t0 + at + 0.55);

    const shimmer = ctx.createOscillator();
    const sg = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.value = 2637;
    sg.gain.setValueAtTime(0.0001, t0 + at);
    sg.gain.exponentialRampToValueAtTime(0.05, t0 + at + 0.03);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.40);
    shimmer.connect(sg); sg.connect(out);
    shimmer.start(t0 + at); shimmer.stop(t0 + at + 0.42);
  }

  // --- 4. the steam --------------------------------------------------
  try {
    const dur = 0.30;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.60);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.64);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.90);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t0 + 0.60); src.stop(t0 + 0.92);
  } catch (e) { /* the steam is garnish; the motif stands without it */ }
}
