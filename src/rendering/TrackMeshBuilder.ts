import * as THREE from 'three';
import type { AtmospherePreset } from '../data/circuits';
import { isSInZone, SAMPLE_COUNT, TrackSpline } from '../engine/TrackSpline';
import {
  clonePBRSetWithRepeat,
  createBarkTexture,
  createBrakingZoneSkidTexture,
  createCatchFenceTexture,
  createCircuitGantryBannerTexture,
  createFiaLightPanelTexture,
  createFoliageCanopyTexture,
  createGrandstandBannerTexture,
  createPaddockTruckTexture,
  createPaintedRunoffTexture,
  createPitBoxMarkingTexture,
  createPitGarageHeaderTexture,
  createPitSpeedBoardTexture,
  createSponsorBarrierTexture,
  createTreelineWallTexture,
  getCachedTrackTextures,
} from './TextureLibrary';

export interface BuiltTrackWorld {
  group: THREE.Group;
  racingLineMesh: THREE.Mesh;
  racingLineColors: Float32Array;
  racingLineSpeeds: Float32Array;
  startLightMaterials: THREE.MeshStandardMaterial[];
  vegasSphereMat: THREE.MeshStandardMaterial | null;
  updateStartLights(litCount: number): void;
  updateRacingLine(playerSpeedMps: number, mode: 'full' | 'corners' | 'off', clockSec: number): void;
  dispose(): void;
}

interface AsphaltPBRTextures {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

function createAsphaltTextures(): AsphaltPBRTextures {
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = 512;
  mapCanvas.height = 512;
  const ctx = mapCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bCtx = bumpCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 512;
  roughCanvas.height = 512;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base albedo with dark rubbered central racing groove
  const groove = ctx.createLinearGradient(0, 0, 512, 0);
  groove.addColorStop(0, '#2b2e36');
  groove.addColorStop(0.16, '#24272e');
  groove.addColorStop(0.5, '#1b1d23');
  groove.addColorStop(0.84, '#24272e');
  groove.addColorStop(1, '#2b2e36');
  ctx.fillStyle = groove;
  ctx.fillRect(0, 0, 512, 512);

  // Base bump mid-gray
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 512, 512);

  // Roughness map: glossy rubbered groove (lower value ~0.46) vs matte dusty edges (~0.90)
  const roughGrad = rCtx.createLinearGradient(0, 0, 512, 0);
  roughGrad.addColorStop(0, '#e6e6e6');
  roughGrad.addColorStop(0.14, '#d2d2d2');
  roughGrad.addColorStop(0.32, '#868686');
  roughGrad.addColorStop(0.5, '#727272');
  roughGrad.addColorStop(0.68, '#868686');
  roughGrad.addColorStop(0.86, '#d2d2d2');
  roughGrad.addColorStop(1, '#e6e6e6');
  rCtx.fillStyle = roughGrad;
  rCtx.fillRect(0, 0, 512, 512);

  // Fine asphalt mineral aggregate across albedo, bump & roughness
  for (let i = 0; i < 11000; i++) {
    const x = (i * 197) % 512;
    const y = (i * 313 + (i % 17) * 29) % 512;
    const v = 28 + ((i * 53) % 26);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ctx.fillRect(x, y, 2, 2);

    const bv = 90 + ((i * 71) % 105);
    bCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bCtx.fillRect(x, y, 2, 2);

    if (i % 3 === 0) {
      const rv = 155 + ((i * 41) % 65);
      rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
      rCtx.fillRect(x, y, 2, 2);
    }
  }

  // Crisp FIA white track limit lines along edges (matte paint)
  ctx.fillStyle = '#F0F2F7';
  ctx.fillRect(10, 0, 12, 512);
  ctx.fillRect(490, 0, 12, 512);
  rCtx.fillStyle = '#d4d4d4';
  rCtx.fillRect(10, 0, 12, 512);
  rCtx.fillRect(490, 0, 12, 512);

  const setup = (canvas: HTMLCanvasElement, isColor: boolean): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  return {
    map: setup(mapCanvas, true),
    bumpMap: setup(bumpCanvas, false),
    roughnessMap: setup(roughCanvas, false),
  };
}

function createSkyDomeTexture(atmosphere: AtmospherePreset): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 512);

  if (atmosphere === 'vegas-night') {
    grad.addColorStop(0, '#02040B');
    grad.addColorStop(0.38, '#080F24');
    grad.addColorStop(0.50, '#1D173A');
    grad.addColorStop(0.56, '#14182C');
    grad.addColorStop(1, '#060912');
  } else if (atmosphere === 'golden-park') {
    grad.addColorStop(0, '#366099');
    grad.addColorStop(0.32, '#7393B8');
    grad.addColorStop(0.49, '#F3AF74');
    grad.addColorStop(0.55, '#DF985E');
    grad.addColorStop(1, '#3A4A2B');
  } else if (atmosphere === 'alpine-day') {
    grad.addColorStop(0, '#1D5BB2');
    grad.addColorStop(0.34, '#5DA8E8');
    grad.addColorStop(0.50, '#CFEAFC');
    grad.addColorStop(0.58, '#8EC2E8');
    grad.addColorStop(1, '#2D5229');
  } else {
    grad.addColorStop(0, '#4E739E');
    grad.addColorStop(0.36, '#87ADD2');
    grad.addColorStop(0.51, '#C5D9EA');
    grad.addColorStop(0.58, '#A5BED6');
    grad.addColorStop(1, '#2D4728');
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  if (atmosphere === 'vegas-night') {
    // Crisp deterministic stars in upper night sky
    for (let i = 0; i < 360; i++) {
      const sx = (i * 347 + 29) % 1024;
      const sy = (i * 179 + 11) % 236;
      const alpha = 0.30 + ((i * 37) % 60) / 100;
      ctx.fillStyle = `rgba(235,244,255,${alpha.toFixed(2)})`;
      ctx.fillRect(sx, sy, 1, 1);
    }
  } else {
    // Soft sun glow bloom near horizon-mid sky
    const sunX = atmosphere === 'golden-park' ? 680 : 360;
    const sunY = atmosphere === 'golden-park' ? 224 : 152;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 144);
    sunGrad.addColorStop(0, 'rgba(255, 250, 232, 0.92)');
    sunGrad.addColorStop(0.3, 'rgba(255, 232, 186, 0.42)');
    sunGrad.addColorStop(1, 'rgba(255, 232, 186, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(sunX - 148, sunY - 148, 296, 296);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCrowdSeatingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1E2430';
  ctx.fillRect(0, 0, 256, 256);

  const fanColors = ['#E10600', '#FFFFFF', '#00D2BE', '#FFD700', '#FF8000', '#38BDF8', '#A855F7'];
  const cols = 16;
  const colW = 256 / cols;
  for (let c = 0; c < cols; c++) {
    // Tiered bench shadow & concrete step running parallel to track (along Y/Z)
    ctx.fillStyle = c % 2 === 0 ? '#272E3E' : '#1E2432';
    ctx.fillRect(c * colW, 0, colW, 256);
    ctx.fillStyle = '#121620';
    ctx.fillRect(c * colW + colW - 3, 0, 3, 256);

    // Spectators along the tier
    for (let y = 4; y < 252; y += 8) {
      const hash = (c * 37 + y * 13) % 100;
      if (hash > 18) {
        ctx.fillStyle = fanColors[(c + y) % fanColors.length];
        ctx.fillRect(c * colW + 3, y, colW - 7, 5);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createKerbTexture(primary: string, secondary: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const stripes = 8;
  const h = 256 / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? primary : secondary;
    ctx.fillRect(0, i * h, 64, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBrakingBoardTexture(distMeters: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#F7F8FA';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#E10600';
  ctx.lineWidth = 10;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#111318';
  ctx.font = '800 72px "Inter", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(distMeters), 128, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCheckeredTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const cols = 16;
  const rows = 4;
  const cw = 256 / cols;
  const ch = 64 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#FFFFFF' : '#121318';
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSkyscraperWindowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#070910';
  ctx.fillRect(0, 0, 256, 512);

  const colors = ['#FFE4A0', '#FFF6DC', '#7CE8FF', '#FFB86C'];
  for (let y = 14; y < 498; y += 18) {
    for (let x = 14; x < 242; x += 18) {
      // Deterministic pattern so ~55% of windows glow warmly
      const hash = ((x * 31 + y * 97) % 100) / 100;
      if (hash > 0.45) {
        ctx.fillStyle = colors[(x + y) % colors.length];
        ctx.fillRect(x, y, 10, 10);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createVegasSphereTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#00E5FF');
  grad.addColorStop(0.35, '#8B5CF6');
  grad.addColorStop(0.7, '#FF2E93');
  grad.addColorStop(1, '#FFD700');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 5;
  for (let y = 24; y < 256; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y - 22, 340, y + 22, 512, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildRibbonGeometry(
  pointsLeft: THREE.Vector3[],
  pointsRight: THREE.Vector3[],
  closed: boolean,
  uvRepeatY = 1,
): THREE.BufferGeometry {
  const count = pointsLeft.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const totalRows = closed ? count + 1 : count;
  for (let i = 0; i < totalRows; i++) {
    const srcIdx = i % count;
    const l = pointsLeft[srcIdx];
    const r = pointsRight[srcIdx];
    positions.push(l.x, l.y, l.z, r.x, r.y, r.z);
    const v = (i / (closed ? count : Math.max(1, count - 1))) * uvRepeatY;
    uvs.push(0, v, 1, v);
  }

  const segs = totalRows - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Vertical wall ribbon where U runs horizontally along the wall and V runs 0 (bottom) -> 1 (top). */
function buildWallGeometry(
  botPts: THREE.Vector3[],
  topPts: THREE.Vector3[],
  closed: boolean,
  uvRepeatAlong = 1,
  flipU = false,
): THREE.BufferGeometry {
  const count = botPts.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const totalCols = closed ? count + 1 : count;
  for (let i = 0; i < totalCols; i++) {
    const srcIdx = i % count;
    const b = botPts[srcIdx];
    const t = topPts[srcIdx];
    positions.push(b.x, b.y, b.z, t.x, t.y, t.z);
    const frac = i / (closed ? count : Math.max(1, count - 1));
    const u = (flipU ? 1 - frac : frac) * uvRepeatAlong;
    uvs.push(u, 0, u, 1);
  }

  const segs = totalCols - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Continuous 360° multi-ridge mountain panorama with rocky/snowy vertex colors (replaces low-poly cones). */
function buildMountainRangeMesh(
  atmosphere: AtmospherePreset,
  groundBaseY: number,
): THREE.Mesh {
  const radialSegs = 200;
  const heightRings = 7;
  const innerR = 1280;
  const outerR = 2350;
  const maxPeak = atmosphere === 'alpine-day' ? 320 : atmosphere === 'golden-park' ? 140 : 95;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const cBase = new THREE.Color(
    atmosphere === 'alpine-day' ? '#244127' : atmosphere === 'golden-park' ? '#2c4022' : '#2f452d',
  );
  const cMid = new THREE.Color(
    atmosphere === 'alpine-day' ? '#4f5d56' : atmosphere === 'golden-park' ? '#4a5a3a' : '#4a5a4e',
  );
  const cRock = new THREE.Color('#6b727c');
  const cSnow = new THREE.Color('#e8eef5');
  const tmpCol = new THREE.Color();

  for (let r = 0; r <= heightRings; r++) {
    const t = r / heightRings; // 0 = inner base, 0.55 = peak ridge, 1.0 = outer far slope
    const radius = THREE.MathUtils.lerp(innerR, outerR, t);
    // Ridge envelope: smoothly rises from 0 at inner base to 1 at ridge crest, drops at outer edge
    const ridgeEnv = Math.sin(t * Math.PI);
    const sharpened = Math.pow(ridgeEnv, 1.15);

    for (let i = 0; i <= radialSegs; i++) {
      const ang = (i / radialSegs) * Math.PI * 2;
      // Multi-octave deterministic FBM mountain profile
      const n1 = Math.sin(ang * 3 + 0.4) * 0.45 + 0.55;
      const n2 = Math.sin(ang * 7 - 1.2) * 0.28 + 0.28;
      const n3 = Math.sin(ang * 15 + 2.1) * 0.14 + 0.14;
      const n4 = Math.sin(ang * 31 - 0.7) * 0.06 + 0.06;
      const hNorm = Math.min(1, Math.max(0.08, (n1 + n2 + n3 + n4) * 0.65));
      const y = groundBaseY - 12 + sharpened * maxPeak * hNorm;

      positions.push(Math.cos(ang) * radius, y, Math.sin(ang) * radius);

      const elev = (y - groundBaseY) / Math.max(1, maxPeak);
      if (atmosphere === 'alpine-day') {
        if (elev < 0.38) {
          tmpCol.copy(cBase).lerp(cMid, elev / 0.38);
        } else if (elev < 0.68) {
          tmpCol.copy(cMid).lerp(cRock, (elev - 0.38) / 0.3);
        } else {
          tmpCol.copy(cRock).lerp(cSnow, Math.min(1, (elev - 0.68) / 0.25));
        }
      } else {
        tmpCol.copy(cBase).lerp(cMid, Math.min(1, elev * 1.4));
      }
      colors.push(tmpCol.r, tmpCol.g, tmpCol.b);
    }
  }

  const stride = radialSegs + 1;
  for (let r = 0; r < heightRings; r++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = r * stride + i;
      const b = a + 1;
      const c = (r + 1) * stride + i;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.02,
    flatShading: false,
  });
  return new THREE.Mesh(geo, mat);
}

/** Multi-plane crossed foliage canopy geometry so trees look volumetric from every camera angle. */
function buildCrossedFoliageGeometry(width: number, height: number, hasTopCrown = true): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    nx: number,
    ny: number,
    nz: number,
  ) => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };

  const hw = width * 0.5;
  for (const ang of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const nx = -s;
    const nz = c;
    pushQuad(
      [-hw * c, 0, -hw * s],
      [hw * c, 0, hw * s],
      [-hw * c, height, -hw * s],
      [hw * c, height, hw * s],
      nx,
      0.2,
      nz,
    );
  }

  if (hasTopCrown) {
    const ch = height * 0.56;
    const cw = hw * 0.82;
    pushQuad(
      [-cw, ch - 0.15, -cw],
      [cw, ch + 0.15, -cw],
      [-cw, ch - 0.15, cw],
      [cw, ch + 0.15, cw],
      0,
      1,
      0,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Deterministic undulating terrain around daylight circuits, strictly cleared below track & pit corridors. */
function buildSurroundingTerrain(
  track: TrackSpline,
  groundBaseY: number,
  grassPbr: ReturnType<typeof clonePBRSetWithRepeat> | null,
): { mesh: THREE.Mesh; sampleY: (x: number, z: number) => number } {
  const cfg = track.config;
  const halfW = cfg.trackWidth * 0.5;
  const midX = (track.boundsMin.x + track.boundsMax.x) * 0.5;
  const midZ = (track.boundsMin.z + track.boundsMax.z) * 0.5;

  // Subsample spline once for fast deterministic clearance evaluation
  const subStep = 6;
  const subCount = Math.floor(SAMPLE_COUNT / subStep);
  const sX = new Float64Array(subCount);
  const sY = new Float64Array(subCount);
  const sZ = new Float64Array(subCount);
  const sRX = new Float64Array(subCount);
  const sRZ = new Float64Array(subCount);
  const sInPit = new Uint8Array(subCount);
  for (let i = 0; i < subCount; i++) {
    const smp = track.samples[i * subStep];
    sX[i] = smp.position.x;
    sY[i] = smp.position.y;
    sZ[i] = smp.position.z;
    sRX[i] = smp.right.x;
    sRZ[i] = smp.right.z;
    sInPit[i] = isSInZone(smp.s, cfg.pitEntryS, cfg.pitExitS) ? 1 : 0;
  }

  const hillAmp =
    cfg.id === 'red-bull-ring' ? 56 : cfg.id === 'monza' ? 16 : 9;

  const sampleY = (x: number, z: number): number => {
    let minSq = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < subCount; i++) {
      const dx = x - sX[i];
      const dz = z - sZ[i];
      const dSq = dx * dx + dz * dz;
      if (dSq < minSq) {
        minSq = dSq;
        bestIdx = i;
      }
    }
    const dist = Math.sqrt(minSq);
    const dx = x - sX[bestIdx];
    const dz = z - sZ[bestIdx];
    const lat = dx * sRX[bestIdx] + dz * sRZ[bestIdx];
    const onPitSide = sInPit[bestIdx] === 1 && Math.sign(lat) === cfg.pitSide;
    const clearDist = halfW + (onPitSide ? 36 : 24);
    const clearFloor = Math.min(groundBaseY - 0.15, sY[bestIdx] - 0.88);

    if (dist <= clearDist) {
      return clearFloor;
    }

    const blend = Math.min(1, (dist - clearDist) / 110);
    const smooth = blend * blend * (3 - 2 * blend);

    // Multi-octave organic landform elevation (always >= 0)
    const n1 = Math.sin(x * 0.0042 + 0.7) * Math.cos(z * 0.0038 - 0.4) * 0.5 + 0.5;
    const n2 = Math.sin(x * 0.011 - z * 0.009 + 1.3) * 0.5 + 0.5;
    const n3 = Math.cos(x * 0.023 + z * 0.021) * 0.5 + 0.5;
    const hillH = (n1 * 0.6 + n2 * 0.28 + n3 * 0.12) * hillAmp;
    const targetY = groundBaseY + 0.35 + hillH;

    return THREE.MathUtils.lerp(clearFloor, targetY, smooth);
  };

  const segs = 92;
  const size = 2400;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const cLow = new THREE.Color(
    cfg.atmosphere === 'alpine-day'
      ? '#2d4d2a'
      : cfg.atmosphere === 'golden-park'
        ? '#3f522d'
        : '#354f30',
  );
  const cMid = new THREE.Color(
    cfg.atmosphere === 'alpine-day'
      ? '#456a3b'
      : cfg.atmosphere === 'golden-park'
        ? '#586939'
        : '#4c6640',
  );
  const cHigh = new THREE.Color(
    cfg.atmosphere === 'alpine-day' ? '#607655' : '#657546',
  );
  const tmpCol = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const wx = posAttr.getX(i) + midX;
    const wz = posAttr.getZ(i) + midZ;
    const wy = sampleY(wx, wz);
    posAttr.setXYZ(i, wx, wy, wz);

    const hFrac = THREE.MathUtils.clamp((wy - groundBaseY) / Math.max(1, hillAmp), 0, 1);
    if (hFrac < 0.55) {
      tmpCol.copy(cLow).lerp(cMid, hFrac / 0.55);
    } else {
      tmpCol.copy(cMid).lerp(cHigh, (hFrac - 0.55) / 0.45);
    }
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: grassPbr ? '#FFFFFF' : '#35542d',
    map: grassPbr?.map ?? null,
    normalMap: grassPbr?.normalMap ?? null,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: grassPbr?.roughnessMap ?? null,
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.02,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'surrounding-terrain';
  mesh.receiveShadow = true;
  return { mesh, sampleY };
}

export function buildTrackWorld(track: TrackSpline): BuiltTrackWorld {
  const group = new THREE.Group();
  const cfg = track.config;
  const isVegas = cfg.atmosphere === 'vegas-night';
  const halfW = cfg.trackWidth * 0.5;
  const textures: THREE.Texture[] = [];
  const pbrBundle = getCachedTrackTextures();

  // Only add procedural fallback sky dome if running without real HDRI (e.g. headless unit tests)
  if (typeof window === 'undefined') {
    const skyTex = createSkyDomeTexture(cfg.atmosphere);
    textures.push(skyTex);
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 32, 20),
      new THREE.MeshBasicMaterial({
        map: skyTex,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    group.add(skyDome);
  }

  // Ground Plane with real CC0 Photorealistic Grass PBR (strictly below lowest spline elevation)
  const groundBaseY = Math.min(-0.35, track.boundsMin.y - 0.85);
  const groundColor = isVegas
    ? '#0A0D16'
    : cfg.atmosphere === 'golden-park'
      ? '#52623D'
      : cfg.atmosphere === 'alpine-day'
        ? '#486A3D'
        : '#4D6242';

  const grassPbr = !isVegas && pbrBundle?.grass ? clonePBRSetWithRepeat(pbrBundle.grass, 140, 140) : null;
  if (grassPbr) {
    textures.push(grassPbr.map, grassPbr.normalMap, grassPbr.roughnessMap);
  }

  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({
      color: grassPbr ? groundColor : isVegas ? '#0A0D16' : '#2E5629',
      map: grassPbr?.map ?? null,
      normalMap: grassPbr?.normalMap ?? null,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: grassPbr?.roughnessMap ?? null,
      roughness: 0.96,
      metalness: 0.02,
    }),
  );
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = groundBaseY;
  groundPlane.receiveShadow = true;
  group.add(groundPlane);

  const terrainPbr =
    !isVegas && pbrBundle?.grass ? clonePBRSetWithRepeat(pbrBundle.grass, 64, 64) : null;
  if (terrainPbr) {
    textures.push(terrainPbr.map, terrainPbr.normalMap, terrainPbr.roughnessMap);
  }
  const terrainInfo = !isVegas
    ? buildSurroundingTerrain(track, groundBaseY, terrainPbr)
    : null;
  if (terrainInfo) {
    group.add(terrainInfo.mesh);
  }
  const sampleTerrainY = (x: number, z: number): number =>
    terrainInfo ? terrainInfo.sampleY(x, z) : groundBaseY;

  // Main Track Ribbon + Real CC0 Photorealistic Asphalt PBR (zero stipple moiré!)
  const asphaltPbr = pbrBundle?.asphalt
    ? clonePBRSetWithRepeat(pbrBundle.asphalt, 1.5, Math.max(40, Math.round(track.totalLength / 14)))
    : null;
  let asphaltMat: THREE.MeshStandardMaterial;
  if (asphaltPbr) {
    textures.push(asphaltPbr.map, asphaltPbr.normalMap, asphaltPbr.roughnessMap);
    asphaltMat = new THREE.MeshStandardMaterial({
      color: isVegas ? '#5A6272' : '#616874',
      map: asphaltPbr.map,
      normalMap: asphaltPbr.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: asphaltPbr.roughnessMap,
      roughness: 0.88,
      metalness: 0.06,
      envMapIntensity: 0.55,
    });
  } else {
    const asphaltTextures = createAsphaltTextures();
    textures.push(asphaltTextures.map, asphaltTextures.bumpMap, asphaltTextures.roughnessMap);
    asphaltMat = new THREE.MeshStandardMaterial({
      map: asphaltTextures.map,
      bumpMap: asphaltTextures.bumpMap,
      bumpScale: 0.025,
      roughnessMap: asphaltTextures.roughnessMap,
      roughness: 1.0,
      metalness: 0.08,
    });
  }
  const kerbTex = createKerbTexture(cfg.kerbPrimary, cfg.kerbSecondary);
  textures.push(kerbTex);

  const pitSpan =
    cfg.pitEntryS <= cfg.pitExitS
      ? cfg.pitExitS - cfg.pitEntryS
      : 1 - cfg.pitEntryS + cfg.pitExitS;
  const getPitProg = (s: number): number =>
    s >= cfg.pitEntryS
      ? (s - cfg.pitEntryS) / pitSpan
      : (1 - cfg.pitEntryS + s) / pitSpan;

  const getPitSideFlare = (s: number): number => {
    if (!isSInZone(s, cfg.pitEntryS, cfg.pitExitS)) return 0;
    const prog = getPitProg(s);
    let alpha = 1;
    if (prog < 0.14) {
      const t = prog / 0.14;
      alpha = t * t * (3 - 2 * t);
    } else if (prog > 0.86) {
      const t = (1 - prog) / 0.14;
      alpha = t * t * (3 - 2 * t);
    }
    return 9.4 * alpha;
  };

  const trackLeft: THREE.Vector3[] = [];
  const trackRight: THREE.Vector3[] = [];
  const runoffLeft: THREE.Vector3[] = [];
  const runoffRight: THREE.Vector3[] = [];
  const leftBarrierPts: THREE.Vector3[] = [];
  const rightBarrierPts: THREE.Vector3[] = [];
  const leftSkirtBot: THREE.Vector3[] = [];
  const rightSkirtBot: THREE.Vector3[] = [];

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const s = track.samples[i];
    const flare = getPitSideFlare(s.s);
    const leftFlare = cfg.pitSide === -1 ? flare : 0;
    const rightFlare = cfg.pitSide === 1 ? flare : 0;

    trackLeft.push(s.position.clone().addScaledVector(s.right, -halfW).add(new THREE.Vector3(0, 0.02, 0)));
    trackRight.push(s.position.clone().addScaledVector(s.right, halfW).add(new THREE.Vector3(0, 0.02, 0)));

    runoffLeft.push(s.position.clone().addScaledVector(s.right, -(halfW + 6.5 + leftFlare)).add(new THREE.Vector3(0, -0.02, 0)));
    runoffRight.push(s.position.clone().addScaledVector(s.right, halfW + 6.5 + rightFlare).add(new THREE.Vector3(0, -0.02, 0)));

    leftBarrierPts.push(s.position.clone().addScaledVector(s.right, -(halfW + 6.0 + leftFlare)));
    rightBarrierPts.push(s.position.clone().addScaledVector(s.right, halfW + 6.0 + rightFlare));

    leftSkirtBot.push(s.position.clone().addScaledVector(s.right, -(halfW + 14.0 + leftFlare)).setY(groundBaseY - 0.65));
    rightSkirtBot.push(s.position.clone().addScaledVector(s.right, halfW + 14.0 + rightFlare).setY(groundBaseY - 0.65));
  }

  const trackGeo = buildRibbonGeometry(trackLeft, trackRight, true, asphaltPbr ? 1 : track.totalLength / 26);
  const trackMesh = new THREE.Mesh(trackGeo, asphaltMat);
  trackMesh.receiveShadow = true;
  group.add(trackMesh);

  // Crisp FIA white track-limit lines flush along both track edges
  const whiteLineMat = new THREE.MeshStandardMaterial({
    color: '#F2F5FA',
    roughness: 0.72,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const addEdgeWhiteLine = (side: -1 | 1) => {
    const innerPts: THREE.Vector3[] = [];
    const outerPts: THREE.Vector3[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const s = track.samples[i];
      const offA = side * (halfW - 0.32);
      const offB = side * (halfW - 0.08);
      const pA = s.position.clone().addScaledVector(s.right, offA).add(new THREE.Vector3(0, 0.032, 0));
      const pB = s.position.clone().addScaledVector(s.right, offB).add(new THREE.Vector3(0, 0.032, 0));
      if (side === -1) {
        innerPts.push(pB);
        outerPts.push(pA);
      } else {
        innerPts.push(pA);
        outerPts.push(pB);
      }
    }
    const lineGeo = buildRibbonGeometry(innerPts, outerPts, true, 1);
    const lineMesh = new THREE.Mesh(lineGeo, whiteLineMat);
    lineMesh.receiveShadow = true;
    group.add(lineMesh);
  };
  addEdgeWhiteLine(-1);
  addEdgeWhiteLine(1);

  // High-grip Painted FIA Runoff (inspired by Paul Ricard / Red Bull Ring) or Gravel/Tarmac PBR
  let runoffMat: THREE.MeshStandardMaterial;
  if (!isVegas && cfg.atmosphere === 'alpine-day') {
    const paintedTex = createPaintedRunoffTexture('#C8102E', '#003A70');
    textures.push(paintedTex);
    runoffMat = new THREE.MeshStandardMaterial({
      map: paintedTex,
      roughness: 0.82,
      metalness: 0.04,
    });
  } else if (!isVegas && pbrBundle?.gravel) {
    const gravelPbr = clonePBRSetWithRepeat(pbrBundle.gravel, 2, Math.max(40, Math.round(track.totalLength / 16)));
    textures.push(gravelPbr.map, gravelPbr.normalMap, gravelPbr.roughnessMap);
    runoffMat = new THREE.MeshStandardMaterial({
      color: '#B8B0A0',
      map: gravelPbr.map,
      normalMap: gravelPbr.normalMap,
      roughnessMap: gravelPbr.roughnessMap,
      roughness: 0.96,
    });
  } else {
    runoffMat = new THREE.MeshStandardMaterial({
      color: isVegas ? '#161B26' : '#3C4148',
      roughness: 0.94,
    });
  }
  const runoffGeo = buildRibbonGeometry(
    runoffLeft,
    runoffRight,
    true,
    !isVegas && cfg.atmosphere === 'alpine-day' ? Math.round(track.totalLength / 18) : 1,
  );
  const runoffMesh = new THREE.Mesh(runoffGeo, runoffMat);
  runoffMesh.receiveShadow = true;
  group.add(runoffMesh);

  // Grounded embankment skirts textured with real grass PBR so elevated hills blend into terrain
  const skirtMat = new THREE.MeshStandardMaterial({
    color: grassPbr ? groundColor : isVegas ? '#0A0D16' : '#2E5629',
    map: grassPbr?.map ?? null,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const leftSkirt = new THREE.Mesh(buildRibbonGeometry(leftSkirtBot, runoffLeft, true, 1), skirtMat);
  const rightSkirt = new THREE.Mesh(buildRibbonGeometry(runoffRight, rightSkirtBot, true, 1), skirtMat);
  leftSkirt.receiveShadow = true;
  rightSkirt.receiveShadow = true;
  group.add(leftSkirt, rightSkirt);

  // F1 Sponsor Board Safety Barriers + Continuous FIA Debris Catch-Fencing & Galvanized Steel Posts
  const sponsorTex = createSponsorBarrierTexture(isVegas);
  const catchFenceTex = createCatchFenceTexture();
  textures.push(sponsorTex, catchFenceTex);

  const barrierWallMat = new THREE.MeshStandardMaterial({
    map: sponsorTex,
    roughness: 0.45,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });
  const catchFenceMat = new THREE.MeshStandardMaterial({
    map: catchFenceTex,
    transparent: true,
    opacity: 0.72,
    roughness: 0.4,
    metalness: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fencePostMat = new THREE.MeshStandardMaterial({
    color: '#9BA6B5',
    metalness: 0.78,
    roughness: 0.32,
  });

  const buildSponsorBarrierAndFence = (pts: THREE.Vector3[], closed = true, flipU = false) => {
    const repeatSponsor = closed ? Math.max(16, Math.round(track.totalLength / 48)) : 6;
    const wallTopPts = pts.map((p) => p.clone().add(new THREE.Vector3(0, 1.35, 0)));
    const wallGeo = buildWallGeometry(pts, wallTopPts, closed, repeatSponsor, flipU);
    const wall = new THREE.Mesh(wallGeo, barrierWallMat);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    // FIA Catch-Fence mesh rising from 1.35m to 3.85m above barrier
    const fenceTopPts = pts.map((p) => p.clone().add(new THREE.Vector3(0, 3.85, 0)));
    const fenceGeo = buildWallGeometry(
      wallTopPts,
      fenceTopPts,
      closed,
      closed ? Math.round(track.totalLength / 6) : 12,
    );
    const fence = new THREE.Mesh(fenceGeo, catchFenceMat);
    group.add(fence);

    // Instanced galvanized steel fence posts every ~3 samples
    const step = 3;
    const postCount = Math.ceil(pts.length / step);
    const postGeo = new THREE.CylinderGeometry(0.055, 0.065, 3.9, 6);
    const posts = new THREE.InstancedMesh(postGeo, fencePostMat, postCount);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      dummy.position.set(p.x, p.y + 1.95, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(idx++, dummy.matrix);
    }
    posts.count = idx;
    group.add(posts);
  };

  buildSponsorBarrierAndFence(leftBarrierPts, true, false);
  buildSponsorBarrierAndFence(rightBarrierPts, true, true);

  // Keep buildWall helper for inner pit lane wall
  const buildWall = (pts: THREE.Vector3[], colorHex: string, closed = true) => {
    const topPts = pts.map((p) => p.clone().add(new THREE.Vector3(0, 1.15, 0)));
    const wallGeo = buildWallGeometry(pts, topPts, closed, closed ? 40 : 4);
    const wallMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      map: sponsorTex,
      roughness: 0.5,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  };

  // Neon barrier strip in Las Vegas (flared around pit lane & inset 0.12m inside barrier faces)
  if (isVegas) {
    const neonLBot: THREE.Vector3[] = [];
    const neonLTop: THREE.Vector3[] = [];
    const neonRBot: THREE.Vector3[] = [];
    const neonRTop: THREE.Vector3[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const s = track.samples[i];
      const flare = getPitSideFlare(s.s);
      const leftFlare = cfg.pitSide === -1 ? flare : 0;
      const rightFlare = cfg.pitSide === 1 ? flare : 0;
      const lp = s.position.clone().addScaledVector(s.right, -(halfW + 5.88 + leftFlare));
      const rp = s.position.clone().addScaledVector(s.right, halfW + 5.88 + rightFlare);
      neonLBot.push(lp.clone().add(new THREE.Vector3(0, 0.88, 0)));
      neonLTop.push(lp.clone().add(new THREE.Vector3(0, 1.02, 0)));
      neonRBot.push(rp.clone().add(new THREE.Vector3(0, 0.88, 0)));
      neonRTop.push(rp.clone().add(new THREE.Vector3(0, 1.02, 0)));
    }
    const neonMat = new THREE.MeshBasicMaterial({ color: '#E10600', side: THREE.DoubleSide });
    group.add(new THREE.Mesh(buildRibbonGeometry(neonLBot, neonLTop, true, 1), neonMat));

    const neonCyanMat = new THREE.MeshBasicMaterial({ color: '#00E5FF', side: THREE.DoubleSide });
    group.add(new THREE.Mesh(buildRibbonGeometry(neonRBot, neonRTop, true, 1), neonCyanMat));
  }

  // Colored Kerbs at corner apexes and exits
  const kerbMat = new THREE.MeshStandardMaterial({
    map: kerbTex,
    roughness: 0.72,
  });
  const addKerbRuns = (side: -1 | 1) => {
    let runStart = -1;
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
      const idx = i % SAMPLE_COUNT;
      const active =
        i < SAMPLE_COUNT &&
        (side === -1 ? track.samples[idx].hasLeftKerb : track.samples[idx].hasRightKerb);
      if (active && runStart === -1) {
        runStart = i;
      } else if (!active && runStart !== -1) {
        if (i - runStart >= 3) {
          const kl: THREE.Vector3[] = [];
          const kr: THREE.Vector3[] = [];
          for (let j = runStart; j < i; j++) {
            const smp = track.samples[j % SAMPLE_COUNT];
            const innerOff = side * (halfW - 0.15);
            const outerOff = side * (halfW + 1.05);
            const pA = smp.position.clone().addScaledVector(smp.right, innerOff).add(new THREE.Vector3(0, 0.055, 0));
            const pB = smp.position.clone().addScaledVector(smp.right, outerOff).add(new THREE.Vector3(0, 0.085, 0));
            if (side === -1) {
              kl.push(pB);
              kr.push(pA);
            } else {
              kl.push(pA);
              kr.push(pB);
            }
          }
          const kGeo = buildRibbonGeometry(kl, kr, false, (i - runStart) * 0.45);
          const kMesh = new THREE.Mesh(kGeo, kerbMat);
          kMesh.receiveShadow = true;
          group.add(kMesh);
        }
        runStart = -1;
      }
    }
  };
  addKerbRuns(-1);
  addKerbRuns(1);

  // Green astroturf verge strips hugging outside edges of daylight kerbs
  if (!isVegas) {
    const astroMat = new THREE.MeshStandardMaterial({
      color: '#256134',
      roughness: 0.92,
      metalness: 0.02,
    });
    const addAstroVers = (side: -1 | 1) => {
      let runStart = -1;
      for (let i = 0; i <= SAMPLE_COUNT; i++) {
        const idx = i % SAMPLE_COUNT;
        const active =
          i < SAMPLE_COUNT &&
          (side === -1 ? track.samples[idx].hasLeftKerb : track.samples[idx].hasRightKerb);
        if (active && runStart === -1) {
          runStart = i;
        } else if (!active && runStart !== -1) {
          if (i - runStart >= 3) {
            const al: THREE.Vector3[] = [];
            const ar: THREE.Vector3[] = [];
            for (let j = runStart; j < i; j++) {
              const smp = track.samples[j % SAMPLE_COUNT];
              const pA = smp.position.clone().addScaledVector(smp.right, side * (halfW + 1.05)).add(new THREE.Vector3(0, 0.025, 0));
              const pB = smp.position.clone().addScaledVector(smp.right, side * (halfW + 1.92)).add(new THREE.Vector3(0, 0.015, 0));
              if (side === -1) {
                al.push(pB);
                ar.push(pA);
              } else {
                al.push(pA);
                ar.push(pB);
              }
            }
            const aMesh = new THREE.Mesh(buildRibbonGeometry(al, ar, false, 1), astroMat);
            aMesh.receiveShadow = true;
            group.add(aMesh);
          }
          runStart = -1;
        }
      }
    };
    addAstroVers(-1);
    addAstroVers(1);
  }

  // Dark rubbered braking-zone skid decals & TecPro red/white tire barrier stacks at heavy braking corners
  const fiftyBoards = track.brakingBoards.filter((b) => b.distanceMeters === 50);
  if (fiftyBoards.length > 0) {
    const skidTex = createBrakingZoneSkidTexture();
    textures.push(skidTex);
    const skidMat = new THREE.MeshBasicMaterial({
      map: skidTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const dsMeters = track.totalLength / SAMPLE_COUNT;
    const preLenSamples = Math.max(4, Math.round(72 / dsMeters));
    const apexAheadSamples = Math.max(2, Math.round(35 / dsMeters));
    const tecRedMat = new THREE.MeshStandardMaterial({ color: '#D90429', roughness: 0.65 });
    const tecWhiteMat = new THREE.MeshStandardMaterial({ color: '#F1F5F9', roughness: 0.65 });
    const tecGeo = new THREE.BoxGeometry(1.15, 1.25, 2.3);
    const maxTec = fiftyBoards.length * 8;
    const tecRedMesh = new THREE.InstancedMesh(tecGeo, tecRedMat, maxTec);
    const tecWhiteMesh = new THREE.InstancedMesh(tecGeo, tecWhiteMat, maxTec);
    tecRedMesh.castShadow = true;
    tecWhiteMesh.castShadow = true;
    let redCount = 0;
    let whiteCount = 0;
    const tecDummy = new THREE.Object3D();

    for (const b of fiftyBoards) {
      const approxIdx = Math.round(
        (track.projectToTrack(b.position.x, b.position.z, 0).s * SAMPLE_COUNT) % SAMPLE_COUNT,
      );
      const sl: THREE.Vector3[] = [];
      const sr: THREE.Vector3[] = [];
      for (let k = -Math.round(preLenSamples * 0.55); k <= Math.round(preLenSamples * 0.5); k++) {
        const smp = track.sampleAtIndex(approxIdx + k);
        const shift = THREE.MathUtils.clamp(smp.curvature * 110, -halfW * 0.35, halfW * 0.35);
        const center = smp.position.clone().addScaledVector(smp.right, shift).add(new THREE.Vector3(0, 0.036, 0));
        sl.push(center.clone().addScaledVector(smp.right, -1.65));
        sr.push(center.clone().addScaledVector(smp.right, 1.65));
      }
      group.add(new THREE.Mesh(buildRibbonGeometry(sl, sr, false, 1), skidMat));

      // Place alternating Red/White TecPro barrier modules along outside exit wall ahead of 50m board
      const apexSmp = track.sampleAtIndex(approxIdx + apexAheadSamples);
      const outSide = apexSmp.curvature >= 0 ? -1 : 1;
      for (let m = -3; m <= 3; m++) {
        const wSmp = track.sampleAtIndex(approxIdx + apexAheadSamples + m * 2);
        const wp = wSmp.position.clone().addScaledVector(wSmp.right, outSide * (halfW + 5.2));
        tecDummy.position.set(wp.x, wp.y + 0.62, wp.z);
        tecDummy.rotation.set(0, Math.atan2(wSmp.tangent.x, wSmp.tangent.z), 0);
        tecDummy.scale.set(1, 1, 1);
        tecDummy.updateMatrix();
        if (Math.abs(m) % 2 === 0 && redCount < maxTec) {
          tecRedMesh.setMatrixAt(redCount++, tecDummy.matrix);
        } else if (whiteCount < maxTec) {
          tecWhiteMesh.setMatrixAt(whiteCount++, tecDummy.matrix);
        }
      }
    }
    tecRedMesh.count = redCount;
    tecWhiteMesh.count = whiteCount;
    group.add(tecRedMesh, tecWhiteMesh);
  }

  // Parallel Pit Lane Ribbon + Inner Pit Wall (prog in [0.16, 0.84]) + Pit Garages
  const pitLeft: THREE.Vector3[] = [];
  const pitRight: THREE.Vector3[] = [];
  const pitSamples: THREE.Vector3[] = [];
  const innerPitWallPts: THREE.Vector3[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const s = i / SAMPLE_COUNT;
    if (isSInZone(s, cfg.pitEntryS, cfg.pitExitS)) {
      const smp = track.samples[i];
      const lat = track.getPitLaneLateralOffset(s);
      const center = smp.position.clone().addScaledVector(smp.right, lat).add(new THREE.Vector3(0, 0.028, 0));
      pitSamples.push(center);
      pitLeft.push(center.clone().addScaledVector(smp.right, -3.2));
      pitRight.push(center.clone().addScaledVector(smp.right, 3.2));

      const prog = getPitProg(s);
      if (prog >= 0.16 && prog <= 0.84) {
        innerPitWallPts.push(
          smp.position.clone().addScaledVector(smp.right, cfg.pitSide * (halfW + 4.9)),
        );
      }
    }
  }
  if (pitLeft.length > 4) {
    // Reorder contiguously around wrap-around pit lane (since pitEntry ~0.91 -> pitExit ~0.10)
    const splitIdx = pitLeft.findIndex((_, idx) => {
      if (idx === 0) return false;
      return pitLeft[idx].distanceTo(pitLeft[idx - 1]) > 80;
    });
    const orderedLeft =
      splitIdx > 0 ? [...pitLeft.slice(splitIdx), ...pitLeft.slice(0, splitIdx)] : pitLeft;
    const orderedRight =
      splitIdx > 0 ? [...pitRight.slice(splitIdx), ...pitRight.slice(0, splitIdx)] : pitRight;
    const orderedCenters =
      splitIdx > 0 ? [...pitSamples.slice(splitIdx), ...pitSamples.slice(0, splitIdx)] : pitSamples;

    const pitGeo = buildRibbonGeometry(orderedLeft, orderedRight, false, 14);
    const pitMat = new THREE.MeshStandardMaterial({
      color: '#2B303A',
      map: asphaltPbr?.map ?? null,
      normalMap: asphaltPbr?.normalMap ?? null,
      roughness: 0.78,
      metalness: 0.08,
    });
    const pitMesh = new THREE.Mesh(pitGeo, pitMat);
    pitMesh.receiveShadow = true;
    group.add(pitMesh);

    if (innerPitWallPts.length > 3) {
      const wallSplitIdx = innerPitWallPts.findIndex((_, idx) => {
        if (idx === 0) return false;
        return innerPitWallPts[idx].distanceTo(innerPitWallPts[idx - 1]) > 80;
      });
      const orderedInnerWall =
        wallSplitIdx > 0
          ? [...innerPitWallPts.slice(wallSplitIdx), ...innerPitWallPts.slice(0, wallSplitIdx)]
          : innerPitWallPts;
      buildWall(orderedInnerWall, isVegas ? '#232B3D' : '#D4D8E0', false);
    }

    // === DETAILED F1 PIT COMPLEX: 6 ILLUMINATED TEAM GARAGES + PADDOCK CLUB + PIT CREW ===
    const pitBox = track.getPitBoxPose();
    const pitBoxPos = pitBox.position;
    const pitHeading = pitBox.heading;

    // 1. Painted FIA Pit Box Stop Markings on the pit lane apron at pitStopS
    const pitBoxTex = createPitBoxMarkingTexture();
    textures.push(pitBoxTex);
    const pitBoxDecal = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 7.6),
      new THREE.MeshBasicMaterial({
        map: pitBoxTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    pitBoxDecal.rotation.order = 'YXZ';
    pitBoxDecal.rotation.y = pitHeading;
    pitBoxDecal.rotation.x = -Math.PI / 2;
    pitBoxDecal.position.set(pitBoxPos.x, pitBoxPos.y + 0.042, pitBoxPos.z);
    group.add(pitBoxDecal);

    // 2. Overhead Carbon Pit-Stop Swivel Gantry + FIA Release Light + 6 Stylized 3D Pit Crew Mechanics
    const pitCrewGroup = new THREE.Group();
    pitCrewGroup.position.set(pitBoxPos.x, pitBoxPos.y, pitBoxPos.z);
    pitCrewGroup.rotation.y = pitHeading;

    const gantryCarbonMat = new THREE.MeshStandardMaterial({
      color: '#181D26',
      metalness: 0.72,
      roughness: 0.28,
    });
    const releaseGreenMat = new THREE.MeshStandardMaterial({
      color: '#10B981',
      emissive: '#10B981',
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    const garageSideX = -cfg.pitSide; // local +X is -sample.right, so -pitSide sits on the garage apron side

    // Overhead swivel gantry boom extending from garage side over the pit box
    const boomMast = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.6, 0.28), gantryCarbonMat);
    boomMast.position.set(garageSideX * 2.55, 1.8, 0.2);
    boomMast.castShadow = true;
    pitCrewGroup.add(boomMast);

    const boomArm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.18, 0.24), gantryCarbonMat);
    boomArm.position.set(garageSideX * 0.45, 3.45, 0.2);
    boomArm.castShadow = true;
    pitCrewGroup.add(boomArm);

    const releasePod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.26, 0.22), gantryCarbonMat);
    releasePod.position.set(0, 3.22, 1.35);
    pitCrewGroup.add(releasePod);
    const releaseLight = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.08), releaseGreenMat);
    releaseLight.position.set(0, 3.22, 1.22);
    pitCrewGroup.add(releaseLight);

    // 6 Stylized 3D Pit Crew Mechanics (Front Jack, Rear Jack, 4 Corner Tire/Wheel-Gun Crew)
    const suitMat = new THREE.MeshStandardMaterial({ color: '#E10600', roughness: 0.65 });
    const crewHelmetMat = new THREE.MeshPhysicalMaterial({
      color: '#11141C',
      metalness: 0.5,
      roughness: 0.18,
      clearcoat: 0.9,
    });
    const tirePropMat = new THREE.MeshStandardMaterial({ color: '#181A20', roughness: 0.8 });
    const crewPositions: [number, number, boolean][] = [
      [-1.55, 1.65, true],  // Front-left wheel crew
      [1.55, 1.65, true],   // Front-right wheel crew
      [-1.55, -1.65, true], // Rear-left wheel crew
      [1.55, -1.65, true],  // Rear-right wheel crew
      [0.85, 3.25, false],  // Front jack man (slightly off-center so car nose never clips!)
      [-0.85, -3.25, false], // Rear jack man
    ];
    for (const [cx, cz, holdsTire] of crewPositions) {
      const mech = new THREE.Group();
      mech.position.set(cx, 0, cz);
      mech.lookAt(0, 0.7, cz * 0.4);
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.72, 8), suitMat);
      legs.position.y = 0.36;
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 0.22), suitMat);
      torso.position.y = 0.92;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), crewHelmetMat);
      head.position.y = 1.32;
      mech.add(legs, torso, head);
      if (holdsTire) {
        const spareTire = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.11, 8, 16), tirePropMat);
        spareTire.position.set(0, 0.72, 0.28);
        mech.add(spareTire);
      }
      pitCrewGroup.add(mech);
    }
    group.add(pitCrewGroup);

    // 3. Pit Entry & Pit Exit 80 KM/H Speed Limit Boards
    const speedBoardTex = createPitSpeedBoardTexture(80);
    textures.push(speedBoardTex);
    const speedBoardMat = new THREE.MeshStandardMaterial({ map: speedBoardTex, roughness: 0.4 });
    const speedPostMat = new THREE.MeshStandardMaterial({ color: '#262C38', metalness: 0.6 });
    for (const boardS of [(cfg.pitEntryS + 0.015) % 1, (cfg.pitExitS - 0.015 + 1) % 1]) {
      const bSmp = track.sampleAtS(boardS);
      const bLat = track.getPitLaneLateralOffset(boardS) + cfg.pitSide * 3.1;
      const bPos = bSmp.position.clone().addScaledVector(bSmp.right, bLat);
      const bGroup = new THREE.Group();
      bGroup.position.set(bPos.x, bPos.y, bPos.z);
      bGroup.rotation.y = Math.atan2(bSmp.tangent.x, bSmp.tangent.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.4, 8), speedPostMat);
      pole.position.y = 1.2;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.08), speedBoardMat);
      sign.position.y = 2.15;
      bGroup.add(pole, sign);
      group.add(bGroup);
    }

    // 4. 6 Illuminated Team Pit Garages + 2nd-Story Tinted-Glass Paddock Club Hospitality Deck
    const midCenter = orderedCenters[Math.floor(orderedCenters.length * 0.5)];
    const startSample = track.samples[0];
    const pitBuildingGroup = new THREE.Group();
    const buildingOrigin = midCenter
      .clone()
      .addScaledVector(startSample.right, cfg.pitSide * 12.2);
    pitBuildingGroup.position.copy(buildingOrigin);
    pitBuildingGroup.rotation.y = Math.atan2(startSample.tangent.x, startSample.tangent.z);

    const concreteBodyMat = new THREE.MeshStandardMaterial({
      color: cfg.id === 'silverstone' ? '#C4CCD8' : '#1A1F2B',
      metalness: cfg.id === 'silverstone' ? 0.55 : 0.3,
      roughness: cfg.id === 'silverstone' ? 0.35 : 0.55,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: '#102338',
      metalness: 0.25,
      roughness: 0.08,
      clearcoat: 1.0,
      envMapIntensity: 1.8,
    });
    const bayLightMat = new THREE.MeshBasicMaterial({ color: '#F4F8FF' });
    const bayFloorMat = new THREE.MeshStandardMaterial({ color: '#2E3440', roughness: 0.55 });

    // Grounded foundation plinth below the 6-garage pit building
    const plinthH = Math.max(1.2, buildingOrigin.y - groundBaseY + 0.8);
    const garagePlinth = new THREE.Mesh(
      new THREE.BoxGeometry(11.5, plinthH, 74),
      new THREE.MeshStandardMaterial({ color: '#1B202A', roughness: 0.85 }),
    );
    garagePlinth.position.set(0, -plinthH * 0.5 + 0.1, 0);
    garagePlinth.receiveShadow = true;
    pitBuildingGroup.add(garagePlinth);

    // Main structural back + 2nd-story Paddock Club hospitality glass suite
    const backStructure = new THREE.Mesh(new THREE.BoxGeometry(6.5, 4.4, 72), concreteBodyMat);
    backStructure.position.set(cfg.pitSide * 2.4, 2.2, 0);
    backStructure.castShadow = true;
    pitBuildingGroup.add(backStructure);

    const upperDeck = new THREE.Mesh(new THREE.BoxGeometry(11.0, 3.6, 72.5), concreteBodyMat);
    upperDeck.position.set(0, 6.2, 0);
    upperDeck.castShadow = true;
    pitBuildingGroup.add(upperDeck);

    // Tinted glass windows along 2nd-story Paddock Club facing the pit lane
    const glassStrip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 69), glassMat);
    glassStrip.position.set(-cfg.pitSide * 5.52, 6.1, 0);
    pitBuildingGroup.add(glassStrip);

    // Silverstone Wing distinctive jagged angular roof vs sleek cantilevered F1 paddock roof
    if (cfg.id === 'silverstone') {
      const wingRoofMat = new THREE.MeshStandardMaterial({
        color: '#DCE4EE',
        metalness: 0.72,
        roughness: 0.24,
      });
      for (let w = 0; w < 3; w++) {
        const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.55, 23.5), wingRoofMat);
        wingBlade.position.set(-cfg.pitSide * 0.8, 8.6 + (w % 2) * 0.85, (w - 1) * 24);
        wingBlade.rotation.z = cfg.pitSide * (w % 2 === 0 ? 0.14 : -0.10);
        wingBlade.castShadow = true;
        pitBuildingGroup.add(wingBlade);
      }
    } else {
      const canopyRoof = new THREE.Mesh(
        new THREE.BoxGeometry(14.2, 0.48, 74.5),
        new THREE.MeshStandardMaterial({ color: '#E10600', roughness: 0.35, metalness: 0.3 }),
      );
      canopyRoof.position.set(-cfg.pitSide * 1.1, 8.2, 0);
      canopyRoof.castShadow = true;
      pitBuildingGroup.add(canopyRoof);
    }

    // 6 Individual Illuminated Team Garage Bays
    const garageTeams = [
      { name: 'MERCEDES-AMG', primary: '#00D2BE', accent: '#C0C8D4' },
      { name: 'RED BULL RACING', primary: '#1E41FF', accent: '#FFD700' },
      { name: 'MCLAREN F1', primary: '#FF8000', accent: '#11131A' },
      { name: 'SCUDERIA FERRARI', primary: '#DC0000', accent: '#FFD700' },
      { name: 'RACING BULLS', primary: '#1D4ED8', accent: '#FFFFFF' },
      { name: 'ALPINE F1', primary: '#0090FF', accent: '#FF66C4' },
    ];
    const baySpacing = 11.4;
    for (let g = 0; g < garageTeams.length; g++) {
      const gt = garageTeams[g];
      const bz = (g - 2.5) * baySpacing;

      // Divider pillar between bays
      const divider = new THREE.Mesh(new THREE.BoxGeometry(4.8, 4.4, 0.65), concreteBodyMat);
      divider.position.set(-cfg.pitSide * 2.8, 2.2, bz - baySpacing * 0.5);
      pitBuildingGroup.add(divider);

      // Illuminated garage interior bay floor & bright overhead LED strip
      const bayFloor = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 10.2), bayFloorMat);
      bayFloor.rotation.x = -Math.PI / 2;
      bayFloor.position.set(-cfg.pitSide * 2.6, 0.08, bz);
      pitBuildingGroup.add(bayFloor);

      const bayLed = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 8.8), bayLightMat);
      bayLed.position.set(-cfg.pitSide * 3.8, 4.15, bz);
      pitBuildingGroup.add(bayLed);

      // Team-branded fascia signboard above each bay
      const fasciaTex = createPitGarageHeaderTexture(gt.name, gt.primary, gt.accent);
      textures.push(fasciaTex);
      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 1.05, 10.6),
        new THREE.MeshStandardMaterial({
          map: fasciaTex,
          emissiveMap: fasciaTex,
          emissive: '#FFFFFF',
          emissiveIntensity: isVegas ? 0.75 : 0.25,
          roughness: 0.3,
        }),
      );
      fascia.position.set(-cfg.pitSide * 5.45, 4.0, bz);
      pitBuildingGroup.add(fascia);

      // Stacked spare Pirelli tires inside garage entrance
      for (let t = 0; t < 3; t++) {
        const tireStack = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.14, 8, 14), tirePropMat);
        tireStack.rotation.x = Math.PI / 2;
        tireStack.position.set(-cfg.pitSide * 3.4, 0.2 + t * 0.26, bz + 3.4);
        pitBuildingGroup.add(tireStack);
      }
    }

    group.add(pitBuildingGroup);

    // 5. Paddock Team Village behind the Pit Complex (concrete apron + 6 F1 team transporter trucks + hospitality awnings)
    const paddockGroup = new THREE.Group();
    const paddockOrigin = buildingOrigin
      .clone()
      .addScaledVector(startSample.right, cfg.pitSide * 15.5);
    paddockGroup.position.copy(paddockOrigin);
    paddockGroup.rotation.y = pitBuildingGroup.rotation.y;

    const paddockApron = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 78),
      new THREE.MeshStandardMaterial({ color: '#262B35', roughness: 0.84, metalness: 0.05 }),
    );
    paddockApron.rotation.x = -Math.PI / 2;
    paddockApron.position.y = 0.04;
    paddockApron.receiveShadow = true;
    paddockGroup.add(paddockApron);

    const truckCabMat = new THREE.MeshStandardMaterial({ color: '#141820', metalness: 0.6, roughness: 0.3 });
    const awningMat = new THREE.MeshStandardMaterial({ color: '#E2E8F0', roughness: 0.55 });
    for (let g = 0; g < garageTeams.length; g++) {
      const gt = garageTeams[g];
      const tz = (g - 2.5) * baySpacing;
      const truckTex = createPaddockTruckTexture(gt.name, gt.primary, gt.accent);
      textures.push(truckTex);
      const trailerMat = new THREE.MeshStandardMaterial({ map: truckTex, roughness: 0.35, metalness: 0.25 });
      const trailer = new THREE.Mesh(new THREE.BoxGeometry(11.5, 3.8, 2.7), trailerMat);
      trailer.position.set(0, 2.1, tz);
      trailer.castShadow = true;
      trailer.receiveShadow = true;
      paddockGroup.add(trailer);

      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.1, 2.5), truckCabMat);
      cab.position.set(-cfg.pitSide * 7.1, 1.75, tz);
      cab.castShadow = true;
      paddockGroup.add(cab);

      const awning = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 4.4), awningMat);
      awning.position.set(cfg.pitSide * 1.4, 3.4, tz + 2.8);
      paddockGroup.add(awning);
    }
    group.add(paddockGroup);
  }

  // Start / Finish Checkered Line + Staggered Starting Grid Boxes
  const s0 = track.samples[0];
  const s0Heading = Math.atan2(s0.tangent.x, s0.tangent.z);
  const checkTex = createCheckeredTexture();
  textures.push(checkTex);
  const finishLine = new THREE.Mesh(
    new THREE.PlaneGeometry(cfg.trackWidth - 0.6, 2.8),
    new THREE.MeshBasicMaterial({ map: checkTex }),
  );
  finishLine.rotation.order = 'YXZ';
  finishLine.rotation.y = s0Heading;
  finishLine.rotation.x = -Math.PI / 2;
  finishLine.position.copy(s0.position).add(new THREE.Vector3(0, 0.035, 0));
  group.add(finishLine);

  const boxMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  for (let slot = 0; slot < 11; slot++) {
    const backM = 8 + slot * 5.2;
    const gridS = (((1 - backM / track.totalLength) % 1) + 1) % 1;
    const gs = track.sampleAtS(gridS);
    const lat = slot % 2 === 0 ? -2.1 : 2.1;
    const gridSpot = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.25), boxMat);
    gridSpot.rotation.order = 'YXZ';
    gridSpot.rotation.y = Math.atan2(gs.tangent.x, gs.tangent.z);
    gridSpot.rotation.x = -Math.PI / 2;
    gridSpot.position
      .copy(gs.position)
      .addScaledVector(gs.right, lat)
      .add(new THREE.Vector3(0, 0.034, 0));
    group.add(gridSpot);
  }

  // Start/Finish Overhead Gantry + 5 Live Emissive Red Start Light Pods
  const gantryGroup = new THREE.Group();
  gantryGroup.position.copy(s0.position);
  gantryGroup.rotation.y = s0Heading;
  const gantryMat = new THREE.MeshStandardMaterial({ color: '#13161E', metalness: 0.7, roughness: 0.35 });

  for (const side of [-1, 1] as const) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7.6, 0.9), gantryMat);
    pillar.position.set(side * (halfW + 1.8), 3.8, 0);
    pillar.castShadow = true;
    gantryGroup.add(pillar);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(cfg.trackWidth + 4.4, 1.35, 1.4), gantryMat);
  bridge.position.set(0, 7.2, 0);
  bridge.castShadow = true;
  gantryGroup.add(bridge);

  // Circuit-specific branded Start/Finish header banner
  const gantryBrand =
    cfg.id === 'red-bull-ring'
      ? { title: 'RED BULL RING', sub: 'SPIELBERG · AUSTRIAN GRAND PRIX', bg: '#0E1930', acc: '#E10600' }
      : cfg.id === 'monza'
        ? { title: 'AUTODROMO NAZIONALE MONZA', sub: 'TEMPLE OF SPEED · ITALIAN GP', bg: '#0E4A25', acc: '#E10600' }
        : cfg.id === 'silverstone'
          ? { title: 'SILVERSTONE CIRCUIT', sub: 'HOME OF BRITISH MOTOR RACING', bg: '#0B1D3A', acc: '#E10600' }
          : { title: 'LAS VEGAS STRIP CIRCUIT', sub: 'NEVADA · FORMULA 1 NIGHT RACE', bg: '#120A24', acc: '#00E5FF' };
  const gantryBannerTex = createCircuitGantryBannerTexture(
    gantryBrand.title,
    gantryBrand.sub,
    gantryBrand.bg,
    gantryBrand.acc,
  );
  textures.push(gantryBannerTex);
  const gantryBannerMat = new THREE.MeshStandardMaterial({
    map: gantryBannerTex,
    emissiveMap: gantryBannerTex,
    emissive: '#FFFFFF',
    emissiveIntensity: isVegas ? 0.9 : 0.25,
    roughness: 0.35,
  });
  const gantryBanner = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.trackWidth + 4.0, 1.55, 1.52),
    gantryBannerMat,
  );
  gantryBanner.position.set(0, 8.45, 0);
  gantryGroup.add(gantryBanner);

  const startLightMaterials: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    // +X is driver-left, -X is driver-right -> place pod 0 on left down to pod 4 on right
    const podX = (2 - i) * 1.45;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.65, 0.6), gantryMat);
    pod.position.set(podX, 6.2, -0.55);
    gantryGroup.add(pod);

    const lightMat = new THREE.MeshStandardMaterial({
      color: '#2B0404',
      emissive: '#FF0800',
      emissiveIntensity: 0.08,
      roughness: 0.2,
    });
    startLightMaterials.push(lightMat);

    // Pair of bright circular bulbs per pod
    for (const dy of [-0.32, 0.32]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), lightMat);
      bulb.position.set(podX, 6.2 + dy, -0.84);
      gantryGroup.add(bulb);
    }
  }
  group.add(gantryGroup);

  // 150m / 100m / 50m Braking Distance Boards
  const boardTexCache = new Map<number, THREE.CanvasTexture>();
  const postMat = new THREE.MeshStandardMaterial({ color: '#222630', metalness: 0.5 });
  for (const b of track.brakingBoards) {
    let tex = boardTexCache.get(b.distanceMeters);
    if (!tex) {
      tex = createBrakingBoardTexture(b.distanceMeters);
      boardTexCache.set(b.distanceMeters, tex);
      textures.push(tex);
    }
    const boardGroup = new THREE.Group();
    boardGroup.position.copy(b.position);
    boardGroup.rotation.y = Math.atan2(b.tangent.x, b.tangent.z);

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), postMat);
    post.position.y = 0.75;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 1.15, 0.12),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }),
    );
    panel.position.y = 1.65;
    boardGroup.add(post, panel);
    group.add(boardGroup);
  }

  // Dynamic Color-Coded 3D Racing / Braking Line Ribbon (sleek & unobtrusive)
  const lineLeft: THREE.Vector3[] = [];
  const lineRight: THREE.Vector3[] = [];
  const racingLineSpeeds = new Float32Array(SAMPLE_COUNT);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const s = track.samples[i];
    // Shift line slightly toward ideal apex side in corners
    const idealShift = THREE.MathUtils.clamp(s.curvature * 140, -halfW * 0.45, halfW * 0.45);
    const center = s.position.clone().addScaledVector(s.right, idealShift).add(new THREE.Vector3(0, 0.044, 0));
    lineLeft.push(center.clone().addScaledVector(s.right, -0.42));
    lineRight.push(center.clone().addScaledVector(s.right, 0.42));
    racingLineSpeeds[i] = s.recommendedSpeed;
  }

  const lineGeo = buildRibbonGeometry(lineLeft, lineRight, true, 1);
  const vertCount = (SAMPLE_COUNT + 1) * 2;
  const racingLineColors = new Float32Array(vertCount * 3);
  lineGeo.setAttribute('color', new THREE.BufferAttribute(racingLineColors, 3));

  const racingLineMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });
  const racingLineMesh = new THREE.Mesh(lineGeo, racingLineMat);
  group.add(racingLineMesh);

  // Overhead Open-Truss Steel Sponsor Gantry Bridges spanning the circuit
  const gantrySpanMat = new THREE.MeshStandardMaterial({
    map: sponsorTex,
    roughness: 0.38,
    metalness: 0.22,
  });
  const gantrySteelMat = new THREE.MeshStandardMaterial({
    color: '#1D2430',
    metalness: 0.78,
    roughness: 0.32,
  });
  for (const bridgeS of [0.22, 0.48, 0.74]) {
    const smp = track.sampleAtS(bridgeS);
    if (isSInZone(smp.s, cfg.pitEntryS, cfg.pitExitS)) continue;
    const bridgeGroup = new THREE.Group();
    bridgeGroup.position.copy(smp.position);
    bridgeGroup.rotation.y = Math.atan2(smp.tangent.x, smp.tangent.z);

    const spanW = cfg.trackWidth + 12.6;
    for (const side of [-1, 1] as const) {
      for (const zOff of [-0.65, 0.65]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 8.1, 0.38), gantrySteelMat);
        leg.position.set(side * (spanW * 0.5), 4.05, zOff);
        leg.castShadow = true;
        bridgeGroup.add(leg);
      }
      const crossBrace = new THREE.Mesh(new THREE.BoxGeometry(0.28, 7.6, 0.24), gantrySteelMat);
      crossBrace.position.set(side * (spanW * 0.5), 4.0, 0);
      crossBrace.rotation.x = 0.22;
      bridgeGroup.add(crossBrace);
    }

    // Upper & lower horizontal truss chords + floor deck + vertical struts
    const lowerChord = new THREE.Mesh(new THREE.BoxGeometry(spanW + 0.8, 0.28, 1.7), gantrySteelMat);
    lowerChord.position.set(0, 6.25, 0);
    const upperChord = new THREE.Mesh(new THREE.BoxGeometry(spanW + 0.8, 0.28, 1.7), gantrySteelMat);
    upperChord.position.set(0, 8.2, 0);
    bridgeGroup.add(lowerChord, upperChord);

    const strutSteps = 8;
    for (let st = 0; st <= strutSteps; st++) {
      const xPos = THREE.MathUtils.lerp(-spanW * 0.48, spanW * 0.48, st / strutSteps);
      const vStrut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.95, 1.5), gantrySteelMat);
      vStrut.position.set(xPos, 7.22, 0);
      bridgeGroup.add(vStrut);
    }

    const bannerPanel = new THREE.Mesh(new THREE.BoxGeometry(spanW - 1.2, 1.35, 1.58), gantrySpanMat);
    bannerPanel.position.set(0, 7.22, 0);
    bannerPanel.castShadow = true;
    bridgeGroup.add(bannerPanel);
    group.add(bridgeGroup);
  }

  // FIA Glowing Green LED Marshal Panels & Trackside Broadcast TV Towers / Marshal Huts
  const fiaPanelTex = createFiaLightPanelTexture();
  textures.push(fiaPanelTex);
  const fiaPostMat = new THREE.MeshStandardMaterial({ color: '#1F2633', metalness: 0.7, roughness: 0.35 });
  const fiaScreenMat = new THREE.MeshStandardMaterial({
    map: fiaPanelTex,
    emissiveMap: fiaPanelTex,
    emissive: '#FFFFFF',
    emissiveIntensity: 1.25,
    roughness: 0.25,
  });
  const fiaPanelCount = 16;
  const fiaPostMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 2.8, 6), fiaPostMat, fiaPanelCount);
  const fiaBoardMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.95, 0.16), fiaScreenMat, fiaPanelCount);
  const fiaDummy = new THREE.Object3D();
  let fiaIdx = 0;
  for (let p = 0; p < fiaPanelCount; p++) {
    const sVal = ((p + 0.35) / fiaPanelCount) % 1;
    const smp = track.sampleAtS(sVal);
    const side: -1 | 1 = p % 2 === 0 ? -1 : 1;
    const finalSide: -1 | 1 =
      isSInZone(sVal, cfg.pitEntryS, cfg.pitExitS) && side === cfg.pitSide ? (-cfg.pitSide as -1 | 1) : side;
    const pos = smp.position.clone().addScaledVector(smp.right, finalSide * (halfW + 6.9));
    const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);

    fiaDummy.position.set(pos.x, pos.y + 1.4, pos.z);
    fiaDummy.rotation.set(0, yaw, 0);
    fiaDummy.updateMatrix();
    fiaPostMesh.setMatrixAt(fiaIdx, fiaDummy.matrix);

    fiaDummy.position.set(pos.x, pos.y + 2.9, pos.z);
    fiaDummy.rotation.set(0, yaw, 0);
    fiaDummy.updateMatrix();
    fiaBoardMesh.setMatrixAt(fiaIdx, fiaDummy.matrix);
    fiaIdx++;
  }
  fiaPostMesh.count = fiaIdx;
  fiaBoardMesh.count = fiaIdx;
  group.add(fiaPostMesh, fiaBoardMesh);

  // 6 Trackside Marshal Huts & Elevated TV Camera Towers
  const hutBodyMat = new THREE.MeshStandardMaterial({ color: '#E2E8F0', roughness: 0.72 });
  const hutTrimMat = new THREE.MeshStandardMaterial({ color: '#EA580C', roughness: 0.5 });
  for (let m = 0; m < 6; m++) {
    const mS = (0.11 + m * 0.155) % 1;
    const mSmp = track.sampleAtS(mS);
    const mSide: -1 | 1 = m % 2 === 0 ? 1 : -1;
    const cand = mSmp.position.clone().addScaledVector(mSmp.right, mSide * (halfW + 10.5));
    const proj = track.projectToTrack(cand.x, cand.z, 0);
    if (Math.abs(proj.lateralOffset) < halfW + 8) continue;
    if (isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) && Math.sign(proj.lateralOffset) === cfg.pitSide) continue;

    const hutGroup = new THREE.Group();
    hutGroup.position.set(cand.x, mSmp.position.y, cand.z);
    hutGroup.rotation.y = Math.atan2(mSmp.tangent.x, mSmp.tangent.z);

    const towerLegs = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.6, 2.2), fiaPostMat);
    towerLegs.position.y = 1.8;
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.6), hutBodyMat);
    booth.position.y = 4.6;
    booth.castShadow = true;
    const roofCap = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.3, 2.9), hutTrimMat);
    roofCap.position.y = 5.85;
    const tvCam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.9), fiaPostMat);
    tvCam.position.set(-mSide * 1.1, 4.9, 0);
    hutGroup.add(towerLegs, booth, roofCap, tvCam);
    group.add(hutGroup);
  }

  // Stadium Floodlight Towers flanking the Main Straight & Pit Complex
  const floodBulbMat = new THREE.MeshBasicMaterial({ color: '#FFF7E0' });
  for (let f = 0; f < 6; f++) {
    const fs = (0.93 + f * 0.025) % 1;
    const fSmp = track.sampleAtS(fs);
    const fPos = fSmp.position.clone().addScaledVector(fSmp.right, cfg.pitSide * (halfW + 28));
    const floodGroup = new THREE.Group();
    floodGroup.position.set(fPos.x, sampleTerrainY(fPos.x, fPos.z), fPos.z);
    floodGroup.rotation.y = Math.atan2(fSmp.tangent.x, fSmp.tangent.z);

    const mastH = 18;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.48, mastH, 8), fiaPostMat);
    mast.position.y = mastH * 0.5;
    const bank = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.8, 3.4), floodBulbMat);
    bank.position.set(-cfg.pitSide * 0.6, mastH, 0);
    bank.rotation.z = cfg.pitSide * 0.35;
    floodGroup.add(mast, bank);
    group.add(floodGroup);
  }

  // Scenery: Grandstands, Trees/Hills OR Las Vegas Neon Skyline & Animated Vegas Sphere!
  let vegasSphereMat: THREE.MeshStandardMaterial | null = null;
  if (isVegas) {
    const windowTex = createSkyscraperWindowTexture();
    const palmTex = createFoliageCanopyTexture('palm');
    const barkTex = createBarkTexture();
    textures.push(windowTex, palmTex, barkTex);

    const buildingMat = new THREE.MeshStandardMaterial({
      color: '#14192B',
      emissive: '#FFE4A0',
      emissiveMap: windowTex,
      emissiveIntensity: 0.95,
      metalness: 0.35,
      roughness: 0.45,
    });
    const podiumBaseMat = new THREE.MeshStandardMaterial({ color: '#1B2236', roughness: 0.55, metalness: 0.35 });
    const neonColors = ['#E10600', '#00E5FF', '#FFD700', '#FF2E93', '#A855F7'];

    // Multi-tier Stepped Strip Resort Casinos + Illuminated Rooftop Marquees
    for (let i = 0; i < SAMPLE_COUNT; i += 14) {
      const smp = track.samples[i];
      const side = (i / 14) % 2 === 0 ? 1 : -1;
      const distOut = halfW + 25 + ((i * 19) % 34);
      const pos = smp.position.clone().addScaledVector(smp.right, side * distOut);

      // Keep clear of Vegas Sphere center
      if (cfg.landmarkCenter) {
        const dSphere = Math.hypot(pos.x - cfg.landmarkCenter[0], pos.z - cfg.landmarkCenter[2]);
        if (dSphere < 95) continue;
      }

      const h = 30 + ((i * 37) % 66);
      const w = 16 + ((i * 13) % 14);
      const yaw = (i * 0.3) % Math.PI;
      const resortGroup = new THREE.Group();
      resortGroup.position.set(pos.x, groundBaseY, pos.z);
      resortGroup.rotation.y = yaw;

      // Stepped casino podium base
      const podiumBase = new THREE.Mesh(new THREE.BoxGeometry(w * 1.28, 7.5, w * 1.28), podiumBaseMat);
      podiumBase.position.y = 3.75;
      resortGroup.add(podiumBase);

      // Main illuminated hotel tower
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), buildingMat);
      tower.position.y = h * 0.5;
      resortGroup.add(tower);

      // Recessed rooftop crown penthouse
      const crownH = 5.5;
      const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.65, crownH, w * 0.65), buildingMat);
      crown.position.y = h + crownH * 0.5;
      resortGroup.add(crown);

      const trimColor = neonColors[(i / 14) % neonColors.length];
      const neonMat = new THREE.MeshBasicMaterial({ color: trimColor });
      const neonBand = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 1.35, w + 0.5), neonMat);
      neonBand.position.y = h - 3.2;
      const podiumNeon = new THREE.Mesh(new THREE.BoxGeometry(w * 1.3, 0.55, w * 1.3), neonMat);
      podiumNeon.position.y = 7.6;
      resortGroup.add(neonBand, podiumNeon);

      group.add(resortGroup);
    }

    // Strip Boulevard Illuminated Palm Trees outside barriers (clearing pit corridor)
    const palmCount = 120;
    const palmTrunkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.34, 7.2, 6),
      new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9 }),
      palmCount,
    );
    const palmCrownMesh = new THREE.InstancedMesh(
      buildCrossedFoliageGeometry(6.8, 4.2, true),
      new THREE.MeshStandardMaterial({
        map: palmTex,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.85,
      }),
      palmCount,
    );
    const palmDummy = new THREE.Object3D();
    let palmPlaced = 0;
    for (let i = 0; i < SAMPLE_COUNT && palmPlaced < palmCount; i += 6) {
      const smp = track.samples[i];
      const pSide = palmPlaced % 2 === 0 ? 1 : -1;
      const pos = smp.position.clone().addScaledVector(smp.right, pSide * (halfW + 10.2));
      const proj = track.projectToTrack(pos.x, pos.z, 0);
      if (Math.abs(proj.lateralOffset) < halfW + 8.5) continue;
      if (
        isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) &&
        Math.sign(proj.lateralOffset) === cfg.pitSide &&
        Math.abs(proj.lateralOffset) < halfW + 28
      ) {
        continue;
      }
      const scale = 0.88 + (i % 5) * 0.08;
      palmDummy.position.set(pos.x, pos.y + 3.6 * scale, pos.z);
      palmDummy.rotation.set(0, (i * 0.7) % (Math.PI * 2), 0);
      palmDummy.scale.set(scale, scale, scale);
      palmDummy.updateMatrix();
      palmTrunkMesh.setMatrixAt(palmPlaced, palmDummy.matrix);

      palmDummy.position.set(pos.x, pos.y + 6.2 * scale, pos.z);
      palmDummy.scale.set(scale, scale, scale);
      palmDummy.updateMatrix();
      palmCrownMesh.setMatrixAt(palmPlaced, palmDummy.matrix);
      palmPlaced++;
    }
    palmTrunkMesh.count = palmPlaced;
    palmCrownMesh.count = palmPlaced;
    group.add(palmTrunkMesh, palmCrownMesh);

    // Trackside overhead light gantry poles (keep pit lane clear on pitSide === -1)
    const poleMat = new THREE.MeshStandardMaterial({ color: '#222836' });
    const bulbMat = new THREE.MeshBasicMaterial({ color: '#FFF7E0' });
    for (let i = 0; i < SAMPLE_COUNT; i += 24) {
      const smp = track.samples[i];
      const inPitZone = isSInZone(smp.s, cfg.pitEntryS, cfg.pitExitS);
      const poleSide = inPitZone && cfg.pitSide === -1 ? 1 : -1;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 10, 6), poleMat);
      const pPos = smp.position.clone().addScaledVector(smp.right, poleSide * (halfW + 7.5));
      pole.position.set(pPos.x, pPos.y + 5, pPos.z);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 0.8), bulbMat);
      lamp.position.copy(pPos).addScaledVector(smp.right, -poleSide * 1.5).add(new THREE.Vector3(0, 9.8, 0));
      lamp.rotation.y = Math.atan2(smp.tangent.x, smp.tangent.z);
      group.add(pole, lamp);
    }

    // Iconic Glowing Vegas Sphere Landmark clearly visible along the Strip & Sphere sweep!
    const sphereTex = createVegasSphereTexture();
    textures.push(sphereTex);
    const sphereSample = track.sampleAtS(0.24);
    const sPos = sphereSample.position
      .clone()
      .addScaledVector(sphereSample.right, -105);

    vegasSphereMat = new THREE.MeshStandardMaterial({
      color: '#141B38',
      map: sphereTex,
      emissive: '#00E5FF',
      emissiveMap: sphereTex,
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.2,
    });
    const sphereMesh = new THREE.Mesh(
      new THREE.SphereGeometry(58, 32, 24),
      vegasSphereMat,
    );
    sphereMesh.position.set(sPos.x, 54, sPos.z);
    group.add(sphereMesh);

    // Neon halo ring base around Vegas Sphere
    const sphereRing = new THREE.Mesh(
      new THREE.TorusGeometry(62, 1.6, 10, 48),
      new THREE.MeshBasicMaterial({ color: '#00E5FF' }),
    );
    sphereRing.rotation.x = Math.PI / 2;
    sphereRing.position.set(sPos.x, 4, sPos.z);
    group.add(sphereRing);

    // Paris Las Vegas Illuminated Golden Eiffel Tower Landmark along the Strip
    const eiffelSample = track.sampleAtS(0.62);
    const ePos = eiffelSample.position.clone().addScaledVector(eiffelSample.right, 68);
    const eiffelGroup = new THREE.Group();
    eiffelGroup.position.set(ePos.x, groundBaseY, ePos.z);
    const goldTowerMat = new THREE.MeshStandardMaterial({
      color: '#D4A843',
      emissive: '#FFB732',
      emissiveIntensity: 0.95,
      metalness: 0.72,
      roughness: 0.28,
      wireframe: true,
    });
    const eiffelBase = new THREE.Mesh(new THREE.CylinderGeometry(10, 24, 38, 4, 4, true), goldTowerMat);
    eiffelBase.position.y = 19;
    const eiffelMid = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 10, 42, 4, 4, true), goldTowerMat);
    eiffelMid.position.y = 59;
    const eiffelSpire = new THREE.Mesh(new THREE.ConeGeometry(4.5, 44, 4, 4, true), goldTowerMat);
    eiffelSpire.position.y = 102;
    const eiffelBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#FFF5CC' }),
    );
    eiffelBeacon.position.y = 125;
    eiffelGroup.add(eiffelBase, eiffelMid, eiffelSpire, eiffelBeacon);
    group.add(eiffelGroup);

    // Bellagio-style Illuminated Strip Fountain Lake & Glowing Water Plumes
    const bellagioSample = track.sampleAtS(0.74);
    const bPos = bellagioSample.position.clone().addScaledVector(bellagioSample.right, -52);
    const lakeGroup = new THREE.Group();
    lakeGroup.position.set(bPos.x, groundBaseY + 0.15, bPos.z);
    lakeGroup.rotation.y = Math.atan2(bellagioSample.tangent.x, bellagioSample.tangent.z);
    const lakePool = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 110),
      new THREE.MeshPhysicalMaterial({
        color: '#081B36',
        metalness: 0.3,
        roughness: 0.08,
        clearcoat: 1.0,
      }),
    );
    lakePool.rotation.x = -Math.PI / 2;
    lakeGroup.add(lakePool);
    const jetMat = new THREE.MeshBasicMaterial({
      color: '#9BE8FF',
      transparent: true,
      opacity: 0.72,
    });
    for (let j = -4; j <= 4; j++) {
      const jetH = 14 + (4 - Math.abs(j)) * 4.5;
      const jet = new THREE.Mesh(new THREE.ConeGeometry(1.4, jetH, 8), jetMat);
      jet.position.set(0, jetH * 0.5, j * 10.5);
      lakeGroup.add(jet);
    }
    group.add(lakeGroup);
  } else {
    // Daylight circuits: Circuit-Wide Tiered Grandstands (Main Straight + Key Braking & Stadium Corners)
    const crowdTex = createCrowdSeatingTexture();
    crowdTex.repeat.set(1, 2);
    const gsBannerTex = createGrandstandBannerTexture(cfg.id);
    textures.push(crowdTex, gsBannerTex);

    const concreteMat = new THREE.MeshStandardMaterial({ color: '#202634', roughness: 0.85 });
    const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.72 });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: cfg.id === 'silverstone' ? '#003A70' : '#E10600',
      roughness: 0.42,
      metalness: 0.2,
    });
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#141820', metalness: 0.6, roughness: 0.35 });
    const gsBannerMat = new THREE.MeshStandardMaterial({ map: gsBannerTex, roughness: 0.4 });

    const gsPlacements: { s: number; side: -1 | 1 }[] = [
      { s: 0.94, side: -cfg.pitSide as -1 | 1 },
      { s: 0.968, side: -cfg.pitSide as -1 | 1 },
      { s: 0.995, side: -cfg.pitSide as -1 | 1 },
      { s: 0.025, side: -cfg.pitSide as -1 | 1 },
      { s: 0.145, side: 1 },
      { s: 0.25, side: -1 },
      { s: 0.35, side: -1 },
      { s: 0.51, side: 1 },
      { s: 0.68, side: -1 },
      { s: 0.85, side: 1 },
    ];

    for (const gp of gsPlacements) {
      const smp = track.sampleAtS(gp.s);
      const pos = smp.position.clone().addScaledVector(smp.right, gp.side * (halfW + 22));
      const proj = track.projectToTrack(pos.x, pos.z, 0);
      if (Math.abs(proj.lateralOffset) < halfW + 17) continue;
      if (
        isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) &&
        Math.sign(proj.lateralOffset) === cfg.pitSide &&
        Math.abs(proj.lateralOffset) < halfW + 34
      ) {
        continue;
      }

      const trackDirLocalX = -gp.side; // points from grandstand toward track
      const standGroup = new THREE.Group();
      standGroup.position.set(pos.x, smp.position.y, pos.z);
      standGroup.rotation.y = Math.atan2(smp.tangent.x, smp.tangent.z);

      // Grounded concrete foundation extending beneath lowest terrain floor
      const foundationH = Math.max(2.5, smp.position.y - groundBaseY + 1.5);
      const foundation = new THREE.Mesh(new THREE.BoxGeometry(12.5, foundationH, 34.5), concreteMat);
      foundation.position.set(0, -foundationH * 0.5 + 0.1, 0);
      foundation.receiveShadow = true;
      standGroup.add(foundation);

      for (let t = 0; t < 3; t++) {
        const tierH = 1.6 + t * 1.5;
        const tierX = trackDirLocalX * (3.6 - t * 3.6);
        const tierBox = new THREE.Mesh(new THREE.BoxGeometry(4.2, tierH, 34), concreteMat);
        tierBox.position.set(tierX, tierH * 0.5, 0);
        tierBox.castShadow = true;
        tierBox.receiveShadow = true;
        standGroup.add(tierBox);
      }

      const seatDeck = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.35, 33.6), crowdMat);
      seatDeck.position.set(0, 4.65, 0);
      seatDeck.rotation.z = -trackDirLocalX * 0.44;
      seatDeck.receiveShadow = true;
      standGroup.add(seatDeck);

      const rearWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8.6, 34), concreteMat);
      rearWall.position.set(-trackDirLocalX * 5.8, 4.3, 0);
      standGroup.add(rearWall);

      for (const pz of [-15, 0, 15]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.2, 0.45), pillarMat);
        pillar.position.set(-trackDirLocalX * 5.2, 7.6, pz);
        standGroup.add(pillar);
      }

      const roof = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.55, 35.2), canopyMat);
      roof.position.set(trackDirLocalX * 0.6, 9.2, 0);
      roof.rotation.z = trackDirLocalX * 0.08;
      roof.castShadow = true;
      standGroup.add(roof);

      const fasciaBanner = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 33.4), gsBannerMat);
      fasciaBanner.position.set(trackDirLocalX * 7.45, 9.0, 0);
      standGroup.add(fasciaBanner);

      group.add(standGroup);
    }

    // Photorealistic Alpha-Cutout Multi-Plane Trees + Textured Bark Trunks (Zero Smooth Spheres/Cones!)
    const treeCount = 720;
    const isAlpine = cfg.atmosphere === 'alpine-day';
    const treeKind = isAlpine ? 'pine' : 'deciduous';
    const foliageTex = createFoliageCanopyTexture(treeKind);
    const barkTex = createBarkTexture();
    textures.push(foliageTex, barkTex);

    const trunkGeo = new THREE.CylinderGeometry(0.26, 0.46, 4.4, 7);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: barkTex,
      roughness: 0.95,
    });
    const foliageGeo = buildCrossedFoliageGeometry(isAlpine ? 6.6 : 7.6, isAlpine ? 11.5 : 8.2, !isAlpine);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      map: foliageTex,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.90,
      metalness: 0.02,
    });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const canopies = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
    trunks.castShadow = true;
    canopies.castShadow = true;
    canopies.receiveShadow = true;

    const palette =
      cfg.atmosphere === 'golden-park'
        ? ['#4E7A38', '#5E8A3E', '#6D9144', '#406B30', '#7B8F41']
        : cfg.atmosphere === 'alpine-day'
          ? ['#34693E', '#417B49', '#4D8A52', '#2B5B35', '#589458']
          : ['#3E6E3F', '#4B7D48', '#588B52', '#356036', '#628E54'];
    const tmpColor = new THREE.Color();
    const dummy = new THREE.Object3D();

    let placed = 0;
    for (let i = 0; i < SAMPLE_COUNT * 2 && placed < treeCount; i++) {
      const sIdx = i % SAMPLE_COUNT;
      const smp = track.samples[sIdx];
      const side = placed % 2 === 0 ? 1 : -1;
      const band = placed % 3;
      const dist =
        band === 0
          ? halfW + 26 + ((i * 19) % 34)
          : band === 1
            ? halfW + 62 + ((i * 29) % 72)
            : halfW + 135 + ((i * 41) % 95);
      const cand = smp.position.clone().addScaledVector(smp.right, side * dist);

      // Ensure tree never enters track, pit lane, pit paddock, or grandstands
      const proj = track.projectToTrack(cand.x, cand.z, 0);
      if (Math.abs(proj.lateralOffset) < halfW + 20) continue;
      if (
        isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) &&
        Math.sign(proj.lateralOffset) === cfg.pitSide &&
        Math.abs(proj.lateralOffset) < halfW + 46
      ) {
        continue;
      }

      const scale = 0.85 + ((i * 13) % 7) * 0.16;
      const baseY = sampleTerrainY(cand.x, cand.z);
      const yaw = (i * 1.9) % (Math.PI * 2);

      dummy.position.set(cand.x, baseY + 2.0 * scale, cand.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);

      dummy.position.set(cand.x, baseY + (isAlpine ? 1.6 : 2.8) * scale, cand.z);
      dummy.rotation.set(0, yaw + 0.4, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      canopies.setMatrixAt(placed, dummy.matrix);
      tmpColor.set(palette[(i * 3 + placed) % palette.length]);
      canopies.setColorAt(placed, tmpColor);
      placed++;
    }
    trunks.count = placed;
    canopies.count = placed;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    group.add(trunks, canopies);

    // 360-degree Continuous Woodland Treeline Perimeter Backdrop around the Valley/Park
    const treelineTex = createTreelineWallTexture(
      cfg.atmosphere === 'golden-park'
        ? 'golden-park'
        : cfg.atmosphere === 'alpine-day'
          ? 'alpine-day'
          : 'british-day',
    );
    treelineTex.repeat.set(14, 1);
    textures.push(treelineTex);
    const midX = (track.boundsMin.x + track.boundsMax.x) * 0.5;
    const midZ = (track.boundsMin.z + track.boundsMax.z) * 0.5;
    const treelineWall = new THREE.Mesh(
      new THREE.CylinderGeometry(860, 860, 48, 64, 1, true),
      new THREE.MeshStandardMaterial({
        map: treelineTex,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.95,
      }),
    );
    treelineWall.position.set(midX, groundBaseY + 22, midZ);
    group.add(treelineWall);

    // Continuous 360° sculpted mountain panorama for Alpine (Red Bull Ring) & Lombardy foothills for Monza;
    // Silverstone is a historic WWII RAF airfield in Northamptonshire (woodland treeline, no alpine mountains)
    if (cfg.id !== 'silverstone') {
      const mountainRange = buildMountainRangeMesh(cfg.atmosphere, groundBaseY);
      group.add(mountainRange);
    }

    // === ICONIC REAL-WORLD CIRCUIT LANDMARKS & ENVIRONMENTAL OBJECTS ===
    if (cfg.id === 'red-bull-ring') {
      // 1. Iconic Giant Metallic "Bull of Spielberg" Sculpture perched on infield slope
      const bullSmp = track.sampleAtS(0.28);
      const bullPos = bullSmp.position.clone().addScaledVector(bullSmp.right, -58);
      const bullY = sampleTerrainY(bullPos.x, bullPos.z);
      const bullGroup = new THREE.Group();
      bullGroup.position.set(bullPos.x, bullY, bullPos.z);
      bullGroup.rotation.y = Math.atan2(bullSmp.tangent.x, bullSmp.tangent.z) + 0.5;
      const bullRedMat = new THREE.MeshPhysicalMaterial({
        color: '#CC0018',
        metalness: 0.80,
        roughness: 0.20,
        clearcoat: 0.9,
      });
      const stoneMat = new THREE.MeshStandardMaterial({ color: '#4B5563', roughness: 0.85 });
      const plinthBase = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 13.0, 3.2, 20), stoneMat);
      plinthBase.position.y = 1.6;
      const plinthUpper = new THREE.Mesh(new THREE.CylinderGeometry(7.8, 9.6, 3.0, 20), stoneMat);
      plinthUpper.position.y = 4.6;

      // Sculpted metallic bull silhouette
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 9.8, 16), bullRedMat);
      torso.rotation.x = Math.PI / 2 - 0.14;
      torso.position.set(0, 9.2, 0);
      const chest = new THREE.Mesh(new THREE.SphereGeometry(2.75, 16, 14), bullRedMat);
      chest.scale.set(1.0, 1.08, 1.18);
      chest.position.set(0, 9.8, 3.6);
      const haunch = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 12), bullRedMat);
      haunch.position.set(0, 8.6, -4.0);
      const bullHead = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.6, 3.8), bullRedMat);
      bullHead.position.set(0, 11.1, 6.4);
      bullHead.rotation.x = 0.28;
      bullGroup.add(plinthBase, plinthUpper, torso, chest, haunch, bullHead);
      for (const side of [-1, 1] as const) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.48, 4.4, 10), bullRedMat);
        horn.position.set(side * 2.0, 12.8, 7.6);
        horn.rotation.z = -side * 0.78;
        horn.rotation.x = 0.42;
        const frontLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 3.8, 8), bullRedMat);
        frontLeg.position.set(side * 1.4, 7.2, 3.4);
        frontLeg.rotation.x = 0.22;
        const rearLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.42, 3.6, 8), bullRedMat);
        rearLeg.position.set(side * 1.3, 6.8, -3.6);
        rearLeg.rotation.x = -0.18;
        bullGroup.add(horn, frontLeg, rearLeg);
      }
      group.add(bullGroup);

      // 2. Iconic Voestalpine Wing Architectural Silver/Glass Landmark near Start/Finish
      const wingSmp = track.sampleAtS(0.05);
      const wingPos = wingSmp.position.clone().addScaledVector(wingSmp.right, -cfg.pitSide * 48);
      const wingGroup = new THREE.Group();
      wingGroup.position.set(wingPos.x, wingPos.y, wingPos.z);
      wingGroup.rotation.y = Math.atan2(wingSmp.tangent.x, wingSmp.tangent.z);

      const wingMat = new THREE.MeshPhysicalMaterial({
        color: '#DCE4F0',
        metalness: 0.84,
        roughness: 0.16,
        clearcoat: 0.9,
      });
      const wingGlassMat = new THREE.MeshPhysicalMaterial({
        color: '#10243C',
        metalness: 0.25,
        roughness: 0.08,
        clearcoat: 1.0,
      });
      const wingRoof = new THREE.Mesh(new THREE.BoxGeometry(24, 2.2, 56), wingMat);
      wingRoof.position.set(0, 12.5, 0);
      wingRoof.rotation.z = 0.20;
      wingRoof.castShadow = true;
      const wingGlassWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5.2, 46), wingGlassMat);
      wingGlassWall.position.set(-cfg.pitSide * -2.2, 7.2, 0);
      for (const pz of [-22, 22]) {
        const aPillar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 12.5, 2.2), wingMat);
        aPillar.position.set(0, 6.0, pz);
        aPillar.rotation.z = 0.18;
        aPillar.castShadow = true;
        wingGroup.add(aPillar);
      }
      wingGroup.add(wingRoof, wingGlassWall);
      group.add(wingGroup);
    } else if (cfg.id === 'monza') {
      // 1. Iconic Historic Monza High-Speed Banking Overpass Bridge spanning the circuit!
      const bankSmp = track.sampleAtS(0.56);
      const bankGroup = new THREE.Group();
      bankGroup.position.copy(bankSmp.position);
      bankGroup.rotation.y = Math.atan2(bankSmp.tangent.x, bankSmp.tangent.z) + 0.18;
      const agedConcreteMat = new THREE.MeshStandardMaterial({
        color: '#9BA1A8',
        roughness: 0.92,
      });
      const railMat = new THREE.MeshStandardMaterial({ color: '#64748B', metalness: 0.65, roughness: 0.4 });
      const spanW = cfg.trackWidth + 28;
      const bankDeck = new THREE.Mesh(new THREE.BoxGeometry(spanW, 1.8, 12.5), agedConcreteMat);
      bankDeck.position.set(0, 9.2, 0);
      bankDeck.rotation.x = 0.24; // Iconic steep historic oval banking tilt
      bankDeck.castShadow = true;
      const upperRail = new THREE.Mesh(new THREE.BoxGeometry(spanW, 0.85, 0.35), railMat);
      upperRail.position.set(0, 11.4, -5.8);
      bankGroup.add(bankDeck, upperRail);
      for (const side of [-1, 1] as const) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(2.8, 11.8, 11.8), agedConcreteMat);
        pier.position.set(side * (spanW * 0.45), 4.8, 0);
        pier.castShadow = true;
        bankGroup.add(pier);
      }
      group.add(bankGroup);

      // 2. Royal Park of Monza Slender Alpha-Cutout Italian Cypress Trees along main straights
      const cypressTex = createFoliageCanopyTexture('cypress');
      textures.push(cypressTex);
      const cypressMat = new THREE.MeshStandardMaterial({
        color: '#2E5933',
        map: cypressTex,
        alphaTest: 0.38,
        side: THREE.DoubleSide,
        roughness: 0.90,
      });
      const cypressGeo = buildCrossedFoliageGeometry(4.2, 15.5, false);
      const cypressMesh = new THREE.InstancedMesh(cypressGeo, cypressMat, 140);
      let cPlaced = 0;
      for (let i = 0; i < SAMPLE_COUNT && cPlaced < 140; i += 5) {
        const smp = track.samples[i];
        const side = cPlaced % 2 === 0 ? 1 : -1;
        const pos = smp.position.clone().addScaledVector(smp.right, side * (halfW + 20 + (i % 10)));
        const proj = track.projectToTrack(pos.x, pos.z, 0);
        if (Math.abs(proj.lateralOffset) < halfW + 17) continue;
        if (
          isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) &&
          Math.sign(proj.lateralOffset) === cfg.pitSide &&
          Math.abs(proj.lateralOffset) < halfW + 44
        ) {
          continue;
        }
        dummy.position.set(pos.x, sampleTerrainY(pos.x, pos.z), pos.z);
        dummy.rotation.set(0, i * 0.5, 0);
        dummy.scale.set(0.9 + (i % 4) * 0.12, 0.95 + (i % 5) * 0.14, 0.9 + (i % 4) * 0.12);
        dummy.updateMatrix();
        cypressMesh.setMatrixAt(cPlaced++, dummy.matrix);
      }
      cypressMesh.count = cPlaced;
      group.add(cypressMesh);

      // 3. Italian Tricolore Tifosi Banner Strips along Main Straight Grandstands
      const triColors = ['#009246', '#FFFFFF', '#CE2B37'];
      for (let t = 0; t < 3; t++) {
        const triSmp = track.sampleAtS((0.96 + t * 0.02) % 1);
        const triPos = triSmp.position.clone().addScaledVector(triSmp.right, -cfg.pitSide * (halfW + 15.5));
        const flagBoard = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 2.2, 22),
          new THREE.MeshBasicMaterial({ color: triColors[t] }),
        );
        flagBoard.position.set(triPos.x, triPos.y + 5.2, triPos.z);
        flagBoard.rotation.y = Math.atan2(triSmp.tangent.x, triSmp.tangent.z);
        group.add(flagBoard);
      }
    } else if (cfg.id === 'silverstone') {
      // 1. Historic WWII RAF Airfield Control Tower & Corrugated Aviation Hangars in the flat infield
      const towerSmp = track.sampleAtS(0.35);
      const towerPos = towerSmp.position.clone().addScaledVector(towerSmp.right, -58);
      const towerY = sampleTerrainY(towerPos.x, towerPos.z);
      const towerGroup = new THREE.Group();
      towerGroup.position.set(towerPos.x, towerY, towerPos.z);
      const brickMat = new THREE.MeshStandardMaterial({ color: '#9EA8B4', roughness: 0.8 });
      const towerBody = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 10), brickMat);
      towerBody.position.y = 7;
      towerBody.castShadow = true;
      const balcony = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.65, 13.2), concreteMat);
      balcony.position.y = 14.1;
      const watchRoom = new THREE.Mesh(
        new THREE.BoxGeometry(11.5, 4.2, 11.5),
        new THREE.MeshPhysicalMaterial({ color: '#142B44', metalness: 0.3, roughness: 0.1, clearcoat: 1.0 }),
      );
      watchRoom.position.y = 16.4;
      const radarMast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 4.5, 8), pillarMat);
      radarMast.position.y = 20.6;
      const radarDish = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.1, 0.35), concreteMat);
      radarDish.position.y = 22.8;
      const hangar = new THREE.Mesh(
        new THREE.CylinderGeometry(14, 14, 34, 16, 1, false, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: '#4B5563', metalness: 0.45, roughness: 0.55 }),
      );
      hangar.rotation.z = Math.PI / 2;
      hangar.position.set(26, 0, 12);
      towerGroup.add(towerBody, balcony, watchRoom, radarMast, radarDish, hangar);
      group.add(towerGroup);

      // 2. Classic British Blue/White Glazed Steel Truss Footbridges over Hangar & Wellington Straights
      const bridgeBlueMat = new THREE.MeshStandardMaterial({ color: '#003A70', roughness: 0.4 });
      const bridgeWhiteMat = new THREE.MeshStandardMaterial({ color: '#F1F5F9', roughness: 0.4 });
      const bridgeGlassMat = new THREE.MeshPhysicalMaterial({
        color: '#1E3A5F',
        metalness: 0.25,
        roughness: 0.1,
        clearcoat: 1.0,
      });
      for (const bs of [0.38, 0.68]) {
        const bSmp = track.sampleAtS(bs);
        const fbGroup = new THREE.Group();
        fbGroup.position.copy(bSmp.position);
        fbGroup.rotation.y = Math.atan2(bSmp.tangent.x, bSmp.tangent.z);
        const spanW = cfg.trackWidth + 16;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(spanW, 2.5, 3.2), bridgeBlueMat);
        deck.position.set(0, 8.2, 0);
        deck.castShadow = true;
        const glassStrip = new THREE.Mesh(new THREE.BoxGeometry(spanW - 2.4, 0.95, 3.35), bridgeGlassMat);
        glassStrip.position.set(0, 8.4, 0);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(spanW + 0.2, 0.45, 3.4), bridgeWhiteMat);
        stripe.position.set(0, 7.5, 0);
        fbGroup.add(deck, glassStrip, stripe);
        for (const side of [-1, 1] as const) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9.0, 3.0), bridgeWhiteMat);
          leg.position.set(side * (spanW * 0.5), 4.5, 0);
          leg.castShadow = true;
          fbGroup.add(leg);
        }
        group.add(fbGroup);
      }
    }
  }

  const updateStartLights = (litCount: number) => {
    for (let i = 0; i < 5; i++) {
      startLightMaterials[i].emissiveIntensity = i < litCount ? 4.5 : 0.08;
    }
  };

  const updateRacingLine = (
    playerSpeedMps: number,
    mode: 'full' | 'corners' | 'off',
    clockSec: number,
  ) => {
    if (mode === 'off') {
      racingLineMesh.visible = false;
      return;
    }
    racingLineMesh.visible = true;

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const recSpeed = racingLineSpeeds[i];
      const speedDelta = playerSpeedMps - recSpeed;

      let r = 0.06;
      let g = 0.88;
      let b = 0.42;

      if (speedDelta > 5) {
        // Red braking required
        r = 0.98;
        g = 0.12;
        b = 0.12;
      } else if (speedDelta > -5) {
        // Yellow/Amber feather or prepare to brake
        r = 1.0;
        g = 0.82;
        b = 0.08;
      } else if (mode === 'corners' && recSpeed > 82) {
        // Dim straights when set to Corners Only
        r = 0.16;
        g = 0.25;
        b = 0.2;
      }

      const vi = i * 6;
      racingLineColors[vi] = r;
      racingLineColors[vi + 1] = g;
      racingLineColors[vi + 2] = b;
      racingLineColors[vi + 3] = r;
      racingLineColors[vi + 4] = g;
      racingLineColors[vi + 5] = b;
    }

    // Duplicate closing vertex colors at SAMPLE_COUNT for closed ribbon seam
    const endOffset = SAMPLE_COUNT * 6;
    for (let k = 0; k < 6; k++) {
      racingLineColors[endOffset + k] = racingLineColors[k];
    }

    (lineGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    if (vegasSphereMat) {
      const hue = (clockSec * 0.08) % 1;
      vegasSphereMat.emissive.setHSL(hue, 0.92, 0.52);
    }
  };

  const dispose = () => {
    for (const tex of textures) tex.dispose();
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  };

  return {
    group,
    racingLineMesh,
    racingLineColors,
    racingLineSpeeds,
    startLightMaterials,
    vegasSphereMat,
    updateStartLights,
    updateRacingLine,
    dispose,
  };
}
