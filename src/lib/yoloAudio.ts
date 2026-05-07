// Web Audio synthesis for the YOLO spinner. Procedural tick + jackpot
// chime — no asset files to host or attribute, no licensing, no load delay.
// AudioContext is lazy-created so it only runs after the first user
// interaction (browser autoplay policy).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Some browsers leave the context in 'suspended' state until a user gesture.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * One sharp click that drops in pitch over 50ms — matches the visual highlight
 * cycling. Pitch defaults to 800 Hz; we pass a slightly lower pitch on the
 * later (slower) ticks so it feels like a reel slowing down.
 */
export function playTick(pitchHz = 800, gain = 0.08): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(pitchHz, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(pitchHz * 0.5, c.currentTime + 0.05);
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.06);
}

/**
 * Six-note ascending arpeggio (C5–G5–C6 doubled) — cartoonish jackpot ding
 * that reads as celebration without being obnoxiously casino-loud.
 */
export function playJackpot(): void {
  const c = getCtx();
  if (!c) return;
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const t0 = c.currentTime + i * 0.08;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.15, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.42);
  });
}
