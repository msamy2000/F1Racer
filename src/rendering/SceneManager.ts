import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { AtmospherePreset } from '../data/circuits';
import type { DriverConfig, TeamId } from '../data/teamsAndDrivers';
import { CameraRig } from './CameraRig';
import { buildF1CarMesh, type CarMeshRig } from './CarMeshBuilder';

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
          o.geometry.dispose();
          if (!Array.isArray(o.material)) o.material.dispose();
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

  /** Builds a live 3D Grand Prix Podium Ceremony stage with P1 car, trophies, confetti & champagne spray. */
  enterPodiumCeremony(
    winnerDriver: DriverConfig,
    yahiaTeamId: TeamId,
    podiumTeamColors: [string, string, string],
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

    // 2. Illuminated 3-Tier F1 Podium Steps (P2 Left, P1 Center Gold, P3 Right Bronze)
    const stepConfigs = [
      { rank: '1', x: 0, h: 1.55, w: 2.3, trim: '#FFD700', teamCol: podiumTeamColors[0] },
      { rank: '2', x: -2.45, h: 1.05, w: 2.05, trim: '#CBD5E1', teamCol: podiumTeamColors[1] },
      { rank: '3', x: 2.45, h: 0.72, w: 2.05, trim: '#D97706', teamCol: podiumTeamColors[2] },
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
        new THREE.BoxGeometry(0.18, 4.4, 0.18),
        new THREE.MeshStandardMaterial({
          color: sc.teamCol,
          emissive: sc.teamCol,
          emissiveIntensity: 1.6,
        }),
      );
      pillar.position.set(sc.x, 2.2, -3.75);
      grp.add(pillar);

      // Sculpted Metallic 3D Grand Prix Trophy on top of each podium step
      const trophy = new THREE.Group();
      trophy.position.set(sc.x, sc.h + 0.08, -2.5);
      const trophyMat = new THREE.MeshPhysicalMaterial({
        color: sc.trim,
        metalness: 0.96,
        roughness: 0.12,
        clearcoat: 1.0,
        envMapIntensity: 2.0,
      });
      const basePed = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.14, 20), stepBaseMat);
      basePed.position.y = 0.07;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, 0.28, 16), trophyMat);
      stem.position.y = 0.28;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.1, 0.34, 24), trophyMat);
      cup.position.y = 0.56;
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 10, 24), trophyMat);
      crown.rotation.x = Math.PI / 2;
      crown.position.y = 0.72;
      trophy.add(basePed, stem, cup, crown);
      if (sc.rank === '1') trophy.scale.set(1.22, 1.28, 1.22);
      grp.add(trophy);
      this.podiumTrophies.push(trophy);
    }

    // 3. Illuminated Grand Prix Podium Backdrop Arch
    const backdropTex = this.createPodiumBackdropTexture();
    const backdrop = new THREE.Mesh(
      new THREE.BoxGeometry(9.2, 2.2, 0.28),
      new THREE.MeshStandardMaterial({
        map: backdropTex,
        emissiveMap: backdropTex,
        emissive: '#FFFFFF',
        emissiveIntensity: 0.55,
        roughness: 0.35,
      }),
    );
    backdrop.position.set(0, 3.85, -3.95);
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
    this.podiumCar = buildF1CarMesh(winnerDriver, yahiaTeamId, 'soft');
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

    // 7. 140 Animated 3D Champagne Spray Droplets arcing from P1, P2 & P3 steps
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
      [0, 2.3, -2.35, 0],        // P1 center fountain
      [-2.45, 1.8, -2.35, 0.35], // P2 left arcing inward
      [2.45, 1.45, -2.35, -0.35], // P3 right arcing inward
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
    // Rotate trophies gently
    for (let i = 0; i < this.podiumTrophies.length; i++) {
      this.podiumTrophies[i].rotation.y = clockSec * 0.9 + i * 1.1;
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
