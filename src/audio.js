export function createSoundscape(onStatusChange = () => {}) {
  let context;
  let master;
  let muted = false;
  let drone;
  let volume = 0.65;
  let disposed = false;
  let charging;
  let melodyTimer;
  let melodyStep = 0;
  const pending = new Set();
  const notify = () => onStatusChange({ muted, volume, state: context?.state || 'idle' });
  const later = (callback, delay) => {
    const id = setTimeout(() => { pending.delete(id); if (!disposed) callback(); }, delay);
    pending.add(id);
  };

  function ensureContext() {
    if (disposed) return null;
    if (context) return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(context.destination);
    context.onstatechange = notify;
    return context;
  }

  function tone(frequency, duration, volume, type = 'sine', endFrequency) {
    const audio = ensureContext();
    if (!audio || muted || audio.state === 'suspended') return;
    const now = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
  }

  function startDrone() {
    const audio = ensureContext();
    if (!audio || muted || drone) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 54;
    gain.gain.value = 0.023;
    oscillator.connect(gain).connect(master);
    oscillator.start();
    drone = { oscillator, gain };
  }

  function stopDrone() {
    if (!drone || !context) return;
    const now = context.currentTime;
    drone.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    drone.oscillator.stop(now + 0.35);
    drone = null;
  }

  function stopCharge() {
    if (!charging || !context) return;
    const now = context.currentTime;
    charging.gain.gain.cancelScheduledValues(now);
    charging.gain.gain.setTargetAtTime(0.0001, now, 0.025);
    charging.oscillator.stop(now + 0.18);
    charging = null;
  }

  function whoosh(power = 1) {
    const audio = ensureContext();
    if (!audio || muted || audio.state === 'suspended') return;
    const length = Math.floor(audio.sampleRate * 0.65);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) channel[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = audio.createBufferSource(); source.buffer = buffer;
    const filter = audio.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4500, audio.currentTime);
    filter.frequency.exponentialRampToValueAtTime(180, audio.currentTime + 0.6);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.14 * Math.max(0.1, power), audio.currentTime + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.65);
    source.connect(filter).connect(gain).connect(master);
    source.start(); source.stop(audio.currentTime + 0.7);
  }

  return {
    resume() {
      const audio = ensureContext();
      if (!audio) return;
      const begin = () => { if (!disposed) { startDrone(); notify(); } };
      if (audio.state === 'suspended') audio.resume().then(begin).catch(notify);
      else begin();
      if (!melodyTimer) {
        melodyTimer = setInterval(() => {
          if (muted || audio.state !== 'running' || disposed) return;
          const notes = [220, 261.63, 293.66, 329.63, 392, 329.63, 293.66, 261.63];
          tone(notes[melodyStep++ % notes.length], 2.8, 0.025, 'sine');
        }, 4200);
      }
    },
    suspend() {
      stopCharge();
      if (context?.state === 'running') context.suspend().catch(() => {});
    },
    seed() {
      tone(620, 0.55, 0.055, 'sine', 920);
    },
    flatten() {
      tone(130, 1.2, 0.075, 'triangle', 360);
      later(() => tone(520, 0.7, 0.07, 'sine', 780), 180);
    },
    rise() {
      tone(180, 1.8, 0.06, 'sine', 680);
      later(() => tone(920, 1.1, 0.05, 'sine', 1320), 450);
      startDrone();
    },
    fold() {
      tone(420, 0.8, 0.04, 'sine', 140);
      stopDrone();
    },
    vortex(active) {
      if (active) {
        tone(110, 1.8, 0.065, 'sawtooth', 240);
        startDrone();
      } else {
        tone(360, 0.6, 0.035, 'sine', 160);
      }
    },
    reset() {
      tone(240, 0.7, 0.035, 'sine', 90);
      stopDrone();
    },
    collect(index = 0) {
      const notes = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      tone(notes[index % notes.length], 0.5, 0.085, 'sine');
    },
    burst(power = 1) {
      stopCharge();
      whoosh(power);
      tone(85, 1.2, 0.07 * power, 'triangle', 38);
      tone(440, 0.8, 0.035 * power, 'sine', 1320);
      later(() => tone(660, 0.9, 0.06 * power, 'sine', 1760), 100);
    },
    charge(value = 0) {
      const audio = ensureContext();
      if (!audio || muted || audio.state !== 'running') return;
      if (!charging) {
        const oscillator = audio.createOscillator(); const gain = audio.createGain();
        oscillator.type = 'triangle'; gain.gain.value = 0.0001;
        oscillator.connect(gain).connect(master); oscillator.start();
        charging = { oscillator, gain };
      }
      const power = Math.max(0, Math.min(1, value));
      charging.oscillator.frequency.setTargetAtTime(110 + power * 330, audio.currentTime, 0.06);
      charging.gain.gain.setTargetAtTime(0.018 + power * 0.055, audio.currentTime, 0.06);
    },
    stopCharge,
    talisman(index = 0) {
      whoosh(0.7);
      tone(110, 1.5, 0.09, 'triangle', 55);
      [523.25, 659.25, 783.99].forEach((note, i) =>
        later(() => tone(note * (1 + index * 0.08), 1.5, 0.065, 'sine'), i * 90));
    },
    test() {
      this.resume();
      later(() => { tone(523.25, 0.8, 0.12); tone(783.99, 1, 0.08); }, 80);
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return volume;
      volume = Math.max(0, Math.min(1, value));
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.04);
      notify(); return volume;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.03);
      if (muted) { stopDrone(); stopCharge(); }
      else this.resume();
      notify();
      return muted;
    },
    dispose() {
      disposed = true;
      clearInterval(melodyTimer);
      pending.forEach(clearTimeout); pending.clear();
      stopCharge();
      stopDrone();
      context?.close();
      context = null;
      master = null;
    },
    get status() { return { muted, volume, state: context?.state || 'idle' }; }
  };
}
