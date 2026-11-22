import * as THREE from 'three';
import type { AtmospherePreset } from '../data/circuits';
import { isSInZone, SAMPLE_COUNT, TrackSpline } from '../engine/TrackSpline';
import {
  clonePBRSetWithRepeat,
  createBarkTexture,
  createBrakingZoneSkidTexture,
  createCatchFenceTexture,
  createCircuitGantryBannerTexture,
  createCircuitHorizonWallTexture,
  createFiaLightPanelTexture,
  createFoliageCanopyTexture,
  createGrandstandBannerTexture,
  createPaddockTruckTexture,
  createPaintedRunoffTexture,
  createPitBoxMarkingTexture,
  createPitGarageHeaderTexture,
  createPitSpeedBoardTexture,
  createSponsorBarrierTexture,
  createVegasBillboardTexture,
  createVegasSkylineWallTexture,
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

function createSkyscraperWindowTexture(
  style: 'gold-curtain' | 'cyan-modern' | 'warm-resort' = 'gold-curtain',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const bgHex =
    style === 'gold-curtain' ? '#0C0A08' : style === 'cyan-modern' ? '#060D1A' : '#100D14';
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 1024);

  const palettes: Record<typeof style, string[]> = {
    'gold-curtain': ['#FFE29A', '#FFC857', '#FFF3D1', '#D4A359'],
    'cyan-modern': ['#7CE8FF', '#38BDF8', '#E0F7FF', '#A5F3FC'],
    'warm-resort': ['#FFF0C8', '#FFD28A', '#FFE4B5', '#FDE68A'],
  };
  const colors = palettes[style];

  // 58 fine architectural stories with dark glass spandrel bands & narrow curtain-wall mullions
  const floorStep = 17;
  const colStep = 12;
  for (let floor = 2; floor < 58; floor++) {
    const y = floor * floorStep;
    // Horizontal floor slab / spandrel shadow line
    ctx.fillStyle = 'rgba(18, 24, 38, 0.92)';
    ctx.fillRect(0, y - 3, 512, 3);

    // Suite lighting clusters across each floor
    const floorSeed = floor * 47 + (style === 'cyan-modern' ? 19 : 7);
    for (let col = 1; col < 41; col++) {
      const x = col * colStep;
      const suiteCluster = Math.floor(col / 3);
      const hash = ((floorSeed + suiteCluster * 31 + col * 7) % 100) / 100;
      const isPenthouse = floor <= 4;
      if (isPenthouse || hash > 0.36) {
        ctx.fillStyle = colors[(floor + suiteCluster) % colors.length];
        ctx.fillRect(x, y, 8, 12);
      } else if (hash > 0.18) {
        ctx.fillStyle = 'rgba(45, 58, 82, 0.45)';
        ctx.fillRect(x, y, 8, 12);
      }
    }
  }

  // Structural corner & center curtain-wall piers
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 10, 1024);
  ctx.fillRect(502, 0, 10, 1024);
  ctx.fillRect(252, 0, 8, 1024);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createVegasSphereTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Vivid high-luminance Exosphere LED background (never dark!)
  const grad = ctx.createLinearGradient(0, 0, 1024, 512);
  grad.addColorStop(0.0, '#00E5FF');
  grad.addColorStop(0.22, '#3B82F6');
  grad.addColorStop(0.45, '#A855F7');
  grad.addColorStop(0.68, '#FF1E8E');
  grad.addColorStop(0.86, '#FF9900');
  grad.addColorStop(1.0, '#FFE600');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  // Glowing equatorial & tropical LED plasma horizon bands
  const bandColors = [
    'rgba(255, 240, 120, 0.72)',
    'rgba(0, 245, 255, 0.68)',
    'rgba(255, 64, 180, 0.65)',
    'rgba(255, 255, 255, 0.78)',
  ];
  for (let b = 0; b < 12; b++) {
    const y = 32 + b * 38;
    ctx.fillStyle = bandColors[b % bandColors.length];
    ctx.fillRect(0, y, 1024, 8);
  }

  // Swooping holographic Exosphere LED aurora waves
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.lineWidth = 7;
  for (let y = 36; y < 480; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(340, y - 38, 680, y + 38, 1024, y);
    ctx.stroke();
  }

  // Iconic giant glowing Sphere circular graphic emblems around the equator
  for (const cx of [256, 768]) {
    const orbGrad = ctx.createRadialGradient(cx, 256, 12, cx, 256, 132);
    orbGrad.addColorStop(0, '#FFFFFF');
    orbGrad.addColorStop(0.45, '#FFE600');
    orbGrad.addColorStop(0.78, '#FF1E8E');
    orbGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(cx, 256, 132, 0, Math.PI * 2);
    ctx.fill();
  }

  // Authentic Geodesic Exosphere LED Panel Seam Matrix across the dome
  ctx.fillStyle = 'rgba(8, 12, 26, 0.34)';
  for (let y = 16; y < 512; y += 16) {
    ctx.fillRect(0, y, 1024, 2);
  }
  for (let x = 16; x < 1024; x += 24) {
    ctx.fillRect(x, 0, 2, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
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

/**
 * Circuit-specific distant mountain backdrop:
 * - Red Bull Ring: asymmetric 360° Seckauer Tauern Alps (steep rocky/snowy peaks north, low Murtal valley south)
 * - Monza: distant hazy northern Lombardy Prealps / Monte Resegone arc only (flat Po Valley everywhere else)
 * - Silverstone: null (completely flat Northamptonshire RAF airfield plateau)
 */
function buildCircuitMountainBackdrop(
  circuitId: string,
  groundBaseY: number,
  innerR = 1480,
): THREE.Mesh | null {
  if (circuitId === 'silverstone' || circuitId === 'las-vegas') {
    return null;
  }

  const isMonza = circuitId === 'monza';
  const radialSegs = isMonza ? 88 : 200;
  const heightRings = 7;
  const startR = isMonza ? innerR + 420 : innerR;
  const outerR = startR + (isMonza ? 780 : 1180);
  const maxPeak = isMonza ? 148 : 375;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const cBase = new THREE.Color(isMonza ? '#44594C' : '#244127');
  const cMid = new THREE.Color(isMonza ? '#5E7284' : '#4F5D56');
  const cRock = new THREE.Color(isMonza ? '#7C8FA3' : '#6B727C');
  const cSnow = new THREE.Color('#E8EEF5');
  const tmpCol = new THREE.Color();

  // Monza Prealps only occupy a 110° northern arc (sin(ang) < 0 -> -Z north horizon)
  const angStart = isMonza ? -Math.PI * 0.84 : 0;
  const angEnd = isMonza ? -Math.PI * 0.16 : Math.PI * 2;

  for (let r = 0; r <= heightRings; r++) {
    const t = r / heightRings;
    const radius = THREE.MathUtils.lerp(startR, outerR, t);
    const ridgeEnv = Math.sin(t * Math.PI);
    const sharpened = Math.pow(ridgeEnv, 1.15);

    for (let i = 0; i <= radialSegs; i++) {
      const u = i / radialSegs;
      const ang = THREE.MathUtils.lerp(angStart, angEnd, u);
      const n1 = Math.sin(ang * 3 + 0.4) * 0.45 + 0.55;
      const n2 = Math.sin(ang * 7 - 1.2) * 0.28 + 0.28;
      const n3 = Math.sin(ang * 15 + 2.1) * 0.14 + 0.14;
      const n4 = Math.sin(ang * 31 - 0.7) * 0.06 + 0.06;

      let asymScale = 1.0;
      if (isMonza) {
        // Taper cleanly down into Po Plain at both eastern and western ends of northern Prealps
        asymScale = Math.pow(Math.sin(u * Math.PI), 0.75);
      } else {
        // Red Bull Ring: steep towering Seckauer Tauern north (sin < 0), lower rolling hills south (sin > 0)
        const northBias = THREE.MathUtils.clamp((-Math.sin(ang) + 1) * 0.5, 0, 1);
        asymScale = THREE.MathUtils.lerp(0.28, 1.05, northBias);
      }

      const hNorm = Math.min(1, Math.max(0.05, (n1 + n2 + n3 + n4) * 0.65 * asymScale));
      const y = groundBaseY - 14 + sharpened * maxPeak * hNorm;

      positions.push(Math.cos(ang) * radius, y, Math.sin(ang) * radius);

      const elev = (y - groundBaseY) / Math.max(1, maxPeak);
      if (isMonza) {
        tmpCol.copy(cBase).lerp(cRock, Math.min(1, elev * 1.15));
      } else {
        if (elev < 0.34) {
          tmpCol.copy(cBase).lerp(cMid, elev / 0.34);
        } else if (elev < 0.64) {
          tmpCol.copy(cMid).lerp(cRock, (elev - 0.34) / 0.3);
        } else {
          tmpCol.copy(cRock).lerp(cSnow, Math.min(1, (elev - 0.64) / 0.24));
        }
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = isMonza ? 'lombardy-prealps-range' : 'alpine-mountain-range';
  return mesh;
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
    cfg.id === 'red-bull-ring' ? 68 : cfg.id === 'monza' ? 3.2 : 1.6;

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

    // Circuit-authentic landform elevation (always >= 0)
    const n1 = Math.sin(x * 0.0042 + 0.7) * Math.cos(z * 0.0038 - 0.4) * 0.5 + 0.5;
    const n2 = Math.sin(x * 0.011 - z * 0.009 + 1.3) * 0.5 + 0.5;
    const n3 = Math.cos(x * 0.023 + z * 0.021) * 0.5 + 0.5;
    let hillH = (n1 * 0.6 + n2 * 0.28 + n3 * 0.12) * hillAmp;
    if (cfg.id === 'red-bull-ring') {
      // Styrian Alps climb steepens behind northern Turns 2-4 (z < midZ), mellows toward southern Murtal meadow
      const northSlope = THREE.MathUtils.clamp((midZ - z + 260) / 880, 0.22, 1.0);
      hillH *= northSlope;
    }
    const targetY = groundBaseY + 0.35 + hillH;

    return THREE.MathUtils.lerp(clearFloor, targetY, smooth);
  };

  const segs = 92;
  const size = 3400;
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

    // Silverstone Wing distinctive jagged angular white/red roof vs sleek cantilevered F1 paddock roof
    if (cfg.id === 'silverstone') {
      const silverstoneWing = new THREE.Group();
      silverstoneWing.name = 'silverstone-wing';
      const wingRoofMat = new THREE.MeshStandardMaterial({
        color: '#E8EEF5',
        metalness: 0.72,
        roughness: 0.22,
      });
      const wingTrimMat = new THREE.MeshStandardMaterial({
        color: '#E10600',
        metalness: 0.4,
        roughness: 0.35,
      });
      for (let w = 0; w < 3; w++) {
        const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(15.2, 0.58, 24.5), wingRoofMat);
        wingBlade.position.set(-cfg.pitSide * 0.8, 8.7 + (w % 2) * 0.95, (w - 1) * 24);
        wingBlade.rotation.z = cfg.pitSide * (w % 2 === 0 ? 0.16 : -0.11);
        wingBlade.castShadow = true;
        const fasciaRed = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 24.6), wingTrimMat);
        fasciaRed.position.set(-cfg.pitSide * 8.1, wingBlade.position.y - 0.1, (w - 1) * 24);
        silverstoneWing.add(wingBlade, fasciaRed);
      }
      pitBuildingGroup.add(silverstoneWing);
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

  // Compute circuit center & dynamic outer perimeter radius for 1:1 GPS track extents
  const midX = (track.boundsMin.x + track.boundsMax.x) * 0.5;
  const midZ = (track.boundsMin.z + track.boundsMax.z) * 0.5;
  let maxTrackRad = 650;
  for (let i = 0; i < SAMPLE_COUNT; i += 8) {
    const p = track.samples[i].position;
    const r = Math.hypot(p.x - midX, p.z - midZ);
    if (r > maxTrackRad) maxTrackRad = r;
  }
  const perimeterRadius = Math.max(1080, maxTrackRad + 220);

  // Track placed footprints so buildings/landmarks/grandstands never overlap or clip into each other
  const placedFootprints: { x: number; z: number; r: number }[] = [];
  const canPlaceFootprint = (x: number, z: number, r: number, minTrackClear = halfW + 17): boolean => {
    const proj = track.projectToTrack(x, z, 0);
    if (Math.abs(proj.lateralOffset) < minTrackClear) return false;
    if (
      isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) &&
      Math.sign(proj.lateralOffset) === cfg.pitSide &&
      Math.abs(proj.lateralOffset) < halfW + r + 32
    ) {
      return false;
    }
    for (const fp of placedFootprints) {
      if (Math.hypot(x - fp.x, z - fp.z) < r + fp.r + 4) return false;
    }
    return true;
  };

  // Circuit-Wide Tiered Grandstands on ALL 4 Circuits (including Las Vegas T-Mobile Sphere Arena Bowl!)
  const crowdTex = createCrowdSeatingTexture();
  crowdTex.repeat.set(1, 2);
  const gsBannerTex = createGrandstandBannerTexture(cfg.id);
  textures.push(crowdTex, gsBannerTex);

  const concreteMat = new THREE.MeshStandardMaterial({ color: '#202634', roughness: 0.85 });
  const crowdMat = new THREE.MeshStandardMaterial({
    map: crowdTex,
    emissive: isVegas ? '#261C38' : '#000000',
    emissiveIntensity: isVegas ? 0.55 : 0,
    roughness: 0.72,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: isVegas ? '#161B2E' : cfg.id === 'silverstone' ? '#003A70' : '#E10600',
    roughness: 0.38,
    metalness: 0.32,
  });
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#141820', metalness: 0.6, roughness: 0.35 });
  const gsBannerMat = new THREE.MeshStandardMaterial({
    map: gsBannerTex,
    emissive: isVegas ? '#FFFFFF' : '#000000',
    emissiveMap: isVegas ? gsBannerTex : null,
    emissiveIntensity: isVegas ? 0.65 : 0,
    roughness: 0.4,
  });
  const vegasNeonMagentaMat = new THREE.MeshBasicMaterial({ color: '#FF0080' });
  const vegasNeonCyanMat = new THREE.MeshBasicMaterial({ color: '#00E5FF' });

  const gsPlacements: { s: number; side: -1 | 1 }[] = isVegas
    ? [
        // East Harmon Pit Straight & T1-T4 Hairpin Stadium Arena
        { s: 0.94, side: -cfg.pitSide as -1 | 1 },
        { s: 0.975, side: -cfg.pitSide as -1 | 1 },
        { s: 0.015, side: -cfg.pitSide as -1 | 1 },
        { s: 0.055, side: 1 },
        // T-Mobile Zone at Sphere Arena Amphitheater Bowl (wrapping around T5-T9 horseshoe!)
        { s: 0.255, side: 1 },
        { s: 0.285, side: 1 },
        { s: 0.315, side: 1 },
        { s: 0.345, side: 1 },
        { s: 0.375, side: 1 },
        { s: 0.405, side: 1 },
        // Las Vegas Strip Hospitality Grandstands
        { s: 0.58, side: -1 },
        { s: 0.69, side: 1 },
        { s: 0.79, side: -1 },
      ]
    : [
        { s: 0.94, side: -cfg.pitSide as -1 | 1 },
        { s: 0.968, side: -cfg.pitSide as -1 | 1 },
        { s: 0.995, side: -cfg.pitSide as -1 | 1 },
        { s: 0.025, side: -cfg.pitSide as -1 | 1 },
        { s: 0.11, side: -1 },
        { s: 0.22, side: -1 },
        { s: 0.33, side: -1 },
        { s: 0.44, side: 1 },
        { s: 0.54, side: -1 },
        { s: 0.65, side: 1 },
        { s: 0.76, side: -1 },
        { s: 0.86, side: -1 },
      ];

  for (let gIdx = 0; gIdx < gsPlacements.length; gIdx++) {
    const gp = gsPlacements[gIdx];
    const smp = track.sampleAtS(gp.s);
    const pos = smp.position.clone().addScaledVector(smp.right, gp.side * (halfW + 22));
    if (!canPlaceFootprint(pos.x, pos.z, 18, halfW + 16)) continue;
    placedFootprints.push({ x: pos.x, z: pos.z, r: 19 });

    const trackDirLocalX = -gp.side; // points from grandstand toward track
    const standGroup = new THREE.Group();
    standGroup.position.set(pos.x, smp.position.y, pos.z);
    standGroup.rotation.y = Math.atan2(smp.tangent.x, smp.tangent.z);

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

    if (isVegas) {
      const neonTrim = new THREE.Mesh(
        new THREE.BoxGeometry(14.0, 0.22, 35.4),
        gIdx % 2 === 0 ? vegasNeonMagentaMat : vegasNeonCyanMat,
      );
      neonTrim.position.set(trackDirLocalX * 0.6, 9.55, 0);
      neonTrim.rotation.z = trackDirLocalX * 0.08;
      standGroup.add(neonTrim);
    }

    group.add(standGroup);
  }

  // Scenery: Las Vegas Strip Urban Arena & Iconic Landmarks OR Daylight Trees/Mountains/Landmarks
  let vegasSphereMat: THREE.MeshStandardMaterial | null = null;
  if (isVegas) {
    const texGold = createSkyscraperWindowTexture('gold-curtain');
    const texCyan = createSkyscraperWindowTexture('cyan-modern');
    const texWarm = createSkyscraperWindowTexture('warm-resort');
    const palmTex = createFoliageCanopyTexture('palm');
    const barkTex = createBarkTexture();
    const skylineWallTex = createVegasSkylineWallTexture();
    skylineWallTex.repeat.set(10, 1);
    const billboardTexs = [0, 1, 2, 3].map((v) => createVegasBillboardTexture(v));
    textures.push(texGold, texCyan, texWarm, palmTex, barkTex, skylineWallTex, ...billboardTexs);

    const towerMats = [
      new THREE.MeshStandardMaterial({
        color: '#1C1610',
        map: texGold,
        emissive: '#FFD98E',
        emissiveMap: texGold,
        emissiveIntensity: 1.05,
        metalness: 0.55,
        roughness: 0.28,
      }),
      new THREE.MeshStandardMaterial({
        color: '#0D172A',
        map: texCyan,
        emissive: '#93E8FF',
        emissiveMap: texCyan,
        emissiveIntensity: 1.05,
        metalness: 0.5,
        roughness: 0.25,
      }),
      new THREE.MeshStandardMaterial({
        color: '#1E1924',
        map: texWarm,
        emissive: '#FFE8B8',
        emissiveMap: texWarm,
        emissiveIntensity: 1.0,
        metalness: 0.35,
        roughness: 0.38,
      }),
    ];
    const podiumBaseMat = new THREE.MeshStandardMaterial({ color: '#1B2236', roughness: 0.5, metalness: 0.38 });
    const neonColors = ['#E10600', '#00E5FF', '#FFD700', '#FF2E93', '#A855F7'];

    // 0. Urban Boulevard Plaza Apron outside barriers so resorts sit on city blocks
    const plazaLeftIn: THREE.Vector3[] = [];
    const plazaLeftOut: THREE.Vector3[] = [];
    const plazaRightIn: THREE.Vector3[] = [];
    const plazaRightOut: THREE.Vector3[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const s = track.samples[i];
      plazaLeftIn.push(s.position.clone().addScaledVector(s.right, -(halfW + 6.5)).setY(groundBaseY + 0.08));
      plazaLeftOut.push(s.position.clone().addScaledVector(s.right, -(halfW + 68)).setY(groundBaseY + 0.06));
      plazaRightIn.push(s.position.clone().addScaledVector(s.right, halfW + 6.5).setY(groundBaseY + 0.08));
      plazaRightOut.push(s.position.clone().addScaledVector(s.right, halfW + 68).setY(groundBaseY + 0.06));
    }
    const plazaMat = new THREE.MeshStandardMaterial({ color: '#131824', roughness: 0.86, metalness: 0.08 });
    group.add(
      new THREE.Mesh(buildRibbonGeometry(plazaLeftOut, plazaLeftIn, true, 1), plazaMat),
      new THREE.Mesh(buildRibbonGeometry(plazaRightIn, plazaRightOut, true, 1), plazaMat),
    );

    // 1. THE BIG SHINY BALL — Iconic MSG Sphere Exosphere & T-Mobile Zone Arena (Exact GPS [427, 0, -449])
    const sphereTex = createVegasSphereTexture();
    textures.push(sphereTex);
    const sPos = new THREE.Vector3(
      cfg.landmarkCenter ? cfg.landmarkCenter[0] : 427,
      0,
      cfg.landmarkCenter ? cfg.landmarkCenter[2] : -449,
    );
    placedFootprints.push({ x: sPos.x, z: sPos.z, r: 108 });

    vegasSphereMat = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      map: sphereTex,
      emissive: '#FFFFFF',
      emissiveMap: sphereTex,
      emissiveIntensity: 1.75,
      roughness: 0.14,
      metalness: 0.24,
    });
    const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(72, 48, 36), vegasSphereMat);
    sphereMesh.position.set(sPos.x, 60, sPos.z);
    group.add(sphereMesh);

    // Geodesic Exosphere Structural LED Frame Lattice
    const exoCage = new THREE.Mesh(
      new THREE.SphereGeometry(72.45, 24, 18),
      new THREE.MeshBasicMaterial({
        color: '#B8F2FF',
        wireframe: true,
        transparent: true,
        opacity: 0.28,
      }),
    );
    exoCage.position.set(sPos.x, 60, sPos.z);
    group.add(exoCage);

    // Dark Metallic Structural Base Podium Cradle & Double Cyan/Magenta Neon Halo Rings
    const sphereCradle = new THREE.Mesh(
      new THREE.CylinderGeometry(64, 74, 14, 36),
      new THREE.MeshStandardMaterial({ color: '#121726', metalness: 0.65, roughness: 0.3 }),
    );
    sphereCradle.position.set(sPos.x, 7, sPos.z);
    const sphereRingCyan = new THREE.Mesh(
      new THREE.TorusGeometry(76, 1.8, 12, 48),
      vegasNeonCyanMat,
    );
    sphereRingCyan.rotation.x = Math.PI / 2;
    sphereRingCyan.position.set(sPos.x, 5.5, sPos.z);
    const sphereRingMagenta = new THREE.Mesh(
      new THREE.TorusGeometry(81, 1.4, 12, 48),
      vegasNeonMagentaMat,
    );
    sphereRingMagenta.rotation.x = Math.PI / 2;
    sphereRingMagenta.position.set(sPos.x, 2.2, sPos.z);
    group.add(sphereCradle, sphereRingCyan, sphereRingMagenta);

    // 8 Vertical Sky-Tracker Searchlight Beams around the MSG Sphere Arena
    const beamMatCyan = new THREE.MeshBasicMaterial({
      color: '#00E5FF',
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const beamMatPink = new THREE.MeshBasicMaterial({
      color: '#FF2E93',
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    for (let b = 0; b < 8; b++) {
      const ang = (b / 8) * Math.PI * 2;
      const bx = sPos.x + Math.cos(ang) * 84;
      const bz = sPos.z + Math.sin(ang) * 84;
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(7.5, 220, 10, 1, true),
        b % 2 === 0 ? beamMatCyan : beamMatPink,
      );
      beam.position.set(bx, 110, bz);
      beam.rotation.z = Math.cos(ang) * 0.08;
      beam.rotation.x = Math.sin(ang) * 0.08;
      group.add(beam);
    }

    // T-Mobile Zone at Sphere Arena Illuminated Neon Stage Lighting Trusses along T5-T9
    for (let st = 0; st < 6; st++) {
      const stS = 0.25 + st * 0.03;
      const stSmp = track.sampleAtS(stS);
      const stPos = stSmp.position.clone().addScaledVector(stSmp.right, -(halfW + 10.5));
      const archGroup = new THREE.Group();
      archGroup.position.set(stPos.x, stPos.y, stPos.z);
      archGroup.rotation.y = Math.atan2(stSmp.tangent.x, stSmp.tangent.z);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12.5, 0.9), pillarMat);
      mast.position.set(0, 6.25, 0);
      const neonBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.65, 14),
        st % 2 === 0 ? vegasNeonMagentaMat : vegasNeonCyanMat,
      );
      neonBar.position.set(0.4, 12.2, 0);
      archGroup.add(mast, neonBar);
      group.add(archGroup);
    }

    // 2. THE LINQ HIGH ROLLER — 168m Giant Illuminated Observation Ferris Wheel (Exact GPS [-131, 0, -107])
    const hrPos = new THREE.Vector3(-131, groundBaseY, -107);
    placedFootprints.push({ x: hrPos.x, z: hrPos.z, r: 58 });
    const hrGroup = new THREE.Group();
    hrGroup.position.copy(hrPos);
    hrGroup.rotation.y = 0.22;
    const hrRim = new THREE.Mesh(
      new THREE.TorusGeometry(66, 1.8, 12, 48),
      vegasNeonMagentaMat,
    );
    hrRim.position.y = 78;
    const hrInnerRim = new THREE.Mesh(
      new THREE.TorusGeometry(61, 0.9, 10, 48),
      vegasNeonCyanMat,
    );
    hrInnerRim.position.y = 78;
    const hrHub = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 6, 16), pillarMat);
    hrHub.rotation.x = Math.PI / 2;
    hrHub.position.y = 78;
    hrGroup.add(hrRim, hrInnerRim, hrHub);
    const legWhiteMat = new THREE.MeshStandardMaterial({ color: '#E2E8F0', metalness: 0.5, roughness: 0.3 });
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 86, 8), legWhiteMat);
        leg.position.set(sx * 20, 39, sz * 14);
        leg.rotation.z = sx * 0.24;
        leg.rotation.x = -sz * 0.16;
        hrGroup.add(leg);
      }
    }
    const podGlassMat = new THREE.MeshBasicMaterial({ color: '#E0F7FF' });
    for (let c = 0; c < 20; c++) {
      const ang = (c / 20) * Math.PI * 2;
      const pod = new THREE.Mesh(new THREE.SphereGeometry(3.1, 10, 8), podGlassMat);
      pod.position.set(Math.cos(ang) * 69.5, 78 + Math.sin(ang) * 69.5, 0);
      hrGroup.add(pod);
    }
    group.add(hrGroup);

    // 3. THE VENETIAN & PALAZZO + 102m ST. MARK'S CAMPANILE BELL TOWER (Exact GPS [-266, 0, -494])
    const venPos = new THREE.Vector3(-266, groundBaseY, -494);
    placedFootprints.push({ x: venPos.x, z: venPos.z, r: 68 });
    const venGroup = new THREE.Group();
    venGroup.position.copy(venPos);
    for (let wIdx = 0; wIdx < 3; wIdx++) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(24, 92, 62), towerMats[2]);
      wing.position.set(0, 46, 0);
      wing.rotation.y = (wIdx * Math.PI) / 3;
      venGroup.add(wing);
    }
    const campBrickMat = new THREE.MeshStandardMaterial({ color: '#9E4732', roughness: 0.65 });
    const campGoldMat = new THREE.MeshStandardMaterial({
      color: '#FFD700',
      emissive: '#FFB800',
      emissiveIntensity: 0.75,
      metalness: 0.75,
      roughness: 0.25,
    });
    const campShaft = new THREE.Mesh(new THREE.BoxGeometry(11, 74, 11), campBrickMat);
    campShaft.position.set(-48, 37, 24);
    const campBelfry = new THREE.Mesh(
      new THREE.BoxGeometry(11.8, 13, 11.8),
      new THREE.MeshBasicMaterial({ color: '#FFF3D1' }),
    );
    campBelfry.position.set(-48, 80.5, 24);
    const campSpire = new THREE.Mesh(new THREE.ConeGeometry(8.5, 22, 4), campGoldMat);
    campSpire.position.set(-48, 98, 24);
    campSpire.rotation.y = Math.PI / 4;
    venGroup.add(campShaft, campBelfry, campSpire);
    group.add(venGroup);

    // 4. WYNN & ENCORE TWIN CURVED BRONZE-GOLD GLASS ARC TOWERS (North Strip T11-T12 Corner)
    for (const [wx, wz, wyaw] of [
      [35, -1065, 0.35],
      [-185, -1055, -0.25],
    ] as const) {
      placedFootprints.push({ x: wx, z: wz, r: 58 });
      const wynnGroup = new THREE.Group();
      wynnGroup.position.set(wx, groundBaseY, wz);
      wynnGroup.rotation.y = wyaw;
      for (let seg = -1; seg <= 1; seg++) {
        const arcWing = new THREE.Mesh(new THREE.BoxGeometry(26, 118, 22), towerMats[0]);
        arcWing.position.set(seg * 23, 59, Math.abs(seg) * 6);
        arcWing.rotation.y = -seg * 0.24;
        wynnGroup.add(arcWing);
      }
      const wynnCrown = new THREE.Mesh(
        new THREE.BoxGeometry(74, 3.2, 24),
        new THREE.MeshBasicMaterial({ color: '#FFE082' }),
      );
      wynnCrown.position.set(0, 119.5, 3);
      wynnGroup.add(wynnCrown);
      group.add(wynnGroup);
    }

    // 5. CAESARS PALACE ROMAN COLONNADE & CYLINDRICAL COLOSSEUM DOME (Exact GPS [-706, 0, 59])
    const caePos = new THREE.Vector3(-706, groundBaseY, 59);
    placedFootprints.push({ x: caePos.x, z: caePos.z, r: 72 });
    const caeGroup = new THREE.Group();
    caeGroup.position.copy(caePos);
    const marbleMat = new THREE.MeshStandardMaterial({
      color: '#F5EFE6',
      emissive: '#FFE4B5',
      emissiveIntensity: 0.35,
      roughness: 0.45,
    });
    const colosseumDrum = new THREE.Mesh(new THREE.CylinderGeometry(34, 36, 22, 32), marbleMat);
    colosseumDrum.position.set(22, 11, 0);
    const colosseumDome = new THREE.Mesh(
      new THREE.SphereGeometry(33, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
      campGoldMat,
    );
    colosseumDome.position.set(22, 21, 0);
    const augustusTower = new THREE.Mesh(new THREE.BoxGeometry(26, 106, 58), towerMats[2]);
    augustusTower.position.set(-28, 53, 0);
    const augustusPediment = new THREE.Mesh(new THREE.ConeGeometry(20, 12, 4), campGoldMat);
    augustusPediment.position.set(-28, 112, 0);
    augustusPediment.rotation.y = Math.PI / 4;
    caeGroup.add(colosseumDrum, colosseumDome, augustusTower, augustusPediment);
    group.add(caeGroup);

    // 6. PARIS LAS VEGAS — 140m GOLDEN EIFFEL TOWER, ARC DE TRIOMPHE & NEON BALLOON (GPS [-468, 0, 468])
    const ePos = new THREE.Vector3(-468, groundBaseY, 468);
    placedFootprints.push({ x: ePos.x, z: ePos.z, r: 56 });
    const eiffelGroup = new THREE.Group();
    eiffelGroup.position.copy(ePos);
    const goldTowerMat = new THREE.MeshStandardMaterial({
      color: '#E5B84B',
      emissive: '#FFB732',
      emissiveIntensity: 1.05,
      metalness: 0.72,
      roughness: 0.25,
      wireframe: true,
    });
    const deckSolidMat = new THREE.MeshStandardMaterial({
      color: '#D4A843',
      emissive: '#FFA726',
      emissiveIntensity: 0.7,
      metalness: 0.6,
      roughness: 0.35,
    });
    const eiffelBase = new THREE.Mesh(new THREE.CylinderGeometry(11, 26, 42, 4, 4, true), goldTowerMat);
    eiffelBase.position.y = 21;
    const deck1 = new THREE.Mesh(new THREE.BoxGeometry(19, 2.6, 19), deckSolidMat);
    deck1.position.y = 42;
    const eiffelMid = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 11, 46, 4, 4, true), goldTowerMat);
    eiffelMid.position.y = 65;
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(10.5, 2.2, 10.5), deckSolidMat);
    deck2.position.y = 88;
    const eiffelSpire = new THREE.Mesh(new THREE.ConeGeometry(5.2, 48, 4, 4, true), goldTowerMat);
    eiffelSpire.position.y = 112;
    const eiffelBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 12, 10),
      new THREE.MeshBasicMaterial({ color: '#FFF9DB' }),
    );
    eiffelBeacon.position.y = 138;

    // Arc de Triomphe & Glowing Paris Hot-Air Balloon sign beside the Eiffel Tower
    const arcPillarL = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 10), marbleMat);
    arcPillarL.position.set(-28, 11, -34);
    const arcPillarR = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 10), marbleMat);
    arcPillarR.position.set(-28, 11, -16);
    const arcTop = new THREE.Mesh(new THREE.BoxGeometry(8.5, 7.5, 28), marbleMat);
    arcTop.position.set(-28, 24.5, -25);

    const balloonSphere = new THREE.Mesh(
      new THREE.SphereGeometry(10.5, 16, 14),
      new THREE.MeshStandardMaterial({
        color: '#E10600',
        emissive: '#FF2E63',
        emissiveIntensity: 1.15,
        roughness: 0.25,
      }),
    );
    balloonSphere.position.set(-34, 34, 28);
    const balloonRing = new THREE.Mesh(
      new THREE.TorusGeometry(10.8, 0.7, 8, 24),
      new THREE.MeshBasicMaterial({ color: '#FFD700' }),
    );
    balloonRing.position.set(-34, 34, 28);
    const balloonPost = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 24, 8), pillarMat);
    balloonPost.position.set(-34, 12, 28);
    eiffelGroup.add(
      eiffelBase,
      deck1,
      eiffelMid,
      deck2,
      eiffelSpire,
      eiffelBeacon,
      arcPillarL,
      arcPillarR,
      arcTop,
      balloonSphere,
      balloonRing,
      balloonPost,
    );
    group.add(eiffelGroup);

    // 7. BELLAGIO FOUNTAINS (210m Lake + 28 Illuminated Water Plumes) & GRAND CURVED BELLAGIO HOTEL (GPS [-662, 0, 446])
    const bPos = new THREE.Vector3(-662, groundBaseY + 0.15, 446);
    placedFootprints.push({ x: bPos.x - 36, z: bPos.z, r: 88 });
    const lakeGroup = new THREE.Group();
    lakeGroup.position.copy(bPos);
    const lakePool = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 210),
      new THREE.MeshPhysicalMaterial({
        color: '#082648',
        emissive: '#06325E',
        emissiveIntensity: 0.55,
        metalness: 0.35,
        roughness: 0.06,
        clearcoat: 1.0,
      }),
    );
    lakePool.rotation.x = -Math.PI / 2;
    lakeGroup.add(lakePool);

    const jetMat = new THREE.MeshBasicMaterial({
      color: '#D8F8FF',
      transparent: true,
      opacity: 0.82,
    });
    const ringGlowMat = new THREE.MeshBasicMaterial({ color: '#FFE082' });
    for (let j = -13; j <= 13; j++) {
      const env = 1 - Math.abs(j) / 14;
      const jetH = 16 + env * 32 + (Math.abs(j) % 2) * 6;
      const jet = new THREE.Mesh(new THREE.ConeGeometry(1.45, jetH, 8), jetMat);
      jet.position.set(4, jetH * 0.5, j * 7.2);
      lakeGroup.add(jet);
      if (j % 3 === 0) {
        const waterRing = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.25, 6, 16), ringGlowMat);
        waterRing.rotation.x = Math.PI / 2;
        waterRing.position.set(4, 0.2, j * 7.2);
        lakeGroup.add(waterRing);
      }
    }

    // Grand Curved Bellagio Resort Main Tower & Side Wings behind the Fountain Lake
    const bellagioCenter = new THREE.Mesh(new THREE.BoxGeometry(28, 116, 74), towerMats[2]);
    bellagioCenter.position.set(-54, 58, 0);
    const bellagioWingN = new THREE.Mesh(new THREE.BoxGeometry(24, 96, 58), towerMats[2]);
    bellagioWingN.position.set(-44, 48, -56);
    bellagioWingN.rotation.y = -0.32;
    const bellagioWingS = new THREE.Mesh(new THREE.BoxGeometry(24, 96, 58), towerMats[2]);
    bellagioWingS.position.set(-44, 48, 56);
    bellagioWingS.rotation.y = 0.32;
    const bellagioCrown = new THREE.Mesh(new THREE.BoxGeometry(30, 4.5, 76), campGoldMat);
    bellagioCrown.position.set(-54, 118, 0);
    lakeGroup.add(bellagioCenter, bellagioWingN, bellagioWingS, bellagioCrown);
    group.add(lakeGroup);

    // 8. LUXOR ILLUMINATED BLACK GLASS PYRAMID & 450m VERTICAL SKYBEAM (South Strip Terminus [-615, 0, 1145])
    const luxPos = new THREE.Vector3(-615, groundBaseY, 1145);
    placedFootprints.push({ x: luxPos.x, z: luxPos.z, r: 85 });
    const luxGroup = new THREE.Group();
    luxGroup.position.copy(luxPos);
    const pyramidBody = new THREE.Mesh(
      new THREE.ConeGeometry(78, 104, 4),
      new THREE.MeshPhysicalMaterial({
        color: '#0A0D16',
        metalness: 0.75,
        roughness: 0.14,
        clearcoat: 1.0,
      }),
    );
    pyramidBody.position.y = 52;
    pyramidBody.rotation.y = Math.PI / 4;
    const pyramidEdges = new THREE.Mesh(
      new THREE.ConeGeometry(78.4, 104.4, 4),
      new THREE.MeshBasicMaterial({ color: '#FFE082', wireframe: true }),
    );
    pyramidEdges.position.y = 52;
    pyramidEdges.rotation.y = Math.PI / 4;
    const pyramidApex = new THREE.Mesh(
      new THREE.ConeGeometry(12, 16, 4),
      new THREE.MeshBasicMaterial({ color: '#FFFFFF' }),
    );
    pyramidApex.position.y = 98;
    pyramidApex.rotation.y = Math.PI / 4;
    const skyBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 2.4, 440, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#E0F7FF',
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    skyBeam.position.y = 320;
    luxGroup.add(pyramidBody, pyramidEdges, pyramidApex, skyBeam);
    group.add(luxGroup);

    // 9. Dense Two-Row Non-Overlapping Strip Resort & High-Rise Streetwall + LED Marquee Billboards
    for (let row = 0; row < 2; row++) {
      const step = row === 0 ? 8 : 11;
      for (let i = 0; i < SAMPLE_COUNT; i += step) {
        const smp = track.samples[i];
        for (const side of [-1, 1] as const) {
          if ((i + (side === 1 ? 3 : 0)) % (row === 0 ? 16 : 22) === 0) continue;
          const distOut =
            row === 0
              ? halfW + 30 + ((i * 17) % 18)
              : halfW + 76 + ((i * 29) % 44);
          const pos = smp.position.clone().addScaledVector(smp.right, side * distOut);

          const w = row === 0 ? 18 + ((i * 11) % 12) : 24 + ((i * 13) % 16);
          const d = row === 0 ? 22 + ((i * 19) % 16) : 26 + ((i * 17) % 18);
          const h = row === 0 ? 38 + ((i * 31) % 58) : 64 + ((i * 43) % 78);
          const footprintR = Math.hypot(w, d) * 0.56;

          if (!canPlaceFootprint(pos.x, pos.z, footprintR, halfW + footprintR + 9)) continue;
          placedFootprints.push({ x: pos.x, z: pos.z, r: footprintR });

          const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);
          const resortGroup = new THREE.Group();
          resortGroup.position.set(pos.x, groundBaseY, pos.z);
          resortGroup.rotation.y = yaw;

          const tMat = towerMats[(i + row + (side === 1 ? 1 : 2)) % towerMats.length];
          const trimColor = neonColors[(i + row * 3) % neonColors.length];
          const neonMat = new THREE.MeshBasicMaterial({ color: trimColor });

          // Podium base
          const podiumBase = new THREE.Mesh(
            new THREE.BoxGeometry(w * 1.22, 8.5, d * 1.22),
            podiumBaseMat,
          );
          podiumBase.position.y = 4.25;
          resortGroup.add(podiumBase);

          // Main architectural tower + secondary offset wing for realistic resort massing
          const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tMat);
          tower.position.y = h * 0.5;
          resortGroup.add(tower);

          if ((i + row) % 2 === 0) {
            const wingH = h * 0.76;
            const sideWing = new THREE.Mesh(
              new THREE.BoxGeometry(w * 0.65, wingH, d * 0.72),
              tMat,
            );
            sideWing.position.set(-side * (w * 0.35), wingH * 0.5, d * 0.24);
            resortGroup.add(sideWing);
          }

          // Recessed penthouse crown + crisp neon cornice bands
          const crownH = 5.5;
          const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.68, crownH, d * 0.68), tMat);
          crown.position.y = h + crownH * 0.5;
          const neonBand = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.45, 1.15, d + 0.45),
            neonMat,
          );
          neonBand.position.y = h - 2.4;
          const podiumNeon = new THREE.Mesh(
            new THREE.BoxGeometry(w * 1.25, 0.5, d * 1.25),
            neonMat,
          );
          podiumNeon.position.y = 8.6;
          resortGroup.add(crown, neonBand, podiumNeon);

          // Track-facing illuminated digital LED billboard marquee on inner-row casino podiums
          if (row === 0 && i % 24 === 0) {
            const bbMat = new THREE.MeshBasicMaterial({
              map: billboardTexs[(i / 24) % billboardTexs.length],
            });
            const bbMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.2, 14.5), bbMat);
            bbMesh.position.set(-side * (w * 0.62 + 0.25), 14.5, 0);
            resortGroup.add(bbMesh);
          }

          group.add(resortGroup);
        }
      }
    }

    // 10. Strip Boulevard Illuminated Palm Trees outside barriers (clearing pit corridor)
    const palmCount = 150;
    const palmTrunkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.20, 0.36, 8.4, 7),
      new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.88 }),
      palmCount,
    );
    const palmCrownMesh = new THREE.InstancedMesh(
      buildCrossedFoliageGeometry(8.6, 5.2, true),
      new THREE.MeshStandardMaterial({
        map: palmTex,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.82,
      }),
      palmCount,
    );
    const palmDummy = new THREE.Object3D();
    let palmPlaced = 0;
    for (let i = 0; i < SAMPLE_COUNT && palmPlaced < palmCount; i += 5) {
      const smp = track.samples[i];
      const pSide = palmPlaced % 2 === 0 ? 1 : -1;
      const pos = smp.position.clone().addScaledVector(smp.right, pSide * (halfW + 10.4));
      const proj = track.projectToTrack(pos.x, pos.z, 0);
      if (Math.abs(proj.lateralOffset) < halfW + 8.5) continue;
      if (
        isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) &&
        Math.sign(proj.lateralOffset) === cfg.pitSide &&
        Math.abs(proj.lateralOffset) < halfW + 28
      ) {
        continue;
      }
      const scale = 0.92 + (i % 5) * 0.08;
      palmDummy.position.set(pos.x, pos.y + 4.2 * scale, pos.z);
      palmDummy.rotation.set(0, (i * 0.7) % (Math.PI * 2), 0);
      palmDummy.scale.set(scale, scale, scale);
      palmDummy.updateMatrix();
      palmTrunkMesh.setMatrixAt(palmPlaced, palmDummy.matrix);

      palmDummy.position.set(pos.x, pos.y + 6.4 * scale, pos.z);
      palmDummy.scale.set(scale, scale, scale);
      palmDummy.updateMatrix();
      palmCrownMesh.setMatrixAt(palmPlaced, palmDummy.matrix);
      palmPlaced++;
    }
    palmTrunkMesh.count = palmPlaced;
    palmCrownMesh.count = palmPlaced;
    group.add(palmTrunkMesh, palmCrownMesh);

    // 11. Trackside overhead light gantry poles (keep pit lane clear on pitSide === -1)
    const poleMat = new THREE.MeshStandardMaterial({ color: '#222836' });
    const bulbMat = new THREE.MeshBasicMaterial({ color: '#FFF7E0' });
    for (let i = 0; i < SAMPLE_COUNT; i += 18) {
      const smp = track.samples[i];
      const inPitZone = isSInZone(smp.s, cfg.pitEntryS, cfg.pitExitS);
      const poleSide = inPitZone && cfg.pitSide === -1 ? 1 : -1;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 10, 6), poleMat);
      const pPos = smp.position.clone().addScaledVector(smp.right, poleSide * (halfW + 7.5));
      pole.position.set(pPos.x, pPos.y + 5, pPos.z);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.42, 0.9), bulbMat);
      lamp.position.copy(pPos).addScaledVector(smp.right, -poleSide * 1.6).add(new THREE.Vector3(0, 9.8, 0));
      lamp.rotation.y = Math.atan2(smp.tangent.x, smp.tangent.z);
      group.add(pole, lamp);
    }

    // 12. 360-Degree Illuminated Las Vegas Night City Horizon Backdrop Cylinder (no empty dark horizon!)
    const vegasHorizonWall = new THREE.Mesh(
      new THREE.CylinderGeometry(perimeterRadius, perimeterRadius, 125, 64, 1, true),
      new THREE.MeshBasicMaterial({
        map: skylineWallTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    vegasHorizonWall.position.set(midX, groundBaseY + 58, midZ);
    group.add(vegasHorizonWall);
  } else {
    // Circuit-specific daylight outdoor vegetation, horizon skyline & regional topography
    const isAlpine = cfg.id === 'red-bull-ring';
    const isMonza = cfg.id === 'monza';
    const treeCount = isAlpine ? 460 : isMonza ? 860 : 160;
    const treeKind = isAlpine ? 'pine' : 'deciduous';
    const foliageTex = createFoliageCanopyTexture(treeKind);
    const barkTex = createBarkTexture();
    textures.push(foliageTex, barkTex);

    const trunkGeo = new THREE.CylinderGeometry(
      isAlpine ? 0.24 : isMonza ? 0.30 : 0.22,
      isAlpine ? 0.44 : isMonza ? 0.50 : 0.38,
      isAlpine ? 4.8 : isMonza ? 4.4 : 3.2,
      7,
    );
    const trunkMat = new THREE.MeshStandardMaterial({
      map: barkTex,
      roughness: 0.95,
    });
    const foliageGeo = buildCrossedFoliageGeometry(
      isAlpine ? 6.4 : isMonza ? 8.2 : 6.2,
      isAlpine ? 12.2 : isMonza ? 8.8 : 5.4,
      !isAlpine,
    );
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

    const palette = isMonza
      ? ['#4A7634', '#5A853B', '#6B8E42', '#3A612B', '#7B8F41']
      : isAlpine
        ? ['#285633', '#356B3E', '#417B47', '#204A2A', '#4D864F']
        : ['#436D3B', '#527B44', '#5E844A', '#385C31', '#6B8B50'];
    const tmpColor = new THREE.Color();
    const dummy = new THREE.Object3D();

    let placed = 0;
    const maxLoop = SAMPLE_COUNT * (isMonza ? 3 : 2);
    for (let i = 0; i < maxLoop && placed < treeCount; i++) {
      const sIdx = (i * (isAlpine ? 3 : isMonza ? 1 : 7)) % SAMPLE_COUNT;
      const smp = track.samples[sIdx];
      const side = placed % 2 === 0 ? 1 : -1;
      const band = placed % 3;
      const dist = isAlpine
        ? band === 0
          ? halfW + 32 + ((i * 23) % 44)
          : band === 1
            ? halfW + 78 + ((i * 31) % 88)
            : halfW + 150 + ((i * 43) % 120)
        : isMonza
          ? band === 0
            ? halfW + 22 + ((i * 17) % 24)
            : band === 1
              ? halfW + 48 + ((i * 23) % 52)
              : halfW + 102 + ((i * 37) % 85)
          : // Silverstone: open RAF airfield plateau — push sparse hedgerow/oak copses out to perimeter fields
            band === 0
              ? halfW + 58 + ((i * 29) % 46)
              : halfW + 115 + ((i * 41) % 85);

      const cand = smp.position.clone().addScaledVector(smp.right, side * dist);

      // Red Bull Ring keeps central Bull meadow and southern valley open, clustering spruce forest on northern Turn 2-4 slope
      if (isAlpine && cand.z > midZ + 65 && i % 4 !== 0) continue;

      // Ensure tree never enters track, pit lane, pit paddock, or grandstands
      const proj = track.projectToTrack(cand.x, cand.z, 0);
      const minTrackDist = isAlpine ? halfW + 24 : isMonza ? halfW + 19 : halfW + 46;
      if (Math.abs(proj.lateralOffset) < minTrackDist) continue;
      if (
        isSInZone(proj.s, cfg.pitEntryS, cfg.pitExitS) &&
        Math.sign(proj.lateralOffset) === cfg.pitSide &&
        Math.abs(proj.lateralOffset) < halfW + 52
      ) {
        continue;
      }

      const scale = isAlpine
        ? 0.92 + ((i * 13) % 7) * 0.17
        : isMonza
          ? 0.95 + ((i * 11) % 7) * 0.15
          : 0.62 + ((i * 13) % 5) * 0.08;
      const baseY = sampleTerrainY(cand.x, cand.z);
      const yaw = (i * 1.9) % (Math.PI * 2);

      dummy.position.set(cand.x, baseY + (isAlpine ? 2.2 : 1.9) * scale, cand.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);

      dummy.position.set(cand.x, baseY + (isAlpine ? 1.8 : 2.7) * scale, cand.z);
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

    // Circuit-Specific Horizon Backdrop Cylinder (zero shared generic wall!)
    const daylightId = (isAlpine
      ? 'red-bull-ring'
      : isMonza
        ? 'monza'
        : 'silverstone') as 'red-bull-ring' | 'monza' | 'silverstone';
    const horizonTex = createCircuitHorizonWallTexture(daylightId);
    horizonTex.repeat.set(isMonza ? 18 : 14, 1);
    textures.push(horizonTex);
    const horizonH = isMonza ? 68 : isAlpine ? 62 : 42;
    const horizonWall = new THREE.Mesh(
      new THREE.CylinderGeometry(perimeterRadius, perimeterRadius, horizonH, 64, 1, true),
      new THREE.MeshStandardMaterial({
        map: horizonTex,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.95,
      }),
    );
    horizonWall.name = `horizon-${daylightId}`;
    horizonWall.position.set(midX, groundBaseY + horizonH * 0.45, midZ);
    group.add(horizonWall);

    // Circuit-Specific Mountain Backdrop (Red Bull Ring Seckauer Tauern Alps, Monza distant northern Prealps only, Silverstone none!)
    const mountainRange = buildCircuitMountainBackdrop(cfg.id, groundBaseY, perimeterRadius + 80);
    if (mountainRange) {
      mountainRange.position.set(midX, 0, midZ);
      group.add(mountainRange);
    }

    // === ICONIC REAL-WORLD CIRCUIT LANDMARKS & ENVIRONMENTAL SITES ===
    if (cfg.id === 'red-bull-ring') {
      // 1. Iconic Giant Metallic "Bull of Spielberg" + 28m Parabolic Steel Arch & Amphitheater Plaza at GPS Infield Center
      const bullCenter = cfg.landmarkCenter ?? [-65, 18, -65];
      const bullY = sampleTerrainY(bullCenter[0], bullCenter[2]);
      const bullGroup = new THREE.Group();
      bullGroup.position.set(bullCenter[0], bullY, bullCenter[2]);
      bullGroup.rotation.y = 0.45;
      const bullRedMat = new THREE.MeshPhysicalMaterial({
        color: '#D90416',
        metalness: 0.85,
        roughness: 0.16,
        clearcoat: 1.0,
      });
      const archSteelMat = new THREE.MeshPhysicalMaterial({
        color: '#D8E2EE',
        metalness: 0.88,
        roughness: 0.18,
        clearcoat: 0.9,
      });
      const stoneMat = new THREE.MeshStandardMaterial({ color: '#4B5563', roughness: 0.85 });

      // Stepped stone amphitheater plaza + parabolic 28m steel arch
      const plinthBase = new THREE.Mesh(new THREE.CylinderGeometry(24, 28, 3.6, 28), stoneMat);
      plinthBase.position.y = 1.8;
      const plinthUpper = new THREE.Mesh(new THREE.CylinderGeometry(14, 17, 4.0, 24), stoneMat);
      plinthUpper.position.y = 5.4;
      const steelArch = new THREE.Mesh(
        new THREE.TorusGeometry(22, 1.45, 12, 36, Math.PI),
        archSteelMat,
      );
      steelArch.position.y = 3.5;

      // Colossal charging Bull of Spielberg perched atop the 25m steel arch crest
      const archPedestal = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.2, 14.5), stoneMat);
      archPedestal.position.set(0, 25.8, 0);
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 2.8, 13.5, 16), bullRedMat);
      torso.rotation.x = Math.PI / 2 - 0.16;
      torso.position.set(0, 31.0, 0);
      const chest = new THREE.Mesh(new THREE.SphereGeometry(3.9, 16, 14), bullRedMat);
      chest.scale.set(1.0, 1.1, 1.2);
      chest.position.set(0, 32.0, 4.8);
      const haunch = new THREE.Mesh(new THREE.SphereGeometry(3.1, 14, 12), bullRedMat);
      haunch.position.set(0, 30.2, -5.4);
      const bullHead = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.5, 5.0), bullRedMat);
      bullHead.position.set(0, 33.8, 8.6);
      bullHead.rotation.x = 0.28;
      bullGroup.add(plinthBase, plinthUpper, steelArch, archPedestal, torso, chest, haunch, bullHead);
      for (const side of [-1, 1] as const) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.65, 6.0, 10), archSteelMat);
        horn.position.set(side * 2.8, 36.2, 10.4);
        horn.rotation.z = -side * 0.78;
        horn.rotation.x = 0.42;
        const frontLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.55, 5.4, 8), bullRedMat);
        frontLeg.position.set(side * 1.9, 28.4, 4.6);
        frontLeg.rotation.x = 0.22;
        const rearLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.58, 5.2, 8), bullRedMat);
        rearLeg.position.set(side * 1.8, 28.0, -4.8);
        rearLeg.rotation.x = -0.18;
        bullGroup.add(horn, frontLeg, rearLeg);
      }
      group.add(bullGroup);

      // 2. Iconic Voestalpine Wing Architectural Silver/Glass Landmark near Start/Finish
      const wingSmp = track.sampleAtS(0.03);
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
      const wingRoof = new THREE.Mesh(new THREE.BoxGeometry(26, 2.4, 64), wingMat);
      wingRoof.position.set(0, 13.5, 0);
      wingRoof.rotation.z = 0.20;
      wingRoof.castShadow = true;
      const wingGlassWall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5.8, 52), wingGlassMat);
      wingGlassWall.position.set(-cfg.pitSide * -2.2, 7.6, 0);
      for (const pz of [-24, 0, 24]) {
        const aPillar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 13.5, 2.2), wingMat);
        aPillar.position.set(0, 6.5, pz);
        aPillar.rotation.z = 0.18;
        aPillar.castShadow = true;
        wingGroup.add(aPillar);
      }
      wingGroup.add(wingRoof, wingGlassWall);
      group.add(wingGroup);

      // 3. Schloss Spielberg Alpine Castle & Styrian Onion-Dome Church overlooking Turn 3-4 Hillside
      const castleSmp = track.sampleAtS(0.39);
      const castlePos = castleSmp.position.clone().addScaledVector(castleSmp.right, -74);
      const castleY = sampleTerrainY(castlePos.x, castlePos.z);
      const castleGroup = new THREE.Group();
      castleGroup.position.set(castlePos.x, castleY, castlePos.z);
      const castleWallMat = new THREE.MeshStandardMaterial({ color: '#EAE2D3', roughness: 0.78 });
      const terracottaRoofMat = new THREE.MeshStandardMaterial({ color: '#A83828', roughness: 0.65 });
      const keep = new THREE.Mesh(new THREE.BoxGeometry(28, 18, 22), castleWallMat);
      keep.position.y = 9;
      castleGroup.add(keep);
      for (const tx of [-14, 14]) {
        for (const tz of [-11, 11]) {
          const turret = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.2, 24, 12), castleWallMat);
          turret.position.set(tx, 12, tz);
          const coneRoof = new THREE.Mesh(new THREE.ConeGeometry(4.8, 9.5, 12), terracottaRoofMat);
          coneRoof.position.set(tx, 28.5, tz);
          castleGroup.add(turret, coneRoof);
        }
      }
      const churchTower = new THREE.Mesh(new THREE.BoxGeometry(7.5, 28, 7.5), castleWallMat);
      churchTower.position.set(28, 14, 0);
      const onionDome = new THREE.Mesh(
        new THREE.SphereGeometry(5.2, 14, 12),
        new THREE.MeshStandardMaterial({ color: '#2E6F5E', metalness: 0.45, roughness: 0.4 }),
      );
      onionDome.scale.set(1, 1.35, 1);
      onionDome.position.set(28, 31, 0);
      castleGroup.add(churchTower, onionDome);
      group.add(castleGroup);

      // 4. Schönberghof / Red Bull Mobile Hillside Chalets & Orange-White Fan Hillside Tribunes overlooking Turn 2-3
      const chaletSmp = track.sampleAtS(0.24);
      const chaletPos = chaletSmp.position.clone().addScaledVector(chaletSmp.right, -54);
      const chaletGroup = new THREE.Group();
      chaletGroup.name = 'rbr-hillside-chalet';
      chaletGroup.position.set(chaletPos.x, sampleTerrainY(chaletPos.x, chaletPos.z), chaletPos.z);
      chaletGroup.rotation.y = Math.atan2(chaletSmp.tangent.x, chaletSmp.tangent.z);
      const woodMat = new THREE.MeshStandardMaterial({ color: '#78482B', roughness: 0.85 });
      const plasterMat = new THREE.MeshStandardMaterial({ color: '#F3ECE0', roughness: 0.75 });
      const chaletRoofMat = new THREE.MeshStandardMaterial({ color: '#4B281E', roughness: 0.72 });
      const chaletBody = new THREE.Mesh(new THREE.BoxGeometry(20, 9.5, 36), plasterMat);
      chaletBody.position.set(0, 4.75, 0);
      const timberDeck = new THREE.Mesh(new THREE.BoxGeometry(22, 3.2, 37), woodMat);
      timberDeck.position.set(0, 8.2, 0);
      const chaletRoof = new THREE.Mesh(new THREE.BoxGeometry(24, 2.4, 39), chaletRoofMat);
      chaletRoof.position.set(0, 11.2, 0);
      chaletRoof.rotation.z = 0.08;
      chaletGroup.add(chaletBody, timberDeck, chaletRoof);
      group.add(chaletGroup);

      const orangeStandSmp = track.sampleAtS(0.34);
      const orangeStandPos = orangeStandSmp.position.clone().addScaledVector(orangeStandSmp.right, 44);
      const fanHillMat = new THREE.MeshStandardMaterial({ color: '#FF6A00', roughness: 0.7 });
      const orangeDeck = new THREE.Mesh(new THREE.BoxGeometry(16, 4.2, 54), fanHillMat);
      orangeDeck.position.set(
        orangeStandPos.x,
        sampleTerrainY(orangeStandPos.x, orangeStandPos.z) + 2.1,
        orangeStandPos.z,
      );
      orangeDeck.rotation.y = Math.atan2(orangeStandSmp.tangent.x, orangeStandSmp.tangent.z);
      group.add(orangeDeck);
    } else if (cfg.id === 'monza') {
      // 1. Historic 1955 Monza High-Speed Oval Banking (Sopraelevata) Viaduct & Overpass Bridge (s = 0.54)
      const bankSmp = track.sampleAtS(0.54);
      const bankGroup = new THREE.Group();
      bankGroup.position.copy(bankSmp.position);
      bankGroup.rotation.y = Math.atan2(bankSmp.tangent.x, bankSmp.tangent.z) + 0.32;
      const agedConcreteMat = new THREE.MeshStandardMaterial({
        color: '#8E959E',
        roughness: 0.90,
      });
      const railYellowMat = new THREE.MeshStandardMaterial({ color: '#EAB308', metalness: 0.4, roughness: 0.45 });
      const spanW = 220;
      const bankDeck = new THREE.Mesh(new THREE.BoxGeometry(spanW, 1.8, 14.5), agedConcreteMat);
      bankDeck.position.set(0, 9.6, 0);
      bankDeck.rotation.x = 0.36; // Famous steep 30° historic Monza Sopraelevata banking
      bankDeck.castShadow = true;
      const upperRail = new THREE.Mesh(new THREE.BoxGeometry(spanW, 1.1, 0.45), railYellowMat);
      upperRail.position.set(0, 12.6, -6.8);
      const lowerRail = new THREE.Mesh(new THREE.BoxGeometry(spanW, 0.9, 0.45), railYellowMat);
      lowerRail.position.set(0, 7.8, 6.8);
      bankGroup.add(bankDeck, upperRail, lowerRail);

      for (let p = -6; p <= 6; p++) {
        if (p === 0) continue; // Keep central span wide open over live track!
        const px = p * 16.5;
        if (Math.abs(px) < cfg.trackWidth * 0.5 + 11) continue;
        const pier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 11.2, 12.5), agedConcreteMat);
        pier.position.set(px, 4.8, 0);
        pier.castShadow = true;
        bankGroup.add(pier);
      }
      group.add(bankGroup);

      // 2. Villa Reale di Monza (Neoclassical Royal Palace of Monza) in the Royal Park Vista (s = 0.27)
      const villaSmp = track.sampleAtS(0.27);
      const villaPos = villaSmp.position.clone().addScaledVector(villaSmp.right, 92);
      const villaY = sampleTerrainY(villaPos.x, villaPos.z);
      const villaGroup = new THREE.Group();
      villaGroup.position.set(villaPos.x, villaY, villaPos.z);
      villaGroup.rotation.y = Math.atan2(villaSmp.tangent.x, villaSmp.tangent.z);
      const villaOchreMat = new THREE.MeshStandardMaterial({ color: '#E8CFA6', roughness: 0.68 });
      const villaMarbleMat = new THREE.MeshStandardMaterial({ color: '#F8F6F0', roughness: 0.5 });
      const villaRoofMat = new THREE.MeshStandardMaterial({ color: '#8C3B2B', roughness: 0.7 });

      const mainCorps = new THREE.Mesh(new THREE.BoxGeometry(22, 22, 96), villaOchreMat);
      mainCorps.position.set(0, 11, 0);
      const mainRoof = new THREE.Mesh(new THREE.BoxGeometry(24, 3.2, 98), villaRoofMat);
      mainRoof.position.set(0, 23.6, 0);
      const centralPortico = new THREE.Mesh(new THREE.BoxGeometry(8, 24, 28), villaMarbleMat);
      centralPortico.position.set(-12, 12, 0);
      const pediment = new THREE.Mesh(new THREE.ConeGeometry(16, 7.5, 4), villaMarbleMat);
      pediment.position.set(-12, 27.5, 0);
      pediment.rotation.y = Math.PI / 4;
      villaGroup.add(mainCorps, mainRoof, centralPortico, pediment);
      for (const wz of [-42, 42]) {
        const courtyardWing = new THREE.Mesh(new THREE.BoxGeometry(36, 18, 16), villaOchreMat);
        courtyardWing.position.set(-24, 9, wz);
        villaGroup.add(courtyardWing);
      }
      group.add(villaGroup);

      // 3. Royal Park of Monza Slender Alpha-Cutout Italian Cypress Trees along straights
      const cypressTex = createFoliageCanopyTexture('cypress');
      textures.push(cypressTex);
      const cypressMat = new THREE.MeshStandardMaterial({
        color: '#2E5933',
        map: cypressTex,
        alphaTest: 0.38,
        side: THREE.DoubleSide,
        roughness: 0.90,
      });
      const cypressGeo = buildCrossedFoliageGeometry(4.4, 16.0, false);
      const cypressMesh = new THREE.InstancedMesh(cypressGeo, cypressMat, 160);
      let cPlaced = 0;
      for (let i = 0; i < SAMPLE_COUNT && cPlaced < 160; i += 4) {
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

      // 4. Iconic Monza Cantilevered Red Podium Canopy & Tifosi Tricolore Banners along Main Straight
      const triColors = ['#009246', '#FFFFFF', '#CE2B37'];
      for (let t = 0; t < 3; t++) {
        const triSmp = track.sampleAtS((0.96 + t * 0.02) % 1);
        const triPos = triSmp.position.clone().addScaledVector(triSmp.right, -cfg.pitSide * (halfW + 15.5));
        const flagBoard = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 2.6, 26),
          new THREE.MeshBasicMaterial({ color: triColors[t] }),
        );
        flagBoard.position.set(triPos.x, triPos.y + 5.5, triPos.z);
        flagBoard.rotation.y = Math.atan2(triSmp.tangent.x, triSmp.tangent.z);
        group.add(flagBoard);
      }

      // 5. Historic Brick & Stone Parco di Monza Perimeter Walls + Viale Mirabello Stone Arch Park Bridge
      const parkWallGroup = new THREE.Group();
      parkWallGroup.name = 'monza-park-wall';
      const parkStoneMat = new THREE.MeshStandardMaterial({ color: '#8A7B68', roughness: 0.90 });
      const parkCapMat = new THREE.MeshStandardMaterial({ color: '#A69882', roughness: 0.85 });
      for (const wallS of [0.14, 0.42, 0.68]) {
        const wSmp = track.sampleAtS(wallS);
        const wPos = wSmp.position.clone().addScaledVector(wSmp.right, 34);
        const wYaw = Math.atan2(wSmp.tangent.x, wSmp.tangent.z);
        const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.6, 56), parkStoneMat);
        wallMesh.position.set(wPos.x, sampleTerrainY(wPos.x, wPos.z) + 1.8, wPos.z);
        wallMesh.rotation.y = wYaw;
        const capMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 56.4), parkCapMat);
        capMesh.position.set(wPos.x, sampleTerrainY(wPos.x, wPos.z) + 3.7, wPos.z);
        capMesh.rotation.y = wYaw;
        parkWallGroup.add(wallMesh, capMesh);
      }
      group.add(parkWallGroup);

      // Serraglio / Viale Mirabello historic arched park bridge spanning the back straight
      const mirSmp = track.sampleAtS(0.72);
      const mirGroup = new THREE.Group();
      mirGroup.name = 'monza-park-bridge';
      mirGroup.position.copy(mirSmp.position);
      mirGroup.rotation.y = Math.atan2(mirSmp.tangent.x, mirSmp.tangent.z);
      const bridgeSpan = cfg.trackWidth + 22;
      const stoneDeck = new THREE.Mesh(new THREE.BoxGeometry(bridgeSpan, 2.2, 7.5), parkStoneMat);
      stoneDeck.position.set(0, 7.6, 0);
      stoneDeck.castShadow = true;
      const stoneParapet = new THREE.Mesh(new THREE.BoxGeometry(bridgeSpan, 1.1, 7.9), parkCapMat);
      stoneParapet.position.set(0, 9.1, 0);
      mirGroup.add(stoneDeck, stoneParapet);
      for (const side of [-1, 1] as const) {
        const abutment = new THREE.Mesh(new THREE.BoxGeometry(5.5, 8.6, 8.2), parkStoneMat);
        abutment.position.set(side * (halfW + 10.5), 4.3, 0);
        mirGroup.add(abutment);
      }
      group.add(mirGroup);
    } else if (cfg.id === 'silverstone') {
      // 1. Historic WWII RAF Silverstone Airfield Control Tower, Radar Dome & Twin Corrugated Hangars
      const towerSmp = track.sampleAtS(0.30);
      const towerPos = towerSmp.position.clone().addScaledVector(towerSmp.right, 68);
      const towerY = sampleTerrainY(towerPos.x, towerPos.z);
      const towerGroup = new THREE.Group();
      towerGroup.position.set(towerPos.x, towerY, towerPos.z);
      const brickMat = new THREE.MeshStandardMaterial({ color: '#9EA8B4', roughness: 0.8 });
      const towerBody = new THREE.Mesh(new THREE.BoxGeometry(11, 15, 11), brickMat);
      towerBody.position.y = 7.5;
      towerBody.castShadow = true;
      const balcony = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.7, 14.5), concreteMat);
      balcony.position.y = 15.2;
      const watchRoom = new THREE.Mesh(
        new THREE.BoxGeometry(12.2, 4.5, 12.2),
        new THREE.MeshPhysicalMaterial({ color: '#142B44', metalness: 0.3, roughness: 0.1, clearcoat: 1.0 }),
      );
      watchRoom.position.y = 17.6;
      const radarMast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 5.2, 8), pillarMat);
      radarMast.position.y = 22.2;
      const radarDish = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.3, 0.4), concreteMat);
      radarDish.position.y = 24.8;
      const hangarMat = new THREE.MeshStandardMaterial({ color: '#4B5563', metalness: 0.48, roughness: 0.52 });
      for (const hz of [18, 52]) {
        const hangar = new THREE.Mesh(
          new THREE.CylinderGeometry(15, 15, 38, 16, 1, false, 0, Math.PI),
          hangarMat,
        );
        hangar.rotation.z = Math.PI / 2;
        hangar.position.set(30, 0, hz);
        towerGroup.add(hangar);
      }
      towerGroup.add(towerBody, balcony, watchRoom, radarMast, radarDish);
      group.add(towerGroup);

      // 2. 85m Red-and-White Stowe/Club Lattice Telemetry & Broadcast Radio Tower (s = 0.44)
      const mastSmp = track.sampleAtS(0.44);
      const mastPos = mastSmp.position.clone().addScaledVector(mastSmp.right, 64);
      const mastY = sampleTerrainY(mastPos.x, mastPos.z);
      const mastGroup = new THREE.Group();
      mastGroup.position.set(mastPos.x, mastY, mastPos.z);
      const redLatticeMat = new THREE.MeshStandardMaterial({
        color: '#E10600',
        roughness: 0.4,
        metalness: 0.5,
        wireframe: true,
      });
      const whiteLatticeMat = new THREE.MeshStandardMaterial({
        color: '#F8FAFC',
        roughness: 0.4,
        metalness: 0.5,
        wireframe: true,
      });
      for (let sec = 0; sec < 6; sec++) {
        const rBot = 5.2 - sec * 0.72;
        const rTop = 5.2 - (sec + 1) * 0.72;
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(Math.max(0.6, rTop), rBot, 14, 4, 2, true),
          sec % 2 === 0 ? redLatticeMat : whiteLatticeMat,
        );
        seg.position.y = sec * 14 + 7;
        mastGroup.add(seg);
      }
      const beaconRed = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#FF1E1E' }),
      );
      beaconRed.position.y = 85.5;
      mastGroup.add(beaconRed);
      group.add(mastGroup);

      // 3. British GP Luffield/Woodcote Fan-Zone Observation Ferris Wheel & Festival Stage (s = 0.89)
      const fwSmp = track.sampleAtS(0.89);
      const fwPos = fwSmp.position.clone().addScaledVector(fwSmp.right, -64);
      const fwY = sampleTerrainY(fwPos.x, fwPos.z);
      const fwGroup = new THREE.Group();
      fwGroup.position.set(fwPos.x, fwY, fwPos.z);
      fwGroup.rotation.y = Math.atan2(fwSmp.tangent.x, fwSmp.tangent.z);
      const fwRim = new THREE.Mesh(
        new THREE.TorusGeometry(22, 0.7, 10, 32),
        new THREE.MeshStandardMaterial({ color: '#F8FAFC', metalness: 0.6, roughness: 0.3 }),
      );
      fwRim.position.y = 26;
      for (const sx of [-1, 1] as const) {
        const fwLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 29, 8), pillarMat);
        fwLeg.position.set(sx * 7.5, 13, 0);
        fwLeg.rotation.z = sx * 0.25;
        fwGroup.add(fwLeg);
      }
      fwGroup.add(fwRim);
      group.add(fwGroup);

      // 4. Classic British Blue/White Glazed Steel Truss Footbridges over Hangar & Wellington Straights
      const bridgeBlueMat = new THREE.MeshStandardMaterial({ color: '#003A70', roughness: 0.4 });
      const bridgeWhiteMat = new THREE.MeshStandardMaterial({ color: '#F1F5F9', roughness: 0.4 });
      const bridgeGlassMat = new THREE.MeshPhysicalMaterial({
        color: '#1E3A5F',
        metalness: 0.25,
        roughness: 0.1,
        clearcoat: 1.0,
      });
      for (const bs of [0.30, 0.78]) {
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

      // 5. British GP Campervan, Caravan & White Glamping Tent Village overlooking outer Abbey/Stowe fields
      const campSmp = track.sampleAtS(0.56);
      const campCenter = campSmp.position.clone().addScaledVector(campSmp.right, 62);
      const campGroup = new THREE.Group();
      campGroup.name = 'silverstone-campsite';
      campGroup.position.set(campCenter.x, sampleTerrainY(campCenter.x, campCenter.z), campCenter.z);
      campGroup.rotation.y = Math.atan2(campSmp.tangent.x, campSmp.tangent.z);
      const tentWhiteMat = new THREE.MeshStandardMaterial({ color: '#F8FAFC', roughness: 0.72 });
      const vanMat = new THREE.MeshStandardMaterial({ color: '#CBD5E1', roughness: 0.5 });
      const vanRoofMat = new THREE.MeshStandardMaterial({ color: '#38BDF8', roughness: 0.45 });
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
          const px = (row - 1) * 14;
          const pz = (col - 2) * 11;
          if ((row + col) % 2 === 0) {
            const tent = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3.6, 4), tentWhiteMat);
            tent.position.set(px, 1.8, pz);
            tent.rotation.y = Math.PI / 4;
            campGroup.add(tent);
          } else {
            const camper = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 6.2), vanMat);
            camper.position.set(px, 1.4, pz);
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.5, 6.26), vanRoofMat);
            stripe.position.set(px, 2.2, pz);
            campGroup.add(camper, stripe);
          }
        }
      }
      group.add(campGroup);

      // 6. Yellow-Boom British GP Broadcast Camera Cranes & BRDC Clubhouse near Luffield/Club
      const craneGroup = new THREE.Group();
      craneGroup.name = 'silverstone-cranes';
      const craneYellowMat = new THREE.MeshStandardMaterial({ color: '#FACC15', metalness: 0.35, roughness: 0.4 });
      for (const cs of [0.22, 0.84]) {
        const cSmp = track.sampleAtS(cs);
        const cPos = cSmp.position.clone().addScaledVector(cSmp.right, -32);
        const cy = sampleTerrainY(cPos.x, cPos.z);
        const craneUnit = new THREE.Group();
        craneUnit.position.set(cPos.x, cy, cPos.z);
        craneUnit.rotation.y = Math.atan2(cSmp.tangent.x, cSmp.tangent.z);
        const mast = new THREE.Mesh(new THREE.BoxGeometry(1.1, 24, 1.1), craneYellowMat);
        mast.position.y = 12;
        const jib = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 18), craneYellowMat);
        jib.position.set(3.5, 24.5, 0);
        jib.rotation.z = -0.32;
        craneUnit.add(mast, jib);
        craneGroup.add(craneUnit);
      }
      group.add(craneGroup);
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
      vegasSphereMat.emissive.setHSL(hue, 0.42, 0.82);
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
