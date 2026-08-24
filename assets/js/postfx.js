/**
 * A small hand-rolled post chain: bright-pass -> two-axis blur -> composite.
 *
 * Written by hand rather than pulling in three's EffectComposer/UnrealBloomPass
 * so the whole pipeline is four vendored-dependency-free passes, the glitch is
 * fused into the composite (one texture read instead of another full-screen
 * round trip), and bloom can be dropped at runtime when a device is struggling.
 */

import * as THREE from '../vendor/three.module.min.js';
import {
  QUAD_VERT, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG
} from './shaders.js';

export class Composer {
  constructor(renderer, { bloom = true } = {}) {
    this.renderer = renderer;
    this.bloomEnabled = bloom;

    // One triangle-ish quad reused by every pass.
    this._quadGeo = new THREE.PlaneGeometry(2, 2);
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quadScene = new THREE.Scene();
    this._quad = new THREE.Mesh(this._quadGeo, null);
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);

    const rtOpts = {
      type: THREE.HalfFloatType,   // headroom for bloom, no clipping
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    };

    this.rtScene = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtA = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: 0.62 },
        uKnee: { value: 0.35 }
      }
    });

    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uDirection: { value: new THREE.Vector2() }
      }
    });

    this.matComposite = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uVel: { value: 0 },
        uBloom: { value: 0.85 },
        uScan: { value: 0.055 },
        uGrain: { value: 0.045 },
        uVignette: { value: 0.95 },
        uCurve: { value: 0.045 }
      }
    });

    this._blackTex = this._makeBlackTexture();
    this.matComposite.uniforms.tBloom.value = this._blackTex;
  }

  _makeBlackTexture() {
    // Stand-in when bloom is switched off, so the composite shader needs no
    // branch and no recompile.
    const data = new Uint8Array([0, 0, 0, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }

  setSize(width, height, pixelRatio) {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    this.rtScene.setSize(w, h);

    // Bloom runs at half resolution — cheap, and it reads softer anyway.
    const bw = Math.max(1, Math.floor(w / 2));
    const bh = Math.max(1, Math.floor(h / 2));
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);

    this.matComposite.uniforms.uResolution.value.set(w, h);
    this._bloomSize = { w: bw, h: bh };
  }

  setBloom(enabled) {
    this.bloomEnabled = enabled;
    if (!enabled) this.matComposite.uniforms.tBloom.value = this._blackTex;
  }

  _blit(material, target) {
    this._quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this._quadScene, this._quadCam);
  }

  render(scene, camera) {
    const r = this.renderer;

    // 1. Scene into a linear HDR target.
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // 2. Bloom: bright-pass, blur horizontally, blur vertically.
    if (this.bloomEnabled) {
      const { w, h } = this._bloomSize;

      this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
      this._blit(this.matBright, this.rtA);

      this.matBlur.uniforms.tDiffuse.value = this.rtA.texture;
      this.matBlur.uniforms.uDirection.value.set(1 / w, 0);
      this._blit(this.matBlur, this.rtB);

      this.matBlur.uniforms.tDiffuse.value = this.rtB.texture;
      this.matBlur.uniforms.uDirection.value.set(0, 1 / h);
      this._blit(this.matBlur, this.rtA);

      this.matComposite.uniforms.tBloom.value = this.rtA.texture;
    }

    // 3. Composite + glitch to the screen. Only pass that leaves linear space.
    this.matComposite.uniforms.tDiffuse.value = this.rtScene.texture;
    this._quad.material = this.matComposite;
    r.setRenderTarget(null);
    r.render(this._quadScene, this._quadCam);
  }

  get uniforms() {
    return this.matComposite.uniforms;
  }

  dispose() {
    this.rtScene.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this._quadGeo.dispose();
    this.matBright.dispose();
    this.matBlur.dispose();
    this.matComposite.dispose();
    this._blackTex.dispose();
  }
}
