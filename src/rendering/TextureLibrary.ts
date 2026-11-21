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
