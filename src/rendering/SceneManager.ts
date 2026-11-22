import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { AtmospherePreset } from '../data/circuits';
import {
  ALL_DRIVERS,
  getDriverPortraitPath,
  resolveDriverHelmet,
  resolveDriverTeam,
  type DriverConfig,
  type TeamId,
} from '../data/teamsAndDrivers';
import { CameraRig } from './CameraRig';
import { buildF1CarMesh, type CarMeshRig } from './CarMeshBuilder';
import { drawFlagOnCanvas } from '../ui/flagIcons';

type EnvKey = AtmospherePreset | 'showroom';

export const HDRI_FILES: Record<EnvKey, string> = {
  'alpine-day': 'alpine-day.hdr',
  'golden-park': 'golden-park.hdr',
  'british-day': 'british-overcast.hdr',
  'vegas-night': 'vegas-night.hdr',
  showroom: 'showroom.hdr',
};

export function resolveHdriFilename(key: EnvKey): string {
  return HDRI_FILES[key];
}

/**
 * Compresses extreme HDR sun/specular spikes via a hue-preserving soft-knee shoulder
 * so HDRI skyboxes do not trigger full-screen UnrealBloom glare before tone mapping.
 */
export function compressHdrTextureRadiance(tex: THREE.DataTexture, maxChannel = 2.0): void {
  const data = tex.image?.data as Uint16Array | Float32Array | undefined;
  if (!data || data.length < 4) return;

  const knee = maxChannel * 0.45;
  const head = Math.max(0.001, maxChannel - knee);
  const isHalfFloat = data instanceof Uint16Array;

  const compressPixel = (r: number, g: number, b: number): [number, number, number] | null => {
    const peak = Math.max(r, g, b);
    if (!Number.isFinite(peak) || peak <= knee) return null;
    const excess = peak - knee;
    const compressed = knee + head * (excess / (excess + head));
    const scale = compressed / peak;
    return [r * scale, g * scale, b * scale];
  };

  for (let i = 0; i < data.length; i += 4) {
    const r = isHalfFloat ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
    const g = isHalfFloat ? THREE.DataUtils.fromHalfFloat(data[i + 1]) : data[i + 1];
    const b = isHalfFloat ? THREE.DataUtils.fromHalfFloat(data[i + 2]) : data[i + 2];
    const next = compressPixel(r, g, b);
    if (!next) continue;
    if (isHalfFloat) {
      data[i] = THREE.DataUtils.toHalfFloat(next[0]);
      data[i + 1] = THREE.DataUtils.toHalfFloat(next[1]);
      data[i + 2] = THREE.DataUtils.toHalfFloat(next[2]);
    } else {
      data[i] = next[0];
      data[i + 1] = next[1];
      data[i + 2] = next[2];
    }
  }
  tex.needsUpdate = true;
}

interface CachedHdri {
  bgTex: THREE.DataTexture;
  envRt: THREE.WebGLRenderTarget;
}

export interface PodiumCharacterRig {
  group: THREE.Group;
  rightArm: THREE.Group;
  leftArm: THREE.Group;
  trophyGroup: THREE.Group;
  baseY: number;
  phase: number;
}

/** Resolves a complete 3-driver podium lineup [P1, P2, P3] even when called from 1-car Time Trial. */
export function resolvePodiumDrivers(
  winnerDriver: DriverConfig,
  podiumDrivers?: [DriverConfig?, DriverConfig?, DriverConfig?],
): [DriverConfig, DriverConfig, DriverConfig] {
  const used = new Set<string>();
  const picked: DriverConfig[] = [];
  const pushUnique = (drv?: DriverConfig) => {
    if (!drv || used.has(drv.id)) return;
    used.add(drv.id);
    picked.push(drv);
  };
  pushUnique(podiumDrivers?.[0] ?? winnerDriver);
  pushUnique(podiumDrivers?.[1]);
  pushUnique(podiumDrivers?.[2]);
  for (const fallback of ALL_DRIVERS) {
    if (picked.length >= 3) break;
    pushUnique(fallback);
  }
  return [picked[0], picked[1], picked[2]];
}

/**
 * Builds an articulated 3D Grand Prix podium driver character standing in team Nomex racing suit,
 * boots, gloves, and helmet — hoisting the metallic trophy in their right hand and holding a
 * champagne magnum bottle in their left hand.
 */
export function buildPodiumDriverCharacter(
  driver: DriverConfig,
  yahiaTeamId: TeamId,
  rank: '1' | '2' | '3',
  trimColor: string,
  baseY = 0,
): PodiumCharacterRig {
  const team = resolveDriverTeam(driver, yahiaTeamId);
  const helmet = resolveDriverHelmet(driver, yahiaTeamId);

  const suitPrimaryMat = new THREE.MeshStandardMaterial({
    color: team.primaryColor,
    roughness: 0.56,
    metalness: 0.08,
  });
  const suitSecondaryMat = new THREE.MeshStandardMaterial({
    color: team.secondaryColor,
    roughness: 0.48,
    metalness: 0.14,
  });
  const suitAccentMat = new THREE.MeshStandardMaterial({
    color: team.accentColor,
    roughness: 0.42,
    metalness: 0.2,
  });
  const gearDarkMat = new THREE.MeshStandardMaterial({
    color: '#11151E',
    roughness: 0.65,
    metalness: 0.15,
  });
  const whiteTrimMat = new THREE.MeshStandardMaterial({
    color: '#F8FAFC',
    roughness: 0.45,
    metalness: 0.1,
  });
  const helmetShellMat = new THREE.MeshPhysicalMaterial({
    color: helmet.shell,
    metalness: 0.42,
    roughness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
  });
  const helmetStripeMat = new THREE.MeshPhysicalMaterial({
    color: helmet.stripe,
    metalness: 0.55,
    roughness: 0.16,
    clearcoat: 0.9,
  });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: helmet.visor,
    metalness: 0.94,
    roughness: 0.06,
    clearcoat: 1.0,
  });
  const trophyMat = new THREE.MeshPhysicalMaterial({
    color: trimColor,
    metalness: 0.96,
    roughness: 0.12,
    clearcoat: 1.0,
    envMapIntensity: 2.0,
  });
  const trophyPedMat = new THREE.MeshStandardMaterial({
    color: '#141926',
    metalness: 0.65,
    roughness: 0.25,
  });
  const bottleGlassMat = new THREE.MeshPhysicalMaterial({
    color: '#144524',
    metalness: 0.22,
    roughness: 0.14,
    clearcoat: 1.0,
  });
  const bottleGoldMat = new THREE.MeshStandardMaterial({
    color: '#FFD700',
    metalness: 0.88,
    roughness: 0.2,
  });

  const group = new THREE.Group();
  group.name = `podium-driver-${rank}`;

  // Legs + Racing Boots (standing firmly at y = 0..0.82)
  for (const side of [-1, 1] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.072, 0.72, 12), suitPrimaryMat);
    leg.position.set(side * 0.115, 0.44, 0);
    leg.castShadow = true;
    const kneeStripe = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.62, 0.11), suitSecondaryMat);
    kneeStripe.position.set(side * 0.165, 0.46, 0);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.23), gearDarkMat);
    boot.position.set(side * 0.115, 0.055, 0.045);
    boot.castShadow = true;
    const bootSole = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.025, 0.235), whiteTrimMat);
    bootSole.position.set(side * 0.115, 0.012, 0.045);
    group.add(leg, kneeStripe, boot, bootSole);
  }

  // Torso Nomex Suit + Team Chest Stripes + Sponsor Panel + Waist Belt
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.22), suitPrimaryMat);
  hips.position.set(0, 0.82, 0);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.395, 0.065, 0.235), suitAccentMat);
  belt.position.set(0, 0.89, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.24), suitPrimaryMat);
  torso.position.set(0, 1.14, 0);
  torso.castShadow = true;
  const chestYoke = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.16, 0.246), suitSecondaryMat);
  chestYoke.position.set(0, 1.29, 0);
  const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.435, 0.045, 0.25), suitAccentMat);
  chestStripe.position.set(0, 1.18, 0);
  const sponsorBadge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.02), whiteTrimMat);
  sponsorBadge.position.set(0, 1.11, 0.125);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.08, 12), suitAccentMat);
  collar.position.set(0, 1.41, 0);
  group.add(hips, belt, torso, chestYoke, chestStripe, sponsorBadge, collar);

  // Driver Helmet + Stripe + Visor (+ Winner Gold Cap Crest on P1)
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, 1.56, 0);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 16), helmetShellMat);
  shell.scale.set(0.95, 1.04, 1.1);
  shell.castShadow = true;
  const hStripe = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.17, 0.29), helmetStripeMat);
  hStripe.position.set(0, 0.052, 0);
  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.154, 0.154, 0.07, 18, 1, true, -0.82, 1.64),
    visorMat,
  );
  visor.position.set(0, 0.014, 0.024);
  helmetGroup.add(shell, hStripe, visor);
  if (rank === '1') {
    const crownBand = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.015, 8, 24), bottleGoldMat);
    crownBand.rotation.x = Math.PI / 2 - 0.15;
    crownBand.position.set(0, 0.08, 0);
    helmetGroup.add(crownBand);
  }
  group.add(helmetGroup);

  // Right Arm (Shoulder + Forearm + Glove) Raised Hoisting the Grand Prix Trophy!
  const rightArm = new THREE.Group();
  rightArm.position.set(-0.26, 1.33, 0);
  rightArm.rotation.x = rank === '1' ? -2.28 : -1.85;
  rightArm.rotation.z = -0.22;
  const rShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), suitSecondaryMat);
  const rUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.44, 10), suitPrimaryMat);
  rUpper.position.set(0, -0.22, 0);
  const rGlove = new THREE.Mesh(new THREE.SphereGeometry(0.056, 10, 8), gearDarkMat);
  rGlove.position.set(0, -0.45, 0);
  rightArm.add(rShoulder, rUpper, rGlove);

  // Sculpted 3D Metallic Grand Prix Trophy Held High in Right Hand
  const trophyGroup = new THREE.Group();
  trophyGroup.position.set(0, -0.52, 0.12);
  trophyGroup.rotation.x = -(rank === '1' ? -2.28 : -1.85);
  const basePed = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.09, 16), trophyPedMat);
  basePed.position.y = 0.045;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.058, 0.22, 14), trophyMat);
  stem.position.y = 0.2;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.072, 0.26, 20), trophyMat);
  cup.position.y = 0.42;
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.018, 8, 20), trophyMat);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 0.54;
  trophyGroup.add(basePed, stem, cup, crown);
  if (rank === '1') trophyGroup.scale.set(1.18, 1.24, 1.18);
  rightArm.add(trophyGroup);
  group.add(rightArm);

  // Left Arm Aiming a 3D Magnum Champagne Bottle Forward toward the Crowd
  const leftArm = new THREE.Group();
  leftArm.position.set(0.26, 1.33, 0);
  leftArm.rotation.x = -1.22;
  leftArm.rotation.z = rank === '2' ? -0.18 : rank === '3' ? 0.18 : 0.05;
  const lShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), suitSecondaryMat);
  const lUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.44, 10), suitPrimaryMat);
  lUpper.position.set(0, -0.22, 0);
  const lGlove = new THREE.Mesh(new THREE.SphereGeometry(0.056, 10, 8), gearDarkMat);
  lGlove.position.set(0, -0.45, 0);
  leftArm.add(lShoulder, lUpper, lGlove);

  const bottle = new THREE.Group();
  bottle.position.set(0, -0.52, 0.06);
  bottle.rotation.x = -0.35;
  const bottleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.056, 0.24, 12), bottleGlassMat);
  bottleBody.position.y = 0.06;
  const bottleFoil = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.048, 0.14, 12), bottleGoldMat);
  bottleFoil.position.y = 0.24;
  const bottleLabel = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.09, 12), whiteTrimMat);
  bottleLabel.position.y = 0.06;
  bottle.add(bottleBody, bottleFoil, bottleLabel);
  leftArm.add(bottle);
  group.add(leftArm);

  return {
    group,
    rightArm,
    leftArm,
    trophyGroup,
    baseY,
    phase: rank === '1' ? 0 : rank === '2' ? 1.4 : 2.8,
  };
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly cameraRig: CameraRig;

  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private pmremGenerator: THREE.PMREMGenerator;
  private rgbeLoader: RGBELoader;
  private hdriCache = new Map<EnvKey, CachedHdri>();
  private hdriLoading = new Set<EnvKey>();
  private fallbackEnvRt: THREE.WebGLRenderTarget | null = null;
  private currentEnvKey: EnvKey | null = null;
  private showroomGroup: THREE.Group | null = null;
  private showroomCar: CarMeshRig | null = null;
  private podiumGroup: THREE.Group | null = null;
  private podiumCar: CarMeshRig | null = null;
  private podiumTrophies: THREE.Object3D[] = [];
  private podiumCharacters: {
    group: THREE.Group;
    rightArm: THREE.Group;
    leftArm: THREE.Group;
    baseY: number;
    phase: number;
  }[] = [];
  private podiumBeams: THREE.Object3D[] = [];
  private podiumConfettiMesh: THREE.InstancedMesh | null = null;
  private podiumConfettiData: { x: number; y: number; z: number; vy: number; phase: number; speed: number }[] = [];
  private podiumChampagneMesh: THREE.InstancedMesh | null = null;
  private podiumChampagneData: { originX: number; originY: number; originZ: number; vx: number; vy: number; vz: number; t: number; life: number }[] = [];
  private podiumTextures: THREE.Texture[] = [];
  private podiumDummy = new THREE.Object3D();
  private activeWorldGroup: THREE.Group | null = null;

  constructor(container: HTMLElement) {
    const initW = container.clientWidth || window.innerWidth;
    const initH = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const isMobileLike =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 920);
    const maxDpr = isMobileLike ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.setSize(initW, initH);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0E131D');
    this.scene.fog = new THREE.FogExp2('#0E131D', 0.0011);

    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.pmremGenerator.compileCubemapShader();
    this.rgbeLoader = new RGBELoader();

    this.cameraRig = new CameraRig(initW / Math.max(1, initH));

    this.hemiLight = new THREE.HemisphereLight('#DCEBFF', '#253129', 0.75);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#FFF8EC', 2.4);
    this.sunLight.position.set(120, 180, 90);
    this.sunLight.castShadow = true;
    const shadowRes = isMobileLike ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    this.sunLight.shadow.camera.near = 25;
    this.sunLight.shadow.camera.far = 340;
    const d = 58;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Post-processing pipeline: Render -> subtle UnrealBloom -> ACES OutputPass
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.composer.setSize(initW, initH);
    const renderPass = new RenderPass(this.scene, this.cameraRig.camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(initW, initH),
      0.26, // strength
      0.42, // radius
      0.94, // threshold (only true emissives, brake glow, rain light, neon, sun glints)
    );
    const outputPass = new OutputPass();
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(outputPass);
  }

  private applyHdriToScene(key: EnvKey, cached: CachedHdri): void {
    this.scene.environment = cached.envRt.texture;
    if (key === 'showroom') {
      this.scene.background = new THREE.Color('#090B12');
      this.scene.environmentIntensity = 0.95;
    } else if (key === 'vegas-night') {
      this.scene.background = cached.bgTex;
      this.scene.backgroundIntensity = 0.30;
      this.scene.environmentIntensity = 0.62;
    } else if (key === 'golden-park') {
      this.scene.background = cached.bgTex;
      this.scene.backgroundIntensity = 0.58;
      this.scene.environmentIntensity = 0.56;
    } else if (key === 'alpine-day') {
      this.scene.background = cached.bgTex;
      this.scene.backgroundIntensity = 0.62;
      this.scene.environmentIntensity = 0.58;
    } else {
      // british-day
      this.scene.background = cached.bgTex;
      this.scene.backgroundIntensity = 0.60;
      this.scene.environmentIntensity = 0.58;
    }
  }

  private updateEnvironmentMap(key: EnvKey): void {
    this.currentEnvKey = key;

    const cached = this.hdriCache.get(key);
    if (cached) {
      this.applyHdriToScene(key, cached);
      return;
    }

    // Immediate procedural fallback so there is never an unlit frame while HDRI downloads
    this.buildProceduralFallbackEnv(key);

    if (this.hdriLoading.has(key) || typeof window === 'undefined') return;
    this.hdriLoading.add(key);

    this.rgbeLoader.load(
      `./assets/hdri/${resolveHdriFilename(key)}`,
      (hdrTex) => {
        this.hdriLoading.delete(key);
        compressHdrTextureRadiance(hdrTex, key === 'showroom' ? 2.8 : 2.0);
        hdrTex.mapping = THREE.EquirectangularReflectionMapping;
        const envRt = this.pmremGenerator.fromEquirectangular(hdrTex);
        const entry: CachedHdri = { bgTex: hdrTex, envRt };
        this.hdriCache.set(key, entry);
        if (this.currentEnvKey === key) {
          this.applyHdriToScene(key, entry);
        }
      },
      undefined,
      () => {
        this.hdriLoading.delete(key);
      },
    );
  }

  private buildProceduralFallbackEnv(key: EnvKey): void {
    const envScene = new THREE.Scene();
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 128);

    if (key === 'showroom') {
      grad.addColorStop(0, '#101626');
      grad.addColorStop(0.5, '#1C2438');
      grad.addColorStop(1, '#06080E');
    } else if (key === 'vegas-night') {
      grad.addColorStop(0, '#040712');
      grad.addColorStop(0.5, '#121936');
      grad.addColorStop(1, '#090B12');
    } else if (key === 'golden-park') {
      grad.addColorStop(0, '#446DA3');
      grad.addColorStop(0.45, '#EAA66D');
      grad.addColorStop(1, '#26381D');
    } else {
      grad.addColorStop(0, '#2A6BC2');
      grad.addColorStop(0.48, '#A8D7F7');
      grad.addColorStop(1, '#254423');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);

    const domeTex = new THREE.CanvasTexture(canvas);
    domeTex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 16),
      new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide }),
    );
    envScene.add(dome);

    const nextRt = this.pmremGenerator.fromScene(envScene, 0.035);
    domeTex.dispose();
    dome.geometry.dispose();
    (dome.material as THREE.Material).dispose();

    if (this.fallbackEnvRt) {
      this.fallbackEnvRt.dispose();
    }
    this.fallbackEnvRt = nextRt;
    this.scene.environment = nextRt.texture;
    this.scene.environmentIntensity = key === 'showroom' ? 0.95 : 0.58;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.cameraRig.setAspect(w / h);
  }

  private setSunShadowFrustum(d: number, near: number, far: number): void {
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = near;
    this.sunLight.shadow.camera.far = far;
    this.sunLight.shadow.camera.updateProjectionMatrix();
  }

  applyAtmosphere(preset: AtmospherePreset): void {
    this.setSunShadowFrustum(74, 20, 360);
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.03;

    if (preset === 'vegas-night') {
      this.scene.background = new THREE.Color('#060914');
      this.scene.fog = new THREE.FogExp2('#080C1C', 0.00075);
      this.hemiLight.color.set('#7DA2FF');
      this.hemiLight.groundColor.set('#141826');
      this.hemiLight.intensity = 0.65;
      this.sunLight.color.set('#D8E6FF');
      this.sunLight.intensity = 1.35;
      this.renderer.toneMappingExposure = 1.02;
      this.bloomPass.strength = 0.28;
      this.bloomPass.radius = 0.35;
      this.bloomPass.threshold = 1.15;
    } else if (preset === 'golden-park') {
      this.scene.background = new THREE.Color('#B88456');
      this.scene.fog = new THREE.FogExp2('#9E7F64', 0.00024);
      this.hemiLight.color.set('#E6CEB0');
      this.hemiLight.groundColor.set('#1D2915');
      this.hemiLight.intensity = 0.42;
      this.sunLight.color.set('#FFD4A3');
      this.sunLight.intensity = 1.55;
      this.renderer.toneMappingExposure = 0.80;
      this.bloomPass.strength = 0.10;
      this.bloomPass.radius = 0.25;
      this.bloomPass.threshold = 1.65;
    } else if (preset === 'alpine-day') {
      this.scene.background = new THREE.Color('#4F8CC8');
      this.scene.fog = new THREE.FogExp2('#719AC2', 0.00022);
      this.hemiLight.color.set('#CBE2FA');
      this.hemiLight.groundColor.set('#1E311B');
      this.hemiLight.intensity = 0.44;
      this.sunLight.color.set('#FFF5E4');
      this.sunLight.intensity = 1.60;
      this.renderer.toneMappingExposure = 0.82;
      this.bloomPass.strength = 0.10;
      this.bloomPass.radius = 0.25;
      this.bloomPass.threshold = 1.65;
    } else {
      // British day (Silverstone)
      this.scene.background = new THREE.Color('#6D8FAD');
      this.scene.fog = new THREE.FogExp2('#7B8FA3', 0.00026);
      this.hemiLight.color.set('#CDDCEB');
      this.hemiLight.groundColor.set('#1E2C1C');
      this.hemiLight.intensity = 0.48;
      this.sunLight.color.set('#F4EFE2');
      this.sunLight.intensity = 1.38;
      this.renderer.toneMappingExposure = 0.82;
      this.bloomPass.strength = 0.10;
      this.bloomPass.radius = 0.25;
      this.bloomPass.threshold = 1.65;
    }

    this.updateEnvironmentMap(preset);
  }

  enterMenuShowroom(driver: DriverConfig, yahiaTeamId: TeamId): void {
    this.clearPodium();
    this.clearWorld();

    this.setSunShadowFrustum(6.5, 2, 45);

    this.scene.background = new THREE.Color('#090B12');
    this.scene.fog = new THREE.FogExp2('#090B12', 0.024);
    this.hemiLight.color.set('#DCEBFF');
    this.hemiLight.groundColor.set('#181E2B');
    this.hemiLight.intensity = 0.85;
    this.sunLight.color.set('#FFFFFF');
    this.sunLight.position.set(12, 18, 10);
    this.sunLight.target.position.set(0, 0.5, 0);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.intensity = 2.1;
    this.renderer.toneMappingExposure = 0.98;
    this.bloomPass.strength = 0.18;
    this.bloomPass.threshold = 1.25;

    this.updateEnvironmentMap('showroom');

    if (!this.showroomGroup) {
      this.showroomGroup = new THREE.Group();
      const podium = new THREE.Mesh(
        new THREE.CylinderGeometry(4.1, 4.4, 0.25, 64),
        new THREE.MeshStandardMaterial({
          color: '#151923',
          metalness: 0.72,
          roughness: 0.22,
        }),
      );
      podium.position.y = -0.14;
      podium.receiveShadow = true;
      this.showroomGroup.add(podium);

      const glowRing = new THREE.Mesh(
        new THREE.RingGeometry(4.05, 4.22, 64),
        new THREE.MeshStandardMaterial({
          color: '#E10600',
          emissive: '#E10600',
          emissiveIntensity: 1.8,
          side: THREE.DoubleSide,
        }),
      );
      glowRing.rotation.x = -Math.PI / 2;
      glowRing.position.y = -0.01;
      this.showroomGroup.add(glowRing);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        new THREE.MeshStandardMaterial({ color: '#0B0D14', roughness: 0.55, metalness: 0.35 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.26;
      floor.receiveShadow = true;
      this.showroomGroup.add(floor);

      this.scene.add(this.showroomGroup);
    }

    if (this.showroomCar) {
      this.showroomGroup.remove(this.showroomCar.root);
      this.showroomCar.dispose();
    }

    this.showroomCar = buildF1CarMesh(driver, yahiaTeamId, 'soft');
    this.showroomCar.root.position.set(0, 0, 0);
    this.showroomGroup.add(this.showroomCar.root);
  }

  clearShowroom(): void {
    if (this.showroomCar && this.showroomGroup) {
      this.showroomGroup.remove(this.showroomCar.root);
      this.showroomCar.dispose();
      this.showroomCar = null;
    }
    if (this.showroomGroup) {
      this.scene.remove(this.showroomGroup);
      this.showroomGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (!o.userData.sharedGlbGeometry) o.geometry.dispose();
          if (Array.isArray(o.material)) {
            o.material.forEach((m) => m.dispose());
          } else {
            o.material.dispose();
          }
        }
      });
      this.showroomGroup = null;
    }
  }

  private createPodiumNumberTexture(rank: string, accentHex: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0D111C';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 236, 236);
    ctx.fillStyle = accentHex;
    ctx.font = '900 148px "Titillium Web", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rank, 128, 134);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.podiumTextures.push(tex);
    return tex;
  }

  private createPodiumBackdropTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 1024, 256);
    grad.addColorStop(0, '#0B0F1A');
    grad.addColorStop(0.5, '#191E2E');
    grad.addColorStop(1, '#0B0F1A');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#E10600';
    ctx.fillRect(0, 0, 1024, 18);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(0, 238, 1024, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 66px "Titillium Web", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FORMULA 1 · GRAND PRIX PODIUM', 512, 108);
    ctx.fillStyle = '#FFD700';
    ctx.font = '800 32px "Titillium Web", Arial, sans-serif';
    ctx.fillText('2026 WORLD TOUR CHAMPIONS CEREMONY', 512, 178);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.podiumTextures.push(tex);
    return tex;
  }

  private createPodiumDriverPlaqueTexture(
    driver: DriverConfig,
    yahiaTeamId: TeamId,
    rank: '1' | '2' | '3',
    trimColor: string,
  ): THREE.CanvasTexture {
    const team = resolveDriverTeam(driver, yahiaTeamId);
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.podiumTextures.push(tex);

    const drawCard = (img: HTMLImageElement | null) => {
      ctx.fillStyle = '#0B101C';
      ctx.fillRect(0, 0, 384, 512);

      // Outer metallic rank border & top team accent stripe
      ctx.strokeStyle = trimColor;
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, 374, 502);
      ctx.fillStyle = team.primaryColor;
      ctx.fillRect(10, 10, 364, 56);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 28px "Titillium Web", "Arial Black", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`P${rank}${rank === '1' ? ' WINNER' : ''}`, 24, 38);

      ctx.fillStyle = trimColor;
      ctx.font = '900 28px "Titillium Web", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`#${driver.number}`, 360, 38);

      // Center portrait frame
      ctx.fillStyle = '#141B2D';
      ctx.fillRect(24, 78, 336, 326);
      if (img && img.width > 0 && img.height > 0) {
        const aspect = img.width / img.height;
        const targetW = 336;
        const targetH = 326;
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;
        if (aspect > targetW / targetH) {
          sw = img.height * (targetW / targetH);
          sx = (img.width - sw) * 0.5;
        } else {
          sh = img.width / (targetW / targetH);
          sy = (img.height - sh) * 0.15;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 24, 78, targetW, targetH);
      } else {
        // Stylized helmet silhouette fallback while async portrait loads
        ctx.fillStyle = team.primaryColor;
        ctx.beginPath();
        ctx.arc(192, 242, 86, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '900 68px "Titillium Web", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(driver.code, 192, 246);
      }

      // Bottom driver flag, name & constructor bar (drawn via Canvas primitives so Windows renders flags cleanly)
      ctx.fillStyle = '#090D16';
      ctx.fillRect(10, 412, 364, 90);
      drawFlagOnCanvas(ctx, driver.flag, 24, 430, 34, 22);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 26px "Titillium Web", "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(driver.name.toUpperCase(), 210, 444);
      ctx.fillStyle = trimColor;
      ctx.font = '800 20px "Titillium Web", Arial, sans-serif';
      ctx.fillText(team.shortName.toUpperCase(), 192, 480);
      tex.needsUpdate = true;
    };

    drawCard(null);

    if (typeof Image !== 'undefined') {
      const pose = driver.isFlexStar ? (rank === '1' ? 'victory' : 'podium') : 'grid';
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => drawCard(img);
      img.src = getDriverPortraitPath(driver, yahiaTeamId, pose);
    }

    return tex;
  }

  /** Builds a live 3D Grand Prix Podium Ceremony stage with P1/P2/P3 driver characters, portraits, car, trophies & champagne spray. */
  enterPodiumCeremony(
    winnerDriver: DriverConfig,
    yahiaTeamId: TeamId,
    podiumTeamColors: [string, string, string],
    podiumDrivers?: [DriverConfig?, DriverConfig?, DriverConfig?],
  ): void {
    this.clearShowroom();
    this.clearWorld();
    this.clearPodium();

    this.setSunShadowFrustum(14, 2, 55);
    this.scene.background = new THREE.Color('#070A14');
    this.scene.fog = new THREE.FogExp2('#070A14', 0.016);
    this.hemiLight.color.set('#EBF4FF');
    this.hemiLight.groundColor.set('#181E2E');
    this.hemiLight.intensity = 0.85;
    this.sunLight.color.set('#FFF6E0');
    this.sunLight.position.set(10, 20, 14);
    this.sunLight.target.position.set(0, 1.2, 0);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.intensity = 2.3;
    this.renderer.toneMappingExposure = 1.00;
    this.bloomPass.strength = 0.24;
    this.bloomPass.threshold = 1.15;
    this.updateEnvironmentMap('showroom');

    const grp = new THREE.Group();
    this.podiumGroup = grp;

    // 1. Reflective Parc Fermé Ceremonial Floor + Glowing Gold/Red Stage Rings
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ color: '#0A0D16', roughness: 0.32, metalness: 0.55 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    grp.add(floor);

    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(5.6, 5.82, 72),
      new THREE.MeshStandardMaterial({
        color: '#FFD700',
        emissive: '#FFD700',
        emissiveIntensity: 1.9,
        side: THREE.DoubleSide,
      }),
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.set(0, 0.015, 0.8);
    grp.add(outerRing);

    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(4.2, 4.35, 72),
      new THREE.MeshStandardMaterial({
        color: '#E10600',
        emissive: '#E10600',
        emissiveIntensity: 1.7,
        side: THREE.DoubleSide,
      }),
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.set(0, 0.018, 2.2);
    grp.add(innerRing);

    // 2. Illuminated 3-Tier F1 Podium Steps + Articulated P1/P2/P3 Driver Characters + Portrait Plaques
    const resolvedDrivers = resolvePodiumDrivers(winnerDriver, podiumDrivers);
    const stepConfigs: {
      rank: '1' | '2' | '3';
      x: number;
      h: number;
      w: number;
      trim: string;
      driver: DriverConfig;
      teamCol: string;
    }[] = [
      {
        rank: '1',
        x: 0,
        h: 1.55,
        w: 2.3,
        trim: '#FFD700',
        driver: resolvedDrivers[0],
        teamCol: podiumTeamColors[0] || resolveDriverTeam(resolvedDrivers[0], yahiaTeamId).primaryColor,
      },
      {
        rank: '2',
        x: -2.45,
        h: 1.05,
        w: 2.05,
        trim: '#CBD5E1',
        driver: resolvedDrivers[1],
        teamCol: podiumTeamColors[1] || resolveDriverTeam(resolvedDrivers[1], yahiaTeamId).primaryColor,
      },
      {
        rank: '3',
        x: 2.45,
        h: 0.72,
        w: 2.05,
        trim: '#D97706',
        driver: resolvedDrivers[2],
        teamCol: podiumTeamColors[2] || resolveDriverTeam(resolvedDrivers[2], yahiaTeamId).primaryColor,
      },
    ];
    const stepBaseMat = new THREE.MeshStandardMaterial({
      color: '#141926',
      metalness: 0.65,
      roughness: 0.25,
    });

    for (const sc of stepConfigs) {
      const dais = new THREE.Mesh(new THREE.BoxGeometry(sc.w, sc.h, 2.1), stepBaseMat);
      dais.position.set(sc.x, sc.h * 0.5, -2.5);
      dais.castShadow = true;
      dais.receiveShadow = true;
      grp.add(dais);

      // Glowing top rim in Gold/Silver/Bronze
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(sc.w + 0.08, 0.09, 2.18),
        new THREE.MeshStandardMaterial({
          color: sc.trim,
          emissive: sc.trim,
          emissiveIntensity: 1.4,
          metalness: 0.8,
          roughness: 0.2,
        }),
      );
      rim.position.set(sc.x, sc.h + 0.02, -2.5);
      grp.add(rim);

      // Front illuminated rank plaque ("1", "2", "3")
      const numTex = this.createPodiumNumberTexture(sc.rank, sc.trim);
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 0.95),
        new THREE.MeshStandardMaterial({
          map: numTex,
          emissiveMap: numTex,
          emissive: '#FFFFFF',
          emissiveIntensity: 0.75,
          roughness: 0.3,
        }),
      );
      plaque.position.set(sc.x, Math.max(0.42, sc.h * 0.5), -1.43);
      grp.add(plaque);

      // Team-colored vertical light pillar behind each step
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 4.9, 0.18),
        new THREE.MeshStandardMaterial({
          color: sc.teamCol,
          emissive: sc.teamCol,
          emissiveIntensity: 1.6,
        }),
      );
      pillar.position.set(sc.x, 2.45, -3.82);
      grp.add(pillar);

      // Illuminated 3D Driver Portrait & Name Broadcast Plaque mounted right behind the driver
      const portraitTex = this.createPodiumDriverPlaqueTexture(
        sc.driver,
        yahiaTeamId,
        sc.rank,
        sc.trim,
      );
      const portraitFrame = new THREE.Mesh(
        new THREE.BoxGeometry(1.48, 1.96, 0.08),
        new THREE.MeshStandardMaterial({
          map: portraitTex,
          emissiveMap: portraitTex,
          emissive: '#FFFFFF',
          emissiveIntensity: 0.78,
          roughness: 0.28,
        }),
      );
      portraitFrame.name = `podium-plaque-${sc.rank}`;
      portraitFrame.position.set(sc.x, sc.h + 1.24, -3.52);
      grp.add(portraitFrame);

      // Articulated 3D Driver Character standing proudly atop their podium step
      const driverRig = buildPodiumDriverCharacter(
        sc.driver,
        yahiaTeamId,
        sc.rank,
        sc.trim,
        sc.h + 0.05,
      );
      driverRig.group.position.set(sc.x, driverRig.baseY, -2.35);
      grp.add(driverRig.group);
      this.podiumCharacters.push(driverRig);
      this.podiumTrophies.push(driverRig.trophyGroup);
    }

    // 3. Illuminated Grand Prix Podium Backdrop Arch raised cleanly above P1 trophy & plaques
    const backdropTex = this.createPodiumBackdropTexture();
    const backdrop = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 2.0, 0.28),
      new THREE.MeshStandardMaterial({
        map: backdropTex,
        emissiveMap: backdropTex,
        emissive: '#FFFFFF',
        emissiveIntensity: 0.55,
        roughness: 0.35,
      }),
    );
    backdrop.position.set(0, 4.75, -3.95);
    grp.add(backdrop);

    // 4. Sweeping Stadium Searchlight Beams behind the podium
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#FFE4A0',
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const bx of [-4.2, 0, 4.2]) {
      const beamPivot = new THREE.Group();
      beamPivot.position.set(bx, 0.1, -5.2);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 16, 16, 1, true), beamMat);
      cone.position.y = 8;
      cone.rotation.x = Math.PI;
      beamPivot.add(cone);
      grp.add(beamPivot);
      this.podiumBeams.push(beamPivot);
    }

    // 5. Hero 3D P1 Winning F1 Car parked in Parc Fermé right in front of the podium!
    this.podiumCar = buildF1CarMesh(resolvedDrivers[0], yahiaTeamId, 'soft');
    this.podiumCar.root.position.set(0, 0, 2.3);
    this.podiumCar.root.rotation.y = 0.44;
    grp.add(this.podiumCar.root);

    // 6. 320 Animated 3D Metallic Confetti Pieces raining across the stage
    const confettiCount = 320;
    const confettiGeo = new THREE.PlaneGeometry(0.11, 0.18);
    const confettiMat = new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      metalness: 0.65,
      roughness: 0.25,
      side: THREE.DoubleSide,
    });
    const confettiMesh = new THREE.InstancedMesh(confettiGeo, confettiMat, confettiCount);
    const confettiColors = ['#FFD700', '#E10600', '#FFFFFF', '#00E5FF', podiumTeamColors[0]];
    const tmpCol = new THREE.Color();
    this.podiumConfettiData = [];
    for (let i = 0; i < confettiCount; i++) {
      this.podiumConfettiData.push({
        x: (Math.random() - 0.5) * 14,
        y: Math.random() * 8 + 0.5,
        z: (Math.random() - 0.5) * 10 - 0.5,
        vy: 0.9 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
        speed: 1.5 + Math.random() * 2.5,
      });
      tmpCol.set(confettiColors[i % confettiColors.length]);
      confettiMesh.setColorAt(i, tmpCol);
    }
    if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;
    grp.add(confettiMesh);
    this.podiumConfettiMesh = confettiMesh;

    // 7. 140 Animated 3D Champagne Spray Droplets arcing from the P1, P2 & P3 drivers' magnum bottles
    const dropCount = 140;
    const dropGeo = new THREE.SphereGeometry(0.036, 6, 6);
    const dropMat = new THREE.MeshBasicMaterial({
      color: '#FFF8DC',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const champagneMesh = new THREE.InstancedMesh(dropGeo, dropMat, dropCount);
    this.podiumChampagneData = [];
    const spraySources: [number, number, number, number][] = [
      [0.26, 3.05, -1.78, 0],        // P1 bottle nozzle
      [-2.19, 2.55, -1.78, 0.38],    // P2 bottle nozzle arcing inward
      [2.71, 2.22, -1.78, -0.38],    // P3 bottle nozzle arcing inward
    ];
    for (let i = 0; i < dropCount; i++) {
      const [ox, oy, oz, biasX] = spraySources[i % spraySources.length];
      const life = 0.75 + Math.random() * 0.65;
      this.podiumChampagneData.push({
        originX: ox,
        originY: oy,
        originZ: oz,
        vx: biasX * 2.6 + (Math.random() - 0.5) * 1.5,
        vy: 2.8 + Math.random() * 2.4,
        vz: 1.8 + Math.random() * 2.2,
        t: Math.random() * life,
        life,
      });
    }
    grp.add(champagneMesh);
    this.podiumChampagneMesh = champagneMesh;

    this.scene.add(grp);
  }

  clearPodium(): void {
    if (this.podiumCar && this.podiumGroup) {
      this.podiumGroup.remove(this.podiumCar.root);
      this.podiumCar.dispose();
      this.podiumCar = null;
    }
    for (const tex of this.podiumTextures) {
      tex.dispose();
    }
    this.podiumTextures = [];
    this.podiumTrophies = [];
    this.podiumCharacters = [];
    this.podiumBeams = [];
    this.podiumConfettiMesh = null;
    this.podiumConfettiData = [];
    this.podiumChampagneMesh = null;
    this.podiumChampagneData = [];

    if (this.podiumGroup) {
      this.scene.remove(this.podiumGroup);
      this.podiumGroup.traverse((o) => {
        if (o instanceof THREE.Mesh && !o.userData.sharedGlbGeometry) {
          o.geometry.dispose();
          if (Array.isArray(o.material)) {
            o.material.forEach((m) => m.dispose());
          } else {
            o.material.dispose();
          }
        }
      });
      this.podiumGroup = null;
    }
  }

  private updatePodiumAnimations(clockSec: number): void {
    // Celebrate on podium: subtle celebratory bounce, torso sway, trophy hoist & champagne shake
    for (let i = 0; i < this.podiumCharacters.length; i++) {
      const ch = this.podiumCharacters[i];
      const t = clockSec * 3.2 + ch.phase;
      ch.group.position.y = ch.baseY + Math.abs(Math.sin(t)) * 0.045;
      ch.group.rotation.y = Math.sin(clockSec * 1.1 + ch.phase) * 0.14;
      ch.rightArm.rotation.x = (i === 0 ? -2.28 : -1.85) + Math.sin(clockSec * 2.4 + ch.phase) * 0.16;
      ch.leftArm.rotation.x = -1.22 + Math.sin(clockSec * 5.8 + ch.phase) * 0.14;
    }

    // Gentle celebratory turn of the hoisted trophies
    for (let i = 0; i < this.podiumTrophies.length; i++) {
      this.podiumTrophies[i].rotation.y = Math.sin(clockSec * 1.4 + i * 1.1) * 0.45;
    }

    // Sway stadium searchlights
    for (let i = 0; i < this.podiumBeams.length; i++) {
      this.podiumBeams[i].rotation.z = Math.sin(clockSec * 0.75 + i * 1.6) * 0.35;
      this.podiumBeams[i].rotation.x = 0.22 + Math.cos(clockSec * 0.55 + i) * 0.14;
    }

    // Animate fluttering 3D confetti rain
    if (this.podiumConfettiMesh) {
      const dummy = this.podiumDummy;
      for (let i = 0; i < this.podiumConfettiData.length; i++) {
        const c = this.podiumConfettiData[i];
        const y = ((c.y - clockSec * c.vy) % 8.5 + 8.5) % 8.5;
        const sway = Math.sin(clockSec * c.speed + c.phase) * 0.55;
        dummy.position.set(c.x + sway, y, c.z + Math.cos(clockSec * c.speed * 0.8 + c.phase) * 0.35);
        dummy.rotation.set(clockSec * c.speed * 1.8 + c.phase, clockSec * c.speed * 1.2, c.phase);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.podiumConfettiMesh.setMatrixAt(i, dummy.matrix);
      }
      this.podiumConfettiMesh.instanceMatrix.needsUpdate = true;
    }

    // Animate sparkling champagne spray arcs with gravity
    if (this.podiumChampagneMesh) {
      const dummy = this.podiumDummy;
      for (let i = 0; i < this.podiumChampagneData.length; i++) {
        const d = this.podiumChampagneData[i];
        const age = (d.t + clockSec) % d.life;
        const frac = age / d.life;
        const px = d.originX + d.vx * age;
        const py = Math.max(0.05, d.originY + d.vy * age - 4.9 * age * age);
        const pz = d.originZ + d.vz * age;
        const sc = Math.max(0.15, (1 - frac) * 1.35);
        dummy.position.set(px, py, pz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        this.podiumChampagneMesh.setMatrixAt(i, dummy.matrix);
      }
      this.podiumChampagneMesh.instanceMatrix.needsUpdate = true;
    }
  }

  setRaceWorldGroup(worldGroup: THREE.Group): void {
    this.clearShowroom();
    this.clearPodium();
    this.clearWorld();
    this.activeWorldGroup = worldGroup;
    this.scene.add(worldGroup);
  }

  clearWorld(): void {
    if (this.activeWorldGroup) {
      this.scene.remove(this.activeWorldGroup);
      this.activeWorldGroup = null;
    }
  }

  updateSunFollow(x: number, y: number, z: number): void {
    this.sunLight.position.set(x + 95, y + 145, z + 70);
    this.sunLight.target.position.set(x, y, z);
    this.sunLight.target.updateMatrixWorld();
  }

  render(clockSec: number, inMenu: boolean): void {
    if (inMenu) {
      if (this.podiumGroup) {
        this.updatePodiumAnimations(clockSec);
        this.cameraRig.updatePodiumStage(clockSec);
      } else if (this.showroomCar) {
        this.showroomCar.root.rotation.y = clockSec * 0.28;
        const isMobileUI =
          typeof document !== 'undefined' &&
          (document.body?.classList.contains('is-mobile-ui') ?? false);
        this.cameraRig.updateMenuShowroom(clockSec, isMobileUI);
      }
    }
    this.composer.render();
  }

  dispose(): void {
    this.clearShowroom();
    this.clearPodium();
    this.clearWorld();
    for (const cached of this.hdriCache.values()) {
      cached.bgTex.dispose();
      cached.envRt.dispose();
    }
    this.hdriCache.clear();
    if (this.fallbackEnvRt) {
      this.fallbackEnvRt.dispose();
      this.fallbackEnvRt = null;
    }
    this.composer.dispose();
    this.pmremGenerator.dispose();
    this.renderer.dispose();
  }
}
