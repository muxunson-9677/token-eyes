import React from "react";
import CelebrationCanvas from "./CelebrationCanvas.jsx";
import {
  TAU,
  clamp,
  drawGlow,
  fadeTransparentSurface,
  hsla,
  randomBetween,
} from "./celebration-canvas-drawing.js";

const PALETTES = [
  [42, 25, 8],
  [190, 205, 225],
  [315, 338, 18],
  [270, 292, 48],
  [120, 165, 195],
  [5, 28, 55],
];

const easeOut = (value) => 1 - Math.pow(1 - value, 3);

export function createFireworksScene(surface) {
  let sparks = [];
  let bursts = [];
  let queue = [];
  let clock = 0;

  const addBurst = (x, y, size = 1, type = "sphere", paletteIndex = null) => {
    const selectedPalette = paletteIndex ?? ((Math.random() * PALETTES.length) | 0);
    bursts.push({
      x,
      y,
      size,
      hue: PALETTES[selectedPalette][1],
      age: 0,
      life: type === "willow" ? 3.8 : 2.5,
    });
    if (bursts.length > 20) bursts.shift();

    const count = Math.min(
      2_600 - sparks.length,
      Math.floor(108 * size * surface.scale * surface.density),
    );
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * TAU + randomBetween(-0.045, 0.045);
      let speed = randomBetween(105, 310) * size;
      let life = randomBetween(1.75, 3.25);
      let drag = 0.982;
      let gravity = 78;
      if (type === "ring") speed = 245 * size * randomBetween(0.95, 1.05);
      else if (type === "double") speed = (index % 2 ? 160 : 285) * size * randomBetween(0.93, 1.07);
      else if (type === "willow") {
        speed = randomBetween(72, 195) * size;
        life = randomBetween(2.8, 4.3);
        drag = 0.992;
        gravity = 40;
      } else if (type === "dahlia") {
        speed = randomBetween(145, 360) * size * Math.pow(Math.random(), 0.3);
      }
      sparks.push({
        x,
        y,
        previousX: x,
        previousY: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life,
        drag,
        gravity,
        paletteIndex: selectedPalette,
        width: randomBetween(0.7, 1.9) * size,
      });
    }
  };

  const buildQueue = () => {
    queue = [
      [0.38, 0.72, 0.24, 1.25, "ring", 1],
      [0.78, 0.47, 0.68, 1.18, "willow", 0],
      [1.14, 0.14, 0.52, 1.25, "dahlia", 3],
      [1.52, 0.83, 0.60, 1.24, "sphere", 4],
      [1.88, 0.56, 0.28, 1.52, "double", 5],
      [2.25, 0.33, 0.42, 1.32, "sphere", 2],
      [2.72, 0.76, 0.72, 1.42, "willow", 0],
      [3.08, 0.20, 0.18, 1.35, "ring", 1],
      [3.44, 0.51, 0.53, 1.62, "dahlia", 2],
      [3.82, 0.91, 0.31, 1.27, "sphere", 5],
      [4.18, 0.68, 0.19, 1.52, "double", 3],
      [4.62, 0.31, 0.75, 1.45, "willow", 0],
      [5.02, 0.56, 0.26, 1.72, "dahlia", 2],
      [5.40, 0.84, 0.62, 1.38, "ring", 1],
      [5.76, 0.15, 0.42, 1.35, "sphere", 5],
    ];
    clock = 0;
  };

  const reset = () => {
    sparks = [];
    bursts = [];
    buildQueue();
    addBurst(surface.width * 0.28, surface.height * 0.34, 1.18, "sphere", 2);
  };

  const render = (_time, delta) => {
    const { context, width, height, density } = surface;
    fadeTransparentSurface(context, width, height, 0.115);
    clock += delta;
    while (queue.length && clock >= queue[0][0]) {
      const [, x, y, size, type, paletteIndex] = queue.shift();
      addBurst(x * width, y * height, size, type, paletteIndex);
    }

    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index];
      spark.age += delta;
      spark.previousX = spark.x;
      spark.previousY = spark.y;
      const drag = Math.pow(spark.drag, delta * 60);
      spark.vx *= drag;
      spark.vy = spark.vy * drag + spark.gravity * delta;
      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
      if (spark.age > spark.life) sparks.splice(index, 1);
    }

    const sparkCount = Math.floor(sparks.length * density);
    let glowBudget = 92;
    for (let index = 0; index < sparkCount; index += 1) {
      const spark = sparks[index];
      const life = clamp(1 - spark.age / spark.life, 0, 1);
      const bin = life > 0.67 ? 2 : life > 0.3 ? 1 : 0;
      const hue = PALETTES[spark.paletteIndex][1];
      context.strokeStyle = hsla(hue, 100, 62);
      context.globalAlpha = [0.3, 0.58, 0.96][bin];
      context.lineWidth = [1.45, 2.15, 3.05][bin];
      context.beginPath();
      context.moveTo(spark.previousX, spark.previousY);
      context.lineTo(spark.x, spark.y);
      context.stroke();
      context.strokeStyle = "rgba(255,248,236,.96)";
      context.globalAlpha = [0.28, 0.62, 1][bin];
      context.lineWidth = [0.55, 0.86, 1.2][bin];
      context.stroke();
      if (glowBudget > 0 && bin === 2 && index % 11 === 0) {
        drawGlow(context, spark.x, spark.y, spark.width * 7, hue, 0.42);
        glowBudget -= 1;
      }
    }

    for (let index = bursts.length - 1; index >= 0; index -= 1) {
      const burst = bursts[index];
      burst.age += delta;
      const core = clamp(1 - burst.age / 0.42, 0, 1);
      if (core > 0) {
        drawGlow(context, burst.x, burst.y, 132 * burst.size, burst.hue, core * 0.96);
        drawGlow(context, burst.x, burst.y, 46 * burst.size, 48, core);
      }
      const ring = clamp(burst.age / 0.85, 0, 1);
      if (ring < 1) {
        context.globalAlpha = Math.pow(1 - ring, 1.5) * 0.76;
        context.strokeStyle = "rgba(255,255,255,.92)";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(burst.x, burst.y, easeOut(ring) * 110 * burst.size, 0, TAU);
        context.stroke();
      }
      if (burst.age > burst.life) bursts.splice(index, 1);
    }
    context.globalAlpha = 1;
  };

  return { render, resize: reset };
}

export default function FireworksCelebrationCanvas({ onFallback }) {
  return (
    <CelebrationCanvas
      effectId="fireworks"
      createScene={createFireworksScene}
      onFallback={onFallback}
    />
  );
}
