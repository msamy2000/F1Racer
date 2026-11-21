import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  clonePBRSetWithRepeat,
  createBrakeBoardTexture,
  createCatchFenceTexture,
  createCircuitGantryBannerTexture,
  createPaintedRunoffTexture,
  createPitBoxMarkingTexture,
  createPitGarageHeaderTexture,
  createPitSpeedBoardTexture,
  createSponsorBarrierTexture,
  getCarbonFiberTexture,
  preloadTrackTextures,
} from '../rendering/TextureLibrary';

function withFullMockCanvas<T>(fn: () => T): T {
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => ({
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        fillText: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        fill: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'center',
        textBaseline: 'middle',
      }),
    }),
  };
  try {
    return fn();
  } finally {
    if (prevDoc === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  }
}

describe('TextureLibrary — Procedural F1 Textures & PBR Clones', () => {
  it('generates and caches diagonal twill woven carbon fiber texture', () => {
    withFullMockCanvas(() => {
      const t1 = getCarbonFiberTexture();
      const t2 = getCarbonFiberTexture();
      expect(t1).not.toBeNull();
      expect(t1).toBe(t2);
      expect(t1!.wrapS).toBe(THREE.RepeatWrapping);
      expect(t1!.wrapT).toBe(THREE.RepeatWrapping);
      expect(t1!.colorSpace).toBe(THREE.SRGBColorSpace);
    });
  });

  it('creates day and night F1 Sponsor Barrier textures with horizontal repeat', () => {
    withFullMockCanvas(() => {
      const dayTex = createSponsorBarrierTexture(false);
      const nightTex = createSponsorBarrierTexture(true);
      expect(dayTex.wrapS).toBe(THREE.RepeatWrapping);
      expect(dayTex.wrapT).toBe(THREE.ClampToEdgeWrapping);
      expect(dayTex.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(nightTex.colorSpace).toBe(THREE.SRGBColorSpace);
      dayTex.dispose();
      nightTex.dispose();
    });
  });

  it('creates FIA Catch-Fence, Painted Runoff, and Brake Board textures cleanly', () => {
    withFullMockCanvas(() => {
      const fence = createCatchFenceTexture();
      const runoff = createPaintedRunoffTexture('#C8102E', '#003A70');
      const board100 = createBrakeBoardTexture(100);

      expect(fence.wrapS).toBe(THREE.RepeatWrapping);
      expect(runoff.wrapT).toBe(THREE.RepeatWrapping);
      expect(board100.colorSpace).toBe(THREE.SRGBColorSpace);

      fence.dispose();
      runoff.dispose();
      board100.dispose();
    });
  });

  it('clones a PBR texture set with independent repeat factors without mutating source', () => {
    const src = {
      map: new THREE.Texture(),
      normalMap: new THREE.Texture(),
      roughnessMap: new THREE.Texture(),
    };
    src.map.repeat.set(1, 1);

    const cloned = clonePBRSetWithRepeat(src, 12, 48);
    expect(cloned.map).not.toBe(src.map);
    expect(cloned.map.repeat.x).toBe(12);
    expect(cloned.map.repeat.y).toBe(48);
    expect(cloned.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(cloned.normalMap.repeat.x).toBe(12);
    expect(cloned.roughnessMap.repeat.y).toBe(48);
    expect(src.map.repeat.x).toBe(1);

    cloned.map.dispose();
    cloned.normalMap.dispose();
    cloned.roughnessMap.dispose();
    src.map.dispose();
    src.normalMap.dispose();
    src.roughnessMap.dispose();
  });

  it('resolves preloadTrackTextures() safely in headless Node environments', async () => {
    const bundle = await preloadTrackTextures();
    expect(bundle).toHaveProperty('asphalt');
    expect(bundle).toHaveProperty('grass');
    expect(bundle).toHaveProperty('gravel');
  });

  it('generates pit garage headers, pit speed signs, pit box markings, and circuit gantry banners', () => {
    withFullMockCanvas(() => {
      const header = createPitGarageHeaderTexture('MERCEDES-AMG', '#00D2BE', '#C0C8D4');
      const speed = createPitSpeedBoardTexture(80);
      const box = createPitBoxMarkingTexture();
      const banner = createCircuitGantryBannerTexture('MONZA', 'ITALIAN GP', '#0E4A25', '#E10600');

      expect(header.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(speed.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(box.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(banner.colorSpace).toBe(THREE.SRGBColorSpace);

      header.dispose();
      speed.dispose();
      box.dispose();
      banner.dispose();
    });
  });
});
