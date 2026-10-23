/**
 * Human-motion generation — the node half.
 *
 * ⛔ THIS IS A PORT. scripts/humanmotion.py is the canonical file; this one
 * exists only because the chromium-host sidecar is node and ui-eye is Python,
 * and the two runtimes cannot share a source file. Every formula, constant and
 * order of random draws here is identical to the Python, down to the PRNG, so
 * `scripts/motion-equivalence.sh` can seed both and diff the output exactly.
 * ⇒ CHANGE ONE, CHANGE BOTH, AND RUN THAT SCRIPT. A divergence here does not
 * fail anything at runtime; it just makes one lane move differently from the
 * other, which is the failure nobody notices.
 *
 * Model: sigma-lognormal velocity primitives (Plamondon), a ballistic stroke
 * plus 0-2 corrective sub-movements, Ornstein-Uhlenbeck lateral drift,
 * signal-dependent noise (Harris & Wolpert), speed-suppressed 8-12Hz tremor,
 * gamma-spaced sample timing. See the Python file's header for why, and for
 * the measured comparison against WindMouse.
 */

const TAU = 2.0 * Math.PI;

const DEFAULTS = {
  fittsA: 50.0,
  fittsB: 150.0,
  targetWidth: 20.0,

  undershootMin: 0.92,
  undershootMax: 0.97,
  peakTimeRatio: 0.35,
  primarySigmaMin: 0.18,
  primarySigmaMax: 0.28,

  overshootProb: 0.15,
  overshootMin: 1.02,
  overshootMax: 1.08,
  correctionSigmaMin: 0.12,
  correctionSigmaMax: 0.20,
  secondCorrectionProb: 0.25,

  curvatureScale: 0.025,

  ouTheta: 3.5,
  ouSigma: 1.2,

  tremorFreqMin: 8.0,
  tremorFreqMax: 12.0,
  tremorAmpMin: 0.15,
  tremorAmpMax: 0.55,

  sdnK: 0.04,

  sampleDtMean: 7.8,
  gammaShape: 3.5,

  prePressMin: 80.0,
  prePressMax: 220.0,
  dwellMin: 50.0,
  dwellMax: 130.0,
  wpm: 52.0,
  keySigma: 0.33,
  wordPauseMin: 60.0,
  wordPauseMax: 220.0,
  hesitateProb: 0.04,
  hesitateMin: 260.0,
  hesitateMax: 900.0,

  typoProb: 0.018,
  typoLateProb: 0.35,
  typoLateMax: 3,
  noticeMin: 90.0,
  noticeMax: 420.0,
  backspaceMin: 55.0,
  backspaceMax: 145.0,
  resumeMin: 40.0,
  resumeMax: 180.0,

  scrollKeyProb: 0.3,
  scrollOvershootProb: 0.22,
  scrollOvershootMax: 4,
  scrollPauseProb: 0.3,
  scrollPauseMin: 350.0,
  scrollPauseMax: 1600.0,
};

// Physically adjacent keys on a US QWERTY board. A typo is a finger landing one
// key off, so a random letter is the wrong model — it produces mistakes no hand
// makes. Must stay identical to _NEIGHBOURS in humanmotion.py.
const NEIGHBOURS = {
  q: "wa", w: "qeas", e: "wrsd", r: "etdf", t: "ryfg", y: "tugh",
  u: "yihj", i: "uojk", o: "ipkl", p: "ol",
  a: "qwsz", s: "awedxz", d: "serfcx", f: "drtgvc", g: "ftyhbv",
  h: "gyujnb", j: "huikmn", k: "jiolm", l: "kop",
  z: "asx", x: "zsdc", c: "xdfv", v: "cfgb", b: "vghn",
  n: "bhjm", m: "njk",
  1: "2q", 2: "13w", 3: "24e", 4: "35r", 5: "46t", 6: "57y",
  7: "68u", 8: "79i", 9: "80o", 0: "9p",
};

function slip(ch, rng) {
  const near = NEIGHBOURS[ch.toLowerCase()];
  if (!near) return null;
  const wrong = near[rng.randint(0, near.length - 1)];
  return ch !== ch.toLowerCase() ? wrong.toUpperCase() : wrong;
}

/** mulberry32 — see the Python Rng docstring for why it is not Math.random. */
class Rng {
  constructor(seed) {
    this.s = (seed === undefined || seed === null
      ? (Math.random() * 4294967296) >>> 0
      : seed) >>> 0;
  }

  random() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  }

  uniform(lo, hi) {
    return lo + (hi - lo) * this.random();
  }

  randint(lo, hi) {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  gauss(mu, sigma) {
    const u1 = Math.max(this.random(), 1e-12);
    const u2 = this.random();
    return mu + sigma * Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(TAU * u2);
  }

  gammavariate(shape, scale) {
    const d = shape - 1.0 / 3.0;
    const c = 1.0 / Math.sqrt(9.0 * d);
    for (;;) {
      const x = this.gauss(0.0, 1.0);
      const v = Math.pow(1.0 + c * x, 3);
      if (v <= 0.0) continue;
      const u = this.random();
      if (u < 1.0 - 0.0331 * x * x * x * x) return d * v * scale;
      if (Math.log(Math.max(u, 1e-300)) < 0.5 * x * x + d * (1.0 - v + Math.log(v)))
        return d * v * scale;
    }
  }
}

function normalCdf(z) {
  // erf via Abramowitz & Stegun 7.1.26 — node has no Math.erf, and Python's
  // math.erf agrees with this to well under a float's worth of pixel.
  const s = z < 0 ? -1 : 1;
  const a = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + 0.3275911 * a);
  const y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1.0 + s * y);
}

function lognormalCdf(t, t0, mu, sigma) {
  if (t <= t0) return 0.0;
  return normalCdf((Math.log(t - t0) - mu) / sigma);
}

function lognormalPdf(t, t0, mu, sigma) {
  if (t <= t0) return 0.0;
  const dt = t - t0;
  const z = (Math.log(dt) - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(TAU) * dt);
}

function curvatureProfile(s) {
  if (s <= 0.0 || s >= 1.0) return 0.0;
  const norm = 0.4 * 0.4 * 0.6 * 0.6 * 0.6;
  return (s * s * Math.pow(1.0 - s, 3)) / norm;
}

function directionFactor(angle) {
  return 0.5 + 0.8 * Math.abs(Math.sin(angle)) - 0.15 * Math.abs(Math.cos(angle));
}

/** Trajectory from (x0,y0) to (x1,y1). Samples carry their own timestamps. */
function path(x0, y0, x1, y1, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts.cfg || {});
  const rng = opts.rng || new Rng();
  const width = opts.targetWidth != null ? opts.targetWidth : cfg.targetWidth;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);
  if (distance < 1.0) return [{ x: x0, y: y0, t: 0.0 }, { x: x1, y: y1, t: 50.0 }];

  const direction = Math.atan2(dy, dx);
  const tx = dx / distance;
  const ty = dy / distance;
  const nx = -ty;
  const ny = tx;

  const id = Math.log2(distance / Math.max(width, 1.0) + 1.0);
  let mt = (cfg.fittsA + cfg.fittsB * id) * Math.exp(rng.gauss(0.0, 0.08));
  mt = Math.max(mt, 80.0);

  const reach = rng.random() < cfg.overshootProb
    ? rng.uniform(cfg.overshootMin, cfg.overshootMax)
    : rng.uniform(cfg.undershootMin, cfg.undershootMax);

  const primaryD = distance * reach;
  const primarySigma = rng.uniform(cfg.primarySigmaMin, cfg.primarySigmaMax);
  const peakT = mt * rng.uniform(cfg.peakTimeRatio - 0.03, cfg.peakTimeRatio + 0.03);
  const primaryMu = Math.log(peakT) + primarySigma * primarySigma;

  const corrections = [];
  const remaining = distance - primaryD;
  if (Math.abs(remaining) > 0.5) {
    const sign = remaining > 0.0 ? 1.0 : -1.0;
    const cD = Math.abs(remaining) * rng.uniform(0.88, 1.02);
    const cSigma = rng.uniform(cfg.correctionSigmaMin, cfg.correctionSigmaMax);
    const cPeak = mt * rng.uniform(0.12, 0.18);
    corrections.push({
      D: cD, t0: mt * rng.uniform(0.55, 0.68),
      mu: Math.log(cPeak) + cSigma * cSigma, sigma: cSigma,
      dx: tx * sign, dy: ty * sign,
    });

    const left = remaining - cD * sign;
    if (Math.abs(left) > 0.3 && rng.random() < cfg.secondCorrectionProb) {
      const sign2 = left > 0.0 ? 1.0 : -1.0;
      const c2D = Math.abs(left) * rng.uniform(0.85, 1.05);
      const c2Sigma = rng.uniform(0.10, 0.16);
      const c2Peak = mt * rng.uniform(0.08, 0.12);
      corrections.push({
        D: c2D, t0: mt * rng.uniform(0.78, 0.88),
        mu: Math.log(c2Peak) + c2Sigma * c2Sigma, sigma: c2Sigma,
        dx: tx * sign2, dy: ty * sign2,
      });
    }
  }

  const curvAmp = distance * cfg.curvatureScale * directionFactor(direction) * rng.gauss(0.0, 1.0);

  const tremorFreq = rng.uniform(cfg.tremorFreqMin, cfg.tremorFreqMax);
  const tremorAmp = rng.uniform(cfg.tremorAmpMin, cfg.tremorAmpMax);
  const phaseX = rng.uniform(0.0, TAU);
  const phaseY = rng.uniform(0.0, TAU);
  let ouX = 0.0;
  let ouY = 0.0;

  const totalT = mt * 1.03;
  const gScale = cfg.sampleDtMean / cfg.gammaShape;
  const times = [0.0];
  let t = 0.0;
  while (t < totalT) {
    t += Math.min(25.0, Math.max(2.0, rng.gammavariate(cfg.gammaShape, gScale)));
    times.push(t);
  }

  const out = [];
  for (let i = 0; i < times.length; i++) {
    const tt = times[i];
    const dtS = (i ? tt - times[i - 1] : cfg.sampleDtMean) / 1000.0;

    const s = lognormalCdf(tt, 0.0, primaryMu, primarySigma);
    let bx = x0 + tx * primaryD * s;
    let by = y0 + ty * primaryD * s;

    const bow = curvAmp * curvatureProfile(s);
    bx += nx * bow;
    by += ny * bow;

    let speed = primaryD * lognormalPdf(tt, 0.0, primaryMu, primarySigma);
    for (const c of corrections) {
      const cs = lognormalCdf(tt, c.t0, c.mu, c.sigma);
      bx += c.dx * c.D * cs;
      by += c.dy * c.D * cs;
      speed += c.D * lognormalPdf(tt, c.t0, c.mu, c.sigma);
    }

    ouX += -cfg.ouTheta * ouX * dtS + cfg.ouSigma * Math.sqrt(dtS) * rng.gauss(0.0, 1.0);
    ouY += -cfg.ouTheta * ouY * dtS + cfg.ouSigma * Math.sqrt(dtS) * rng.gauss(0.0, 1.0);

    const trem = 1.0 / (1.0 + speed * 0.3);
    const tS = tt / 1000.0;
    const trX = tremorAmp * trem * Math.sin(TAU * tremorFreq * tS + phaseX);
    const trY = tremorAmp * trem * Math.sin(TAU * tremorFreq * tS + phaseY);

    const sdnX = cfg.sdnK * speed * rng.gauss(0.0, 1.0);
    const sdnY = cfg.sdnK * speed * rng.gauss(0.0, 1.0);

    out.push({ x: bx + ouX + trX + sdnX, y: by + ouY + trY + sdnY, t: tt });
  }

  out.push({ x: x1, y: y1, t: out[out.length - 1].t + rng.uniform(8.0, 22.0) });
  return out;
}

/** `path`, rounded to whole pixels, each step carrying the seconds to wait after it. */
function steps(x0, y0, x1, y1, opts = {}) {
  const pts = path(x0, y0, x1, y1, opts);
  const out = [];
  let last = [Math.round(x0), Math.round(y0)];
  for (let i = 0; i < pts.length; i++) {
    const px = Math.round(pts[i].x);
    const py = Math.round(pts[i].y);
    const dt = i ? pts[i].t - pts[i - 1].t : 0.0;
    if (px === last[0] && py === last[1] && i < pts.length - 1) continue;
    last = [px, py];
    out.push([px, py, Math.max(dt, 1.0) / 1000.0]);
  }
  return out;
}

function settle(x, y, rng) {
  rng = rng || new Rng();
  const out = [];
  const n = rng.randint(1, 2);
  for (let i = 0; i < n; i++) {
    out.push([x + rng.randint(-1, 1), y + rng.randint(-1, 1), rng.uniform(0.02, 0.05)]);
  }
  out.push([x, y, rng.uniform(0.01, 0.03)]);
  return out;
}

/** [secondsToWaitBeforePressing, secondsToHold] */
function pressTiming(cfg, rng) {
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  rng = rng || new Rng();
  return [
    rng.uniform(cfg.prePressMin, cfg.prePressMax) / 1000.0,
    rng.uniform(cfg.dwellMin, cfg.dwellMax) / 1000.0,
  ];
}

/** [[char, secondsToWaitBeforeTypingIt], ...] */
function keyDelays(text, cfg, rng) {
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  rng = rng || new Rng();
  const base = 60000.0 / (cfg.wpm * 5.0);
  const out = [];
  let prev = "";
  for (const ch of text) {
    let d = base * Math.exp(rng.gauss(0.0, cfg.keySigma));
    if (prev === " " || prev === "\t") d += rng.uniform(cfg.wordPauseMin, cfg.wordPauseMax);
    if (".,!?;:".includes(prev) && prev !== "") d += rng.uniform(cfg.wordPauseMin, cfg.wordPauseMax) * 1.5;
    if (ch !== ch.toLowerCase() || '!@#$%^&*()_+{}|:"<>?'.includes(ch)) d += rng.uniform(20.0, 70.0);
    if (rng.random() < cfg.hesitateProb) d += rng.uniform(cfg.hesitateMin, cfg.hesitateMax);
    out.push([ch, d / 1000.0]);
    prev = ch;
  }
  return out;
}

/**
 * A keystroke program: [{op:"key",char,delay} | {op:"backspace",delay}, ...].
 * ⛔ sensitive=true produces NO typos — a wrong character in a password, a card
 * number, an amount or a quantity is a real error rather than realism.
 * Must stay identical to type_program in humanmotion.py.
 */
function typeProgram(text, cfg, rng, sensitive = false) {
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  rng = rng || new Rng();
  const base = 60000.0 / (cfg.wpm * 5.0);
  const ops = [];
  let prev = "";

  const gap = (ch) => {
    let d = base * Math.exp(rng.gauss(0.0, cfg.keySigma));
    if (prev === " " || prev === "\t") d += rng.uniform(cfg.wordPauseMin, cfg.wordPauseMax);
    if (prev !== "" && ".,!?;:".includes(prev)) d += rng.uniform(cfg.wordPauseMin, cfg.wordPauseMax) * 1.5;
    if (ch !== ch.toLowerCase() || '!@#$%^&*()_+{}|:"<>?'.includes(ch)) d += rng.uniform(20.0, 70.0);
    if (rng.random() < cfg.hesitateProb) d += rng.uniform(cfg.hesitateMin, cfg.hesitateMax);
    return d / 1000.0;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const wrong = sensitive ? null : slip(ch, rng);
    if (wrong !== null && rng.random() < cfg.typoProb) {
      ops.push({ op: "key", char: wrong, delay: gap(ch) });
      prev = wrong;
      let extra = 0;
      if (rng.random() < cfg.typoLateProb) {
        extra = rng.randint(1, cfg.typoLateMax);
        for (let k = 0; k < extra; k++) {
          if (i + 1 + k >= text.length) { extra = k; break; }
          const nxt = text[i + 1 + k];
          ops.push({ op: "key", char: nxt, delay: gap(nxt) });
          prev = nxt;
        }
      }
      ops.push({ op: "backspace", delay: rng.uniform(cfg.noticeMin, cfg.noticeMax) / 1000.0 });
      for (let k = 0; k < extra; k++) {
        ops.push({ op: "backspace", delay: rng.uniform(cfg.backspaceMin, cfg.backspaceMax) / 1000.0 });
      }
      ops.push({ op: "key", char: ch, delay: rng.uniform(cfg.resumeMin, cfg.resumeMax) / 1000.0 });
      prev = ch;
      i += 1;
      continue;
    }
    ops.push({ op: "key", char: ch, delay: gap(ch) });
    prev = ch;
    i += 1;
  }
  return ops;
}

/**
 * How to deliver a scroll, mixing wheel, arrow keys, pauses and an occasional
 * overshoot-and-return. Must stay identical to scroll_plan in humanmotion.py.
 */
function scrollPlan(notches, cfg, rng) {
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  rng = rng || new Rng();
  if (notches === 0) return [];
  const sign = notches > 0 ? 1 : -1;
  const target = Math.abs(notches);

  let overshoot = 0;
  if (target > 3 && rng.random() < cfg.scrollOvershootProb) {
    overshoot = rng.randint(1, cfg.scrollOvershootMax);
  }

  const ops = [];
  let left = target + overshoot;
  while (left > 0) {
    const n = Math.min(left, rng.randint(2, 5));
    left -= n;
    if (rng.random() < cfg.scrollKeyProb) {
      ops.push({ op: "key", key: sign > 0 ? "Up" : "Down",
                 repeat: n * rng.randint(2, 3), delay: rng.uniform(0.05, 0.16) });
    } else {
      ops.push({ op: "wheel", notches: n * sign, delay: rng.uniform(0.04, 0.14) });
    }
    if (left > 0 && rng.random() < cfg.scrollPauseProb) {
      ops.push({ op: "pause", delay: rng.uniform(cfg.scrollPauseMin, cfg.scrollPauseMax) / 1000.0 });
    }
  }

  if (overshoot) {
    ops.push({ op: "pause", delay: rng.uniform(0.12, 0.45) });
    let back = 0;
    while (back < overshoot) {
      const n = Math.min(overshoot - back, rng.randint(1, 3));
      back += n;
      ops.push({ op: "wheel", notches: -n * sign, delay: rng.uniform(0.05, 0.15) });
    }
  }
  return ops;
}

/** [[notchesThisBurst, secondsToWaitAfterIt], ...] */
function scrollBursts(notches, rng) {
  rng = rng || new Rng();
  const total = Math.abs(notches);
  let left = total;
  const out = [];
  while (left > 0) {
    const n = Math.min(left, rng.randint(2, 5));
    left -= n;
    const gap = rng.uniform(0.04, 0.12) * (1.0 + 0.6 * (1.0 - left / Math.max(total, 1)));
    out.push([n, gap]);
  }
  return out;
}

function measure(pts, targetX, targetY, targetWidth = 20.0) {
  if (pts.length < 2) return {};
  const straight = Math.hypot(targetX - pts[0].x, targetY - pts[0].y);
  let length = 0.0;
  const speeds = new Array(pts.length).fill(0);
  let peak = 0.0;
  let timeToPeak = 0.0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const dt = pts[i].t - pts[i - 1].t;
    length += seg;
    speeds[i] = dt > 0 ? seg / dt : 0.0;
    if (speeds[i] > peak) { peak = speeds[i]; timeToPeak = pts[i].t; }
  }
  const thresh = peak * 0.15;
  let sub = 0;
  for (let i = 2; i < speeds.length - 1; i++) {
    if (speeds[i] > thresh && speeds[i] > speeds[i - 1] && speeds[i] > speeds[i + 1]) sub++;
  }
  return {
    movement_time_ms: pts[pts.length - 1].t - pts[0].t,
    samples: pts.length,
    path_length: length,
    straight_distance: straight,
    path_efficiency: length ? straight / length : 1.0,
    peak_speed_px_per_ms: peak,
    time_to_peak_ms: timeToPeak,
    submovements: Math.max(sub, 1),
    endpoint_error_px: Math.hypot(pts[pts.length - 1].x - targetX, pts[pts.length - 1].y - targetY),
  };
}

// --------------------------------------------------------------------------- //
// xdotool chains — what the chromium-host sidecar actually runs
// --------------------------------------------------------------------------- //

const f3 = (n) => n.toFixed(3);

/** Travel to (x,y) from (fromX,fromY), ending with the settle correction. */
function moveChain(fromX, fromY, x, y, opts = {}) {
  const rng = opts.rng || new Rng();
  const chain = [];
  for (const [px, py, dt] of steps(fromX, fromY, x, y, { rng, targetWidth: opts.targetWidth })) {
    chain.push("mousemove", String(px), String(py), "sleep", f3(dt));
  }
  if (opts.settle !== false) {
    for (const [px, py, dt] of settle(x, y, rng)) {
      chain.push("mousemove", String(px), String(py), "sleep", f3(dt));
    }
  }
  return chain;
}

function clickChain(fromX, fromY, x, y, opts = {}) {
  const rng = opts.rng || new Rng();
  const button = String(opts.button || 1);
  const [pre, dwell] = pressTiming(opts.cfg, rng);
  const chain = moveChain(fromX, fromY, x, y, Object.assign({}, opts, { rng }));
  chain.push("sleep", f3(pre), "mousedown", button, "sleep", f3(dwell), "mouseup", button);
  return chain;
}

function scrollChain(notches, opts = {}) {
  const rng = opts.rng || new Rng();
  const button = notches > 0 ? "4" : "5";
  const chain = [];
  for (const [n, gap] of scrollBursts(notches, rng)) {
    for (let i = 0; i < n; i++) {
      chain.push("click", button, "sleep", f3(rng.uniform(0.012, 0.035)));
    }
    chain.push("sleep", f3(gap));
  }
  return chain;
}

/**
 * Typing CANNOT be one chain: `xdotool type` swallows the rest of an argv chain
 * (measured 2026-10-23 — the literal chain text landed in the field). Returns a
 * list of separate invocations instead, each with its own gap.
 */
function typeRuns(text, opts = {}) {
  const rng = opts.rng || new Rng();
  const delays = keyDelays(text, opts.cfg, rng);
  const runs = [];
  let i = 0;
  while (i < delays.length) {
    const n = rng.randint(2, 5);
    const chunk = delays.slice(i, i + n);
    i += n;
    const run = chunk.map(([c]) => c).join("");
    const perKey = chunk.reduce((a, [, d]) => a + d, 0) / chunk.length;
    runs.push({
      args: ["type", "--clearmodifiers", "--delay", String(Math.max(20, Math.round(perKey * 1000))), "--", run],
      gapSeconds: i < delays.length ? delays[i][1] : 0,
    });
  }
  return runs;
}

export {
  Rng, DEFAULTS, path, steps, settle, pressTiming, keyDelays, scrollBursts, measure,
  moveChain, clickChain, scrollChain, typeRuns, typeProgram, scrollPlan, slip,
};

// `node humanmotion.js ...` runs the bench/emit; importing it does not.
if (import.meta.url === `file://${process.argv[1]}`) {
  // `emit <seed> <x0> <y0> <x1> <y1> <width>` — the equivalence check's other half.
  const a = process.argv.slice(2);
  if (a[0] === "emit") {
    const rng = new Rng(parseInt(a[1], 10));
    const st = steps(+a[2], +a[3], +a[4], +a[5], { rng, targetWidth: a[6] ? +a[6] : 20.0 });
    console.log(JSON.stringify(st.map(([x, y, dt]) => [x, y, Math.round(dt * 1e6) / 1e6])));
    process.exit(0);
  }
  if (a[0] === "emit-type") {
    const ops = typeProgram(a[2], null, new Rng(parseInt(a[1], 10)), a[3] === "sensitive");
    console.log(JSON.stringify(ops.map((o) => [o.op, o.char || "", Math.round(o.delay * 1e6) / 1e6])));
    process.exit(0);
  }
  if (a[0] === "emit-scroll") {
    const ops = scrollPlan(parseInt(a[2], 10), null, new Rng(parseInt(a[1], 10)));
    console.log(JSON.stringify(ops.map((o) => [o.op, o.notches ?? o.repeat ?? 0, o.key || "", Math.round(o.delay * 1e6) / 1e6])));
    process.exit(0);
  }
  const dist = a[0] ? +a[0] : 630.0;
  const width = a[1] ? +a[1] : 20.0;
  const n = 40;
  const acc = {};
  for (let i = 0; i < n; i++) {
    const m = measure(path(0, 0, dist, 0, { targetWidth: width }), dist, 0, width);
    for (const k of ["movement_time_ms", "submovements", "path_efficiency", "endpoint_error_px", "samples"]) {
      acc[k] = (acc[k] || 0) + m[k] / n;
    }
  }
  for (const k of Object.keys(acc)) acc[k] = Math.round(acc[k] * 1000) / 1000;
  console.log(JSON.stringify({ "sigma-lognormal": acc }, null, 2));
}
