/**
 * Staging: scroll progress -> camera path + per-object state.
 *
 * All of it is keyframe tracks rather than imperative if/else on chapter
 * index, so every transition is continuous. Scrub the scrollbar backwards and
 * the whole scene runs in reverse exactly, with no state to unwind.
 *
 * The Z anchors here must stay in step with `Z` in world.js.
 */

import { track, clamp, lerp } from './scroll.js';
import { Z } from './world.js';

/* Camera dolly down the corridor. Deliberately slow at the start so the hero
 * plate holds while the visitor reads the name, then accelerates. */
const CAM_Z = [
  [0.00, 6], [0.06, 2], [0.14, -46], [0.22, -78], [0.30, -130],
  [0.44, -262], [0.58, -368], [0.76, -486], [0.88, -520], [1.00, -600]
];

const CAM_Y = [
  [0.00, 2.5], [0.30, 3.5], [0.50, 4.0], [0.76, 4.6], [1.00, 5.2]
];

/* Gentle lateral weave so the corridor never feels like a straight rail. */
const CAM_X = [
  [0.00, 0], [0.22, 1.5], [0.37, -1.8], [0.51, 1.2],
  [0.68, -1.5], [0.85, 0.6], [1.00, 0]
];

/* Where the camera looks, laterally — leans toward whichever photo plate is
 * staged in that chapter. */
const LOOK_X = [
  [0.00, 0], [0.18, -2.4], [0.30, 0], [0.44, 0],
  [0.62, 2.2], [0.76, 0], [1.00, 0]
];

/* The corridor tightens through the middle, then opens out at the end. */
const FOG = [
  [0.00, 0.0050], [0.30, 0.0068], [0.58, 0.0072], [0.80, 0.0040], [1.00, 0.0026]
];

const PORTRAIT_CUTOUT_OPACITY = [[0.005, 0], [0.030, 1], [0.075, 1], [0.105, 0]];
const PORTRAIT_CUTOUT_DISSOLVE = [[0.050, 0], [0.105, 1]];

const PORTRAIT_CYBER_OPACITY = [[0.145, 0], [0.175, 1], [0.235, 1], [0.265, 0]];
const PORTRAIT_CYBER_DISSOLVE = [[0.220, 0], [0.265, 1]];

const PORTRAIT_HUD_OPACITY = [[0.575, 0], [0.610, 1], [0.665, 1], [0.700, 0]];
const PORTRAIT_HUD_DISSOLVE = [[0.660, 0], [0.700, 1]];

const MONOLITH_OPACITY = [[0.160, 0], [0.225, 1], [0.480, 1], [0.530, 0]];
const STACK_OPACITY = [[0.400, 0], [0.460, 1], [0.570, 1], [0.620, 0]];
const PANEL_OPACITY = [[0.540, 0], [0.600, 1], [0.750, 1], [0.805, 0]];
const CORE_OPACITY = [[0.720, 0], [0.800, 1], [0.900, 1], [0.955, 0]];
const HORIZON_OPACITY = [[0.800, 0], [0.920, 0.55], [1.000, 0.95]];

const RAIL_OPACITY = [[0.00, 0.5], [0.65, 0.5], [0.80, 0.05], [1.00, 0]];
const CEIL_OPACITY = [[0.00, 0.42], [0.70, 0.42], [0.86, 0.08], [1.00, 0.04]];
const FLOOR_OPACITY = [[0.00, 0.85], [0.80, 0.85], [1.00, 0.55]];

/** Toggle an object's `visible` with a little slack around its opacity window. */
function gate(obj, p, lo, hi) {
  const v = p >= lo && p <= hi;
  if (obj.visible !== v) obj.visible = v;
  return v;
}

export function stage(world, scroll, dt) {
  const p = scroll.smooth;
  const vel = scroll.velocity;
  const cam = world.camera;

  /* ---------------- camera ---------------- */
  const px = world.pointer.x;
  const py = world.pointer.y;

  cam.position.z = track(p, CAM_Z);
  cam.position.y = track(p, CAM_Y) + py * 0.55;
  cam.position.x = track(p, CAM_X) + px * 0.85;

  // Look ahead down the corridor, leaning toward the staged plate.
  const lookX = track(p, LOOK_X) + px * 1.5;
  cam.lookAt(lookX, cam.position.y + py * 0.8 - 0.4, cam.position.z - 30);

  // Bank into the scroll. Small, but it is what makes fast scrolling feel
  // like movement rather than a slideshow.
  const roll = -vel * 0.018;
  cam.rotation.z += (roll - cam.rotation.z) * Math.min(1, dt * 5);

  /* ---------------- atmosphere ---------------- */
  world.scene.fog.density = track(p, FOG);
  world.gridFloorMat.uniforms.uOpacity.value = track(p, FLOOR_OPACITY);
  world.gridCeilMat.uniforms.uOpacity.value = track(p, CEIL_OPACITY);
  world.rails.material.opacity = track(p, RAIL_OPACITY) *
    (0.85 + Math.sin(world.time * 2.1) * 0.12 + Math.abs(vel) * 0.08);
  world.rails.visible = track(p, RAIL_OPACITY) > 0.01;

  /* ---------------- photo plates ---------------- */
  const cut = world.portraitCutout;
  if (gate(cut, p, 0.0, 0.13)) {
    cut.material.uniforms.uOpacity.value = track(p, PORTRAIT_CUTOUT_OPACITY);
    cut.material.uniforms.uDissolve.value = track(p, PORTRAIT_CUTOUT_DISSOLVE);
  }

  const cyber = world.portraitCyber;
  if (gate(cyber, p, 0.13, 0.29)) {
    cyber.material.uniforms.uOpacity.value = track(p, PORTRAIT_CYBER_OPACITY);
    cyber.material.uniforms.uDissolve.value = track(p, PORTRAIT_CYBER_DISSOLVE);
    // Drifts inward as the camera closes, so it feels like it is being passed.
    cyber.position.x = lerp(-11, -6.5, scroll.window(0.14, 0.28));
  }

  const hud = world.portraitHud;
  if (gate(hud, p, 0.56, 0.72)) {
    hud.material.uniforms.uOpacity.value = track(p, PORTRAIT_HUD_OPACITY);
    hud.material.uniforms.uDissolve.value = track(p, PORTRAIT_HUD_DISSOLVE);
    hud.position.x = lerp(12, 7.5, scroll.window(0.575, 0.70));
  }

  // Captions ride their plate's opacity, slightly delayed.
  world.captions[0].mesh.material.uniforms.uOpacity.value =
    cut.visible ? track(p, PORTRAIT_CUTOUT_OPACITY) * 0.95 : 0;
  world.captions[0].mesh.visible = cut.visible;
  world.captions[1].mesh.material.uniforms.uOpacity.value =
    cyber.visible ? track(p, PORTRAIT_CYBER_OPACITY) * 0.95 : 0;
  world.captions[1].mesh.visible = cyber.visible;
  world.captions[2].mesh.material.uniforms.uOpacity.value =
    hud.visible ? track(p, PORTRAIT_HUD_OPACITY) * 0.95 : 0;
  world.captions[2].mesh.visible = hud.visible;

  /* ---------------- monoliths ---------------- */
  const monoOpacity = track(p, MONOLITH_OPACITY);
  for (let i = 0; i < world.monoliths.length; i++) {
    const m = world.monoliths[i];
    if (!gate(m.group, p, 0.15, 0.54)) continue;
    m.mat.opacity = monoOpacity;
    m.mat.transparent = monoOpacity < 0.995;
    m.labelMat.uniforms.uOpacity.value = monoOpacity;
    m.edgeMat.opacity *= monoOpacity;
  }

  /* ---------------- stack helix ---------------- */
  const stackOpacity = track(p, STACK_OPACITY);
  if (gate(world.stackGroup, p, 0.39, 0.63)) {
    for (const s of world.stackTiles) {
      s.mat.uniforms.uOpacity.value = stackOpacity;
    }
  }

  /* ---------------- project panels ---------------- */
  const panelOpacity = track(p, PANEL_OPACITY);
  for (const panel of world.panels) {
    if (!gate(panel.mesh, p, 0.53, 0.82)) continue;
    panel.mat.uniforms.uOpacity.value = panelOpacity;
  }

  /* ---------------- core ---------------- */
  const coreOpacity = track(p, CORE_OPACITY);
  if (gate(world.coreGroup, p, 0.71, 0.96)) {
    world.coreMat.uniforms.uOpacity.value = coreOpacity;
    world.coreDustMat.uniforms.uSize.value = 2.0 * coreOpacity;
    // Drifts up and away as the page moves on to contact.
    world.coreGroup.position.y = 4 + track(p, [[0.90, 0], [1.00, 7]]);
  }

  /* ---------------- horizon ---------------- */
  world.horizonMat.opacity = track(p, HORIZON_OPACITY);
  world.horizon.visible = world.horizonMat.opacity > 0.005;
}

/**
 * Light a 3D project panel when its matching DOM card scrolls into view.
 * Called by ui.js from an IntersectionObserver.
 */
export function setPanelActive(world, index, active) {
  const panel = world.panels[index];
  if (panel) panel.target = active ? 1 : 0;
}

export { clamp };
