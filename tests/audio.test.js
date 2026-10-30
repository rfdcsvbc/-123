import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createSoundscape } from '../src/audio.js';

class Param {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}
class Node {
  gain = new Param(); frequency = new Param();
  connect(node) { return node; }
  start = vi.fn(); stop = vi.fn();
}
class AudioContextMock {
  static instances = [];
  currentTime = 0; sampleRate = 1000; state = 'suspended'; destination = {};
  oscillators = []; sources = []; gains = [];
  constructor() { AudioContextMock.instances.push(this); }
  resume = vi.fn(async () => { this.state = 'running'; this.onstatechange?.(); });
  suspend = vi.fn(async () => { this.state = 'suspended'; this.onstatechange?.(); });
  close = vi.fn(async () => { this.state = 'closed'; });
  createGain() { const node = new Node(); this.gains.push(node); return node; }
  createOscillator() { const node = new Node(); this.oscillators.push(node); return node; }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  createBiquadFilter() { return new Node(); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
}

describe('audible interaction feedback', () => {
  let sound;
  beforeEach(() => {
    vi.useFakeTimers(); AudioContextMock.instances = [];
    vi.stubGlobal('window', { AudioContext: AudioContextMock });
    sound = createSoundscape();
  });
  afterEach(() => { sound.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('unlocks audio on user interaction and plays a test bell', async () => {
    sound.test(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(100);
    const context = AudioContextMock.instances[0];
    expect(context.resume).toHaveBeenCalled();
    expect(sound.status).toMatchObject({ state: 'running', muted: false, volume: 0.65 });
    expect(context.oscillators.filter((node) => node.start.mock.calls.length).length).toBeGreaterThanOrEqual(3);
  });
  it('adjusts volume, mutes, and restores the selected volume on unmute', async () => {
    sound.resume(); await Promise.resolve();
    const context = AudioContextMock.instances[0]; const master = context.gains[0];
    sound.setVolume(0.4); expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, 0, 0.04);
    expect(sound.toggleMute()).toBe(true);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.03);
    const count = context.oscillators.length;
    sound.talisman(); await vi.advanceTimersByTimeAsync(400);
    expect(context.oscillators.length).toBe(count);
    expect(sound.toggleMute()).toBe(false);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, 0, 0.03);
  });
  it('ramps charging pitch and plays a layered talisman sound', async () => {
    sound.resume(); await Promise.resolve(); sound.charge(0); sound.charge(1);
    const context = AudioContextMock.instances[0];
    const charge = context.oscillators.at(-1);
    expect(charge.frequency.setTargetAtTime).toHaveBeenLastCalledWith(440, 0, 0.06);
    sound.stopCharge(); expect(charge.stop).toHaveBeenCalled();
    const count = context.oscillators.length;
    sound.talisman(2); await vi.advanceTimersByTimeAsync(300);
    expect(context.sources.at(-1).start).toHaveBeenCalled();
    expect(context.oscillators.length - count).toBe(4);
  });
  it('cleans up timers and never recreates the audio context after disposal', async () => {
    sound.resume(); await Promise.resolve(); sound.talisman(); sound.dispose();
    const context = AudioContextMock.instances[0];
    const count = context.oscillators.length;
    await vi.advanceTimersByTimeAsync(10000);
    sound.resume(); sound.test(); await vi.advanceTimersByTimeAsync(1000);
    expect(context.oscillators.length).toBe(count);
    expect(AudioContextMock.instances.length).toBe(1);
    expect(context.close).toHaveBeenCalled();
  });
});
