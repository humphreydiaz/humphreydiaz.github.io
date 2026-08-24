/**
 * ScrollEngine — turns native page scroll into the signals the 3D world runs on.
 *
 * Native scrolling is left completely alone (no scroll-jacking), so touch,
 * keyboard, screen readers and the real scrollbar all behave normally. The
 * smoothing happens only on the value handed to the 3D scene.
 *
 * Published each frame:
 *   raw       0..1 document progress
 *   smooth    0..1 damped, this is what drives camera + staging
 *   velocity  SIGNED, normalised, clamped. Negative when scrolling up.
 *             This is what makes the animation reverse rather than just slow.
 *   chapter   index into CHAPTERS
 *   local     0..1 progress within the active chapter
 */

export const CHAPTERS = [
  { id: 'home',         label: 'IDENTITY',     start: 0.00, end: 0.14 },
  { id: 'about',        label: 'SIGNAL',       start: 0.14, end: 0.30 },
  { id: 'capabilities', label: 'CAPABILITIES', start: 0.30, end: 0.44 },
  { id: 'stack',        label: 'STACK',        start: 0.44, end: 0.58 },
  { id: 'builds',       label: 'BUILDS',       start: 0.58, end: 0.76 },
  { id: 'core',         label: 'CORE',         start: 0.76, end: 0.88 },
  { id: 'contact',      label: 'UPLINK',       start: 0.88, end: 1.00 }
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class ScrollEngine {
  constructor({ damping = 0.085, velocityScale = 26, velocityClamp = 3 } = {}) {
    this.damping = damping;
    this.velocityScale = velocityScale;
    this.velocityClamp = velocityClamp;

    this.raw = 0;
    this.smooth = 0;
    this.velocity = 0;
    this.chapter = 0;
    this.local = 0;
    this.chapterChanged = false;

    this._prevSmooth = 0;
    this._maxScroll = 1;
    this._listeners = [];

    this._onResize = this._measure.bind(this);
    this._measure();
    this._read();
    this.smooth = this._prevSmooth = this.raw;

    addEventListener('resize', this._onResize, { passive: true });
    addEventListener('orientationchange', this._onResize, { passive: true });
    addEventListener('load', this._onResize, { passive: true });
    // Late webfont / image loads change section heights.
    if (document.fonts) document.fonts.ready.then(this._onResize);
  }

  _measure() {
    this._maxScroll = Math.max(
      1,
      document.documentElement.scrollHeight - innerHeight
    );

    // Where each section ACTUALLY sits in the document. A section runs from
    // its own top to the next one's top, so the ranges tile [0, 1] exactly.
    const max = this._maxScroll;
    const tops = CHAPTERS.map((c) => {
      const el = document.getElementById(c.id);
      return el ? clamp(el.offsetTop / max, 0, 1) : null;
    });

    const sections = CHAPTERS.map((c, i) => ({
      start: tops[i] ?? i / CHAPTERS.length,
      end: i + 1 < CHAPTERS.length
        ? (tops[i + 1] ?? (i + 1) / CHAPTERS.length)
        : 1
    }));

    // The final section's top can land exactly on maxScroll — its height is
    // one viewport, so there is no scroll left to travel through it. That
    // would collapse its range to zero width and freeze the last chapter's
    // staging on its first frame. Walk backwards guaranteeing every section a
    // usable slice.
    const MIN = 0.05;
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].end - sections[i].start < MIN) {
        sections[i].start = Math.max(0, sections[i].end - MIN);
        if (i > 0) sections[i - 1].end = Math.min(sections[i - 1].end, sections[i].start);
      }
    }

    this._sections = sections;
  }

  /**
   * Remap real document progress onto the canonical chapter timeline the 3D
   * staging is authored against.
   *
   * On desktop the CSS spans are computed from CHAPTERS, so this is close to
   * identity. On mobile the sticky pin is dropped and sections size to their
   * content, so the real boundaries move — this keeps the camera and the
   * staging locked to whichever section is actually on screen either way.
   */
  _toCanonical(p) {
    const S = this._sections;
    if (!S || !S[0]) return p;

    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (!s) continue;
      const isLast = i === S.length - 1;
      if (p < s.end || isLast) {
        const span = Math.max(s.end - s.start, 1e-6);
        const t = clamp((p - s.start) / span, 0, 1);
        const c = CHAPTERS[i];
        return c.start + t * (c.end - c.start);
      }
    }
    return p;
  }

  _read() {
    const doc = clamp(scrollY / this._maxScroll, 0, 1);
    this.rawDoc = doc;
    this.raw = this._toCanonical(doc);
  }

  /** Call once per animation frame. `dt` in seconds. */
  update(dt) {
    this._read();

    // Frame-rate independent damping.
    const t = 1 - Math.pow(1 - this.damping, dt * 60);
    this.smooth += (this.raw - this.smooth) * t;

    // Signed velocity, normalised so it reads roughly -3..3 during a fast flick.
    const delta = (this.smooth - this._prevSmooth) / Math.max(dt, 0.0001);
    const target = clamp(
      delta * this.velocityScale,
      -this.velocityClamp,
      this.velocityClamp
    );
    this.velocity += (target - this.velocity) * Math.min(1, dt * 9);
    if (Math.abs(this.velocity) < 0.0015) this.velocity = 0;
    this._prevSmooth = this.smooth;

    // Chapter + local progress.
    const prevChapter = this.chapter;
    let idx = CHAPTERS.length - 1;
    for (let i = 0; i < CHAPTERS.length; i++) {
      if (this.smooth < CHAPTERS[i].end) { idx = i; break; }
    }
    this.chapter = idx;
    const c = CHAPTERS[idx];
    this.local = clamp((this.smooth - c.start) / (c.end - c.start), 0, 1);
    this.chapterChanged = prevChapter !== idx;

    if (this.chapterChanged) {
      for (const fn of this._listeners) fn(idx, CHAPTERS[idx], prevChapter);
    }
  }

  onChapterChange(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i > -1) this._listeners.splice(i, 1);
    };
  }

  /**
   * Progress across an arbitrary window of the document, eased and clamped.
   * Lets the scene stage things that don't line up with chapter boundaries.
   */
  window(start, end) {
    return clamp((this.smooth - start) / (end - start), 0, 1);
  }

  destroy() {
    removeEventListener('resize', this._onResize);
    removeEventListener('orientationchange', this._onResize);
    removeEventListener('load', this._onResize);
    this._listeners.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Interpolation helpers used by the chapter staging
 * ------------------------------------------------------------------ */

/** Smootherstep — zero first AND second derivative at both ends. */
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Sample a keyframe track: `track(p, [[0, 0], [0.5, 10], [1, 4]])`.
 * Segments are eased with smootherstep so the camera never snaps.
 */
export function track(p, keys) {
  if (p <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [p0, v0] = keys[i];
    const [p1, v1] = keys[i + 1];
    if (p >= p0 && p <= p1) {
      return lerp(v0, v1, smoothstep(p0, p1, p));
    }
  }
  return last[1];
}

export { clamp };
