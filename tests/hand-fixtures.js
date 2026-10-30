const point = (x, y, z = 0) => ({ x, y, z });
export function poseHand(pose = 'palm') {
  const hand = Array.from({ length: 21 }, () => point(0.5, 0.75));
  hand[0] = point(0.5, 0.9, 0.02);
  hand[1] = point(0.42, 0.82); hand[2] = point(0.34, 0.75);
  hand[3] = point(0.29, 0.68); hand[4] = point(0.25, 0.6);
  const extended = pose === 'palm' || pose === 'pinch' ? [5, 9, 13, 17]
    : pose === 'point' ? [5] : pose === 'peace' ? [5, 9] : [];
  [[5, 0.38, 0.65], [9, 0.47, 0.62], [13, 0.56, 0.65], [17, 0.65, 0.68]]
    .forEach(([base, x, y]) => {
      hand[base] = point(x, y);
      if (extended.includes(base)) {
        hand[base + 1] = point(x, y - 0.12, -0.01);
        hand[base + 2] = point(x, y - 0.21, -0.018);
        hand[base + 3] = point(x, y - 0.29, -0.025);
      } else {
        hand[base + 1] = point(x, y - 0.085, -0.04);
        hand[base + 2] = point(x, y - 0.025, -0.075);
        hand[base + 3] = point(x, y + 0.055, -0.02);
      }
    });
  if (pose === 'pinch') {
    hand[6] = point(0.36, 0.53, -0.02); hand[7] = point(0.32, 0.55, -0.04);
    hand[8] = point(0.32, 0.62, -0.05); hand[4] = point(0.325, 0.625, -0.05);
  } else if (pose === 'fist') {
    hand[4] = { ...hand[8], x: hand[8].x + 0.01 };
  }
  return hand;
}

export function transformHand(hand, { scale = 1, roll = 0, yaw = 0, mirror = false, noise = 0, seed = 7 } = {}) {
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 - 0.5; };
  return hand.map((p) => {
    const x = (p.x - 0.5) * (mirror ? -1 : 1);
    const y = p.y - 0.5;
    const z = p.z;
    const rx = x * Math.cos(roll) - y * Math.sin(roll);
    const ry = x * Math.sin(roll) + y * Math.cos(roll);
    return { x: 0.5 + (rx * Math.cos(yaw) + z * Math.sin(yaw) + random() * noise) * scale,
      y: 0.5 + (ry + random() * noise) * scale,
      z: (-rx * Math.sin(yaw) + z * Math.cos(yaw) + random() * noise) * scale };
  });
}
