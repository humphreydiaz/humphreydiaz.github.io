/**
 * Everything that lives in the DOM: the boot sequence, the HUD chrome, nav,
 * reveals, and the wiring that lets DOM elements drive the 3D scene.
 *
 * The page is fully readable with this module absent — it only ever adds
 * behaviour on top of content that is already in the markup.
 */

import { CHAPTERS, clamp } from './scroll.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ *
 * Boot sequence — doubles as the asset preloader
 * ------------------------------------------------------------------ */

const BOOT_LINES = [
  'initialising render pipeline',
  'compiling shader programs',
  'establishing uplink // binalatongan',
  'mounting portfolio data',
  'calibrating scroll telemetry'
];

export class BootSequence {
  constructor() {
    this.el = $('#boot');
    this.log = $('#boot-log');
    this.bar = $('#boot-bar');
    this.pct = $('#boot-pct');
    this.done = false;
    this._progress = 0;
    this._shown = 0;
    this._start = performance.now();
  }

  /** 0..1 from the texture loader. */
  setProgress(v) {
    this._progress = clamp(v, 0, 1);
    const shown = Math.round(this._progress * 100);
    if (this.bar) this.bar.style.width = `${shown}%`;
    if (this.pct) this.pct.textContent = String(shown).padStart(3, '0');

    // Reveal log lines in step with loading, so the terminal tracks reality.
    const want = Math.min(BOOT_LINES.length, Math.ceil(this._progress * BOOT_LINES.length));
    while (this._shown < want) this._pushLine(BOOT_LINES[this._shown++]);
  }

  _pushLine(text) {
    if (!this.log) return;
    const line = document.createElement('div');
    line.className = 'boot__line';
    line.innerHTML = `<span class="boot__caret">&gt;</span> ${text} <span class="boot__ok">OK</span>`;
    this.log.appendChild(line);
  }

  async finish() {
    if (this.done) return;
    this.done = true;

    // Hold briefly so the sequence reads as intentional rather than a stutter
    // on a fast connection.
    const elapsed = performance.now() - this._start;
    if (elapsed < 900) await sleep(900 - elapsed);

    while (this._shown < BOOT_LINES.length) this._pushLine(BOOT_LINES[this._shown++]);
    this._pushLine('<strong>system online</strong>');
    await sleep(420);

    document.body.classList.add('is-booted');
    this.el?.classList.add('is-out');
    await sleep(900);
    this.el?.remove();
  }

  fail(message) {
    this._pushLine(`<span class="boot__err">${message}</span>`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Section layout — CSS spans are derived from the chapter definitions so
 * the HTML and the 3D staging can never drift apart.
 * ------------------------------------------------------------------ */

export function applyChapterSpans() {
  const SCROLL_VH = 700;   // total scrollable distance, in viewport heights
  CHAPTERS.forEach((c, i) => {
    const section = document.getElementById(c.id);
    if (!section) return;
    let span = (c.end - c.start) * SCROLL_VH;
    // The final section carries one extra viewport so the page can end.
    if (i === CHAPTERS.length - 1) span += 100;
    section.style.setProperty('--span', span.toFixed(2));
  });
}

/** Scroll position (px) that puts a chapter comfortably on screen. */
function chapterScrollTop(index) {
  const c = CHAPTERS[index];
  const max = document.documentElement.scrollHeight - innerHeight;
  return (c.start + (c.end - c.start) * 0.3) * max;
}

/* ------------------------------------------------------------------ *
 * Navigation + chapter rail
 * ------------------------------------------------------------------ */

export class Navigation {
  constructor() {
    this.links = $$('[data-nav]');
    this.rail = $('#rail');
    this.ticks = [];
    this._build();
    this._bind();
  }

  _build() {
    if (!this.rail) return;
    CHAPTERS.forEach((c, i) => {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'rail__tick';
      tick.setAttribute('aria-label', `Jump to ${c.label}`);
      tick.innerHTML =
        `<span class="rail__num">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="rail__line"></span>` +
        `<span class="rail__label">${c.label}</span>`;
      tick.addEventListener('click', () => {
        scrollTo({ top: chapterScrollTop(i), behavior: 'smooth' });
      });
      this.rail.appendChild(tick);
      this.ticks.push(tick);
    });
  }

  _bind() {
    for (const link of this.links) {
      link.addEventListener('click', (e) => {
        const id = link.getAttribute('href')?.replace('#', '');
        const idx = CHAPTERS.findIndex((c) => c.id === id);
        if (idx < 0) return;
        e.preventDefault();
        scrollTo({ top: chapterScrollTop(idx), behavior: 'smooth' });
      });
    }
  }

  setActive(index) {
    this.ticks.forEach((t, i) => t.classList.toggle('is-active', i === index));
    const id = CHAPTERS[index].id;
    for (const link of this.links) {
      link.classList.toggle('is-active', link.getAttribute('href') === `#${id}`);
    }
  }

  setProgress(p) {
    if (this.rail) this.rail.style.setProperty('--progress', p.toFixed(4));
  }
}

/* ------------------------------------------------------------------ *
 * Telemetry HUD — makes the scroll/animation coupling visible
 * ------------------------------------------------------------------ */

export class Telemetry {
  constructor() {
    this.el = $('#telemetry');
    this.scrollEl = $('#tel-scroll');
    this.velEl = $('#tel-vel');
    this.fpsEl = $('#tel-fps');
    this.chapEl = $('#tel-chapter');
    this.arrowEl = $('#tel-arrow');
    this._fps = 60;
    this._acc = 0;
  }

  update(dt, scroll) {
    // Smooth the FPS readout so it is legible rather than jittering.
    this._fps += (1 / Math.max(dt, 0.0001) - this._fps) * 0.06;
    this._acc += dt;
    if (this._acc < 0.1) return;
    this._acc = 0;
    if (!this.el) return;

    const v = scroll.velocity;
    if (this.scrollEl) this.scrollEl.textContent = (scroll.smooth * 100).toFixed(1).padStart(5, '0');
    if (this.velEl) this.velEl.textContent = (v >= 0 ? '+' : '') + v.toFixed(2);
    if (this.fpsEl) this.fpsEl.textContent = String(Math.round(this._fps)).padStart(2, '0');
    if (this.chapEl) {
      this.chapEl.textContent =
        `${String(scroll.chapter + 1).padStart(2, '0')}//${CHAPTERS[scroll.chapter].label}`;
    }
    if (this.arrowEl) {
      this.arrowEl.textContent = v > 0.02 ? '▼' : v < -0.02 ? '▲' : '■';
      this.arrowEl.dataset.dir = v > 0.02 ? 'down' : v < -0.02 ? 'up' : 'idle';
    }
  }
}

/* ------------------------------------------------------------------ *
 * Reveals, skill bars, counters
 * ------------------------------------------------------------------ */

export function initReveals() {
  const items = $$('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const delay = Number(el.dataset.reveal) || 0;
      setTimeout(() => el.classList.add('is-in'), delay);
      io.unobserve(el);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });

  items.forEach((el) => io.observe(el));
}

export function initSkillBars() {
  const bars = $$('[data-skill]');
  if (!('IntersectionObserver' in window)) {
    bars.forEach((b) => { b.style.width = `${b.dataset.skill}%`; });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const bar = entry.target;
      bar.style.width = `${bar.dataset.skill}%`;
      io.unobserve(bar);
    }
  }, { threshold: 0.4 });
  bars.forEach((b) => io.observe(b));
}

/* ------------------------------------------------------------------ *
 * DOM -> 3D: light the matching holo panel as each project card appears
 * ------------------------------------------------------------------ */

export function linkProjectPanels(onChange) {
  const cards = $$('[data-panel]');
  if (!('IntersectionObserver' in window)) return;

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const idx = Number(entry.target.dataset.panel);
      onChange(idx, entry.isIntersecting);
      entry.target.classList.toggle('is-live', entry.isIntersecting);
    }
  }, { threshold: 0.45 });

  cards.forEach((c) => io.observe(c));
}

/* ------------------------------------------------------------------ *
 * Motion toggle — respected by every animated system
 * ------------------------------------------------------------------ */

const MOTION_KEY = 'hd-motion';

export class MotionControl {
  constructor() {
    this.button = $('#motion-toggle');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const stored = localStorage.getItem(MOTION_KEY);

    // The OS preference decides unless the visitor has overridden it here.
    this.enabled = stored === null ? !media.matches : stored === 'on';
    this._listeners = [];
    this._apply();

    this.button?.addEventListener('click', () => {
      this.enabled = !this.enabled;
      localStorage.setItem(MOTION_KEY, this.enabled ? 'on' : 'off');
      this._apply();
      for (const fn of this._listeners) fn(this.enabled);
    });

    media.addEventListener?.('change', (e) => {
      if (localStorage.getItem(MOTION_KEY) !== null) return;
      this.enabled = !e.matches;
      this._apply();
      for (const fn of this._listeners) fn(this.enabled);
    });
  }

  _apply() {
    document.body.classList.toggle('reduce-motion', !this.enabled);
    if (this.button) {
      this.button.setAttribute('aria-pressed', String(this.enabled));
      const label = $('.toggle__state', this.button);
      if (label) label.textContent = this.enabled ? 'ON' : 'OFF';
    }
  }

  onChange(fn) { this._listeners.push(fn); }
}

/* ------------------------------------------------------------------ *
 * Glitch bursts on headings
 * ------------------------------------------------------------------ */

export class GlitchText {
  constructor() {
    this.targets = $$('.glitch');
    // Mirror text content into data-text for the CSS pseudo-element copies.
    for (const el of this.targets) {
      if (!el.dataset.text) el.dataset.text = el.textContent.trim();
    }
  }

  burst(duration = 380) {
    for (const el of this.targets) {
      if (!isOnScreen(el)) continue;
      el.classList.add('is-glitching');
      setTimeout(() => el.classList.remove('is-glitching'), duration);
    }
  }
}

function isOnScreen(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
}

/* ------------------------------------------------------------------ *
 * Scanline sweep on chapter change
 * ------------------------------------------------------------------ */

export function sweep() {
  const el = $('#sweep');
  if (!el) return;
  el.classList.remove('is-sweeping');
  void el.offsetWidth;          // force reflow so the animation restarts
  el.classList.add('is-sweeping');
}

/* ------------------------------------------------------------------ *
 * Pointer input for scene parallax
 * ------------------------------------------------------------------ */

export function initPointer(onMove) {
  let raf = 0;
  let x = 0, y = 0;

  const flush = () => {
    raf = 0;
    onMove(x, y);
  };

  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;   // touch scrolling shouldn't tilt the scene
    x = (e.clientX / innerWidth) * 2 - 1;
    y = -((e.clientY / innerHeight) * 2 - 1);
    if (!raf) raf = requestAnimationFrame(flush);
  }, { passive: true });

  addEventListener('pointerleave', () => { x = 0; y = 0; onMove(0, 0); }, { passive: true });
}

export { $, $$ };
