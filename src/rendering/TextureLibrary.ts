import * as THREE from 'three';

export interface LoadedPBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export interface TrackTextureBundle {
  asphalt: LoadedPBRSet | null;
  grass: LoadedPBRSet | null;
  gravel: LoadedPBRSet | null;
}

let cachedBundle: TrackTextureBundle | null = null;
let bundlePromise: Promise<TrackTextureBundle> | null = null;
let cachedCarbonTex: THREE.CanvasTexture | null = null;

function loadTex(
  loader: THREE.TextureLoader,
  url: string,
  isColor: boolean,
  repeatX: number,
  repeatY: number,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.anisotropy = 16;
        if (isColor) {
          tex.colorSpace = THREE.SRGBColorSpace;
        }
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

async function loadPBRSet(
  loader: THREE.TextureLoader,
  prefix: string,
  repeatX: number,
  repeatY: number,
): Promise<LoadedPBRSet | null> {
  try {
    const [map, normalMap, roughnessMap] = await Promise.all([
      loadTex(loader, `./assets/textures/${prefix}_diff.jpg`, true, repeatX, repeatY),
      loadTex(loader, `./assets/textures/${prefix}_nor.jpg`, false, repeatX, repeatY),
      loadTex(loader, `./assets/textures/${prefix}_rough.jpg`, false, repeatX, repeatY),
    ]);
    return { map, normalMap, roughnessMap };
  } catch {
    return null;
  }
}

export function preloadTrackTextures(): Promise<TrackTextureBundle> {
  if (cachedBundle) return Promise.resolve(cachedBundle);
  if (bundlePromise) return bundlePromise;
  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    cachedBundle = { asphalt: null, grass: null, gravel: null };
    return Promise.resolve(cachedBundle);
  }

  const loader = new THREE.TextureLoader();
  bundlePromise = Promise.all([
    loadPBRSet(loader, 'asphalt', 1, 1),
    loadPBRSet(loader, 'grass', 48, 48),
    loadPBRSet(loader, 'gravel', 1, 1),
  ]).then(([asphalt, grass, gravel]) => {
    cachedBundle = { asphalt, grass, gravel };
    return cachedBundle;
  });
  return bundlePromise;
}

export function getCachedTrackTextures(): TrackTextureBundle | null {
  return cachedBundle;
}

export function clonePBRSetWithRepeat(
  set: LoadedPBRSet,
  repeatX: number,
  repeatY: number,
): LoadedPBRSet {
  const cloneOne = (src: THREE.Texture, isColor: boolean): THREE.Texture => {
    const t = src.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 16;
    if (isColor) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return {
    map: cloneOne(set.map, true),
    normalMap: cloneOne(set.normalMap, false),
    roughnessMap: cloneOne(set.roughnessMap, false),
  };
}

/** High-detail diagonal twill woven carbon-fiber texture for F1 bodywork/floor/wings. */
export function getCarbonFiberTexture(): THREE.CanvasTexture | null {
  if (cachedCarbonTex) return cachedCarbonTex;
  if (typeof document === 'undefined') return null;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#15181e';
  ctx.fillRect(0, 0, size, size);

  const cell = 8;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const diag = ((x / cell + y / cell) % 4 + 4) % 4;
      const bright = diag === 0 || diag === 1;
      const grad = ctx.createLinearGradient(x, y, x + cell, y + cell);
      if (bright) {
        grad.addColorStop(0, '#2a2f3a');
        grad.addColorStop(0.5, '#1d2129');
        grad.addColorStop(1, '#12151b');
      } else {
        grad.addColorStop(0, '#12151b');
        grad.addColorStop(0.5, '#1a1e26');
        grad.addColorStop(1, '#262b35');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, cell, cell);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedCarbonTex = tex;
  return tex;
}

/** Repeating F1 Trackside Sponsor Board texture (PIRELLI, ARAMCO, ROLEX, AWS, DHL, F1 2026). */
export function createSponsorBarrierTexture(isNight: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const panels = [
    { bg: '#006039', fg: '#F4D03F', accent: '#FFFFFF', text: 'ROLEX', sub: 'OFFICIAL TIMEPIECE' },
    { bg: '#E10600', fg: '#FFFFFF', accent: '#111111', text: 'F1 2026', sub: 'WORLD TOUR' },
    { bg: '#0A192F', fg: '#00E5A0', accent: '#00B4D8', text: 'aramco', sub: 'ENERGY' },
    { bg: '#FFCC00', fg: '#D40511', accent: '#D40511', text: 'DHL', sub: 'LOGISTICS' },
    { bg: '#11131A', fg: '#FFDD00', accent: '#E10600', text: 'PIRELLI', sub: 'P ZERO' },
    { bg: '#1B2230', fg: '#FF9900', accent: '#FFFFFF', text: 'aws', sub: 'POWERED BY' },
    { bg: '#005A2B', fg: '#FFFFFF', accent: '#E10600', text: 'HEINEKEN 0.0', sub: 'WHEN YOU DRIVE NEVER DRINK' },
    { bg: '#002855', fg: '#38BDF8', accent: '#FFFFFF', text: 'CRYPTO', sub: 'GLOBAL PARTNER' },
  ];

  const pw = canvas.width / panels.length;

  panels.forEach((p, idx) => {
    const x = idx * pw;
    ctx.fillStyle = p.bg;
    ctx.fillRect(x, 0, pw, 196);

    // Top & bottom trim bar
    ctx.fillStyle = p.accent;
    ctx.fillRect(x, 0, pw, 12);
    ctx.fillRect(x, 184, pw, 12);

    // Subtle panel divider
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, 0, 4, 196);

    ctx.fillStyle = p.fg;
    ctx.font = '900 54px "Titillium Web", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, x + pw / 2, 88);

    ctx.fillStyle = isNight ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.78)';
    ctx.font = '700 18px "Titillium Web", Arial, sans-serif';
    ctx.fillText(p.sub, x + pw / 2, 148);
  });

  // Lower concrete / corrugated steel barrier strip
  ctx.fillStyle = '#B8C0CC';
  ctx.fillRect(0, 196, canvas.width, 60);
  ctx.fillStyle = '#8F98A8';
  ctx.fillRect(0, 214, canvas.width, 10);
  ctx.fillRect(0, 236, canvas.width, 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Semi-transparent metallic FIA debris catch-fence mesh texture. */
export function createCatchFenceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  if (typeof ctx.lineTo === 'function') {
    // Fine steel wire grid
    ctx.strokeStyle = 'rgba(185, 196, 210, 0.42)';
    ctx.lineWidth = 1.4;
    for (let x = 0; x <= 256; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
    for (let y = 0; y <= 256; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }

    // Horizontal steel tension cables
    ctx.strokeStyle = 'rgba(215, 224, 236, 0.78)';
    ctx.lineWidth = 3;
    for (const y of [10, 86, 168, 246]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** High-grip FIA painted runoff stripes (inspired by Red Bull Ring & Paul Ricard). */
export function createPaintedRunoffTexture(
  primaryHex: string,
  secondaryHex: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#383d47';
  ctx.fillRect(0, 0, 512, 256);

  // Diagonal high-grip chevron bands
  if (typeof ctx.lineTo === 'function') {
    const stripeW = 48;
    for (let i = -8; i < 18; i++) {
      ctx.fillStyle = i % 2 === 0 ? primaryHex : secondaryHex;
      ctx.beginPath();
      const x = i * stripeW;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + stripeW * 0.62, 0);
      ctx.lineTo(x + stripeW * 0.62 + 90, 256);
      ctx.lineTo(x + 90, 256);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Subtle tarmac grain overlay so stripes look painted onto asphalt
  ctx.fillStyle = 'rgba(20, 24, 30, 0.22)';
  for (let y = 0; y < 256; y += 4) {
    ctx.fillRect(0, y, 512, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Crisp 150m / 100m / 50m FIA Braking Marker Board texture. */
export function createBrakeBoardTexture(meters: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 256, 192);
  ctx.strokeStyle = '#E10600';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, 242, 178);

  ctx.fillStyle = '#11131A';
  ctx.font = '900 108px "Titillium Web", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(meters), 128, 102);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Illuminated F1 Team Pit Garage Fascia Header Signage. */
export function createPitGarageHeaderTexture(
  teamName: string,
  primaryHex: string,
  accentHex: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0D1018';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = primaryHex;
  ctx.fillRect(0, 0, 512, 22);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 114, 512, 14);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 44px "Titillium Web", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(teamName, 256, 70);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Official FIA Pit Lane Speed Limit Sign (80 KM/H). */
export function createPitSpeedBoardTexture(limitKmh = 80): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#E10600';
  ctx.lineWidth = 22;
  if (typeof ctx.arc === 'function') {
    ctx.beginPath();
    ctx.arc(128, 112, 82, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#11131A';
  ctx.font = '900 92px "Titillium Web", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(limitKmh), 128, 114);

  ctx.fillStyle = '#E10600';
  ctx.fillRect(16, 206, 224, 38);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 24px "Titillium Web", Arial, sans-serif';
  ctx.fillText('PIT LIMIT KM/H', 128, 226);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Painted FIA Pit Box Ground Markings (stop lines + wheel guides). */
export function createPitBoxMarkingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 512);
  // Crisp FIA yellow/red pit box border
  ctx.fillStyle = '#FACC15';
  ctx.fillRect(16, 16, 224, 14);
  ctx.fillRect(16, 482, 224, 14);
  ctx.fillRect(16, 16, 14, 480);
  ctx.fillRect(226, 16, 14, 480);

  // Red front-wheel stop bar
  ctx.fillStyle = '#E10600';
  ctx.fillRect(36, 92, 184, 20);

  // White wheel target boxes
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(42, 118, 42, 74);
  ctx.fillRect(172, 118, 42, 74);
  ctx.fillRect(42, 340, 42, 74);
  ctx.fillRect(172, 340, 42, 74);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 58px "Titillium Web", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BOX', 128, 266);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Circuit-Specific Branded Gantry Banner Texture. */
export function createCircuitGantryBannerTexture(
  title: string,
  subtitle: string,
  bgHex: string,
  accentHex: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 1024, 192);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 1024, 18);
  ctx.fillRect(0, 174, 1024, 18);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 66px "Titillium Web", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 512, 82);

  ctx.fillStyle = accentHex;
  ctx.font = '800 28px "Titillium Web", Arial, sans-serif';
  ctx.fillText(subtitle, 512, 142);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

/** Multi-layer alpha-cutout 3D foliage cluster texture (tinted per instance in TrackMeshBuilder). */
export function createFoliageCanopyTexture(
  kind: 'deciduous' | 'pine' | 'cypress' | 'palm',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  if (kind === 'pine') {
    // Tiered spruce/pine boughs from spire tip (y=18) down to broad skirt (y=244)
    const tiers = 7;
    for (let t = 0; t < tiers; t++) {
      const frac = t / (tiers - 1);
      const cy = 30 + frac * 195;
      const halfSpan = 20 + frac * 94;
      const puffCount = 5 + Math.round(frac * 8);
      for (let p = 0; p < puffCount; p++) {
        const pf = puffCount === 1 ? 0 : (p / (puffCount - 1)) * 2 - 1;
        const px = 128 + pf * halfSpan + Math.sin(t * 7 + p * 3) * 7;
        const py = cy + Math.abs(pf) * 14 + Math.cos(t * 5 + p) * 5;
        const r = 13 + (1 - Math.abs(pf) * 0.35) * 14;
        ctx.fillStyle =
          py < cy + 8 ? 'rgba(210, 232, 190, 0.96)' : 'rgba(132, 162, 120, 0.96)';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'cypress') {
    // Tall slender Tuscan/Monza Italian cypress column
    for (let i = 0; i < 42; i++) {
      const frac = i / 41;
      const y = 18 + frac * 226;
      const halfW = 10 + Math.sin(Math.pow(frac, 0.72) * Math.PI * 0.92) * 34;
      const jitterX = Math.sin(i * 11.3) * (halfW * 0.45);
      const r = 12 + (1 - Math.abs(frac - 0.6)) * 9;
      ctx.fillStyle =
        i % 3 === 0 ? 'rgba(198, 224, 178, 0.96)' : 'rgba(128, 158, 118, 0.96)';
      ctx.beginPath();
      ctx.arc(128 + jitterX, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'palm') {
    // Arching Vegas Strip palm fronds radiating from crown hub
    const fronds = 10;
    for (let f = 0; f < fronds; f++) {
      const ang = (f / fronds) * Math.PI * 2 + (f % 2) * 0.14;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const px = -dy;
      const py = dx;
      const tipX = 128 + dx * 108;
      const tipY = 112 + dy * 88 + 26;
      const ctrlX = 128 + dx * 62;
      const ctrlY = 112 + dy * 38 - 18;
      ctx.strokeStyle = f % 2 === 0 ? '#5b8a42' : '#4a7736';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(128, 112);
      ctx.bezierCurveTo(ctrlX, ctrlY, tipX - dx * 18, tipY - 12, tipX, tipY);
      ctx.stroke();

      // Leaflets along frond spine
      for (let s = 2; s <= 7; s++) {
        const lt = s / 8;
        const lx = 128 + (tipX - 128) * lt;
        const ly = 112 + (tipY - 112) * lt - Math.sin(lt * Math.PI) * 14;
        ctx.fillStyle = s > 5 ? 'rgba(130, 184, 86, 0.95)' : 'rgba(92, 146, 62, 0.95)';
        ctx.beginPath();
        ctx.arc(lx + px * 7, ly + py * 7, 8, 0, Math.PI * 2);
        ctx.arc(lx - px * 7, ly - py * 7, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // Broad deciduous park oak/beech foliage cluster (tinted per tree instance)
    for (let i = 0; i < 64; i++) {
      const hashA = ((i * 73 + 19) % 100) / 100;
      const hashB = ((i * 137 + 41) % 100) / 100;
      const ang = hashA * Math.PI * 2;
      const rad = Math.sqrt(hashB) * 74;
      const cx = 128 + Math.cos(ang) * rad;
      const cy = 124 + Math.sin(ang) * rad * 0.88;
      const r = 18 + (i % 5) * 4.5;
      ctx.fillStyle =
        cy < 98
          ? 'rgba(228, 244, 206, 0.94)'
          : i % 2 === 0
            ? 'rgba(176, 204, 152, 0.95)'
            : 'rgba(128, 158, 114, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Furrowed vertical bark texture for realistic tree trunks. */
export function createBarkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, '#3a2b1d');
  grad.addColorStop(0.5, '#523e2c');
  grad.addColorStop(1, '#34261a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);

  for (let i = 0; i < 42; i++) {
    const x = (i * 29 + (i % 5) * 7) % 124;
    const y = (i * 47) % 210;
    const h = 24 + (i % 6) * 10;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(24, 16, 10, 0.55)' : 'rgba(104, 86, 66, 0.32)';
    ctx.fillRect(x, y, 4 + (i % 3), h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Continuous 360-degree woodland horizon wall alpha-cutout texture. */
export function createTreelineWallTexture(
  atmosphere: 'alpine-day' | 'golden-park' | 'british-day',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 256);

  const deep =
    atmosphere === 'alpine-day'
      ? '#16301b'
      : atmosphere === 'golden-park'
        ? '#20361b'
        : '#1e3820';
  const mid =
    atmosphere === 'alpine-day'
      ? '#234a2b'
      : atmosphere === 'golden-park'
        ? '#315025'
        : '#2b4f2d';
  const lit =
    atmosphere === 'alpine-day'
      ? '#34663c'
      : atmosphere === 'golden-park'
        ? '#4c6d31'
        : '#3d693d';

  // Solid deep woodland understory floor band
  const floorGrad = ctx.createLinearGradient(0, 130, 0, 256);
  floorGrad.addColorStop(0, mid);
  floorGrad.addColorStop(1, deep);
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, 136, 1024, 120);

  // Overlapping jagged/rounded tree crowns forming organic skyline silhouette
  for (let i = 0; i < 110; i++) {
    const x = (i / 110) * 1024;
    const crownH = 52 + ((i * 37) % 68);
    const cy = 152 - crownH * 0.55;
    const r = 18 + ((i * 19) % 24);
    ctx.fillStyle = i % 3 === 0 ? lit : i % 3 === 1 ? mid : deep;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
    if (atmosphere === 'alpine-day' || i % 2 === 0) {
      ctx.beginPath();
      ctx.arc(x, cy - r * 0.65, r * 0.56, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Realistic dual-wheel rubbered braking-zone skid marks deposited before corner apexes. */
export function createBrakingZoneSkidTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 512);

  for (const gx of [72, 160]) {
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(12, 14, 18, 0.0)');
    grad.addColorStop(0.28, 'rgba(12, 14, 18, 0.42)');
    grad.addColorStop(0.84, 'rgba(12, 14, 18, 0.52)');
    grad.addColorStop(1, 'rgba(12, 14, 18, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(gx, 0, 24, 512);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Circuit-branded grandstand architectural fascia banner. */
export function createGrandstandBannerTexture(circuitId: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const spec =
    circuitId === 'red-bull-ring'
      ? { bg: '#0E1930', acc: '#E10600', label: 'RED BULL RING · SPIELBERG · AUSTRIA' }
      : circuitId === 'monza'
        ? { bg: '#0E4A25', acc: '#E10600', label: 'AUTODROMO NAZIONALE MONZA · ITALIA' }
        : circuitId === 'silverstone'
          ? { bg: '#0B1D3A', acc: '#E10600', label: 'SILVERSTONE · BRITISH GRAND PRIX' }
          : { bg: '#120A24', acc: '#00E5FF', label: 'LAS VEGAS STRIP · NIGHT GRAND PRIX' };

  ctx.fillStyle = spec.bg;
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = spec.acc;
  ctx.fillRect(0, 0, 1024, 12);
  ctx.fillRect(0, 116, 1024, 12);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 40px "Inter", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.label, 512, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** FIA digital trackside LED marshal status panel (green flag condition). */
export function createFiaLightPanelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0D1017';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 120, 120);

  ctx.fillStyle = '#10B981';
  for (let y = 24; y <= 104; y += 20) {
    for (let x = 24; x <= 104; x += 20) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Paddock team transporter semi-trailer livery texture. */
export function createPaddockTruckTexture(
  teamName: string,
  primaryHex: string,
  accentHex: string,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#151A26';
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = primaryHex;
  ctx.fillRect(0, 0, 512, 26);
  ctx.fillRect(0, 166, 512, 26);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 26, 512, 6);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 32px "Inter", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(teamName, 256, 98);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 360-degree illuminated Las Vegas night city skyline horizon backdrop texture. */
export function createVegasSkylineWallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 256);

  // Subtle urban horizon glow along the lower third
  const glow = ctx.createLinearGradient(0, 48, 0, 256);
  glow.addColorStop(0, 'rgba(8, 12, 28, 0)');
  glow.addColorStop(0.45, 'rgba(26, 20, 56, 0.55)');
  glow.addColorStop(1, 'rgba(14, 18, 34, 0.98)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 48, 1024, 208);

  const neonAccents = ['#00E5FF', '#FF2E93', '#FFD700', '#A855F7', '#E10600'];
  const winColors = ['#FFE8A3', '#7CE8FF', '#FFF6DC', '#F472B6'];

  // Dense multi-layered high-rise silhouette along the entire 1024px strip
  let x = 0;
  let bIdx = 0;
  while (x < 1024) {
    const w = 22 + ((bIdx * 17) % 28);
    const h = 84 + ((bIdx * 43 + 19) % 138);
    const topY = 256 - h;

    ctx.fillStyle = bIdx % 2 === 0 ? '#0D1324' : '#12192E';
    ctx.fillRect(x, topY, w - 2, h);

    // Rooftop neon crown bar
    ctx.fillStyle = neonAccents[bIdx % neonAccents.length];
    ctx.fillRect(x + 1, topY, w - 4, 3);

    // Fine multi-story window grid
    for (let wy = topY + 7; wy < 248; wy += 6) {
      for (let wx = x + 3; wx < x + w - 5; wx += 5) {
        const hash = (wx * 31 + wy * 53 + bIdx * 11) % 100;
        if (hash > 38) {
          ctx.fillStyle = winColors[(wx + wy + bIdx) % winColors.length];
          ctx.fillRect(wx, wy, 3, 3);
        }
      }
    }

    x += w;
    bIdx++;
  }

  // Dense ground-level boulevard city lights
  for (let i = 0; i < 160; i++) {
    const lx = (i * 29) % 1024;
    ctx.fillStyle = i % 3 === 0 ? '#FFD700' : i % 3 === 1 ? '#00E5FF' : '#FF2E93';
    ctx.fillRect(lx, 246 + (i % 6), 4, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** High-brightness Las Vegas Strip & Sphere Arena digital LED marquee billboard texture. */
export function createVegasBillboardTexture(variant: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const themes = [
    {
      bg0: '#19082E',
      bg1: '#07142C',
      border: '#FF0080',
      accent: '#00E5FF',
      title: 'SPHERE ARENA',
      sub: 'T-MOBILE ZONE • LAS VEGAS GP',
    },
    {
      bg0: '#081C38',
      bg1: '#040B1A',
      border: '#00E5FF',
      accent: '#FFD700',
      title: 'THE STRIP',
      sub: 'LAS VEGAS BLVD • 350 KM/H',
    },
    {
      bg0: '#2A0912',
      bg1: '#10061C',
      border: '#FFD700',
      accent: '#E10600',
      title: 'BELLAGIO • PARIS',
      sub: 'CAESARS • VENETIAN • WYNN',
    },
    {
      bg0: '#04261C',
      bg1: '#071224',
      border: '#10B981',
      accent: '#FFFFFF',
      title: 'HEINEKEN SILVER',
      sub: 'F1 LAS VEGAS WORLD TOUR',
    },
  ];
  const th = themes[Math.abs(variant) % themes.length];

  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, th.bg0);
  grad.addColorStop(1, th.bg1);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = th.border;
  ctx.fillRect(0, 0, 512, 12);
  ctx.fillRect(0, 244, 512, 12);
  ctx.fillRect(0, 0, 12, 256);
  ctx.fillRect(500, 0, 12, 256);

  ctx.fillStyle = th.accent;
  ctx.fillRect(28, 170, 456, 5);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 56px "Titillium Web", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(th.title, 256, 104);

  ctx.fillStyle = th.accent;
  ctx.font = '800 24px "Titillium Web", Arial, sans-serif';
  ctx.fillText(th.sub, 256, 206);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
