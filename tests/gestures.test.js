import { describe, expect, it } from 'vitest';
import { classifyHand, mirrorLandmarks, createGestureTracker, createSwipeDetector } from '../src/gestures.js';
import { poseHand } from './hand-fixtures.js';

function baseHand() {
  return Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.72, z: 0 }));
}

function pointingHand() {
  return poseHand('point');
}

function openHand() {
  return poseHand('palm');
}

function fistHand() {
  return poseHand('fist');
}

describe('gesture classification', () => {
  it('mirrors the camera x coordinate', () => {
    expect(mirrorLandmarks([{ x: 0.2, y: 0.4, z: 0 }])[0].x).toBeCloseTo(0.8);
  });

  it('recognizes a pointing index finger', () => {
    expect(classifyHand(pointingHand()).gesture).toBe('point');
  });

  it('recognizes an open palm', () => {
    expect(classifyHand(openHand()).gesture).toBe('palm');
  });

  it('recognizes a fist', () => {
    expect(classifyHand(fistHand()).gesture).toBe('fist');
  });

  it('returns none for incomplete landmarks', () => {
    expect(classifyHand([]).gesture).toBe('none');
  });

  it.each([0.2, 0.4, 1, 1.5])('recognizes a distant or nearby palm at scale %s', (scale) => {
    const hand = openHand().map((p) => ({ x: 0.5 + (p.x - 0.5) * scale,
      y: 0.5 + (p.y - 0.5) * scale, z: 0 }));
    expect(classifyHand(hand).gesture).toBe('palm');
  });

  it.each([Math.PI / 2, Math.PI, -Math.PI / 3])('handles a rotated hand at %s radians', (angle) => {
    for (const [factory, gesture] of [[openHand, 'palm'], [pointingHand, 'point'], [fistHand, 'fist']]) {
      const hand = factory().map((p) => ({ x: 0.5 + (p.x - 0.5) * Math.cos(angle) - (p.y - 0.5) * Math.sin(angle),
        y: 0.5 + (p.x - 0.5) * Math.sin(angle) + (p.y - 0.5) * Math.cos(angle), z: 0 }));
      expect(classifyHand(hand).gesture).toBe(gesture);
    }
  });

  it('recognizes a palm without requiring a widely extended thumb', () => {
    const hand = openHand(); hand[4] = { ...hand[0] };
    expect(classifyHand(hand).gesture).toBe('palm');
  });

  it('recognizes pinch and peace without confusing them with palm', () => {
    const pinch = openHand(); pinch[4] = { ...pinch[8], x: pinch[8].x + 0.01 };
    expect(classifyHand(pinch).gesture).toBe('pinch');
    const peace = poseHand('peace');
    expect(classifyHand(peace).gesture).toBe('peace');
  });

  it('corrects camera aspect ratio', () => {
    const hand = openHand().map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) / 2 }));
    expect(classifyHand(hand, { aspectRatio: 2 }).metrics.palmSize)
      .toBeCloseTo(classifyHand(openHand()).metrics.palmSize);
  });

  it('rejects invalid and collapsed landmarks safely', () => {
    expect(classifyHand(baseHand()).gesture).toBe('none');
    const hand = openHand(); hand[3].x = NaN;
    expect(classifyHand(hand).gesture).toBe('none');
    hand[3] = null;
    expect(classifyHand(hand).gesture).toBe('none');
  });
});

describe('temporal gesture tracking', () => {
  it.each([15, 30, 60])('confirms within 140ms at %s FPS', (fps) => {
    const tracker = createGestureTracker();
    tracker.update(openHand(), 0);
    let result;
    for (let time = 1000 / fps; time <= 140; time += 1000 / fps) {
      result = tracker.update(openHand(), time);
      if (result.changed) break;
    }
    expect(result.gesture).toBe('palm');
    expect(result.changed).toBe(true);
  });

  it('rejects brief misclassifications and fires changes once per held pose', () => {
    const tracker = createGestureTracker();
    tracker.update(openHand(), 0);
    expect(tracker.update(openHand(), 80).changed).toBe(true);
    expect(tracker.update(openHand(), 120).changed).toBe(false);
    expect(tracker.update(fistHand(), 150).gesture).toBe('palm');
    expect(tracker.update(openHand(), 180).gesture).toBe('palm');
    tracker.update(fistHand(), 210);
    expect(tracker.update(fistHand(), 340).gesture).toBe('fist');
  });

  it('keeps a pose through brief loss and expires it after 600ms', () => {
    const tracker = createGestureTracker();
    tracker.update(pointingHand(), 0); tracker.update(pointingHand(), 80);
    expect(tracker.update(null, 300)).toMatchObject({ gesture: 'point', tracked: false });
    expect(tracker.update(null, 700)).toMatchObject({ gesture: 'none', changed: true });
    expect(tracker.update(pointingHand(), 720).gesture).toBe('none');
    expect(tracker.update(pointingHand(), 800).gesture).toBe('point');
  });

  it('supports a steadier confirmation setting', () => {
    const tracker = createGestureTracker(); tracker.setSensitivity('steady');
    tracker.update(openHand(), 0);
    expect(tracker.update(openHand(), 100).gesture).toBe('none');
    expect(tracker.update(openHand(), 180).gesture).toBe('palm');
    tracker.reset();
    expect(tracker.update(openHand(), 200).gesture).toBe('none');
  });
});

describe('swipe detection', () => {
  it('requires real displacement and enforces a cooldown', () => {
    const swipe = createSwipeDetector();
    expect(swipe.update(0.4, 0)).toBe(false);
    expect(swipe.update(0.48, 60)).toBe(false);
    expect(swipe.update(0.58, 120)).toBe(true);
    expect(swipe.update(0.72, 180)).toBe(false);
    expect(swipe.update(0.9, 240)).toBe(false);
    swipe.update(0.8, 1400); swipe.update(0.72, 1460);
    expect(swipe.update(0.6, 1520)).toBe(true);
  });
  it('ignores jitter and gaps in tracking', () => {
    const swipe = createSwipeDetector();
    for (let i = 0; i < 30; i++) expect(swipe.update(0.5 + Math.sin(i) * 0.015, i * 20)).toBe(false);
    swipe.update(null, 650);
    expect(swipe.update(0.1, 700)).toBe(false);
    swipe.reset();
    expect(swipe.update(0.9, 750)).toBe(false);
  });
});

