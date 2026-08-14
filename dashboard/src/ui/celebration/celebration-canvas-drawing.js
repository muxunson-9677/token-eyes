export const TAU = Math.PI * 2;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function edgeFade(x, y, width, height, marginRatio = 0.14, pixelMargin = null) {
  const marginX = pixelMargin ?? Math.max(12, width * marginRatio);
  const marginY = pixelMargin ?? Math.max(12, height * marginRatio);
  return clamp(
    Math.min(x / marginX, (width - x) / marginX, y / marginY, (height - y) / marginY, 1),
    0,
    1,
  );
}

export function lifecycleFade(progress, appearAt = 0.08, vanishAt = 0.9) {
  if (progress <= appearAt || progress >= vanishAt) return 0;
  const phase = clamp((progress - appearAt) / Math.max(0.001, vanishAt - appearAt), 0, 1);
  return Math.sin(Math.PI * phase);
}

export const randomBetween = (min = 0, max = 1) => min + Math.random() * (max - min);
export const pickRandom = (values) => values[(Math.random() * values.length) | 0];
export const hsla = (hue, saturation, lightness, alpha = 1) => (
  `hsla(${hue},${saturation}%,${lightness}%,${alpha})`
);

export function fadeTransparentSurface(context, width, height, alpha) {
  context.globalCompositeOperation = "destination-out";
  context.globalAlpha = 1;
  context.fillStyle = `rgba(0,0,0,${alpha})`;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "lighter";
}

export function drawLine(context, x1, y1, x2, y2, color, width = 1, alpha = 1) {
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.globalAlpha = 1;
}

export function drawGlow(context, x, y, radius, hue = 200, alpha = 1) {
  if (radius <= 0.2 || alpha <= 0) return;
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `hsla(${hue},100%,96%,${alpha})`);
  gradient.addColorStop(0.12, `hsla(${hue},100%,76%,${alpha * 0.92})`);
  gradient.addColorStop(0.38, `hsla(${hue},100%,62%,${alpha * 0.36})`);
  gradient.addColorStop(1, `hsla(${hue},100%,55%,0)`);
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = 1;
  context.fillStyle = gradient;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
