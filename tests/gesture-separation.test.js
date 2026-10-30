import { describe, it, expect } from 'vitest';
import { classifyHand, createGestureTracker, createPinchController, createPalmZoom, createDwellController, handPointer } from '../src/gestures.js';
import { poseHand, transformHand } from './hand-fixtures.js';
import { normalizeTalismanText } from '../src/talismans.js';

describe('gesture separation with full finger joints', () => {
  it.each(['fist', 'pinch', 'point', 'peace', 'palm'])('%s stays distinct across distance, roll, depth, handedness and jitter', (pose) => {
    for (const scale of [0.2, 0.5, 1]) for (const roll of [0, Math.PI / 3, Math.PI])
      for (const yaw of [-0.8, 0, 0.8]) for (const mirror of [false, true]) for (const seed of [7, 25, 88]) {
        const hand = transformHand(poseHand(pose), { scale, roll, yaw, mirror, noise: 0.003, seed });
        expect(classifyHand(hand).gesture, JSON.stringify({ pose, scale, roll, yaw, mirror, seed })).toBe(pose);
      }
  });

  it('never interprets touching thumb/index on a fist as a pinch', () => {
    for (let seed = 0; seed < 40; seed++) {
      const fist = transformHand(poseHand('fist'), { noise: 0.008, seed });
      fist[4] = { ...fist[8] };
      expect(classifyHand(fist).gesture).toBe('fist');
    }
  });

  it('requires two of the remaining three fingers to be clearly straight for a pinch', () => {
    const hand = poseHand('fist');
    [9, 10, 11, 12].forEach((i) => { hand[i] = poseHand('palm')[i]; });
    hand[4] = { ...hand[8] };
    expect(classifyHand(hand).gesture).toBe('neutral');
  });

  it('uses a neutral gap between contact and open fingers', () => {
    const hand = poseHand('pinch');
    const size = classifyHand(hand).metrics.palmSize;
    hand[4] = { ...hand[8], x: hand[8].x + size * 0.39 };
    expect(classifyHand(hand).gesture).toBe('neutral');
  });

  it('does not guess gestures when joints are collapsed or depth is invalid', () => {
    const hand = poseHand('fist');
    [5, 9, 13, 17].forEach((i) => { hand[i + 1] = hand[i]; });
    expect(classifyHand(hand).gesture).toBe('neutral');
    hand[8].z = NaN;
    expect(classifyHand(hand).gesture).toBe('none');
  });

  it('requires a longer stable hold for pinch, suppressing a brief transition', () => {
    const tracker = createGestureTracker();
    tracker.update(poseHand('palm'), 0);
    tracker.update(poseHand('palm'), 80);
    tracker.update(poseHand('pinch'), 100);
    expect(tracker.update(poseHand('pinch'), 230).gesture).toBe('palm');
    expect(tracker.update(poseHand('pinch'), 265).gesture).toBe('pinch');
  });
});

const tracked = (pose) => ({ ...classifyHand(poseHand(pose)), rawGesture: pose, gesture: pose, tracked: true });
describe('pinch charge action routing', () => {
  it('starts once per contact and releases only when a confirmed pinch opens', () => {
    const controller = createPinchController();
    expect(controller.update(tracked('pinch'), 0)).toMatchObject({ event: 'start', active: true, blockFist: true });
    expect(controller.update(tracked('pinch'), 400).event).toBeNull();
    expect(controller.update(tracked('palm'), 700)).toMatchObject({ event: 'release', active: false });
    expect(controller.update(tracked('palm'), 750).event).toBeNull();
    expect(controller.update(tracked('pinch'), 1000).event).toBe('start');
  });
  it('cancels on closing a pinch into a fist and suppresses the fold action', () => {
    const controller = createPinchController();
    controller.update(tracked('pinch'), 0);
    const transition = { ...tracked('fist'), gesture: 'pinch' };
    expect(controller.update(transition, 300)).toMatchObject({ event: 'cancel', active: false, blockFist: true });
    expect(controller.update(tracked('fist'), 500).blockFist).toBe(true);
    expect(controller.update(tracked('pinch'), 600).event).toBeNull();
    controller.update(tracked('palm'), 800);
    expect(controller.update(tracked('fist'), 900).blockFist).toBe(false);
    expect(controller.update(tracked('pinch'), 1100).event).toBe('start');
  });
  it('cancels instead of firing on hand loss, and requires reopening to rearm', () => {
    const controller = createPinchController(); controller.update(tracked('pinch'), 0);
    expect(controller.update({ tracked: false }, 150).active).toBe(true);
    expect(controller.update({ tracked: false }, 360).event).toBe('cancel');
    expect(controller.update(tracked('pinch'), 500).event).toBeNull();
    controller.update(tracked('palm'), 800);
    expect(controller.update(tracked('pinch'), 1000).event).toBe('start');
  });
  it('does not release on a brief false palm frame or a lingering ambiguous pose', () => {
    const controller = createPinchController(); controller.update(tracked('pinch'), 0);
    expect(controller.update({ ...tracked('palm'), gesture: 'pinch' }, 400).event).toBeNull();
    expect(controller.update({ ...tracked('palm'), gesture: 'neutral', rawGesture: 'neutral' }, 900).event).toBe('cancel');
  });
});

describe('two-palm zoom', () => {
  const palms = (span) => [0.5 - span / 2, 0.5 + span / 2].map((x) => ({
    ...classifyHand(poseHand('palm')), metrics: { palm: { x, y: 0.5 } }
  }));
  it('requires both open palms, increases on separation and decreases on approach', () => {
    const zoom = createPalmZoom();
    expect(zoom.update(palms(0.3), 0, 1)).toBeNull();
    expect(zoom.update(palms(0.3), 160, 1)).toBe(1);
    expect(zoom.update(palms(0.45), 200, 1)).toBeGreaterThan(1);
    expect(zoom.update(palms(0.18), 240, 1)).toBeLessThan(1.175);
    expect(zoom.update([tracked('fist'), tracked('palm')], 260, 1)).toBeNull();
    expect(zoom.update(palms(0.45), 300, 1)).toBeNull();
  });
  it('releases baseline on losing a hand and clamps the zoom range', () => {
    const zoom = createPalmZoom();
    zoom.update(palms(0.2), 0, 1.8); zoom.update(palms(0.2), 150, 1.8);
    expect(zoom.update(palms(0.9), 180, 1.8)).toBeLessThanOrEqual(1.8);
    expect(zoom.update([], 200, 1)).toBeNull();
    zoom.reset(); expect(zoom.update(palms(0.5), 240, 1)).toBeNull();
  });
});

describe('readable talisman writing', () => {
  it('keeps Chinese writing, removes invisible controls and caps at eight characters', () => {
    expect(normalizeTalismanText(' 雷\n霆\u200b敕令 ')).toBe('雷霆敕令');
    expect(normalizeTalismanText('天地玄黄宇宙洪荒日月盈昃')).toBe('天地玄黄宇宙洪荒');
    expect(normalizeTalismanText('   ', '清风入境')).toBe('清风入境');
  });
});

describe('gesture control dwell', () => {
  it('activates once, requires leaving, and never carries progress between controls', () => {
    const dwell = createDwellController();
    expect(dwell.update('cast', 0).activate).toBeNull();
    expect(dwell.update('cast', 899).activate).toBeNull();
    expect(dwell.update('cast', 900).activate).toBe('cast');
    expect(dwell.update('cast', 3000).activate).toBeNull();
    expect(dwell.update('recall', 3100).progress).toBe(0);
    expect(dwell.update('recall', 4000).activate).toBe('recall');
    dwell.update(null, 4100);
    expect(dwell.update('cast', 4200).progress).toBe(0);
  });
  it('cancels incomplete dwell on an ambiguous pose, hand loss or reset', () => {
    const dwell = createDwellController();
    dwell.update('mute', 100); dwell.update(null, 950);
    expect(dwell.update('mute', 1000).activate).toBeNull();
    expect(dwell.update('mute', 1800).activate).toBeNull();
    dwell.reset();
    expect(dwell.update('mute', 2200).progress).toBe(0);
  });
  it('makes screen edges reachable with the entire hand inside the camera frame', () => {
    expect(handPointer({x:0.12,y:0.1},780,650)).toMatchObject({x:0,y:0});
    expect(handPointer({x:0.88,y:0.65},780,650)).toMatchObject({x:779,y:649});
    expect(handPointer({x:1.2,y:-0.3},780,650)).toMatchObject({x:779,y:0});
  });
});
