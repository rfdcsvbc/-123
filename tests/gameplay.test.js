import { describe, expect, it } from 'vitest';
import { createChallenge } from '../src/gameplay.js';

describe('eight-trigram challenge', () => {
  it('collects every target exactly once and completes after eight holds', () => {
    const game = createChallenge(); game.start(() => 0.5);
    const collected = [];
    for (let i = 0; i < 8; i++) {
      const target = game.snapshot.target;
      let result;
      for (let frame = 0; frame < 6; frame++) result = game.update(target, 0.1);
      expect(result.collectedNow).toBe(true); collected.push(result.index);
    }
    expect(new Set(collected).size).toBe(8);
    expect(game.snapshot).toMatchObject({ active: false, complete: true, collected: 8, target: -1 });
    expect(game.update(-1, 0.1).collectedNow).toBe(false);
  });
  it('resets dwell on leaving a target or losing the pointer', () => {
    const game = createChallenge(); game.start(); const target = game.snapshot.target;
    for (let i = 0; i < 4; i++) game.update(target, 0.1);
    expect(game.snapshot.progress).toBeGreaterThan(0.5);
    game.update(-1, 0.1);
    expect(game.snapshot.progress).toBe(0);
    expect(game.update(target, 0.1).collectedNow).toBe(false);
    game.stop(); expect(game.snapshot.active).toBe(false);
    game.start(); expect(game.snapshot).toMatchObject({ collected: 0, elapsed: 0, progress: 0, complete: false });
  });
  it('does not award a target after a background tab pause', () => {
    const game = createChallenge(); game.start();
    expect(game.update(game.snapshot.target, 60).collectedNow).toBe(false);
    expect(game.snapshot.progress).toBeLessThan(0.2);
  });
});
