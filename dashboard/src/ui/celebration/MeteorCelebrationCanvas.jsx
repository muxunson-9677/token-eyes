import React from "react";
import CelebrationCanvas from "./CelebrationCanvas.jsx";
import {
  TAU,
  clamp,
  drawGlow,
  drawLine,
  fadeTransparentSurface,
  hsla,
  lifecycleFade,
  pickRandom,
  randomBetween,
} from "./celebration-canvas-drawing.js";

const METEOR_HUES = [186, 198, 210, 225, 250, 282, 34];

export function selectMeteorLane(initial, random = Math.random) {
  return random() < (initial ? 0.38 : 0.28) ? "front" : initial ? "rear" : "entry";
}

export function createMeteorScene(surface) {
  let meteors = [];
  let stars = [];
  let embers = [];
  const makeMeteor = (initial = false, giant = false) => {
    const depth = giant ? 1 : Math.pow(Math.random(), 1.6);
    const speed = (giant ? 900 : 340 + depth * 720) * surface.scale;
    const angle = randomBetween(2.25, 2.44);
    const lane = selectMeteorLane(initial);
    const entersFromTop = initial || Math.random() < 0.62;
    const x = lane === "front"
      ? randomBetween(surface.width * 0.08, surface.width * 0.38)
      : lane === "rear"
        ? randomBetween(surface.width * 0.42, surface.width * 0.68)
        : entersFromTop
        ? randomBetween(surface.width * 0.54, surface.width * 0.84)
        : randomBetween(surface.width * 0.66, surface.width * 0.86);
    const y = lane === "front"
      ? randomBetween(surface.height * 0.4, surface.height * 0.78)
      : lane === "rear"
        ? randomBetween(surface.height * 0.52, surface.height * 0.94)
        : entersFromTop
        ? randomBetween(surface.height * 0.26, surface.height * 0.52)
        : randomBetween(surface.height * 0.24, surface.height * 0.78);
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      depth,
      length: (giant ? 240 : 58 + depth * 170) * surface.scale,
      width: (giant ? 7 : 1 + depth * 5) * surface.scale,
      hue: pickRandom(METEOR_HUES),
      life: randomBetween(0.46, 0.96),
      age: initial ? randomBetween(0, 0.3) : 0,
      appearAt: randomBetween(0.02, 0.14),
      vanishAt: randomBetween(0.56, 0.86),
      edgeMargin: randomBetween(28, 84) * surface.scale,
    };
  };

  const reset = () => {
    const count = Math.floor(155 * surface.scale);
    meteors = Array.from({ length: count }, () => makeMeteor(true));
    meteors.push(makeMeteor(true, true), makeMeteor(true, true));
    stars = Array.from({ length: Math.floor(250 * surface.scale) }, () => ({
      x: randomBetween(0, surface.width),
      y: randomBetween(0, surface.height),
      radius: randomBetween(0.3, 1.4),
      alpha: randomBetween(0.15, 0.8),
      phase: randomBetween(0, TAU),
    }));
    embers = [];
  };

  const render = (time, delta) => {
    const { context, width, height, density } = surface;
    fadeTransparentSurface(context, width, height, 0.34);

    const starCount = Math.floor(stars.length * density);
    for (let index = 0; index < starCount; index += 1) {
      const star = stars[index];
      context.globalAlpha = star.alpha * (0.55 + 0.45 * Math.sin(time * (0.5 + star.radius) + star.phase));
      context.fillStyle = "#c6e9ff";
      context.fillRect(star.x, star.y, star.radius, star.radius);
    }
    context.globalAlpha = 1;

    const meteorCount = Math.max(1, Math.floor(meteors.length * density));
    for (let index = 0; index < meteorCount; index += 1) {
      const meteor = meteors[index];
      meteor.age += delta;
      meteor.x += meteor.vx * delta;
      meteor.y += meteor.vy * delta;
      const speed = Math.hypot(meteor.vx, meteor.vy);
      const tailX = meteor.x - (meteor.vx / speed) * meteor.length;
      const tailY = meteor.y - (meteor.vy / speed) * meteor.length;
      const nearestLineEdge = Math.min(
        meteor.x,
        tailX,
        width - meteor.x,
        width - tailX,
        meteor.y,
        tailY,
        height - meteor.y,
        height - tailY,
      );
      const edgeFade = clamp(nearestLineEdge / meteor.edgeMargin, 0, 1);
      const fade = edgeFade * lifecycleFade(
        meteor.age / meteor.life,
        meteor.appearAt,
        meteor.vanishAt,
      );
      drawLine(
        context,
        tailX,
        tailY,
        meteor.x,
        meteor.y,
        hsla(meteor.hue, 100, 60),
        meteor.width * 3.2,
        (0.2 + 0.25 * meteor.depth) * fade,
      );
      drawLine(
        context,
        tailX + (meteor.x - tailX) * 0.56,
        tailY + (meteor.y - tailY) * 0.56,
        meteor.x,
        meteor.y,
        "rgba(245,252,255,1)",
        Math.max(0.7, meteor.width * 0.52),
        0.96 * fade,
      );
      if (meteor.depth > 0.6) {
        drawGlow(context, meteor.x, meteor.y, 7 + meteor.width * 3.4, meteor.hue, 0.72 * fade);
      }
      if (meteor.depth > 0.72 && Math.random() < delta * 14 && embers.length < 260) {
        embers.push({
          x: meteor.x - randomBetween(0, 70),
          y: meteor.y - randomBetween(0, 50),
          vx: randomBetween(-140, 15),
          vy: randomBetween(20, 160),
          age: 0,
          life: randomBetween(0.25, 0.65),
          hue: meteor.hue,
          radius: randomBetween(0.7, 2.1),
        });
      }
      const offCanvas = meteor.x < -width * 0.16 || meteor.y > height * 1.16;
      if (meteor.age > meteor.life || offCanvas) {
        meteors[index] = makeMeteor(false, Math.random() < 0.014);
      }
    }

    const emberCount = Math.min(embers.length, Math.floor(260 * density));
    for (let index = emberCount - 1; index >= 0; index -= 1) {
      const ember = embers[index];
      ember.age += delta;
      ember.x += ember.vx * delta;
      ember.y += ember.vy * delta;
      context.globalAlpha = clamp(1 - ember.age / ember.life, 0, 1);
      context.fillStyle = hsla(ember.hue, 100, 78);
      context.fillRect(ember.x, ember.y, ember.radius, ember.radius);
      if (ember.age > ember.life) embers.splice(index, 1);
    }
    context.globalAlpha = 1;

    if (Math.random() < delta * 0.12 && meteors.length < 190) {
      meteors.push(makeMeteor(false, true));
    }
  };

  return { render, resize: reset };
}

export default function MeteorCelebrationCanvas({ onFallback, fitParent = false }) {
  return (
    <CelebrationCanvas
      effectId="meteors"
      createScene={createMeteorScene}
      onFallback={onFallback}
      fitParent={fitParent}
    />
  );
}
