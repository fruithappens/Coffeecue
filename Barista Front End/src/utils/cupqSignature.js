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
// v2, ~2.4 seconds: Steve heard v1 through the QR page and asked for
// "much longer maybe a bit fanfare" -- so the pour grew into a five-
// note run, a major chord lands under it, and the top lifts an octave
// for the ta-da. Same DNA (drop first, steam last), bigger payoff.
// All mid-high frequencies, so it carries on a phone speaker in a
// noisy room.
//
// Pure WebAudio, no samples: nothing to load, nothing to license, and
// it plays from a context the caller already unlocked (iOS rules --
// see useReadyChime for the context-lifecycle scars).

export default function playCupQSignature(ctx, master = 0.9) {
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = master;
  out.connect(ctx.destination);

  // one voice: warm triangle doubled by a detuned sine
  const note = (hz, at, len, peak) => {
    [['triangle', 0, peak], ['sine', 6, peak * 0.38]].forEach(([type, cents, p]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = hz;
      if (osc.detune) osc.detune.value = cents;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(p, t0 + at + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      osc.connect(g); g.connect(out);
      osc.start(t0 + at); osc.stop(t0 + at + len + 0.02);
    });
  };

  // --- 1. two drops: blub-blub ---------------------------------------
  [[0.0, 320, 170], [0.16, 360, 200]].forEach(([at, f1, f2]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f1, t0 + at);
    osc.frequency.exponentialRampToValueAtTime(f2, t0 + at + 0.11);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.13);
    osc.connect(g); g.connect(out);
    osc.start(t0 + at); osc.stop(t0 + at + 0.15);
  });

  // --- 2. the pour: a five-note run up A-major pentatonic ------------
  // E5  F#5  A5  B5  C#6 -- swung and slightly accelerating, the sound
  // of a level being climbed.
  const run = [[659.3, 0.36], [740.0, 0.52], [880.0, 0.66], [987.8, 0.78], [1108.7, 0.88]];
  run.forEach(([hz, at]) => note(hz, at, 0.22, 0.22));

  // --- 3. the fanfare chord: A major lands ---------------------------
  // Root pad + triad hit together at the top of the climb.
  {
    const at = 1.02;
    // low warmth so the chord has a floor (quiet -- phone speakers
    // barely render it, bigger speakers feel it)
    note(220.0, at, 0.85, 0.10);
    [880.0, 1108.7, 1318.5].forEach((hz) => note(hz, at, 0.55, 0.20));
  }

  // --- 4. the "Q": the octave ta-da ----------------------------------
  // E6 holds, then LIFTS to A6 with vibrato -- the flourish.
  {
    const at = 1.30;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1318.5, t0 + at);
    osc.frequency.setValueAtTime(1318.5, t0 + at + 0.22);
    osc.frequency.exponentialRampToValueAtTime(1760.0, t0 + at + 0.30);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 6;
    lfoGain.gain.value = 9;
    lfo.connect(lfoGain);
    if (osc.frequency) lfoGain.connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.30, t0 + at + 0.02);
    g.gain.setValueAtTime(0.30, t0 + at + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.00);
    osc.connect(g); g.connect(out);
    osc.start(t0 + at); osc.stop(t0 + at + 1.05);
    lfo.start(t0 + at); lfo.stop(t0 + at + 1.05);

    const shimmer = ctx.createOscillator();
    const sg = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(2637, t0 + at);
    shimmer.frequency.exponentialRampToValueAtTime(3520, t0 + at + 0.30);
    sg.gain.setValueAtTime(0.0001, t0 + at);
    sg.gain.exponentialRampToValueAtTime(0.05, t0 + at + 0.04);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.80);
    shimmer.connect(sg); sg.connect(out);
    shimmer.start(t0 + at); shimmer.stop(t0 + at + 0.85);
  }

  // --- 5. the steam ---------------------------------------------------
  try {
    const dur = 0.5;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 1.55);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 1.62);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.05);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t0 + 1.55); src.stop(t0 + 2.08);
  } catch (e) { /* the steam is garnish; the motif stands without it */ }
}
