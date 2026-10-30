export const TRIGRAMS = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];

// Dwell uses elapsed time and cancels on leaving a target or losing tracking.
export function createChallenge() {
  let order = [];
  let collected = 0;
  let dwell = 0;
  let elapsed = 0;
  let active = false;
  let complete = false;
  return {
    start(random = Math.random) {
      order = TRIGRAMS.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      collected = dwell = elapsed = 0; active = true; complete = false;
    },
    stop() { active = false; dwell = 0; },
    update(hit, seconds) {
      if (!active) return { collectedNow: false, complete: false };
      // Ignore long background-tab gaps instead of awarding an invisible hold.
      const dt = Math.min(Math.max(seconds, 0), 0.1);
      elapsed += dt;
      dwell = hit === order[collected] ? dwell + dt : 0;
      if (dwell < 0.55) return { collectedNow: false, complete: false };
      const index = order[collected++];
      dwell = 0;
      if (collected === order.length) { active = false; complete = true; }
      return { collectedNow: true, index, complete };
    },
    get snapshot() {
      return { active, complete, collected, elapsed, target: active ? order[collected] : -1,
        progress: Math.min(1, dwell / 0.55), lit: order.slice(0, collected) };
    }
  };
}
