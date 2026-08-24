/**
 * Text in the 3D scene, drawn to a 2D canvas and uploaded as a texture.
 *
 * Deliberately avoids FontLoader / TextGeometry: no extra vendored files, no
 * typeface JSON to fetch, crisp at any distance, and it can use the same
 * monospace stack as the HUD so the 3D labels and the DOM chrome match.
 */

import * as THREE from '../vendor/three.module.min.js';

const MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace";

/** Shared canvas keeps allocation down while building the scene. */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A bracketed glyph tile: [ PHP ] style, used for the orbiting stack ring.
 * Returns { texture, aspect }.
 */
export function makeGlyphTile(text, {
  width = 512,
  height = 256,
  color = '#d8fbff',
  accent = '#00fbff',
  sub = ''
} = {}) {
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  // Faint plate so the tile reads as an object, not floating text.
  ctx.fillStyle = 'rgba(6, 18, 26, 0.55)';
  ctx.fillRect(0, 0, width, height);

  // Corner brackets.
  const m = 16;
  const arm = 44;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.9;
  const corners = [
    [m, m, 1, 1], [width - m, m, -1, 1],
    [m, height - m, 1, -1], [width - m, height - m, -1, -1]
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * arm);
    ctx.stroke();
  }

  // Thin edge rule.
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 2;
  ctx.strokeRect(m, m, width - m * 2, height - m * 2);
  ctx.globalAlpha = 1;

  // Label.
  const size = sub ? 62 : 74;
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 22;
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, sub ? height / 2 - 22 : height / 2);

  if (sub) {
    ctx.shadowBlur = 8;
    ctx.font = `500 30px ${MONO}`;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, width / 2, height / 2 + 46);
  }

  return { texture: toTexture(c), aspect: width / height };
}

/**
 * A tall monolith label: an index number, a title and a rule.
 * Drawn portrait so it can be mapped onto the face of a standing slab.
 */
export function makeMonolithLabel(index, title, lines = [], {
  width = 512,
  height = 1024,
  accent = '#05f76e'
} = {}) {
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const pad = 46;

  // Index.
  ctx.font = `700 130px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.30;
  ctx.fillText(String(index).padStart(2, '0'), pad, pad);
  ctx.globalAlpha = 1;

  // Rule under the index.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 168);
  ctx.lineTo(width - pad, pad + 168);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Title, wrapped.
  ctx.font = `700 54px ${MONO}`;
  ctx.fillStyle = '#eafcff';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;

  const words = title.split(' ');
  let y = pad + 208;
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > width - pad * 2 && line) {
      ctx.fillText(line, pad, y);
      y += 64;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, pad, y); y += 64; }
  ctx.shadowBlur = 0;

  // Detail lines.
  ctx.font = `400 30px ${MONO}`;
  ctx.fillStyle = '#8fb3c4';
  y += 26;
  for (const l of lines) {
    ctx.fillText(`> ${l}`, pad, y);
    y += 44;
  }

  // Vertical tick strip down the right edge, for texture.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const ty = pad + 220 + i * 28;
    if (ty > height - pad) break;
    const w = (i % 4 === 0) ? 26 : 12;
    ctx.beginPath();
    ctx.moveTo(width - pad, ty);
    ctx.lineTo(width - pad - w, ty);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return { texture: toTexture(c), aspect: width / height };
}

/** Small caption plate used to tag the photo planes in 3D. */
export function makeCaption(text, sub = '', {
  width = 1024,
  height = 256,
  accent = '#00fbff'
} = {}) {
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Leading marker bar.
  ctx.fillStyle = accent;
  ctx.fillRect(0, height / 2 - 40, 8, 80);

  ctx.font = `700 58px ${MONO}`;
  ctx.fillStyle = '#eafcff';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.fillText(text, 34, sub ? height / 2 - 26 : height / 2);

  if (sub) {
    ctx.shadowBlur = 6;
    ctx.font = `400 32px ${MONO}`;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, 34, height / 2 + 38);
  }

  return { texture: toTexture(c), aspect: width / height };
}
