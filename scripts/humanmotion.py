"""Human-motion generation: trajectories, press timing, key timing, scroll bursts.

Pure stdlib, no I/O, no dependency on how the input is delivered. Two front ends
call it and must behave alike:

  * scripts/realinput.py  -- XTEST (xdotool) on the Linux chromium-host sidecars
  * ui-eye                -- CGEvent on the MacBook

Ben's requirement, #unibrowse 2026-10-23: "it needs to be mouse and keyboard
automation that's made to look realistic", and "they should research and emulate
human behavior through these".

The trajectory model is the sigma-lognormal / motor-synergy model described in
ck0i/SigmaDrift and its paper (https://zenodo.org/records/18872499), implemented
here from the described components rather than copied -- that repo ships no
licence. Its measured claim against WindMouse, which is why it is the model used:
movement time 827ms vs 499ms for a 630px reach at a 20px target (real humans
750-850ms), 2 sub-movements vs 15 (real humans 1-3), and Fitts compliance that
WindMouse does not have. WindMouse is kept below for comparison only.

Components, each from the motor-control literature:
  - sigma-lognormal velocity primitives (Plamondon's kinematic theory): the
    asymmetric bell-shaped speed profile a limb actually produces.
  - two-phase surge: one ballistic stroke covering ~92-97% of the distance, then
    0-2 corrective sub-movements.
  - Ornstein-Uhlenbeck lateral drift: mean-reverting hand wander.
  - signal-dependent noise (Harris & Wolpert 1998): noise scales with motor
    command, which is what makes Fitts's law emerge instead of being imposed.
  - 8-12Hz physiological tremor, suppressed while moving fast.
  - gamma-distributed sample spacing: real hardware does not poll on a metronome.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

SQRT2 = math.sqrt(2.0)
TAU = 2.0 * math.pi


class Rng:
    """mulberry32, and every distribution derived from it by hand.

    ⛔ NOT `random.Random`. The model exists twice — here and in humanmotion.js,
    because ui-eye is Python on the MacBook and the chromium-host sidecar is
    node — and two implementations that merely LOOK alike drift silently. This
    generator, Box-Muller for the normal and Marsaglia-Tsang for the gamma are
    byte-identical in both files, so the same seed produces the same trajectory
    in both and scripts/motion-equivalence.sh can prove it. Python's own
    `random.gauss` caches a spare deviate and `gammavariate` uses a different
    method entirely; either would make the two unfalsifiably different.
    """

    def __init__(self, seed: int | None = None):
        if seed is None:
            seed = random.getrandbits(32)
        self.s = seed & 0xFFFFFFFF

    def random(self) -> float:
        self.s = (self.s + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.s
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    def uniform(self, lo: float, hi: float) -> float:
        return lo + (hi - lo) * self.random()

    def randint(self, lo: int, hi: int) -> int:
        return lo + int(self.random() * (hi - lo + 1))

    def gauss(self, mu: float, sigma: float) -> float:
        """Box-Muller, keeping only z0 so both files consume the stream alike."""
        u1 = max(self.random(), 1e-12)
        u2 = self.random()
        return mu + sigma * math.sqrt(-2.0 * math.log(u1)) * math.cos(TAU * u2)

    def gammavariate(self, shape: float, scale: float) -> float:
        """Marsaglia-Tsang. Only shape >= 1 is used here."""
        d = shape - 1.0 / 3.0
        c = 1.0 / math.sqrt(9.0 * d)
        while True:
            x = self.gauss(0.0, 1.0)
            v = (1.0 + c * x) ** 3
            if v <= 0.0:
                continue
            u = self.random()
            if u < 1.0 - 0.0331 * x * x * x * x:
                return d * v * scale
            if math.log(max(u, 1e-300)) < 0.5 * x * x + d * (1.0 - v + math.log(v)):
                return d * v * scale


@dataclass
class MotionConfig:
    # Fitts's law: MT = a + b * log2(D/W + 1), milliseconds
    fitts_a: float = 50.0
    fitts_b: float = 150.0
    target_width: float = 20.0

    # primary ballistic stroke
    undershoot_min: float = 0.92
    undershoot_max: float = 0.97
    peak_time_ratio: float = 0.35
    primary_sigma_min: float = 0.18
    primary_sigma_max: float = 0.28

    # corrective sub-movements
    overshoot_prob: float = 0.15
    overshoot_min: float = 1.02
    overshoot_max: float = 1.08
    correction_sigma_min: float = 0.12
    correction_sigma_max: float = 0.20
    second_correction_prob: float = 0.25

    curvature_scale: float = 0.025

    ou_theta: float = 3.5          # OU reversion rate, 1/s
    ou_sigma: float = 1.2          # OU volatility, px/sqrt(s)

    tremor_freq_min: float = 8.0
    tremor_freq_max: float = 12.0
    tremor_amp_min: float = 0.15
    tremor_amp_max: float = 0.55

    sdn_k: float = 0.04            # signal-dependent noise gain

    sample_dt_mean: float = 7.8    # ms between samples
    gamma_shape: float = 3.5

    # press and key timing
    pre_press_min: float = 80.0
    pre_press_max: float = 220.0
    dwell_min: float = 50.0
    dwell_max: float = 130.0
    wpm: float = 52.0              # ~230ms/word -> ~115ms/char at 5 chars+space
    key_sigma: float = 0.33        # lognormal spread on inter-key interval
    word_pause_min: float = 60.0
    word_pause_max: float = 220.0
    hesitate_prob: float = 0.04
    hesitate_min: float = 260.0
    hesitate_max: float = 900.0


@dataclass
class Point:
    x: float
    y: float
    t: float                       # ms since the gesture started

    def __iter__(self):
        return iter((self.x, self.y, self.t))


# --------------------------------------------------------------------------- #
# math helpers
# --------------------------------------------------------------------------- #

def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / SQRT2))


def _lognormal_cdf(t: float, t0: float, mu: float, sigma: float) -> float:
    """Fraction of a stroke's displacement delivered by time t."""
    if t <= t0:
        return 0.0
    return _normal_cdf((math.log(t - t0) - mu) / sigma)


def _lognormal_pdf(t: float, t0: float, mu: float, sigma: float) -> float:
    """Instantaneous speed shape of a stroke -- the asymmetric bell."""
    if t <= t0:
        return 0.0
    dt = t - t0
    z = (math.log(dt) - mu) / sigma
    return math.exp(-0.5 * z * z) / (sigma * math.sqrt(TAU) * dt)


def _curvature_profile(s: float) -> float:
    """s^2 (1-s)^3, normalised to 1.0 at its peak. Curvature is largest during
    acceleration, which is where a real arc bows away from the straight line."""
    if s <= 0.0 or s >= 1.0:
        return 0.0
    norm = 0.4 * 0.4 * 0.6 * 0.6 * 0.6
    return (s * s * (1.0 - s) ** 3) / norm


def _direction_factor(angle: float) -> float:
    """Vertical reaches bow more than horizontal ones: wrist and forearm pivot
    around different axes."""
    return 0.5 + 0.8 * abs(math.sin(angle)) - 0.15 * abs(math.cos(angle))


# --------------------------------------------------------------------------- #
# trajectory
# --------------------------------------------------------------------------- #

def path(x0, y0, x1, y1, cfg: MotionConfig | None = None, rng=None,
         target_width: float | None = None) -> list[Point]:
    """Point-to-point trajectory from (x0,y0) to (x1,y1).

    Returns samples carrying their own timestamps -- the caller sleeps the
    differences. The last sample is snapped exactly onto the target, because
    every front end has to land on the pixel it was asked for even though the
    model's endpoint carries noise.
    """
    cfg = cfg or MotionConfig()
    rng = rng or Rng()
    width = target_width if target_width is not None else cfg.target_width

    dx, dy = x1 - x0, y1 - y0
    distance = math.hypot(dx, dy)
    if distance < 1.0:
        return [Point(x0, y0, 0.0), Point(x1, y1, 50.0)]

    direction = math.atan2(dy, dx)
    tx, ty = dx / distance, dy / distance
    nx, ny = -ty, tx

    # movement time from Fitts, with lognormal trial-to-trial variation
    index_of_difficulty = math.log2(distance / max(width, 1.0) + 1.0)
    mt = (cfg.fitts_a + cfg.fitts_b * index_of_difficulty) * math.exp(rng.gauss(0.0, 0.08))
    mt = max(mt, 80.0)

    # the ballistic stroke usually falls short; occasionally it overshoots
    if rng.random() < cfg.overshoot_prob:
        reach = rng.uniform(cfg.overshoot_min, cfg.overshoot_max)
    else:
        reach = rng.uniform(cfg.undershoot_min, cfg.undershoot_max)

    primary_d = distance * reach
    primary_sigma = rng.uniform(cfg.primary_sigma_min, cfg.primary_sigma_max)
    # mode of the lognormal = exp(mu - sigma^2), so peak speed lands at peak_t
    peak_t = mt * rng.uniform(cfg.peak_time_ratio - 0.03, cfg.peak_time_ratio + 0.03)
    primary_mu = math.log(peak_t) + primary_sigma * primary_sigma

    corrections = []  # each: (D, t0, mu, sigma, dir_x, dir_y)
    remaining = distance - primary_d
    if abs(remaining) > 0.5:
        sign = 1.0 if remaining > 0.0 else -1.0
        c_d = abs(remaining) * rng.uniform(0.88, 1.02)
        c_sigma = rng.uniform(cfg.correction_sigma_min, cfg.correction_sigma_max)
        c_peak = mt * rng.uniform(0.12, 0.18)
        corrections.append((c_d, mt * rng.uniform(0.55, 0.68),
                            math.log(c_peak) + c_sigma * c_sigma, c_sigma,
                            tx * sign, ty * sign))

        left = remaining - c_d * sign
        if abs(left) > 0.3 and rng.random() < cfg.second_correction_prob:
            sign2 = 1.0 if left > 0.0 else -1.0
            c2_d = abs(left) * rng.uniform(0.85, 1.05)
            c2_sigma = rng.uniform(0.10, 0.16)
            c2_peak = mt * rng.uniform(0.08, 0.12)
            corrections.append((c2_d, mt * rng.uniform(0.78, 0.88),
                                math.log(c2_peak) + c2_sigma * c2_sigma, c2_sigma,
                                tx * sign2, ty * sign2))

    curv_amp = distance * cfg.curvature_scale * _direction_factor(direction) * rng.gauss(0.0, 1.0)

    tremor_freq = rng.uniform(cfg.tremor_freq_min, cfg.tremor_freq_max)
    tremor_amp = rng.uniform(cfg.tremor_amp_min, cfg.tremor_amp_max)
    tremor_phase_x = rng.uniform(0.0, TAU)
    tremor_phase_y = rng.uniform(0.0, TAU)
    ou_x = ou_y = 0.0

    total_t = mt * 1.03
    g_scale = cfg.sample_dt_mean / cfg.gamma_shape
    times = [0.0]
    t = 0.0
    while t < total_t:
        t += min(25.0, max(2.0, rng.gammavariate(cfg.gamma_shape, g_scale)))
        times.append(t)

    out: list[Point] = []
    for i, t in enumerate(times):
        dt_s = ((t - times[i - 1]) if i else cfg.sample_dt_mean) / 1000.0

        s = _lognormal_cdf(t, 0.0, primary_mu, primary_sigma)
        bx = x0 + tx * primary_d * s
        by = y0 + ty * primary_d * s

        bow = curv_amp * _curvature_profile(s)
        bx += nx * bow
        by += ny * bow

        speed = primary_d * _lognormal_pdf(t, 0.0, primary_mu, primary_sigma)
        for c_d, c_t0, c_mu, c_sigma, c_dx, c_dy in corrections:
            cs = _lognormal_cdf(t, c_t0, c_mu, c_sigma)
            bx += c_dx * c_d * cs
            by += c_dy * c_d * cs
            speed += c_d * _lognormal_pdf(t, c_t0, c_mu, c_sigma)

        # Euler-Maruyama step of the OU drift
        ou_x += -cfg.ou_theta * ou_x * dt_s + cfg.ou_sigma * math.sqrt(dt_s) * rng.gauss(0.0, 1.0)
        ou_y += -cfg.ou_theta * ou_y * dt_s + cfg.ou_sigma * math.sqrt(dt_s) * rng.gauss(0.0, 1.0)

        # tremor is suppressed while the limb is moving fast
        trem = 1.0 / (1.0 + speed * 0.3)
        t_s = t / 1000.0
        tr_x = tremor_amp * trem * math.sin(TAU * tremor_freq * t_s + tremor_phase_x)
        tr_y = tremor_amp * trem * math.sin(TAU * tremor_freq * t_s + tremor_phase_y)

        sdn_x = cfg.sdn_k * speed * rng.gauss(0.0, 1.0)
        sdn_y = cfg.sdn_k * speed * rng.gauss(0.0, 1.0)

        out.append(Point(bx + ou_x + tr_x + sdn_x, by + ou_y + tr_y + sdn_y, t))

    out.append(Point(float(x1), float(y1), out[-1].t + rng.uniform(8.0, 22.0)))
    return out


def steps(x0, y0, x1, y1, **kw) -> list[tuple[int, int, float]]:
    """`path`, rounded to whole pixels, with duplicate pixels collapsed and each
    step carrying the seconds to sleep after it. What a front end actually wants."""
    pts = path(x0, y0, x1, y1, **kw)
    out: list[tuple[int, int, float]] = []
    last = (int(round(x0)), int(round(y0)))
    for i, p in enumerate(pts):
        px, py = int(round(p.x)), int(round(p.y))
        dt = (p.t - pts[i - 1].t) if i else 0.0
        if (px, py) == last and i < len(pts) - 1:
            continue
        last = (px, py)
        out.append((px, py, max(dt, 1.0) / 1000.0))
    return out


def settle(x, y, rng=None) -> list[tuple[int, int, float]]:
    """One or two 1px corrections on the target, then rest exactly on it."""
    rng = rng or Rng()
    out = []
    for _ in range(rng.randint(1, 2)):
        out.append((x + rng.randint(-1, 1), y + rng.randint(-1, 1), rng.uniform(0.02, 0.05)))
    out.append((x, y, rng.uniform(0.01, 0.03)))
    return out


# --------------------------------------------------------------------------- #
# press, key and scroll timing
# --------------------------------------------------------------------------- #

def press_timing(cfg: MotionConfig | None = None, rng=None) -> tuple[float, float]:
    """(seconds to wait after arriving before pressing, seconds to hold)."""
    cfg = cfg or MotionConfig()
    rng = rng or Rng()
    return (rng.uniform(cfg.pre_press_min, cfg.pre_press_max) / 1000.0,
            rng.uniform(cfg.dwell_min, cfg.dwell_max) / 1000.0)


def key_delays(text: str, cfg: MotionConfig | None = None, rng=None) -> list[tuple[str, float]]:
    """(character, seconds to wait before typing it). Lognormal inter-key
    intervals around the configured wpm, an extra pause at word and sentence
    boundaries, and an occasional hesitation of a few hundred ms."""
    cfg = cfg or MotionConfig()
    rng = rng or Rng()
    base = 60000.0 / (cfg.wpm * 5.0)          # ms per character
    out: list[tuple[str, float]] = []
    prev = ""
    for ch in text:
        d = base * math.exp(rng.gauss(0.0, cfg.key_sigma))
        if prev in " \t":
            d += rng.uniform(cfg.word_pause_min, cfg.word_pause_max)
        if prev in ".,!?;:":
            d += rng.uniform(cfg.word_pause_min, cfg.word_pause_max) * 1.5
        if ch.isupper() or ch in '!@#$%^&*()_+{}|:"<>?':
            d += rng.uniform(20.0, 70.0)      # reaching for shift
        if rng.random() < cfg.hesitate_prob:
            d += rng.uniform(cfg.hesitate_min, cfg.hesitate_max)
        out.append((ch, d / 1000.0))
        prev = ch
    return out


def scroll_bursts(notches: int, rng=None) -> list[tuple[int, float]]:
    """(notches this burst, seconds to wait after it). A wheel is turned in
    bursts of a few clicks that slow down, not at a constant rate."""
    rng = rng or Rng()
    left = abs(notches)
    out: list[tuple[int, float]] = []
    while left > 0:
        n = min(left, rng.randint(2, 5))
        left -= n
        gap = rng.uniform(0.04, 0.12) * (1.0 + 0.6 * (1.0 - left / max(abs(notches), 1)))
        out.append((n, gap))
    return out


# --------------------------------------------------------------------------- #
# measurement -- how a generated path scores on the metrics detectors use
# --------------------------------------------------------------------------- #

def measure(pts: list[Point], target_x, target_y, target_width=20.0) -> dict:
    if len(pts) < 2:
        return {}
    straight = math.hypot(target_x - pts[0].x, target_y - pts[0].y)
    length = 0.0
    speeds = [0.0] * len(pts)
    peak = 0.0
    time_to_peak = 0.0
    for i in range(1, len(pts)):
        seg = math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
        dt = pts[i].t - pts[i - 1].t
        length += seg
        speeds[i] = seg / dt if dt > 0 else 0.0
        if speeds[i] > peak:
            peak, time_to_peak = speeds[i], pts[i].t
    thresh = peak * 0.15
    submoves = sum(1 for i in range(2, len(speeds) - 1)
                   if speeds[i] > thresh and speeds[i] > speeds[i - 1] and speeds[i] > speeds[i + 1])
    idiff = math.log2(straight / max(target_width, 1.0) + 1.0)
    return {
        "movement_time_ms": pts[-1].t - pts[0].t,
        "samples": len(pts),
        "path_length": length,
        "straight_distance": straight,
        "path_efficiency": straight / length if length else 1.0,
        "peak_speed_px_per_ms": peak,
        "time_to_peak_ms": time_to_peak,
        "submovements": max(submoves, 1),
        "endpoint_error_px": math.hypot(pts[-1].x - target_x, pts[-1].y - target_y),
        "fitts_predicted_ms": 50.0 + 150.0 * idiff,
    }


# --------------------------------------------------------------------------- #
# WindMouse, for comparison only
# --------------------------------------------------------------------------- #

def windmouse_path(x0, y0, x1, y1, gravity=9.0, wind=3.0, max_step=15.0,
                   target_area=8.0, rng=None) -> list[Point]:
    """Benland100's WindMouse. Kept so the two models can be measured against
    each other; `path` is what the front ends call."""
    rng = rng or Rng()
    s3, s5 = math.sqrt(3.0), math.sqrt(5.0)
    xs, ys = float(x0), float(y0)
    vx = vy = wx = wy = 0.0
    step = max_step
    t = 0.0
    out = [Point(xs, ys, 0.0)]
    for _ in range(5000):
        dist = math.hypot(x1 - xs, y1 - ys)
        if dist < 1.0:
            break
        w = min(wind, dist)
        if dist >= target_area:
            wx = wx / s3 + rng.uniform(-w, w) / s5
            wy = wy / s3 + rng.uniform(-w, w) / s5
        else:
            wx, wy = wx / s3, wy / s3
            step = rng.uniform(3.0, 6.0) if step < 3.0 else step / s5
        vx += wx + gravity * (x1 - xs) / dist
        vy += wy + gravity * (y1 - ys) / dist
        vmag = math.hypot(vx, vy)
        if vmag > step:
            r = step / 2.0 + rng.uniform(0.0, step / 2.0)
            vx, vy = vx / vmag * r, vy / vmag * r
        xs += vx
        ys += vy
        t += rng.uniform(5.0, 15.0)
        out.append(Point(xs, ys, t))
    return out


if __name__ == "__main__":
    import json
    import statistics
    import sys

    # `emit <seed> <x0> <y0> <x1> <y1> <width>` prints the exact step list, for
    # scripts/motion-equivalence.sh to diff against humanmotion.js. Nothing in
    # production calls this; it exists so the two implementations cannot drift.
    if len(sys.argv) > 1 and sys.argv[1] == "emit":
        seed = int(sys.argv[2])
        x0, y0, x1, y1 = (float(v) for v in sys.argv[3:7])
        width = float(sys.argv[7]) if len(sys.argv) > 7 else 20.0
        st = steps(x0, y0, x1, y1, rng=Rng(seed), target_width=width)
        print(json.dumps([[x, y, round(dt, 6)] for x, y, dt in st]))
        raise SystemExit(0)

    dist = float(sys.argv[1]) if len(sys.argv) > 1 else 630.0
    width = float(sys.argv[2]) if len(sys.argv) > 2 else 20.0
    n = 40
    rows = {}
    for name, gen in (("sigma-lognormal", lambda: path(0, 0, dist, 0, target_width=width)),
                      ("windmouse", lambda: windmouse_path(0, 0, dist, 0))):
        ms = [measure(gen(), dist, 0, width) for _ in range(n)]
        rows[name] = {k: round(statistics.mean(m[k] for m in ms), 3)
                      for k in ("movement_time_ms", "submovements", "path_efficiency",
                                "endpoint_error_px", "samples")}
        rows[name]["fitts_predicted_ms"] = round(ms[0]["fitts_predicted_ms"], 1)
    print(json.dumps(rows, indent=2))
