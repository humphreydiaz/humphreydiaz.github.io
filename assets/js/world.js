/**
 * The 3D world: a data corridor the camera travels down as the page scrolls.
 *
 * Layout runs along -Z. The camera dollies from z = 0 to z = -640, and every
 * content section has a matching "station" staged at a known depth, so the
 * whole page reads as one continuous space rather than seven separate scenes.
 *
 * Materials are deliberately mixed — PBR metal with real environment
 * reflections next to procedural grids, additive neon and photo planes —
 * because an all-wireframe scene reads as a diagram, not as a place.
 */

import * as THREE from '../vendor/three.module.min.js';
import {
  QUAD_VERT, GRID_VERT, GRID_FRAG, PARTICLE_VERT, PARTICLE_FRAG,
  PORTRAIT_VERT, PORTRAIT_FRAG, PANEL_FRAG, LABEL_FRAG, CORE_VERT, CORE_FRAG
} from './shaders.js';
import { makeGlyphTile, makeMonolithLabel, makeCaption } from './labels.js';

export const Z = {
  home: 0, about: -90, capabilities: -190,
  stack: -300, builds: -410, core: -530, contact: -620
};

const GREEN = new THREE.Color('#05f76e');
const CYAN = new THREE.Color('#00fbff');
const DIM = new THREE.Color('#0a2b3a');

/** Tech names for the orbiting stack helix — straight from the README. */
const STACK = [
  ['PHP', 'ADVANCED'], ['MySQL', 'ADVANCED'], ['JavaScript', 'INTERMEDIATE'],
  ['HTML5', 'ADVANCED'], ['CSS3', 'ADVANCED'], ['SQL', 'ADVANCED'],
  ['MariaDB', 'DATABASE'], ['AdminLTE', 'TEMPLATE'], ['Bootstrap', 'FRAMEWORK'],
  ['XAMPP', 'LOCAL'], ['WAMP', 'LOCAL'], ['Git', 'VERSION'],
  ['GitHub', 'REMOTE'], ['Arduino', 'HARDWARE'], ['IoT', 'CONCEPTS'],
  ['PWA', 'EXPLORING'], ['REST', 'API'], ['Apache', 'SERVER']
];

const MONOLITHS = [
  { title: 'Web Systems', lines: ['PHP / SQL / JS', 'AdminLTE + Bootstrap'] },
  { title: 'Offline First', lines: ['WAMP / XAMPP', 'No uplink required'] },
  { title: 'Info Systems', lines: ['Student + faculty', 'Attendance / grading'] },
  { title: 'Civic Tech', lines: ['LGU services', 'Public guidance'] },
  { title: 'Hardware + IoT', lines: ['Arduino', 'Sensor integration'] }
];

export class World {
  constructor(renderer, textures, quality) {
    this.renderer = renderer;
    this.textures = textures;
    this.quality = quality;
    this.time = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#04070a');
    this.scene.fog = new THREE.FogExp2(0x04070a, 0.0052);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);
    this.camera.position.set(0, 1.6, 12);

    this.pointer = new THREE.Vector2();
    this._pointerTarget = new THREE.Vector2();

    this._buildEnvironment();
    this._buildLights();
    this._buildCorridor();
    this._buildRails();
    this._buildParticles();
    this._buildPortraits();
    this._buildMonoliths();
    this._buildStackHelix();
    this._buildPanels();
    this._buildCore();
    this._buildHorizon();
  }

  /* -------------------------------------------------------------- *
   * Environment map — what the metal actually reflects
   * -------------------------------------------------------------- */

  _buildEnvironment() {
    // A 2:1 equirect gradient with a few bright bands. Cheap to generate and
    // it gives the monoliths streaked highlights that read as a real room.
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');

    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.00, '#000a10');
    g.addColorStop(0.42, '#06323f');
    g.addColorStop(0.52, '#0b5f6f');
    g.addColorStop(0.62, '#04222c');
    g.addColorStop(1.00, '#000508');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);

    // Vertical light bands, like the rails reflected.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = (i / 9) * 512 + 12;
      const grad = ctx.createLinearGradient(x - 10, 0, x + 10, 0);
      grad.addColorStop(0, 'rgba(0,251,255,0)');
      grad.addColorStop(0.5, i % 3 === 0 ? 'rgba(5,247,110,0.55)' : 'rgba(0,251,255,0.42)');
      grad.addColorStop(1, 'rgba(0,251,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - 10, 40, 20, 176);
    }
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.envMap = pmrem.fromEquirectangular(tex).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();
    tex.dispose();
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x16323f, 1.1));

    // Two travelling lights keep the monoliths from going flat as they pass.
    this.lightA = new THREE.PointLight(CYAN, 240, 90, 2);
    this.lightB = new THREE.PointLight(GREEN, 180, 80, 2);
    this.scene.add(this.lightA, this.lightB);
  }

  /* -------------------------------------------------------------- *
   * Corridor: floor + ceiling procedural grids
   * -------------------------------------------------------------- */

  _makeGridMaterial(color, opacity, pulse) {
    return new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color.clone() },
        uTime: { value: 0 },
        uScale: { value: 4.0 },
        uOpacity: { value: opacity },
        uPulse: { value: pulse },
        uFade: { value: 190 }
      }
    });
  }

  _buildCorridor() {
    const geo = new THREE.PlaneGeometry(300, 1500);
    this.gridFloorMat = this._makeGridMaterial(CYAN, 0.85, 0.7);
    this.gridCeilMat = this._makeGridMaterial(GREEN, 0.42, 0.4);

    this.gridFloor = new THREE.Mesh(geo, this.gridFloorMat);
    this.gridFloor.rotation.x = -Math.PI / 2;
    this.gridFloor.position.set(0, -4.2, -320);

    this.gridCeil = new THREE.Mesh(geo, this.gridCeilMat);
    this.gridCeil.rotation.x = Math.PI / 2;
    this.gridCeil.position.set(0, 12.5, -320);

    this.scene.add(this.gridFloor, this.gridCeil);
  }

  /** Vertical neon strips down both walls. One instanced draw call. */
  _buildRails() {
    const count = 68;
    const geo = new THREE.BoxGeometry(0.14, 15, 0.14);
    const mat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    });

    this.rails = new THREE.InstancedMesh(geo, mat, count);
    this.rails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.railPhase = new Float32Array(count);

    const m = new THREE.Matrix4();
    const colour = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 20 - Math.floor(i / 2) * 20;
      m.makeTranslation(side * 15.5, 4, z);
      this.rails.setMatrixAt(i, m);
      this.railPhase[i] = Math.random() * Math.PI * 2;
      colour.copy(i % 5 === 0 ? GREEN : CYAN);
      this.rails.setColorAt(i, colour);
    }
    this.rails.instanceMatrix.needsUpdate = true;
    if (this.rails.instanceColor) this.rails.instanceColor.needsUpdate = true;
    this.scene.add(this.rails);
  }

  /* -------------------------------------------------------------- *
   * Particle field — travels with the camera and wraps, so it never ends
   * -------------------------------------------------------------- */

  _buildParticles() {
    const count = this.quality.particles;
    const span = 320;
    const pos = new Float32Array(count * 3);
    const scale = new Float32Array(count);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Hollow out the middle so particles don't sit on the camera lens.
      const r = 4 + Math.pow(Math.random(), 0.7) * 46;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r * 0.55 + 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * span;
      scale[i] = 0.35 + Math.pow(Math.random(), 2.2) * 1.9;
      seed[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.particleMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 2.2 },
        uDrift: { value: 0 },
        uSpan: { value: span },
        uColorA: { value: CYAN.clone() },
        uColorB: { value: GREEN.clone() }
      }
    });

    this.particles = new THREE.Points(geo, this.particleMat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this._drift = 0;
  }

  /* -------------------------------------------------------------- *
   * Photo planes
   * -------------------------------------------------------------- */

  _makePortrait(texture, height, tint) {
    const aspect = texture.image.width / texture.image.height;
    const mat = new THREE.ShaderMaterial({
      vertexShader: PORTRAIT_VERT,
      fragmentShader: PORTRAIT_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: texture },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uVel: { value: 0 },
        uOpacity: { value: 0 },
        uDissolve: { value: 0 },
        uRim: { value: CYAN.clone() },
        uTint: { value: tint.clone() }
      }
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(height * aspect, height, 1, 1),
      mat
    );
    mesh.frustumCulled = false;
    return mesh;
  }

  _makeCaptionPlane(text, sub, width, accent) {
    const { texture, aspect } = makeCaption(text, sub, { accent });
    const mat = new THREE.ShaderMaterial({
      vertexShader: PORTRAIT_VERT,
      fragmentShader: LABEL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: texture },
        uColor: { value: new THREE.Color('#ffffff') },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uGlitch: { value: 0 }
      }
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / aspect), mat
    );
    mesh.frustumCulled = false;
    return mesh;
  }

  _buildPortraits() {
    const t = this.textures;

    // Chapter 0 — the alpha cutout, front and centre.
    this.portraitCutout = this._makePortrait(t.cutout, 13.2, new THREE.Color('#9fe8ff'));
    this.portraitCutout.position.set(0, 2.4, Z.home - 17);
    this.scene.add(this.portraitCutout);

    // Chapter 1 — the datacenter plate, pushed to one side.
    this.portraitCyber = this._makePortrait(t.cyber, 12.5, new THREE.Color('#a8f0ff'));
    this.portraitCyber.position.set(-8.5, 3.4, Z.about - 14);
    this.portraitCyber.rotation.y = 0.30;
    this.scene.add(this.portraitCyber);

    // Chapter 4 — the HUD interaction shot, anchoring the projects run.
    this.portraitHud = this._makePortrait(t.hud, 13.0, new THREE.Color('#a8ecff'));
    this.portraitHud.position.set(9.5, 3.6, Z.builds - 6);
    this.portraitHud.rotation.y = -0.34;
    this.scene.add(this.portraitHud);

    this.captions = [
      { mesh: this._makeCaptionPlane('HUMPHREY DIAZ', 'INSTRUCTOR II // DEVELOPER', 11, '#00fbff'), anchor: this.portraitCutout, offset: new THREE.Vector3(0, -7.6, 0.4) },
      { mesh: this._makeCaptionPlane('SIGNAL', 'EDUCATION x SOFTWARE x PUBLIC SERVICE', 10, '#05f76e'), anchor: this.portraitCyber, offset: new THREE.Vector3(0, -7.2, 0.4) },
      { mesh: this._makeCaptionPlane('BUILDS', 'SYSTEMS IN PRODUCTION', 9, '#00fbff'), anchor: this.portraitHud, offset: new THREE.Vector3(0, -7.6, 0.4) }
    ];
    for (const c of this.captions) {
      c.mesh.position.copy(c.anchor.position).add(c.offset);
      c.mesh.rotation.copy(c.anchor.rotation);
      this.scene.add(c.mesh);
    }
  }

  /* -------------------------------------------------------------- *
   * Monoliths — metallic slabs with reflections and emissive edges
   * -------------------------------------------------------------- */

  _buildMonoliths() {
    this.monoliths = [];
    const slabGeo = new THREE.BoxGeometry(6.4, 22, 1.8);
    const edgeGeo = new THREE.BoxGeometry(6.6, 0.10, 2.0);

    MONOLITHS.forEach((data, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const z = Z.capabilities + 40 - i * 26;

      const group = new THREE.Group();
      group.position.set(side * 10.5, 3, z);
      group.rotation.y = side * -0.42;

      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a1a24,
        metalness: 0.96,
        roughness: 0.17,
        envMap: this.envMap,
        envMapIntensity: 1.5
      });
      const slab = new THREE.Mesh(slabGeo, mat);
      group.add(slab);

      // Emissive rails top and bottom.
      const edgeMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? CYAN : GREEN,
        transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      for (const y of [10.6, -10.6]) {
        const e = new THREE.Mesh(edgeGeo, edgeMat);
        e.position.y = y;
        group.add(e);
      }

      // Label mapped onto the face.
      const { texture, aspect } = makeMonolithLabel(
        i + 1, data.title, data.lines,
        { accent: i % 2 === 0 ? '#00fbff' : '#05f76e' }
      );
      const labelMat = new THREE.ShaderMaterial({
        vertexShader: PORTRAIT_VERT,
        fragmentShader: LABEL_FRAG,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uMap: { value: texture },
          uColor: { value: new THREE.Color('#ffffff') },
          uOpacity: { value: 1 },
          uTime: { value: 0 },
          uGlitch: { value: 0 }
        }
      });
      const lw = 5.4;
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(lw, lw / aspect), labelMat
      );
      label.position.z = 0.95;
      group.add(label);

      group.visible = false;
      this.scene.add(group);
      this.monoliths.push({ group, mat, edgeMat, labelMat, side, baseY: 3 });
    });
  }

  /* -------------------------------------------------------------- *
   * Stack helix — the ring whose spin the scrollbar drives
   * -------------------------------------------------------------- */

  _buildStackHelix() {
    this.stackGroup = new THREE.Group();
    this.stackGroup.position.set(0, 4, Z.stack);
    this.stackTiles = [];

    const radius = 12.5;
    const zSpread = 120;

    STACK.forEach(([name, sub], i) => {
      const t = i / STACK.length;
      const angle = t * Math.PI * 6;          // three full turns
      const z = (t - 0.5) * zSpread;

      const { texture, aspect } = makeGlyphTile(name, {
        sub,
        accent: i % 3 === 0 ? '#05f76e' : '#00fbff'
      });

      const mat = new THREE.ShaderMaterial({
        vertexShader: PORTRAIT_VERT,
        fragmentShader: LABEL_FRAG,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uMap: { value: texture },
          uColor: { value: new THREE.Color('#ffffff') },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uGlitch: { value: 0 }
        }
      });

      const w = 5.2;
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(w, w / aspect), mat);
      tile.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.62,
        z
      );
      // Face the axis but angled toward the approaching camera, so tiles are
      // readable on the way in rather than only in peripheral vision.
      tile.lookAt(0, 0, z + 16);
      tile.frustumCulled = false;

      this.stackGroup.add(tile);
      this.stackTiles.push({ tile, mat });
    });

    this.stackGroup.visible = false;
    this.scene.add(this.stackGroup);
  }

  /* -------------------------------------------------------------- *
   * Holographic project panels — lit by the matching DOM card
   * -------------------------------------------------------------- */

  _buildPanels() {
    this.panels = [];
    const geo = new THREE.PlaneGeometry(9.5, 6.2);

    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = Z.builds + 46 - i * 22;

      const mat = new THREE.ShaderMaterial({
        vertexShader: PORTRAIT_VERT,
        fragmentShader: PANEL_FRAG,
        transparent: true, depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: (i % 2 === 0 ? CYAN : GREEN).clone() },
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uActive: { value: 0 }
        }
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(side * 11, 2.5 + (i % 3) * 3.2, z);
      mesh.rotation.y = side * -0.48;
      mesh.rotation.z = side * 0.04;
      mesh.frustumCulled = false;
      mesh.visible = false;

      this.scene.add(mesh);
      this.panels.push({ mesh, mat, target: 0 });
    }
  }

  /* -------------------------------------------------------------- *
   * The core — fresnel shell plus an inner particle sphere
   * -------------------------------------------------------------- */

  _buildCore() {
    this.coreGroup = new THREE.Group();
    this.coreGroup.position.set(0, 4, Z.core - 18);

    this.coreMat = new THREE.ShaderMaterial({
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uOpacity: { value: 0 },
        uColorA: { value: GREEN.clone() },
        uColorB: { value: CYAN.clone() }
      }
    });
    this.coreShell = new THREE.Mesh(new THREE.IcosahedronGeometry(7, 3), this.coreMat);
    this.coreGroup.add(this.coreShell);

    // Wireframe cage over the shell for structure.
    this.coreCageMat = new THREE.MeshBasicMaterial({
      color: CYAN, wireframe: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.coreCage = new THREE.Mesh(new THREE.IcosahedronGeometry(9.2, 1), this.coreCageMat);
    this.coreGroup.add(this.coreCage);

    // Inner points.
    const n = Math.min(2600, Math.floor(this.quality.particles / 4));
    const pos = new Float32Array(n * 3);
    const scale = new Float32Array(n);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 5.6 * Math.cbrt(Math.random());
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * r;
      pos[i * 3 + 1] = Math.sin(a) * s * r;
      pos[i * 3 + 2] = u * r;
      scale[i] = 0.4 + Math.random() * 1.2;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.coreDustMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 2.0 },
        uDrift: { value: 0 },
        uSpan: { value: 1e6 },      // effectively disables Z wrapping
        uColorA: { value: GREEN.clone() },
        uColorB: { value: CYAN.clone() }
      }
    });
    this.coreDust = new THREE.Points(geo, this.coreDustMat);
    this.coreDust.frustumCulled = false;
    this.coreGroup.add(this.coreDust);

    this.coreGroup.visible = false;
    this.scene.add(this.coreGroup);
  }

  /* -------------------------------------------------------------- *
   * Horizon — where the corridor opens out at the end
   * -------------------------------------------------------------- */

  _buildHorizon() {
    // Radial glow sprite at the vanishing point.
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0.0, 'rgba(180,255,250,0.95)');
    g.addColorStop(0.18, 'rgba(0,251,255,0.55)');
    g.addColorStop(0.48, 'rgba(5,247,110,0.16)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;

    this.horizonMat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    this.horizon = new THREE.Sprite(this.horizonMat);
    this.horizon.scale.set(120, 120, 1);
    this.horizon.position.set(0, 5, Z.contact - 70);
    this.scene.add(this.horizon);
  }

  /* -------------------------------------------------------------- *
   * Per-frame
   * -------------------------------------------------------------- */

  setPointer(x, y) {
    this._pointerTarget.set(x, y);
  }

  update(dt, scroll, glitch, motion) {
    this.time += dt;
    const t = this.time;

    // Pointer eases toward its target so the parallax never snaps.
    this.pointer.x += (this._pointerTarget.x - this.pointer.x) * Math.min(1, dt * 3.2);
    this.pointer.y += (this._pointerTarget.y - this.pointer.y) * Math.min(1, dt * 3.2);

    const vel = scroll.velocity;

    // --- shared uniforms ------------------------------------------
    this.gridFloorMat.uniforms.uTime.value = t;
    this.gridCeilMat.uniforms.uTime.value = t;

    // --- particles: drift takes velocity with NO base term, so the
    //     field genuinely reverses when the page scrolls up ---------
    this._drift += (vel * 9 + (motion ? 1.4 : 0)) * dt;
    this.particleMat.uniforms.uDrift.value = this._drift;
    this.particleMat.uniforms.uTime.value = t;
    this.particles.position.z = this.camera.position.z - 120;

    // --- travelling lights ----------------------------------------
    const cz = this.camera.position.z;
    this.lightA.position.set(Math.sin(t * 0.4) * 9, 9, cz - 14);
    this.lightB.position.set(Math.sin(t * 0.31 + 2) * -9, 1, cz - 30);

    // --- rails flicker ---------------------------------------------
    this.rails.material.opacity = 0.42 + Math.sin(t * 2.1) * 0.06 + Math.abs(vel) * 0.05;

    // --- portraits --------------------------------------------------
    for (const p of [this.portraitCutout, this.portraitCyber, this.portraitHud]) {
      p.material.uniforms.uTime.value = t;
      p.material.uniforms.uVel.value = vel;
      p.material.uniforms.uGlitch.value = glitch;
    }
    // Mouse parallax on the hero plate only — subtle, and only while it's up.
    this.portraitCutout.position.x = this.pointer.x * 1.15;
    this.portraitCutout.position.y = 2.4 + this.pointer.y * 0.7;
    this.portraitCutout.rotation.y = this.pointer.x * 0.10;
    this.portraitCutout.rotation.x = -this.pointer.y * 0.06;

    for (const c of this.captions) {
      c.mesh.material.uniforms.uTime.value = t;
      c.mesh.material.uniforms.uGlitch.value = glitch;
      c.mesh.position.copy(c.anchor.position).add(c.offset);
      c.mesh.rotation.copy(c.anchor.rotation);
    }

    // --- monoliths: slow counter-drift, plus glitch on the labels ---
    for (let i = 0; i < this.monoliths.length; i++) {
      const m = this.monoliths[i];
      if (!m.group.visible) continue;
      m.group.position.y = m.baseY + Math.sin(t * 0.5 + i) * 0.35;
      m.group.rotation.y += (m.side * -0.42 - m.group.rotation.y) * 0.02;
      m.labelMat.uniforms.uTime.value = t;
      m.labelMat.uniforms.uGlitch.value = glitch * 0.7;
      m.edgeMat.opacity = 0.65 + Math.sin(t * 3 + i * 1.7) * 0.2;
    }

    // --- stack helix: THE scroll-driven rotation --------------------
    // No base spin term on the velocity component, so scrolling up runs the
    // ring backwards rather than merely slowing it down.
    if (this.stackGroup.visible) {
      this.stackRotation = (this.stackRotation || 0) +
        (vel * 0.9 + (motion ? 0.10 : 0)) * dt;
      this.stackGroup.rotation.z = this.stackRotation;
      for (const s of this.stackTiles) {
        s.mat.uniforms.uTime.value = t;
        s.mat.uniforms.uGlitch.value = glitch;
      }
    }

    // --- panels ------------------------------------------------------
    for (const p of this.panels) {
      if (!p.mesh.visible) continue;
      p.mat.uniforms.uTime.value = t;
      const cur = p.mat.uniforms.uActive.value;
      p.mat.uniforms.uActive.value = cur + (p.target - cur) * Math.min(1, dt * 4);
    }

    // --- core --------------------------------------------------------
    if (this.coreGroup.visible) {
      const pulse = (Math.sin(t * 1.6) * 0.5 + 0.5) * 0.55 + Math.abs(vel) * 0.2;
      this.coreMat.uniforms.uTime.value = t;
      this.coreMat.uniforms.uPulse.value = pulse;
      this.coreDustMat.uniforms.uTime.value = t;
      this.coreShell.rotation.y += (0.10 + vel * 0.5) * dt;
      this.coreShell.rotation.x += 0.04 * dt;
      this.coreCage.rotation.y -= (0.16 + vel * 0.7) * dt;
      this.coreCage.rotation.z += 0.05 * dt;
      this.coreDust.rotation.y += (0.2 + vel * 0.9) * dt;
      this.coreCageMat.opacity = this.coreMat.uniforms.uOpacity.value * 0.28;
    }
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q) {
    this.quality = q;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const key in m.uniforms || {}) {
            const v = m.uniforms[key].value;
            if (v && v.isTexture) v.dispose();
          }
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    if (this.envMap) this.envMap.dispose();
  }
}
