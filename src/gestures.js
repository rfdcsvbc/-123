export function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Reach the entire screen while keeping the hand within the camera's useful area.
export function handPointer(point, width, height) {
  return { x: Math.max(0, Math.min(1, (point.x - 0.12) / 0.76)) * (width - 1),
    y: Math.max(0, Math.min(1, (point.y - 0.1) / 0.55)) * (height - 1), source: 'camera' };
}

export function mirrorLandmarks(landmarks) {
  return landmarks.map((point) => ({
    x: 1 - point.x,
    y: point.y,
    z: point.z ?? 0
  }));
}

export function classifyHand(landmarks, { aspectRatio = 1 } = {}) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21 ||
      landmarks.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        (p.z !== undefined && !Number.isFinite(p.z)))) {
    return {
      gesture: 'none',
      points: [],
      metrics: null
    };
  }

  const points = mirrorLandmarks(landmarks);
  aspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const wrist = points[0];
  // MediaPipe z uses the same scale as x. Depth avoids a closed hand appearing
  // extended when the fingertips overlap in the image.
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspectRatio,
    a.y - b.y, (a.z - b.z) * aspectRatio);
  const angle = (a, b, c) => {
    const u = [(a.x - b.x) * aspectRatio, a.y - b.y, (a.z - b.z) * aspectRatio];
    const v = [(c.x - b.x) * aspectRatio, c.y - b.y, (c.z - b.z) * aspectRatio];
    const length = Math.hypot(...u) * Math.hypot(...v);
    return length > 1e-8 ? Math.acos(Math.max(-1, Math.min(1,
      u.reduce((sum, value, i) => sum + value * v[i], 0) / length))) : 0;
  };
  const palmSize = Math.max(distance(points[5], points[17]), distance(wrist, points[9]) * 0.75);
  if (palmSize < 0.008) return { gesture: 'none', points: [], metrics: null };
  const ratios = {};
  const extended = {};
  const folded = {};
  const fingers = {};

  [
    [8, 5, 'index'],
    [12, 9, 'middle'],
    [16, 13, 'ring'],
    [20, 17, 'pinky']
  ].forEach(([tip, base, name]) => {
    const a = points[base];
    const joint = points[base + 1];
    const b = points[tip];
    const dip = points[base + 2];
    const bones = [distance(a, joint), distance(joint, dip), distance(dip, b)];
    const valid = bones.every((length) => length > palmSize * 0.035);
    const pipAngle = angle(a, joint, dip);
    const dipAngle = angle(joint, dip, b);
    const straightness = distance(a, b) / Math.max(bones.reduce((sum, value) => sum + value, 0), 1e-5);
    const ratio = distance(b, wrist) / Math.max(distance(a, wrist), 0.0001);
    ratios[name] = ratio;
    extended[name] = valid && pipAngle > 2.45 && dipAngle > 2.35 &&
      straightness > 0.8 && ratio > 1.15;
    folded[name] = valid && !extended[name] &&
      ((pipAngle < 2.15 || dipAngle < 2.0) && (straightness < 0.76 || ratio < 1.1));
    fingers[name] = { extended: extended[name], folded: folded[name], pipAngle, dipAngle, straightness, valid };
  });

  const extendedCount = Object.values(extended).filter(Boolean).length;
  const foldedCount = Object.values(folded).filter(Boolean).length;
  const pinchRatio = distance(points[4], points[8]) / palmSize;
  const tailExtended = ['middle', 'ring', 'pinky'].filter((name) => extended[name]).length;
  const fist = foldedCount === 4;
  const pinch = !fist && pinchRatio < 0.27 && tailExtended >= 2;
  // The gap between contact and release is intentional: half-closed poses do nothing.
  const pinchTransition = tailExtended >= 2 && pinchRatio < 0.5;

  let gesture = 'neutral';
  if (fist) gesture = 'fist';
  else if (pinch) gesture = 'pinch';
  else if (pinchTransition) gesture = 'neutral';
  else if (extended.index && extended.middle && folded.ring && folded.pinky) gesture = 'peace';
  else if (extendedCount >= 3) gesture = 'palm';
  else if (extended.index && folded.middle && folded.ring && folded.pinky) gesture = 'point';

  return {
    gesture,
    points,
    metrics: {
      ratios,
      fingers,
      foldedCount,
      tailExtended,
      extendedCount,
      palmSize,
      pinchRatio,
      fingerLength: distance(points[5], points[8]),
      palm: {
        x: (points[0].x + points[5].x + points[9].x + points[17].x) / 4,
        y: (points[0].y + points[5].y + points[9].y + points[17].y) / 4
      },
      wrist,
      roll: Math.atan2(
        points[5].y - points[17].y,
        (points[5].x - points[17].x) * aspectRatio
      )
    }
  };
}

// Milliseconds, rather than frame counts, keep confirmation responsive at low FPS.
export function createGestureTracker({ sensitivity = 'responsive' } = {}) {
  let candidate = 'none';
  let candidateAt = 0;
  let stable = 'none';
  let lastSeen = -Infinity;
  let previousAt = null;
  let smoothed = null;
  const holds = { responsive: 65, balanced: 110, steady: 170 };
  return {
    setSensitivity(value) { sensitivity = value in holds ? value : 'responsive'; },
    reset() {
      candidate = stable = 'none'; lastSeen = -Infinity;
      previousAt = null; smoothed = null;
    },
    update(landmarks, now, options) {
      const result = classifyHand(landmarks, options);
      const before = stable;
      if (result.gesture === 'none') {
        candidate = 'none'; candidateAt = now;
        if (now - lastSeen > 600) {
          stable = candidate = 'none'; smoothed = null; previousAt = null;
        }
        return { ...result, gesture: stable, changed: stable !== before, tracked: false };
      }
      lastSeen = now;
      if (result.gesture !== candidate) { candidate = result.gesture; candidateAt = now; }
      const hold = Math.max(holds[sensitivity] ?? 65, candidate === 'pinch' ? 160 : candidate === 'fist' ? 120 : 0);
      if (now - candidateAt >= hold) stable = candidate;
      const alpha = previousAt === null ? 1 : 1 - Math.exp(-(now - previousAt) / 24);
      smoothed = result.points.map((p, i) => ({
        x: smoothed ? smoothed[i].x + (p.x - smoothed[i].x) * alpha : p.x,
        y: smoothed ? smoothed[i].y + (p.y - smoothed[i].y) * alpha : p.y,
        z: p.z
      }));
      previousAt = now;
      return { ...result, points: smoothed, rawGesture: result.gesture,
        gesture: stable, changed: stable !== before, tracked: true,
        progress: stable === candidate ? 1 : Math.min(1, (now - candidateAt) / hold) };
    }
  };
}

// Only a confirmed, visibly opened pinch releases energy. Curling into a fist,
// ambiguous poses and tracking loss cancel it, and cannot also fold the field.
export function createPinchController() {
  let active = false;
  let ready = true;
  let blockFist = false;
  let lastSeen = -Infinity;
  let uncertainAt = null;
  return {
    reset() { active = false; ready = true; blockFist = false; lastSeen = -Infinity; uncertainAt = null; },
    update(hand, now) {
      let event = null;
      const cancel = () => { active = false; ready = false; blockFist = true; event = 'cancel'; };
      if (!hand.tracked) {
        if (active && now - lastSeen > 350) cancel();
        return { event, active, blockFist };
      }
      lastSeen = now;
      const pose = hand.gesture === hand.rawGesture ? hand.gesture : 'neutral';
      const opened = ['palm', 'peace', 'point'].includes(pose) && hand.metrics.pinchRatio > 0.5;
      if (active) {
        if (hand.rawGesture === 'fist') cancel();
        else if (opened) { active = false; ready = true; blockFist = false; event = 'release'; }
        else if (hand.rawGesture !== 'pinch') {
          uncertainAt ??= now;
          if (now - uncertainAt > 450) cancel();
        } else uncertainAt = null;
      } else if (opened) { ready = true; blockFist = false; }
      else if (ready && pose === 'pinch') {
        active = true; ready = false; blockFist = true; uncertainAt = null; event = 'start';
      }
      return { event, active, blockFist };
    }
  };
}

export function createSwipeDetector() {
  let samples = [];
  let cooldownUntil = 0;
  return {
    reset() { samples = []; cooldownUntil = 0; },
    update(x, now) {
      if (!Number.isFinite(x)) { samples = []; return false; }
      samples = samples.filter((sample) => now - sample.time <= 280);
      samples.push({ x, time: now });
      if (now < cooldownUntil || samples.length < 3) return false;
      const start = samples[0];
      const elapsed = (now - start.time) / 1000;
      if (elapsed >= 0.07 && Math.abs(x - start.x) > 0.13 && Math.abs(x - start.x) / elapsed > 0.65) {
        samples = []; cooldownUntil = now + 1100; return true;
      }
      return false;
    }
  };
}

export function createPalmZoom() {
  let baseline = null;
  let since = null;
  let filtered = 1;
  return {
    reset() { baseline = null; since = null; },
    update(hands, now, currentZoom, aspectRatio = 1) {
      if (hands.length !== 2 || hands.some((hand) => hand.gesture !== 'palm')) {
        baseline = null; since = null; return null;
      }
      const a = hands[0].metrics.palm, b = hands[1].metrics.palm;
      const span = Math.hypot((a.x - b.x) * aspectRatio, a.y - b.y);
      if (span < 0.12) { baseline = null; since = null; return null; }
      since ??= now;
      if (now - since < 140) return null;
      if (!baseline) { baseline = { span, zoom: currentZoom }; filtered = currentZoom; }
      const target = Math.max(0.45, Math.min(1.8, baseline.zoom * span / baseline.span));
      filtered += (target - filtered) * 0.35;
      return filtered;
    }
  };
}

// One activation per dwell; leaving, an ambiguous pose or loss of tracking cancels.
export function createDwellController({ holdMs = 900 } = {}) {
  let target = null;
  let since = 0;
  let fired = false;
  return {
    reset() { target = null; since = 0; fired = false; },
    update(next, now) {
      if (!next) { target = null; since = 0; fired = false; return { progress: 0, activate: null }; }
      if (next !== target) { target = next; since = now; fired = false; }
      const progress = Math.max(0, Math.min(1, (now - since) / holdMs));
      let activate = null;
      if (progress >= 1 && !fired) { fired = true; activate = target; }
      return { progress, activate };
    }
  };
}
