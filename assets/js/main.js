/**
 * Entry point.
 *
 * Order of business: work out what this device can do, load textures behind
 * the boot sequence, build the world, then run one RAF loop that drives
 * scroll -> staging -> render.
 *
 * Every failure path here ends with a readable page rather than a broken one:
 * no WebGL, a texture that will not decode, or a shader that will not compile
 * all fall back to the plain DOM portfolio.
 */

import * as THREE from '../vendor/three.module.min.js';
import { ScrollEngine, clamp } from './scroll.js';
import { World } from './world.js';
import { stage, setPanelActive } from './chapters.js';
import { Composer } from './postfx.js';
import {
  BootSequence, Navigation, Telemetry, MotionControl, GlitchText,
  applyChapterSpans, initReveals, initSkillBars, linkProjectPanels,
  initPointer, sweep, $
} from './ui.js';

/* ------------------------------------------------------------------ *
 * Capability detection
 * ------------------------------------------------------------------ */

function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    // Some very old drivers report a context but cannot do float textures,
    // which the bloom chain relies on.
    return true;
  } catch {
    return false;
  }
}

function detectQuality() {
  const mobile = matchMedia('(max-width: 768px)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const lean = mobile || cores <= 4;

  return {
    mobile,
    particles: lean ? 4000 : 12000,
    bloom: !lean || !mobile,
    pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2)
  };
}

/* ------------------------------------------------------------------ *
 * Texture loading
 * ------------------------------------------------------------------ */

const TEXTURES = {
  cutout: './assets/img/portrait-cutout.webp',
  cyber: './assets/img/portrait-cyber.webp',
  hud: './assets/img/hud-panel.webp'
};

function loadTextures(onProgress) {
  const manager = new THREE.LoadingManager();
  const loader = new THREE.TextureLoader(manager);
  const out = {};
  const keys = Object.keys(TEXTURES);
  let loaded = 0;

  return new Promise((resolve, reject) => {
    manager.onLoad = () => resolve(out);
    manager.onError = (url) => reject(new Error(`failed to load ${url}`));

    for (const key of keys) {
      loader.load(TEXTURES[key], (tex) => {
        // sRGB textures are uploaded as SRGB8_ALPHA8, so the GPU linearises
        // them on sample — which is what custom shaders need.
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 4;
        out[key] = tex;
        onProgress(++loaded / keys.length);
      });
    }
  });
}

/* ------------------------------------------------------------------ *
 * Glitch scheduler
 * ------------------------------------------------------------------ */

class GlitchDriver {
  constructor(glitchText) {
    this.value = 0;
    this.glitchText = glitchText;
    this._next = 3 + Math.random() * 5;
    this._t = 0;
    this._burst = 0;
  }

  trigger(strength = 1, textToo = true) {
    this._burst = Math.max(this._burst, strength);
    if (textToo) this.glitchText.burst();
  }

  update(dt, velocity, motion) {
    if (!motion) {
      this.value += (0 - this.value) * Math.min(1, dt * 8);
      return this.value;
    }

    this._t += dt;
    if (this._t > this._next) {
      this._t = 0;
      this._next = 4 + Math.random() * 5;
      this.trigger(0.35 + Math.random() * 0.5, Math.random() > 0.5);
    }

    // Fast scrolling destabilises the image on its own.
    const fromScroll = clamp((Math.abs(velocity) - 0.55) * 0.34, 0, 0.6);

    this._burst *= Math.pow(0.0016, dt);         // fast exponential decay
    if (this._burst < 0.004) this._burst = 0;

    const target = Math.max(this._burst, fromScroll);
    this.value += (target - this.value) * Math.min(1, dt * 14);
    return this.value;
  }
}

/* ------------------------------------------------------------------ *
 * Adaptive quality — shed work if the device cannot keep up
 * ------------------------------------------------------------------ */

class QualityGovernor {
  constructor(composer) {
    this.composer = composer;
    this._samples = [];
    this._degraded = 0;
    this._cooldown = 3;
  }

  update(dt) {
    this._cooldown -= dt;
    if (this._cooldown > 0) return;

    this._samples.push(1 / Math.max(dt, 0.0001));
    if (this._samples.length < 90) return;

    const avg = this._samples.reduce((a, b) => a + b, 0) / this._samples.length;
    this._samples.length = 0;

    if (avg < 45 && this._degraded === 0) {
      this.composer.setBloom(false);
      this._degraded = 1;
      this._cooldown = 4;
    } else if (avg < 35 && this._degraded === 1) {
      // Last resort: drop the device pixel ratio.
      this._degraded = 2;
      this.onDropResolution?.();
      this._cooldown = 6;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function main() {
  applyChapterSpans();

  const boot = new BootSequence();
  const motion = new MotionControl();
  const glitchText = new GlitchText();
  const nav = new Navigation();
  const telemetry = new Telemetry();

  initReveals();
  initSkillBars();

  const scroll = new ScrollEngine();

  // --- no WebGL: ship the DOM portfolio and stop here ----------------
  if (!detectWebGL()) {
    document.body.classList.add('no-webgl');
    boot.fail('webgl unavailable // rendering static mode');
    await boot.finish();
    runDomOnlyLoop(scroll, nav, telemetry);
    return;
  }

  const canvas = $('#stage');
  const quality = detectQuality();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // the composite pass does its own smoothing
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
  } catch (err) {
    document.body.classList.add('no-webgl');
    boot.fail('renderer init failed // static mode');
    await boot.finish();
    runDomOnlyLoop(scroll, nav, telemetry);
    return;
  }

  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false;

  // --- textures ------------------------------------------------------
  let textures;
  try {
    textures = await loadTextures((p) => boot.setProgress(p * 0.8));
  } catch (err) {
    console.error('[portfolio]', err);
    document.body.classList.add('no-webgl');
    boot.fail('asset load failed // static mode');
    await boot.finish();
    runDomOnlyLoop(scroll, nav, telemetry);
    return;
  }

  // --- world ---------------------------------------------------------
  const world = new World(renderer, textures, quality);
  const composer = new Composer(renderer, { bloom: quality.bloom });
  composer.setSize(innerWidth, innerHeight, quality.pixelRatio);
  boot.setProgress(0.92);

  const governor = new QualityGovernor(composer);
  governor.onDropResolution = () => {
    quality.pixelRatio = Math.max(1, quality.pixelRatio * 0.75);
    renderer.setPixelRatio(quality.pixelRatio);
    composer.setSize(innerWidth, innerHeight, quality.pixelRatio);
  };

  const glitch = new GlitchDriver(glitchText);

  initPointer((x, y) => world.setPointer(x, y));
  linkProjectPanels((i, active) => setPanelActive(world, i, active));

  scroll.onChapterChange(() => {
    glitch.trigger(0.8);
    if (motion.enabled) sweep();
  });

  // Force one compile + render so the first visible frame is complete rather
  // than a flash of empty canvas.
  world.resize(innerWidth, innerHeight);
  stage(world, scroll, 0.016);
  renderer.compile(world.scene, world.camera);
  composer.render(world.scene, world.camera);
  boot.setProgress(1);

  await boot.finish();
  glitch.trigger(1);

  // --- resize --------------------------------------------------------
  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      renderer.setSize(innerWidth, innerHeight, false);
      world.resize(innerWidth, innerHeight);
      composer.setSize(innerWidth, innerHeight, quality.pixelRatio);
    });
  };
  addEventListener('resize', onResize, { passive: true });
  addEventListener('orientationchange', onResize, { passive: true });

  // --- main loop -----------------------------------------------------
  let last = performance.now();
  let running = true;

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  });

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);

    // Clamp so a backgrounded tab or a hitch cannot fling the scene forward.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    scroll.update(dt);
    const g = glitch.update(dt, scroll.velocity, motion.enabled);

    world.update(dt, scroll, g, motion.enabled);
    stage(world, scroll, dt);

    const u = composer.uniforms;
    u.uTime.value = world.time;
    u.uGlitch.value = g;
    u.uVel.value = scroll.velocity;
    u.uScan.value = motion.enabled ? 0.055 : 0.02;
    u.uGrain.value = motion.enabled ? 0.045 : 0.018;

    composer.render(world.scene, world.camera);

    nav.setActive(scroll.chapter);
    nav.setProgress(scroll.smooth);
    telemetry.update(dt, scroll);
    governor.update(dt);
  }

  requestAnimationFrame(frame);

  // Expose for debugging without polluting behaviour.
  window.__portfolio = { world, composer, scroll, renderer, quality };
}

/**
 * Without WebGL the HUD still works — it just has nothing to drive.
 * Keeping it live means the nav, rail and telemetry stay consistent.
 */
function runDomOnlyLoop(scroll, nav, telemetry) {
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    scroll.update(dt);
    nav.setActive(scroll.chapter);
    nav.setProgress(scroll.smooth);
    telemetry.update(dt, scroll);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error('[portfolio] fatal', err);
  document.body.classList.add('no-webgl', 'is-booted');
  document.getElementById('boot')?.remove();
});
