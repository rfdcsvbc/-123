import { gsap } from 'gsap';

// The first card is transcribed from the supplied video at 00:32.
// Lines run from top to bottom: broken, broken, solid, broken, broken, broken.
export const TALISMANS = [
  { name: '雷地豫', words: '雷地豫', lines: [0, 0, 1, 0, 0, 0],
    relation: '上雷震 · 下地坤', badge: '吉',
    meaning: '雷出地奋，豫。顺时而动，万事和乐，宜早做准备。',
    english: 'Thunder bursts from earth. Prepare well, then enjoy.',
    note: '六爻安静 · 守常则吉' },
  { name: '乾为天', words: '乾为天', lines: [1, 1, 1, 1, 1, 1],
    relation: '上天乾 · 下天乾', badge: '健',
    meaning: '天行健，君子以自强不息。持之以恒，循序而进。',
    english: 'Heaven moves ceaselessly. Keep learning, keep going.',
    note: '自强不息 · 笃行不怠' },
  { name: '坤为地', words: '坤为地', lines: [0, 0, 0, 0, 0, 0],
    relation: '上地坤 · 下地坤', badge: '厚',
    meaning: '地势坤，君子以厚德载物。包容万象，踏实而行。',
    english: 'Earth carries all things. Be patient, generous and steady.',
    note: '厚德载物 · 安静笃实' }
];

export function normalizeTalismanText(value, fallback = '雷地豫') {
  return Array.from(String(value).normalize('NFC').replace(/[\s\p{Cc}\p{Cf}]/gu, '')).slice(0, 8).join('') || fallback;
}

function drawLines(element, lines) {
  element.replaceChildren(...lines.map(solid => {
    const row = document.createElement('span');
    row.className = solid ? 'yao-line solid' : 'yao-line';
    row.append(document.createElement('i'), document.createElement('i'));
    return row;
  }));
}

// DOM text stays sharp at every zoom and the two buttons are real controls.
export function createTalismanSystem({ reducedMotion = false } = {}) {
  const root = document.querySelector('#oracle-presentation');
  const card = document.querySelector('#oracle-card');
  const title = document.querySelector('#oracle-title');
  const motion = { alpha: 0, size: 0.88, travel: 0 };
  let enabled = false;
  let variant = 0;
  let charge = 0;
  let layout = { x: 0, y: 0, scale: 1 };

  function writeTitle(words) {
    const length = Array.from(words).length;
    title.textContent = words;
    title.style.fontSize = `${length > 4 ? Math.max(14, Math.floor(164 / length) - 3) : 34}px`;
    title.style.letterSpacing = length > 4 ? '3px' : '11px';
  }

  function writeCard() {
    const data = TALISMANS[variant];
    writeTitle(data.words);
    card.setAttribute('aria-label', `${data.name}卦签`);
    document.querySelector('#oracle-relation').textContent = data.relation;
    document.querySelector('#oracle-meaning').textContent = data.meaning;
    document.querySelector('#oracle-english').textContent = data.english;
    document.querySelector('#oracle-note').textContent = data.note;
    document.querySelector('#oracle-badge').textContent = data.badge;
    drawLines(document.querySelector('#oracle-lines'), data.lines);
    drawLines(document.querySelector('#oracle-side-lines'), data.lines);
  }

  function resize() {
    const width = innerWidth, height = innerHeight;
    const panel = document.querySelector('#play-panel').getBoundingClientRect();
    const mobile = width <= 900;
    const right = mobile ? width : panel.left;
    const bottom = mobile ? panel.top : height - 45;
    layout = { x: right / 2, y: 66 + (bottom - 66) / 2,
      scale: Math.min(1, Math.max(0.35, (bottom - 90) / 470), (right - 54) / 445) };
  }

  function cast(power = 0.7) {
    if (!enabled) return false;
    gsap.killTweensOf(motion);
    root.hidden = false;
    root.inert = false;
    Object.assign(motion, { alpha: 0, size: 0.88, travel: 0 });
    gsap.to(motion, { alpha: 1, size: 1, travel: 1,
      duration: reducedMotion ? 0.15 : 0.7, ease: 'power3.out' });
    root.style.setProperty('--oracle-energy', String(0.3 + power * 0.6));
    return true;
  }

  function recall() {
    gsap.killTweensOf(motion);
    root.inert = true;
    gsap.to(motion, { alpha: 0, size: 0.88, travel: 0,
      duration: reducedMotion ? 0.1 : 0.35,
      onComplete: () => { if (motion.alpha < 0.01) root.hidden = true; } });
  }

  function setEnabled(value) {
    enabled = Boolean(value); charge = 0;
    document.documentElement.classList.toggle('oracle-open', enabled);
    resize();
    if (enabled) cast(); else recall();
    return enabled;
  }

  function setVariant(index) {
    if (!Number.isFinite(index)) return;
    variant = Math.max(0, Math.min(TALISMANS.length - 1, Math.round(index)));
    writeCard();
    if (enabled) cast();
  }

  writeCard();
  resize();
  return { setEnabled, setVariant, cast, recall, resize,
    setText(value) {
      const words = normalizeTalismanText(value, TALISMANS[variant].words);
      writeTitle(words);
      return words;
    },
    setCharge(value) { charge = Math.max(0, Math.min(1, value)); },
    update(time, zoom = 1) {
      if (root.hidden) return;
      root.style.opacity = String(motion.alpha);
      const drift = reducedMotion ? 0 : Math.sin(time * 0.8) * 2;
      root.style.left = `${layout.x}px`;
      root.style.top = `${layout.y + (1 - motion.travel) * 24 + drift}px`;
      root.style.transform = `translate(-50%, -50%) scale(${layout.scale * zoom * motion.size})`;
      root.style.setProperty('--oracle-charge', String(charge));
    },
    get enabled() { return enabled; }, get variant() { return variant; }
  };
}
