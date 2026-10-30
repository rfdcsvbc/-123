import './styles.css';
import { classifyHand, createGestureTracker, createSwipeDetector, createPinchController, createPalmZoom, createDwellController, handPointer } from './gestures.js';
import { TALISMANS } from './talismans.js';
import { createBaguaExperience } from './scene.js';
import { createSoundscape } from './audio.js';
import { createChallenge, TRIGRAMS } from './gameplay.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#stage');
const video = $('#camera');
const gate = $('#gate');
const sound = createSoundscape(({ muted, state, volume }) => {
  $('#sound-status').textContent = muted ? '声音已关闭' : volume === 0 ? '音量为零' : state === 'running' ? '声音已开启' : '点击试听开启声音';
  $('#mute').textContent = muted ? '静音' : '声音';
  $('#mute').setAttribute('aria-pressed', String(muted));
});
const tracker = createGestureTracker();
const pinchController = createPinchController();
const palmZoom = createPalmZoom();
const dwell = createDwellController();
let dwellTarget = null;
let pointingAtUI = false;
const swipe = createSwipeDetector();
const challenge = createChallenge();
const themeNames = ['青霄', '鎏金', '紫微', '朱雀'];
const themeColors = ['#83d9d0', '#f0b956', '#c3a0ff', '#ff857c'];
const gestureNames = { none: '等待手部', neutral: '调整手势', point: '☝ 食指', fist: '✊ 握拳',
  palm: '🖐 张掌', pinch: '🤏 捏合蓄力', peace: '✌ 切换主题' };
const statusCopy = {
  hidden: ['☝', '伸出食指 · 唤醒阵眼', 'AWAKEN THE CENTER'],
  seed: ['✊', '握拳 · 展开八卦阵', 'UNFOLD THE FIELD'],
  flat: ['🖐', '张掌升维 · 捏合蓄力', 'OPEN YOUR PALM · RISE'],
  rising: ['◌', '正在升维 · 感受流动', 'ENTERING THREE DIMENSIONS'],
  risen: ['🖐', '转掌引导 · 挥掌唤起旋涡', 'GUIDE THE FIELD'],
  vortex: ['↻', '金色旋涡 · 再挥掌关闭', 'VORTEX ACTIVE']
};
const experience = createBaguaExperience(canvas, (state, vortex) => {
  const copy = statusCopy[vortex ? 'vortex' : state];
  $('#status-icon').textContent = copy[0];
  $('#status-zh').textContent = copy[1];
  $('#status-en').textContent = copy[2];
  $('#vortex').setAttribute('aria-pressed', String(vortex));
  $('#phase-label').textContent = ({ hidden: '待唤醒', seed: '阵眼', flat: '平面', rising: '升维中', risen: '立体' })[state];
}, (value) => {
  $('#size').value = Math.round(value * 100);
  $('#size-value').textContent = `${Math.round(value * 100)}%`;
});

let mode = 'idle';
let hands = null;
let cameraStream = null;
let cameraSession = 0;
let frameHandle = 0;
let loadingCamera = false;
let neutralPalm = null;
let lastSeenAt = -Infinity;
let gesture = 'none';
let theme = 0;
let charging = false;
let chargeStarted = 0;
let chargeValue = 0;
let chargeSource = null;
let pointer = null;
let toastTimer = 0;
let lastInferenceAt = 0;
let inferenceFps = 0;
let lastPeaceAt = -Infinity;
let twoHandMode = false;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2600);
}

function enterExperience(nextMode) {
  mode = nextMode;
  sound.resume();
  sound.test();
  gate.classList.add('is-leaving');
  $('#hud').hidden = false;
  $('#play-panel').hidden = false;
  $('#manual-help').hidden = false;
  setTimeout(() => { gate.hidden = true; }, 650);
  updateMode();
}

function updateMode() {
  $('#camera-toggle').textContent = mode === 'camera' ? '关闭摄像头' : '启用摄像头';
  $('#camera-toggle').disabled = loadingCamera;
  $('#tracking').dataset.state = mode === 'camera' ? 'searching' : 'manual';
  $('#tracking-label').textContent = mode === 'camera' ? '寻找手部…' : '鼠标 / 触屏模式';
  $('#preview-toggle').hidden = mode !== 'camera';
  $('#sensitivity-control').hidden = mode !== 'camera';
  $('#gesture-guide').hidden = mode !== 'camera';
  $('#gesture-ui-help').hidden = mode !== 'camera';
  $('#manual-help').textContent = mode === 'camera'
    ? '☝ 唤醒　✊ 四指收拢　🤏 捏合时其余三指伸直　双掌拉开缩放　F 符箓'
    : '点击推进　滚轮 / 滑块缩放　空格蓄力　V 旋涡　T 换色　G 挑战　F 符箓　R 重置';
}

function cancelCharge() {
  charging = false; chargeValue = 0; chargeSource = null;
  experience.setCharge(0);
  sound.stopCharge();
  $('#charge-fill').style.width = '0%';
  $('#charge-label').textContent = '捏合时其余三指伸直';
  $('#charge').classList.remove('is-charging');
}

function stopCamera() {
  cameraSession++;
  cancelAnimationFrame(frameHandle);
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
  const oldHands = hands;
  hands = null;
  if (oldHands) Promise.resolve(oldHands.close()).catch(console.warn);
  tracker.reset(); swipe.reset(); pinchController.reset(); palmZoom.reset(); twoHandMode = false;
  neutralPalm = null;
  pointer = null;
  experience.setAim(null);
  if (chargeSource === 'camera') cancelCharge();
  $('#camera-preview').hidden = true;
  $('#preview-toggle').setAttribute('aria-pressed', 'false');
  if (mode === 'camera') mode = 'manual';
  loadingCamera = false;
  updateMode();
}

function advance() {
  sound.resume();
  if (experience.talismans.enabled) { castTalisman(); return; }
  if (experience.state === 'hidden') {
    if (experience.summon(0, 0)) sound.seed();
  } else if (experience.state === 'seed') {
    if (experience.flatten()) sound.flatten();
  } else if (experience.state === 'flat') {
    if (experience.rise()) sound.rise();
  } else if (experience.flattenBack()) sound.fold();
}

function toggleVortex() {
  sound.resume();
  if (!['flat', 'risen'].includes(experience.state)) {
    toast('先展开八卦阵，再唤起旋涡'); return;
  }
  sound.vortex(experience.toggleVortex());
}

function changeTheme() {
  sound.resume();
  theme = experience.setTheme(theme + 1);
  document.documentElement.style.setProperty('--accent', themeColors[theme]);
  $('#theme-name').textContent = themeNames[theme];
  toast(`${themeNames[theme]} · 流光已切换`);
  sound.collect(theme);
}

function startCharge(source) {
  if (charging) return;
  if (experience.state === 'hidden') {
    experience.summon(0, 0); experience.flatten(); sound.flatten();
  } else if (experience.state === 'seed') { experience.flatten(); sound.flatten(); }
  charging = true; chargeStarted = performance.now(); chargeSource = source;
  sound.resume();
  $('#charge').classList.add('is-charging');
}

function releaseCharge() {
  if (!charging) return;
  const power = Math.max(0.15, Math.min(1, (performance.now() - chargeStarted) / 1600));
  cancelCharge();
  if (experience.talismans.enabled) { castTalisman(power); return; }
  if (experience.releaseEnergy(power)) sound.burst(power);
  toast(power > 0.95 ? '满蓄力 · 星河迸发' : `灵力释放 · ${Math.round(power * 100)}%`);
}

function reset() {
  cancelCharge(); challenge.stop(); experience.showChallenge();
  $('#challenge').setAttribute('aria-pressed', 'false');
  $('#challenge-copy').textContent = '循光而行，依次点亮八个卦象';
  $('#challenge-progress').style.width = '0%';
  $('#challenge-count').textContent = '0 / 8';
  tracker.reset(); pinchController.reset(); palmZoom.reset(); neutralPalm = null; swipe.reset(); pointer = null;
  experience.setAim(null);
  if (experience.reset()) sound.reset();
  experience.resize();
  $('#talisman-mode').setAttribute('aria-pressed', 'false');
  $('#talisman-status').textContent = '视频同款黑金卦签 · 捏合蓄力，张掌出签';
  experience.setZoom(1);
}

function ensureField() {
  if (experience.state === 'hidden') experience.summon(0, 0);
  if (experience.state === 'seed') experience.flatten();
}

function castTalisman(power = 0.7) {
  if (!experience.talismans.enabled) return;
  sound.resume();
  experience.talismans.cast(power);
  experience.releaseEnergy(power * 0.6);
  sound.talisman(experience.talismans.variant);
  $('#talisman-status').textContent = `${TALISMANS[experience.talismans.variant].name}已显形 · 握拳收符`;
}

function toggleTalismans() {
  cancelCharge(); pinchController.reset();
  const enabled = !experience.talismans.enabled;
  if (enabled) {
    challenge.stop(); experience.showChallenge();
    $('#challenge').setAttribute('aria-pressed', 'false');
    ensureField();
    if (['rising', 'risen'].includes(experience.state)) experience.flattenBack();
    theme = experience.setTheme(1);
    document.documentElement.style.setProperty('--accent', themeColors[theme]);
    $('#theme-name').textContent = themeNames[theme];
  }
  experience.talismans.setEnabled(enabled);
  experience.resize();
  $('#talisman-mode').setAttribute('aria-pressed', String(enabled));
  sound.resume();
  if (enabled) {
    sound.talisman(experience.talismans.variant);
    toast('雷地豫 · 视频同款黑金卦签 · 握拳收签');
  } else sound.fold();
  $('#talisman-status').textContent = enabled ? '捏合蓄力，张掌出签 · 食指停留选择再卜一卦' : '视频同款黑金卦签 · 捏合蓄力，张掌出签';
}

function recallTalisman() {
  if (!experience.talismans.enabled) return;
  experience.talismans.recall(); sound.resume(); sound.fold();
  $('#talisman-status').textContent = '已收签 · 再次捏合或指向出签';
}

function drawAnotherTalisman() {
  const next = (experience.talismans.variant + 1 + Math.floor(Math.random() * (TALISMANS.length - 1))) % TALISMANS.length;
  $('#talisman-type').value = String(next);
  $('#talisman-type').dispatchEvent(new Event('change', { bubbles: true }));
  castTalisman();
}

function clearHandUI() {
  dwell.reset(); pointingAtUI = false;
  dwellTarget?.classList.remove('gesture-target'); dwellTarget = null;
  $('#gesture-cursor').hidden = true;
}

function updateHandUI(now) {
  if (mode !== 'camera' || pointer?.source !== 'camera' || now - lastSeenAt > 350 || charging) {
    clearHandUI(); return;
  }
  const cursor = $('#gesture-cursor');
  cursor.hidden = false;
  cursor.style.left = `${pointer.x}px`; cursor.style.top = `${pointer.y}px`;
  const element = document.elementFromPoint(pointer.x, pointer.y);
  const candidate = element?.closest('button, select, input[type="range"]');
  // Charging has its own pinch/release interaction. Never latch it via a dwell.
  const target = candidate && !candidate.disabled && candidate.id !== 'charge' && !candidate.closest('[hidden], [inert]') ? candidate : null;
  pointingAtUI = Boolean(element?.closest('#play-panel, #hud, #oracle-presentation'));
  if (target !== dwellTarget) {
    dwellTarget?.classList.remove('gesture-target'); dwellTarget = target;
    target?.classList.add('gesture-target');
  }
  const result = dwell.update(target, now);
  cursor.style.setProperty('--dwell', String(result.progress));
  const label = target?.getAttribute('aria-label') || (target?.tagName === 'SELECT' ? target.options[target.selectedIndex]?.text : target?.textContent?.trim());
  $('#dwell-label').textContent = target ? `${result.progress === 1 ? '已执行 · 移开后可再次选择' : '停留选择'} ${label}` : '食指指向 · 停留选择';
  if (!result.activate) return;
  sound.resume();
  if (target.tagName === 'SELECT') {
    target.selectedIndex = (target.selectedIndex + 1) % target.options.length;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (target.matches('input[type="range"]')) {
    const rect = target.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (pointer.x - rect.left) / rect.width));
    const step = Number(target.step) || 1;
    target.value = String(Math.round((Number(target.min) + fraction * (Number(target.max) - Number(target.min))) / step) * step);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  } else target.click();
  sound.collect(0);
}

function toggleChallenge() {
  if (experience.talismans.enabled) toggleTalismans();
  if (challenge.snapshot.active) {
    challenge.stop(); experience.showChallenge();
    $('#challenge').setAttribute('aria-pressed', 'false');
    $('#challenge-copy').textContent = '挑战已暂停，点击可以重新开始';
    return;
  }
  if (experience.state === 'hidden') experience.summon(0, 0);
  if (experience.state === 'seed') experience.flatten();
  if (['rising', 'risen'].includes(experience.state)) experience.flattenBack();
  challenge.start();
  experience.showChallenge(challenge.snapshot.target, []);
  $('#challenge').setAttribute('aria-pressed', 'true');
  toast('追光挑战 · 食指或鼠标停在闪烁光点，保持半秒点亮');
  sound.seed();
}

const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],
  [9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(points, second = []) {
  if ($('#camera-preview').hidden) return;
  const overlay = $('#hand-overlay');
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!points.length) return;
  ctx.strokeStyle = themeColors[theme]; ctx.lineWidth = 2;
  [points, second].filter((hand) => hand.length).forEach((points) => {
    connections.forEach(([a, b]) => {
    ctx.beginPath(); ctx.moveTo(points[a].x * overlay.width, points[a].y * overlay.height);
    ctx.lineTo(points[b].x * overlay.width, points[b].y * overlay.height); ctx.stroke();
  });
  ctx.fillStyle = '#fff';
    points.forEach((p) => { ctx.beginPath(); ctx.arc(p.x * overlay.width, p.y * overlay.height, 3, 0, Math.PI * 2); ctx.fill(); });
  });
}

function handleResults(results) {
  if (mode !== 'camera') return;
  const now = performance.now();
  const aspectRatio = (video.videoWidth || 640) / (video.videoHeight || 480);
  const allHands = results.multiHandLandmarks || [];
  if (allHands.length === 2) {
    clearHandUI();
    const poses = allHands.map((landmarks) => classifyHand(landmarks, { aspectRatio }));
    if (!twoHandMode) {
      tracker.reset(); pinchController.reset();
      if (chargeSource === 'camera') cancelCharge();
      twoHandMode = true; neutralPalm = null;
    }
    lastSeenAt = now; pointer = null; experience.setAim(null); swipe.reset();
    const nextZoom = palmZoom.update(poses, now, experience.zoom, aspectRatio);
    if (nextZoom !== null) experience.setZoom(nextZoom);
    $('#tracking').dataset.state = 'tracked';
    $('#tracking-label').textContent = nextZoom === null ? '双手入镜 · 张开双掌调整大小' : '双掌缩放 · 拉开放大，靠近缩小';
    $('#gesture-label').textContent = '👐 双掌缩放';
    $('#live-gesture').textContent = '👐 双手模式 · 单手动作已暂停';
    drawHand(poses[0].points, poses[1].points);
    return;
  }
  if (twoHandMode) { tracker.reset(); pinchController.reset(); palmZoom.reset(); twoHandMode = false; }
  const hand = tracker.update(results.multiHandLandmarks?.[0], now,
    { aspectRatio });
  const pinch = pinchController.update(hand, now);
  if (pinch.event === 'cancel' && chargeSource === 'camera') {
    cancelCharge(); toast('已取消蓄力 · 重新张掌后再捏合');
  }
  if (pinch.event === 'release' && chargeSource === 'camera') releaseCharge();
  if (pinch.event === 'start') startCharge('camera');
  if (lastInferenceAt) inferenceFps += (1000 / Math.max(1, now - lastInferenceAt) - inferenceFps) * 0.15;
  lastInferenceAt = now;
  $('#tracking-fps').textContent = `${Math.round(inferenceFps)} FPS`;
  if (!hand.tracked) {
    clearHandUI();
    drawHand([]); pointer = null; experience.setAim(null); swipe.update(null, now);
    $('#tracking').dataset.state = 'searching';
    $('#tracking-label').textContent = '请把手放回画面 · 阵法已保留';
    $('#gesture-label').textContent = '等待手部';
    $('#live-gesture').textContent = '等待手部 · 不触发动作';
    if (now - lastSeenAt > 600) {
      neutralPalm = null;
      if (chargeSource === 'camera') cancelCharge();
    }
    return;
  }
  lastSeenAt = now;
  gesture = hand.gesture;
  const { points, metrics } = hand;
  drawHand(points);
  $('#tracking').dataset.state = 'tracked';
  $('#tracking-label').textContent = '已锁定手部';
  $('#gesture-label').textContent = hand.rawGesture === 'neutral' ? '姿势不明确 · 保持不动再试' : gestureNames[hand.rawGesture] || '识别中';
  $('#live-gesture').textContent = hand.rawGesture === 'neutral'
    ? '姿势不明确 · 不触发动作' : `${gestureNames[hand.rawGesture]}${gesture !== hand.rawGesture ? ' · 确认中' : ' · 已确认'}`;
  $('#gesture-progress').style.width = `${hand.progress * 100}%`;
  // A charge transition consumes this pose: it must not also fold/rise the field.
  if (pinch.active || pinch.event) {
    clearHandUI(); pointer = null; experience.setAim(null); swipe.reset(); return;
  }
  if (gesture !== hand.rawGesture) { clearHandUI(); pointer = null; experience.setAim(null); }
  if (gesture === 'point' && hand.rawGesture === 'point') {
    pointer = handPointer(points[8], innerWidth, innerHeight);
    experience.setAim(pointer.x, pointer.y);
    const target = experience.screenToWorld(pointer.x, pointer.y);
    if (experience.state === 'hidden' && experience.summon(target.x, target.y)) sound.seed();
    else if (experience.state === 'seed') {
      experience.moveSeed(target.x, target.y);
      experience.setSeedIntensity(Math.min(1, metrics.palmSize * 5));
    }
  } else { clearHandUI(); pointer = null; experience.setAim(null); }
  if (gesture === 'fist' && hand.changed && !pinch.blockFist) {
    if (experience.talismans.enabled) recallTalisman();
    else if (experience.state === 'seed' && experience.flatten()) sound.flatten();
    else if (['rising', 'risen'].includes(experience.state) && experience.flattenBack()) sound.fold();
  }
  if (gesture === 'palm' && hand.rawGesture === 'palm') {
    if (!neutralPalm) neutralPalm = { ...metrics.palm, roll: metrics.roll };
    if (experience.state === 'flat' && hand.changed && !challenge.snapshot.active && !experience.talismans.enabled) {
      if (experience.rise()) sound.rise();
    } else if (experience.state === 'risen') {
      experience.guide(metrics.palm.x, metrics.palm.y, metrics.roll, neutralPalm);
    }
    if (swipe.update(metrics.palm.x, now)) toggleVortex();
  } else {
    swipe.update(null, now);
    if (gesture !== 'palm') neutralPalm = null;
  }
  if (gesture === 'peace' && hand.changed && now - lastPeaceAt > 900) {
    changeTheme(); lastPeaceAt = now;
  }
}

async function enableCamera() {
  if (loadingCamera || mode === 'camera') return;
  $('#error').hidden = true;
  enterExperience('camera');
  loadingCamera = true; updateMode();
  const session = ++cameraSession;
  let localHands = null;
  let localStream = null;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('此浏览器未提供摄像头接口，请使用 localhost 或 HTTPS');
    toast('正在启动本地手部识别…');
    const { Hands } = await import('@mediapipe/hands');
    if (session !== cameraSession) return;
    localHands = new Hands({ locateFile: (file) =>
      new URL(`mediapipe/${file}`, document.baseURI).href });
    hands = localHands;
    localHands.setOptions({ maxNumHands: 2, modelComplexity: 1,
      minDetectionConfidence: 0.55, minTrackingConfidence: 0.6 });
    localHands.onResults((results) => { if (session === cameraSession) handleResults(results); });
    localStream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    if (session !== cameraSession) { localStream.getTracks().forEach((t) => t.stop()); return; }
    cameraStream = localStream;
    video.srcObject = localStream;
    await video.play();
    if (session !== cameraSession) return;
    await localHands.initialize();
    if (session !== cameraSession) return;
    loadingCamera = false; updateMode();
    lastInferenceAt = 0; inferenceFps = 30;
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (session === cameraSession) { stopCamera(); toast('摄像头已断开，已切换手动模式'); }
    }, { once: true });
    async function infer() {
      if (session !== cameraSession) return;
      try {
        if (video.readyState >= 2 && !document.hidden) await localHands.send({ image: video });
        if (session === cameraSession) frameHandle = requestAnimationFrame(infer);
      } catch (error) {
        if (session === cameraSession) cameraError(error);
      }
    }
    frameHandle = requestAnimationFrame(infer);
    toast('摄像头已就绪 · 伸出食指唤醒阵眼');
  } catch (error) {
    localStream?.getTracks().forEach((track) => track.stop());
    if (session === cameraSession) cameraError(error);
  }
}

function cameraError(error) {
  console.error(error);
  stopCamera();
  const reason = ({ NotAllowedError: '摄像头权限未开启', NotFoundError: '没有找到摄像头',
    NotReadableError: '摄像头被其他程序占用' })[error.name] || '摄像头或本地识别模型加载失败';
  $('#error').textContent = `${reason}。已切换手动模式，可点击“启用摄像头”重试。`;
  $('#error').hidden = false;
}

$('#enable-camera').addEventListener('click', enableCamera);
$('#manual-mode').addEventListener('click', () => enterExperience('manual'));
$('#camera-toggle').addEventListener('click', () => mode === 'camera' ? stopCamera() : enableCamera());
$('#preview-toggle').addEventListener('click', () => {
  $('#camera-preview').hidden = !$('#camera-preview').hidden;
  $('#preview-toggle').setAttribute('aria-pressed', String(!$('#camera-preview').hidden));
});
$('#sensitivity').addEventListener('change', (event) => tracker.setSensitivity(event.target.value));
$('#reset').addEventListener('click', reset);
$('#advance').addEventListener('click', advance);
$('#vortex').addEventListener('click', toggleVortex);
$('#theme').addEventListener('click', changeTheme);
$('#challenge').addEventListener('click', toggleChallenge);
$('#talisman-mode').addEventListener('click', toggleTalismans);
$('#cast-talisman').addEventListener('click', () => {
  if (!experience.talismans.enabled) toggleTalismans();
  else castTalisman();
});
$('#recall-talisman').addEventListener('click', recallTalisman);
$('#oracle-recall').addEventListener('click', recallTalisman);
$('#oracle-recast').addEventListener('click', drawAnotherTalisman);
$('#gesture-scroll-up').addEventListener('click', () => $('#play-panel').scrollBy({ top: -170, behavior: 'smooth' }));
$('#gesture-scroll-down').addEventListener('click', () => $('#play-panel').scrollBy({ top: 170, behavior: 'smooth' }));
$('#talisman-type').addEventListener('change', (event) => {
  experience.talismans.setVariant(Number(event.target.value));
  $('#talisman-text').value = TALISMANS[experience.talismans.variant].words;
  experience.talismans.setText($('#talisman-text').value);
  if (experience.talismans.enabled) sound.talisman(experience.talismans.variant);
});
function applyTalismanText() {
  const text = experience.talismans.setText($('#talisman-text').value);
  $('#talisman-text').value = text;
  if (!experience.talismans.enabled) toggleTalismans();
  $('#talisman-status').textContent = `符文「${text}」已写入 · 大字竖排`;
  sound.resume(); sound.collect(0);
}
$('#apply-talisman-text').addEventListener('click', applyTalismanText);
$('#talisman-text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) applyTalismanText();
});
$('#size').addEventListener('input', (event) => experience.setZoom(Number(event.target.value) / 100));
$('#size-down').addEventListener('click', () => experience.scaleBy(0.9));
$('#size-up').addEventListener('click', () => experience.scaleBy(1.1));
$('#volume').addEventListener('input', (event) => {
  sound.resume(); sound.setVolume(Number(event.target.value) / 100);
  $('#volume-value').textContent = `${event.target.value}%`;
});
for (const [id, delta] of [['volume-down', -10], ['volume-up', 10]]) {
  $(`#${id}`).addEventListener('click', () => {
    $('#volume').value = Math.max(0, Math.min(100, Number($('#volume').value) + delta));
    $('#volume').dispatchEvent(new Event('input', { bubbles: true }));
  });
}
$('#sound-test').addEventListener('click', () => {
  if (sound.status.muted) sound.toggleMute();
  if (sound.status.volume === 0) { sound.setVolume(0.65); $('#volume').value = 65; $('#volume-value').textContent = '65%'; }
  sound.test(); toast('音效试听 · 已播放清脆铃音');
});
$('#mute').addEventListener('click', () => {
  const muted = sound.toggleMute();
  $('#mute').textContent = muted ? '静音' : '声音';
  $('#mute').setAttribute('aria-pressed', String(muted));
});
$('#charge').addEventListener('pointerdown', (event) => {
  event.preventDefault(); $('#charge').setPointerCapture(event.pointerId); startCharge('button');
});
$('#charge').addEventListener('pointerup', releaseCharge);
$('#charge').addEventListener('pointercancel', cancelCharge);
$('#charge').addEventListener('lostpointercapture', () => { if (chargeSource === 'button') cancelCharge(); });
$('#charge').addEventListener('keydown', (event) => {
  if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) startCharge('button'); }
});
$('#charge').addEventListener('keyup', (event) => {
  if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); releaseCharge(); }
});

canvas.addEventListener('click', (event) => {
  if (!gate.hidden || challenge.snapshot.active) return;
  sound.resume();
  if (experience.talismans.enabled) { castTalisman(); return; }
  if (experience.state === 'hidden') {
    const target = experience.screenToWorld(event.clientX, event.clientY);
    if (experience.summon(target.x, target.y)) sound.seed();
  } else advance();
});
canvas.addEventListener('pointermove', (event) => {
  if (!gate.hidden || mode === 'camera') return;
  pointer = { x: event.clientX, y: event.clientY, source: 'manual' };
  experience.setAim(pointer.x, pointer.y);
  if (!challenge.snapshot.active) experience.manualGuide(event.clientX / innerWidth - 0.5, event.clientY / innerHeight - 0.5);
});
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' && mode !== 'camera') {
    pointer = { x: event.clientX, y: event.clientY, source: 'manual' };
    experience.setAim(pointer.x, pointer.y);
    canvas.setPointerCapture(event.pointerId);
  }
});
canvas.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'mouse') { pointer = null; experience.setAim(null); }
});
canvas.addEventListener('pointercancel', () => { pointer = null; experience.setAim(null); });
canvas.addEventListener('pointerleave', () => {
  if (pointer?.source === 'manual') { pointer = null; experience.setAim(null); }
});
canvas.addEventListener('wheel', (event) => {
  if (!gate.hidden) return;
  event.preventDefault(); experience.scaleBy(event.deltaY > 0 ? 0.94 : 1.06);
}, { passive: false });
window.addEventListener('keydown', (event) => {
  if (!gate.hidden || event.target.closest('button, select, input') || event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === ' ') { event.preventDefault(); startCharge('keyboard'); }
  if (key === 'v') toggleVortex();
  if (key === 't') changeTheme();
  if (key === 'g') toggleChallenge();
  if (key === 'f') toggleTalismans();
  if (key === '+' || key === '=') experience.scaleBy(1.1);
  if (key === '-') experience.scaleBy(0.9);
  if (key === 'r') reset();
  if (key === 'm') $('#mute').click();
  if (key === 'escape') stopCamera();
});
window.addEventListener('keyup', (event) => {
  if (event.key === ' ' && chargeSource === 'keyboard') { event.preventDefault(); releaseCharge(); }
});
function suspendInput() { clearHandUI(); cancelCharge(); pinchController.reset(); palmZoom.reset(); pointer = null; experience.setAim(null); tracker.reset(); neutralPalm = null; }
window.addEventListener('blur', suspendInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { suspendInput(); sound.suspend(); }
  else if (mode !== 'idle') sound.resume();
});
window.addEventListener('pagehide', () => { stopCamera(); sound.dispose(); });

let previousFrame = performance.now();
function update(now) {
  const dt = Math.min((now - previousFrame) / 1000, 0.1);
  previousFrame = now;
  updateHandUI(now);
  if (mode === 'camera' && now - lastSeenAt > 350) { pointer = null; experience.setAim(null); }
  if (chargeSource === 'camera' && now - lastSeenAt > 350) {
    const pinch = pinchController.update({ tracked: false }, now);
    if (pinch.event === 'cancel') cancelCharge();
  }
  if (charging) {
    chargeValue = Math.min(1, (now - chargeStarted) / 1600);
    experience.setCharge(chargeValue);
    sound.charge(chargeValue);
    $('#charge-fill').style.width = `${chargeValue * 100}%`;
    $('#charge-label').textContent = chargeValue >= 1 ? '灵力已满 · 松开释放' : `聚气中 · ${Math.round(chargeValue * 100)}%`;
  }
  if (challenge.snapshot.active) {
    const hit = pointer && !pointingAtUI ? experience.hitTarget(pointer.x, pointer.y) : -1;
    const result = challenge.update(hit, dt);
    const state = challenge.snapshot;
    experience.showChallenge(state.target, state.lit);
    $('#challenge-count').textContent = `${state.collected} / 8`;
    $('#challenge-progress').style.width = `${state.progress * 100}%`;
    $('#challenge-copy').textContent = state.active
      ? `寻找「${TRIGRAMS[state.target]}」· 停在闪烁光点保持半秒`
      : `八卦归位 · ${state.elapsed.toFixed(1)} 秒！再来一次？`;
    if (result.collectedNow) sound.collect(state.collected);
    if (result.complete) {
      experience.releaseEnergy(1); sound.burst(1);
      $('#challenge').setAttribute('aria-pressed', 'false');
      toast(`八卦归位！用时 ${state.elapsed.toFixed(1)} 秒`);
    }
  }
  requestAnimationFrame(update);
}
requestAnimationFrame(update);
new ResizeObserver(() => experience.resize()).observe($('#play-panel'));

// Development-only rehearsal: synthetic landmarks traverse the real recognizer,
// action routing and dwell UI. No camera or test event listener ships in dist.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('gesture-rehearsal')) {
  document.documentElement.dataset.gestureRehearsal = 'ready';
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === 'hui-test-start') enterExperience('camera');
    if (event.data?.type === 'hui-test-frame') handleResults({ multiHandLandmarks: event.data.hands });
  });
}
