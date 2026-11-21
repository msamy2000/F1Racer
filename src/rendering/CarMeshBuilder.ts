import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  resolveDriverHelmet,
  resolveDriverTeam,
  type DriverConfig,
  type TeamId,
} from '../data/teamsAndDrivers';
import { TIRE_SPECS, type CarState, type TireCompound } from '../engine/CarPhysics';
import { getCarbonFiberTexture } from './TextureLibrary';

let cachedGlbTemplate: THREE.Group | null = null;
let cachedGlbMinY = 0;
let glbLoadPromise: Promise<void> | null = null;

/**
 * Preload the CC BY 4.0 Formula F226 3D F1 car model (by CarlosCG31) once at startup.
 * Safe no-op in headless/Node test environments.
 */
export function preloadF1CarModel(): Promise<void> {
  if (cachedGlbTemplate) return Promise.resolve();
  if (glbLoadPromise) return glbLoadPromise;
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return Promise.resolve();
  }

  glbLoadPromise = new Promise<void>((resolve) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      './assets/models/f1-2026-car.glb',
      (gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        cachedGlbMinY = Number.isFinite(box.min.y) ? box.min.y : 0;
        scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.userData.sharedGlbGeometry = true;
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        cachedGlbTemplate = scene;
        resolve();
      },
      undefined,
      () => {
        // Fallback to procedural car mesh if GLB fails to load
        resolve();
      },
    );
  });

  return glbLoadPromise;
}

export function hasLoadedGlbCarModel(): boolean {
  return cachedGlbTemplate !== null;
}

export interface CarMeshRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  frontAeroFlap: THREE.Mesh;
  rearAeroFlap: THREE.Mesh;
  frontLeftSteer: THREE.Group;
  frontRightSteer: THREE.Group;
  wheelSpinMeshes: THREE.Object3D[];
  tireRingMaterials: THREE.MeshStandardMaterial[];
  brakeGlowMaterials: THREE.MeshStandardMaterial[];
  rearLedMaterial: THREE.MeshStandardMaterial;
  currentCompound: TireCompound;
  setCockpitView(isCockpit: boolean): void;
  updateFromState(state: CarState, clockSec: number): void;
  setTireCompound(compound: TireCompound): void;
  dispose(): void;
}

function createContactAOTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);

  ctx.save();
  ctx.translate(64, 128);
  ctx.scale(0.88, 1.85);
  const grad = ctx.createRadialGradient(0, 0, 12, 0, 0, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.58)');
  grad.addColorStop(0.82, 'rgba(0, 0, 0, 0.18)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addSuspensionStrut(
  parent: THREE.Object3D,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  radius: number,
  mat: THREE.Material,
): void {
  const p1 = new THREE.Vector3(x1, y1, z1);
  const p2 = new THREE.Vector3(x2, y2, z2);
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  if (len < 1e-4) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
  mesh.position.addVectors(p1, p2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(mesh);
}

function createNumberDecalTexture(num: number, textColor: string, bgColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = textColor;
  ctx.font = '900 74px "Titillium Web", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let cachedExhaustMetalTex: THREE.CanvasTexture | null = null;

function getExhaustMetalTexture(): THREE.CanvasTexture | null {
  if (cachedExhaustMetalTex) return cachedExhaustMetalTex;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Heat-treated Inconel titanium gradient from base -> straw gold -> violet-blue tip
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#727986');
  grad.addColorStop(0.38, '#8d8c86');
  grad.addColorStop(0.62, '#b39562');
  grad.addColorStop(0.78, '#8a627f');
  grad.addColorStop(0.92, '#495c8f');
  grad.addColorStop(1.0, '#2c3448');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);

  // Subtle machined weld seam rings
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, 86, 64, 3);
  ctx.fillRect(0, 168, 64, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 89, 64, 2);
  ctx.fillRect(0, 171, 64, 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedExhaustMetalTex = tex;
  return tex;
}

function createSteeringDashDisplay(teamAccent: string): {
  texture: THREE.CanvasTexture;
  update: (state: CarState) => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  let lastKey = '';

  const update = (state: CarState) => {
    const kmh = Math.round(Math.abs(state.speed) * 3.6);
    const gearStr = state.gear < 0 ? 'R' : state.gear === 0 ? 'N' : String(state.gear);
    const ersPct = Math.round(THREE.MathUtils.clamp(state.ersBattery * 100, 0, 100));
    const aeroStr = state.activeAeroOpen > 0.5 ? 'X-MODE' : 'Z-MODE';
    const rpmFrac = THREE.MathUtils.clamp((state.rpm - 4000) / 9000, 0, 1);
    const key = `${gearStr}|${kmh}|${Math.round(ersPct / 2)}|${aeroStr}|${state.boostActive ? 1 : 0}|${Math.round(rpmFrac * 15)}`;
    if (key === lastKey) return;
    lastKey = key;

    // Deep OLED black-navy background
    ctx.fillStyle = '#070A12';
    ctx.fillRect(0, 0, 256, 160);

    // Top RPM bar
    const rpmW = Math.round(rpmFrac * 236);
    ctx.fillStyle = '#182032';
    ctx.fillRect(10, 8, 236, 12);
    ctx.fillStyle = rpmFrac > 0.85 ? '#38BDF8' : rpmFrac > 0.65 ? '#EF4444' : '#10B981';
    ctx.fillRect(10, 8, rpmW, 12);

    // Center big Gear digit
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 72px "Titillium Web", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gearStr, 128, 72);

    // Left: Speed (KM/H)
    ctx.fillStyle = '#94A3B8';
    ctx.font = '700 13px "Titillium Web", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('KM/H', 14, 42);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '900 30px "Titillium Web", Arial, sans-serif';
    ctx.fillText(String(kmh), 14, 70);

    // Right: Active Aero & Boost badge
    ctx.fillStyle = state.boostActive ? '#00E5FF' : teamAccent;
    ctx.fillRect(172, 34, 72, 24);
    ctx.fillStyle = '#05070D';
    ctx.font = '900 13px "Titillium Web", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.boostActive ? 'BOOST' : aeroStr, 208, 47);

    // Right lower: Tire temp
    ctx.fillStyle = '#94A3B8';
    ctx.font = '700 12px "Titillium Web", Arial, sans-serif';
    ctx.fillText('TYRE', 208, 74);
    ctx.fillStyle = '#FACC15';
    ctx.font = '800 18px "Titillium Web", Arial, sans-serif';
    ctx.fillText(`${Math.round(state.tireTemp)}°C`, 208, 92);

    // Bottom ERS Battery bar
    ctx.fillStyle = '#182032';
    ctx.fillRect(12, 122, 232, 24);
    ctx.fillStyle = state.boostActive ? '#00E5FF' : '#22C55E';
    ctx.fillRect(12, 122, Math.round((ersPct / 100) * 232), 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 14px "Titillium Web", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`ERS  ${ersPct}%`, 128, 135);

    texture.needsUpdate = true;
  };

  return { texture, update };
}

function buildGlbF1CarMesh(
  driver: DriverConfig,
  yahiaFlexTeam: TeamId | undefined,
  initialCompound: TireCompound,
  template: THREE.Group,
): CarMeshRig {
  const team = resolveDriverTeam(driver, yahiaFlexTeam);
  const helmet = resolveDriverHelmet(driver, yahiaFlexTeam);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // Soft Contact AO shadow decal beneath car on asphalt (kept level against car roll)
  const aoTex = createContactAOTexture();
  const aoPivot = new THREE.Group();
  root.add(aoPivot);
  const contactAo = new THREE.Mesh(
    new THREE.PlaneGeometry(2.35, 5.45),
    new THREE.MeshBasicMaterial({
      map: aoTex,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  contactAo.rotation.x = -Math.PI / 2;
  contactAo.position.set(0, 0.015, -0.05);
  aoPivot.add(contactAo);

  // Align GLB (-X nose, +Z left, +Y up) -> game (+Z nose, +X left, +Y up)
  const glbAlign = new THREE.Group();
  glbAlign.rotation.y = Math.PI / 2;
  glbAlign.position.y = -cachedGlbMinY;
  bodyGroup.add(glbAlign);

  const model = template.clone(true);
  glbAlign.add(model);

  const carbonTex = getCarbonFiberTexture();
  const ownedMaterials: THREE.Material[] = [];
  const trackMat = <T extends THREE.Material>(m: T): T => {
    ownedMaterials.push(m);
    return m;
  };

  const primaryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: team.primaryColor,
      metalness: team.id === 'mercedes' ? 0.62 : team.id === 'redbull' ? 0.24 : 0.36,
      roughness: team.id === 'redbull' ? 0.28 : 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.05,
    }),
  );

  const secondaryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: team.secondaryColor,
      metalness: 0.45,
      roughness: 0.20,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.0,
    }),
  );

  const accentMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: team.accentColor,
      metalness: 0.35,
      roughness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.95,
    }),
  );

  const carbonMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#20242d',
      map: carbonTex ?? undefined,
      metalness: 0.28,
      roughness: 0.36,
      clearcoat: 0.45,
      clearcoatRoughness: 0.22,
      envMapIntensity: 0.85,
    }),
  );

  const metalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#8e98a8',
      metalness: 0.92,
      roughness: 0.22,
      envMapIntensity: 1.15,
    }),
  );

  const coverMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#1b1f27',
      metalness: 0.65,
      roughness: 0.28,
      envMapIntensity: 0.95,
    }),
  );

  const tyreMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#181a1f',
      metalness: 0.04,
      roughness: 0.78,
      envMapIntensity: 0.45,
    }),
  );

  const rearLedMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#FF1100',
      emissive: '#FF1A00',
      emissiveIntensity: 1.8,
      roughness: 0.18,
    }),
  );

  const screenMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#0D1320',
      emissive: '#00D4FF',
      emissiveIntensity: 0.9,
      roughness: 0.12,
      metalness: 0.2,
    }),
  );

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.userData.sharedGlbGeometry = true;

    const srcMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const matName = srcMat?.name ?? '';

    if (matName === 'BodyLivery') {
      obj.material = primaryMat;
    } else if (matName === 'AeroLivery') {
      obj.material = secondaryMat;
    } else if (matName === 'FrontEndplateLivery' || matName === 'RearEndplateLivery') {
      obj.material = accentMat;
    } else if (matName === 'FrontWingLivery' || matName === 'RearWingLivery') {
      obj.material = team.id === 'redbull' ? primaryMat : secondaryMat;
    } else if (matName.startsWith('Carbon')) {
      obj.material = carbonMat;
    } else if (matName === 'Metal') {
      obj.material = metalMat;
    } else if (matName === 'Cover') {
      obj.material = coverMat;
    } else if (matName === 'Tyre') {
      obj.material = tyreMat;
    } else if (matName === 'Redlight') {
      obj.material = rearLedMaterial;
    } else if (matName === 'Screen') {
      obj.material = screenMat;
    } else {
      obj.material = carbonMat;
    }
  });

  // Re-pivot all 4 wheel groups around their true axle center for clean spinning & front steering
  const tireRingMaterials: THREE.MeshStandardMaterial[] = [];
  const brakeGlowMaterials: THREE.MeshStandardMaterial[] = [];
  const wheelSpinMeshes: THREE.Object3D[] = [];

  const initialColor = TIRE_SPECS[initialCompound].color;
  const setupWheelPivot = (
    nodeName: string,
    isFront: boolean,
    isLeft: boolean,
  ): THREE.Group => {
    const wheelNode = model.getObjectByName(nodeName);
    const steerGroup = new THREE.Group();
    if (!wheelNode || !wheelNode.parent) {
      return steerGroup;
    }

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wheelNode);
    const centerWorld = box.getCenter(new THREE.Vector3());
    const parentInv = new THREE.Matrix4().copy(wheelNode.parent.matrixWorld).invert();
    const centerLocal = centerWorld.clone().applyMatrix4(parentInv);

    steerGroup.position.copy(centerLocal);
    const spinGroup = new THREE.Group();
    steerGroup.add(spinGroup);

    // Move children of wheelNode into spinGroup shifted by -centerLocal
    const children = [...wheelNode.children];
    for (const child of children) {
      child.position.sub(centerLocal);
      spinGroup.add(child);
    }

    // Add crisp Pirelli colored compound sidewall ring on outer face of each tire
    const ringMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: initialColor,
        emissive: initialColor,
        emissiveIntensity: 0.55,
        roughness: 0.35,
      }),
    );
    tireRingMaterials.push(ringMat);

    const outerSign = isLeft ? 1 : -1;
    const sidewallZ = outerSign * (isFront ? 0.165 : 0.21);
    const ringGeo = new THREE.RingGeometry(0.225, 0.258, 36);
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.z = sidewallZ;
    if (!isLeft) ringMesh.rotation.y = Math.PI;
    spinGroup.add(ringMesh);

    // Add glowing inner brake disc
    const brakeMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#2d3138',
        emissive: '#FF4500',
        emissiveIntensity: 0,
        metalness: 0.75,
        roughness: 0.32,
      }),
    );
    brakeGlowMaterials.push(brakeMat);
    const discMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24), brakeMat);
    discMesh.rotation.x = Math.PI / 2;
    discMesh.position.z = -outerSign * 0.12;
    steerGroup.add(discMesh);

    wheelNode.parent.add(steerGroup);
    wheelNode.parent.remove(wheelNode);
    wheelSpinMeshes.push(spinGroup);
    return steerGroup;
  };

  const frontLeftSteer = setupWheelPivot('front-left-wheel', true, true);
  const frontRightSteer = setupWheelPivot('front-right-wheel', true, false);
  setupWheelPivot('rear-left-wheel', false, true);
  setupWheelPivot('rear-right-wheel', false, false);

  // Hide low-detail GLB exhaust stub and static GLB steering wheel nodes — replaced with high-detail assemblies below
  const glbExhaustNode = model.getObjectByName('exhaust');
  if (glbExhaustNode) glbExhaustNode.visible = false;
  for (const staticWheelNodeName of ['Object_113', 'Object_115', 'Object_117', 'Object_119', 'Object_121']) {
    const n = model.getObjectByName(staticWheelNodeName);
    if (n) n.visible = false;
  }

  // === HIGH-DETAIL INCONEL TITANIUM F1 EXHAUST & TWIN WASTEGATE ASSEMBLY (Chase Cam Hero Detail) ===
  const exhaustGroup = new THREE.Group();
  exhaustGroup.position.set(0, 0.495, -2.14);
  bodyGroup.add(exhaustGroup);

  const exhaustTex = getExhaustMetalTexture();
  const inconelMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: '#d4d8e2',
      map: exhaustTex ?? undefined,
      metalness: 0.94,
      roughness: 0.2,
      clearcoat: 0.35,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.7,
    }),
  );
  const sootInnerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#08090c',
      roughness: 0.92,
      metalness: 0.15,
      side: THREE.BackSide,
    }),
  );
  const exhaustGlowMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#FF5A14',
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const exhaustFlameMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#38BDF8',
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  // Carbon-fiber heatshield collar around exhaust exit
  const exhaustCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.105, 0.14, 24, 1, true),
    carbonMat,
  );
  exhaustCollar.rotation.x = Math.PI / 2;
  exhaustCollar.position.z = 0.02;
  exhaustGroup.add(exhaustCollar);

  // Main central Inconel tailpipe (hollow outer wall + blackened inner bore + machined bevel lip)
  const mainPipeOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.056, 0.064, 0.42, 28, 1, true),
    inconelMat,
  );
  mainPipeOuter.rotation.x = Math.PI / 2;
  mainPipeOuter.position.z = -0.09;
  mainPipeOuter.castShadow = true;
  exhaustGroup.add(mainPipeOuter);

  const mainPipeInner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.051, 0.058, 0.41, 24, 1, true),
    sootInnerMat,
  );
  mainPipeInner.rotation.x = Math.PI / 2;
  mainPipeInner.position.z = -0.09;
  exhaustGroup.add(mainPipeInner);

  const mainPipeLip = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.0045, 10, 28), inconelMat);
  mainPipeLip.position.z = -0.30;
  exhaustGroup.add(mainPipeLip);

  // Internal glowing thermal core disc deep inside the tailpipe
  const thermalCore = new THREE.Mesh(new THREE.CircleGeometry(0.048, 20), exhaustGlowMat);
  thermalCore.rotation.y = Math.PI;
  thermalCore.position.z = -0.22;
  exhaustGroup.add(thermalCore);

  // Subtle recessed tapered exhaust flame cone (activates at high RPM / ERS boost)
  const flameCone = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.34, 16, 1, true), exhaustFlameMat);
  flameCone.rotation.x = -Math.PI / 2;
  flameCone.position.z = -0.44;
  exhaustGroup.add(flameCone);

  // Twin flanking wastegate pipes
  for (const side of [-1, 1] as const) {
    const wgOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.021, 0.024, 0.32, 18, 1, true),
      inconelMat,
    );
    wgOuter.rotation.x = Math.PI / 2;
    wgOuter.position.set(side * 0.078, -0.012, -0.05);
    exhaustGroup.add(wgOuter);

    const wgInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.021, 0.31, 14, 1, true),
      sootInnerMat,
    );
    wgInner.rotation.x = Math.PI / 2;
    wgInner.position.set(side * 0.078, -0.012, -0.05);
    exhaustGroup.add(wgInner);

    const wgLip = new THREE.Mesh(new THREE.TorusGeometry(0.0195, 0.0025, 8, 18), inconelMat);
    wgLip.position.set(side * 0.078, -0.012, -0.21);
    exhaustGroup.add(wgLip);
  }

  // Sculpted carbon diffuser vertical strakes beneath rear crash structure
  for (const sx of [-0.36, -0.18, 0.18, 0.36]) {
    const strake = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.19, 0.42), carbonMat);
    strake.position.set(sx, 0.14, -2.22);
    bodyGroup.add(strake);
  }

  // === HIGH-DETAIL ANIMATED F1 2026 COCKPIT INTERIOR & STEERING WHEEL ===
  const alcantaraMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#14171d',
      roughness: 0.94,
      metalness: 0.04,
    }),
  );
  const harnessMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: team.accentColor,
      roughness: 0.78,
      metalness: 0.06,
    }),
  );

  // Cockpit interior Alcantara side bolsters, dash cowl, steering column & harness straps
  const cockpitTrimGroup = new THREE.Group();
  bodyGroup.add(cockpitTrimGroup);

  // Matte carbon dash coaming cowl behind the steering wheel
  const dashCowl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.075, 0.24), carbonMat);
  dashCowl.position.set(0, 0.675, 0.76);
  dashCowl.rotation.x = 0.18;
  cockpitTrimGroup.add(dashCowl);

  // Carbon steering column shaft
  const steeringCol = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.22, 14), carbonMat);
  steeringCol.rotation.x = Math.PI / 2 - 0.18;
  steeringCol.position.set(0, 0.605, 0.72);
  cockpitTrimGroup.add(steeringCol);

  // Left & Right Alcantara cockpit headrest / shoulder padding bolsters
  for (const side of [-1, 1] as const) {
    const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.17, 0.46), alcantaraMat);
    bolster.position.set(side * 0.215, 0.60, 0.36);
    bolster.rotation.z = -side * 0.12;
    cockpitTrimGroup.add(bolster);

    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.014, 0.26), harnessMat);
    strap.position.set(side * 0.105, 0.54, 0.22);
    strap.rotation.x = 0.45;
    cockpitTrimGroup.add(strap);
  }

  // Animated F1 Butterfly Steering Wheel (rotates smoothly with steerAngle!)
  const steeringWheelGroup = new THREE.Group();
  steeringWheelGroup.position.set(0, 0.618, 0.635);
  steeringWheelGroup.rotation.x = -0.22;
  bodyGroup.add(steeringWheelGroup);

  // Central carbon faceplate + upper/lower wings
  const wheelCenterPlate = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.118, 0.022), carbonMat);
  steeringWheelGroup.add(wheelCenterPlate);

  const wheelTopBrow = new THREE.Mesh(new THREE.BoxGeometry(0.245, 0.026, 0.026), carbonMat);
  wheelTopBrow.position.set(0, 0.064, 0.002);
  steeringWheelGroup.add(wheelTopBrow);

  const wheelBottomBar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.022, 0.024), carbonMat);
  wheelBottomBar.position.set(0, -0.062, 0.002);
  steeringWheelGroup.add(wheelBottomBar);

  // Ergonomic Alcantara-wrapped left & right grips + carbon shift paddles behind wheel
  for (const side of [-1, 1] as const) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.135, 14), alcantaraMat);
    grip.position.set(side * 0.118, -0.002, -0.004);
    grip.rotation.z = side * 0.09;
    steeringWheelGroup.add(grip);

    const thumbGuard = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.026, 0.022), carbonMat);
    thumbGuard.position.set(side * 0.098, 0.028, 0.0);
    steeringWheelGroup.add(thumbGuard);

    const shiftPaddle = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.022, 0.006), carbonMat);
    shiftPaddle.position.set(side * 0.092, 0.015, 0.022);
    shiftPaddle.rotation.y = side * 0.18;
    steeringWheelGroup.add(shiftPaddle);
  }

  // LIVE Dynamic F1 OLED Telemetry Screen (faces driver at -Z!)
  const dashDisplay = createSteeringDashDisplay(team.accentColor);
  const oledScreenMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: dashDisplay.texture,
    }),
  );
  const oledScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.112, 0.068), oledScreenMat);
  oledScreen.position.set(0, 0.014, -0.0125);
  oledScreen.rotation.y = Math.PI;
  steeringWheelGroup.add(oledScreen);

  // 15 Live Emissive RPM Shift LEDs across top brow (5 Green -> 5 Red -> 5 Blue)
  const ledCount = 15;
  const steeringLedMaterials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < ledCount; i++) {
    const ledMat = trackMat(new THREE.MeshBasicMaterial({ color: '#1A202C' }));
    steeringLedMaterials.push(ledMat);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.0085, 0.0085, 0.006), ledMat);
    // In driver view (looking +Z), +X is left and -X is right -> place index 0 on left (+X) to 14 on right (-X)
    const t = i / (ledCount - 1);
    led.position.set(THREE.MathUtils.lerp(0.088, -0.088, t), 0.064, -0.013);
    steeringWheelGroup.add(led);
  }

  // 6 Color-Coded Rotary Dial Knobs & Push Buttons on lower steering faceplate
  const dialConfigs: { x: number; y: number; color: string; isKnob: boolean }[] = [
    { x: 0.045, y: -0.036, color: '#EF4444', isKnob: true },
    { x: 0.0, y: -0.038, color: '#FACC15', isKnob: true },
    { x: -0.045, y: -0.036, color: '#00E5FF', isKnob: true },
    { x: 0.072, y: 0.036, color: '#22C55E', isKnob: false },
    { x: -0.072, y: 0.036, color: '#F97316', isKnob: false },
    { x: 0.074, y: -0.006, color: '#38BDF8', isKnob: false },
    { x: -0.074, y: -0.006, color: '#F43F5E', isKnob: false },
  ];
  for (const d of dialConfigs) {
    const dMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: d.color,
        emissive: d.color,
        emissiveIntensity: 0.28,
        roughness: 0.35,
        metalness: 0.25,
      }),
    );
    const geo = d.isKnob
      ? new THREE.CylinderGeometry(0.011, 0.012, 0.01, 12)
      : new THREE.CylinderGeometry(0.0065, 0.0065, 0.008, 10);
    const mesh = new THREE.Mesh(geo, dMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(d.x, d.y, -0.013);
    steeringWheelGroup.add(mesh);
  }

  // Driver Helmet seated accurately inside GLB cockpit seat (auto-hidden in cockpit camera view)
  const driverHelmetGroup = new THREE.Group();
  driverHelmetGroup.position.set(0, 0.71, 0.20);
  bodyGroup.add(driverHelmetGroup);

  const helmetMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: helmet.shell,
      metalness: 0.38,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.6,
    }),
  );
  const helmetShell = new THREE.Mesh(new THREE.SphereGeometry(0.145, 24, 18), helmetMat);
  helmetShell.scale.set(0.95, 1.02, 1.12);
  helmetShell.castShadow = true;
  driverHelmetGroup.add(helmetShell);

  const helmetStripeMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: helmet.stripe,
      metalness: 0.45,
      roughness: 0.16,
      clearcoat: 0.9,
    }),
  );
  const helmetStripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.28), helmetStripeMat);
  helmetStripe.position.set(0, 0.05, 0);
  driverHelmetGroup.add(helmetStripe);

  const visorMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: helmet.visor,
      metalness: 0.95,
      roughness: 0.06,
      clearcoat: 1.0,
      envMapIntensity: 1.9,
    }),
  );
  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.146, 0.146, 0.065, 20, 1, true, -0.85, 1.7),
    visorMat,
  );
  visor.position.set(0, 0.012, 0.02);
  driverHelmetGroup.add(visor);

  // Locate rear-wing & front-wing groups for Active Aero X-Mode animation
  const rearWingGroup = model.getObjectByName('rear-wing');
  const frontWingGroup = model.getObjectByName('front-wing');
  // Placeholder meshes for CarMeshRig interface compatibility
  const frontAeroFlap = new THREE.Mesh();
  const rearAeroFlap = new THREE.Mesh();

  let currentCompound: TireCompound = initialCompound;
  let cockpitView = false;

  const setCockpitView = (isCockpit: boolean) => {
    if (cockpitView === isCockpit) return;
    cockpitView = isCockpit;
    driverHelmetGroup.visible = !isCockpit;
  };

  const setTireCompound = (compound: TireCompound) => {
    if (compound === currentCompound) return;
    currentCompound = compound;
    const hex = TIRE_SPECS[compound].color;
    for (const m of tireRingMaterials) {
      m.color.set(hex);
      m.emissive.set(hex);
    }
  };

  const updateFromState = (state: CarState, clockSec: number) => {
    root.position.set(state.x, state.y, state.z);
    root.rotation.y = state.heading;
    root.rotation.x = -state.pitch;
    root.rotation.z = state.roll;
    aoPivot.rotation.z = -state.roll;

    const targetPitch = THREE.MathUtils.clamp(
      state.brakeApplied * 0.026 - state.throttleApplied * 0.014,
      -0.02,
      0.03,
    );
    const targetRoll = THREE.MathUtils.clamp(state.yawRate * state.speed * 0.0012, -0.04, 0.04);
    const aeroHeave = -Math.min(
      0.026,
      Math.pow(state.speed / 95, 2) * 0.026 * (1 - state.activeAeroOpen * 0.25),
    );
    const kerbBuzz = state.onKerb && state.speed > 10 ? Math.sin(clockSec * 58) * 0.012 : 0;
    const shockBuzz =
      state.collisionShock > 0.05 ? Math.sin(clockSec * 72) * state.collisionShock * 0.016 : 0;

    bodyGroup.rotation.z += (targetRoll - bodyGroup.rotation.z) * 0.25;
    bodyGroup.rotation.x += (targetPitch - bodyGroup.rotation.x) * 0.25;
    bodyGroup.position.y += (aeroHeave + kerbBuzz + shockBuzz - bodyGroup.position.y) * 0.35;

    // Active Aero X-Mode subtle wing flattening on real GLB wing elements
    if (rearWingGroup && rearWingGroup.children.length > 0) {
      const upperFlap = rearWingGroup.children[0];
      upperFlap.rotation.z = THREE.MathUtils.lerp(0, -0.24, state.activeAeroOpen);
    }
    if (frontWingGroup && frontWingGroup.children.length > 1) {
      const flap = frontWingGroup.children[1];
      flap.rotation.z = THREE.MathUtils.lerp(0, -0.14, state.activeAeroOpen);
    }

    // Steering, animated F1 steering wheel, live 15-LED RPM bar & live OLED dash display
    frontLeftSteer.rotation.y = -state.steerAngle;
    frontRightSteer.rotation.y = -state.steerAngle;
    steeringWheelGroup.rotation.z = state.steerAngle * 1.45;

    const rpmNorm = THREE.MathUtils.clamp((state.rpm - 4500) / 8600, 0, 1);
    const rpmLit = Math.round(rpmNorm * ledCount);
    const redlineFlash = rpmNorm > 0.94 && Math.sin(clockSec * 28) > 0;
    for (let i = 0; i < ledCount; i++) {
      if (redlineFlash) {
        steeringLedMaterials[i].color.set('#38BDF8');
      } else if (i < rpmLit) {
        steeringLedMaterials[i].color.set(
          i < 5 ? '#10B981' : i < 10 ? '#EF4444' : '#38BDF8',
        );
      } else {
        steeringLedMaterials[i].color.set('#1A202C');
      }
    }
    if (cockpitView) {
      dashDisplay.update(state);
    }

    // Dynamic Inconel exhaust internal heat glow & recessed flame cone
    const heat = THREE.MathUtils.clamp(
      state.throttleApplied * rpmNorm * 0.85 + (state.boostActive ? 0.55 : 0),
      0,
      1,
    );
    exhaustGlowMat.opacity = heat * 0.85;
    exhaustGlowMat.color.set(state.boostActive ? '#60EFFF' : '#FF5A14');
    if (state.boostActive && state.speed > 12) {
      const flicker = 0.82 + Math.sin(clockSec * 52) * 0.18;
      exhaustFlameMat.opacity = 0.62 * flicker;
      exhaustFlameMat.color.set('#38BDF8');
      flameCone.scale.set(1, 0.85 + flicker * 0.45, 1);
    } else if (state.throttleApplied > 0.85 && rpmNorm > 0.82) {
      const flicker = 0.7 + Math.sin(clockSec * 44) * 0.3;
      exhaustFlameMat.opacity = 0.28 * flicker;
      exhaustFlameMat.color.set('#FF6B1A');
      flameCone.scale.set(0.8, 0.55 + flicker * 0.25, 0.8);
    } else {
      exhaustFlameMat.opacity = 0;
    }

    for (const w of wheelSpinMeshes) {
      w.rotation.z = state.wheelSpinAngle;
    }

    // Brake disc thermal glow (feeds UnrealBloomPass!)
    const targetGlow = state.isBrakingHard ? 2.6 : 0;
    for (const bm of brakeGlowMaterials) {
      bm.emissiveIntensity += (targetGlow - bm.emissiveIntensity) * 0.22;
    }

    // FIA rear ERS/rain LED (blooms cleanly!)
    const blink = Math.sin(clockSec * 16) > 0;
    rearLedMaterial.emissiveIntensity = state.boostActive
      ? 3.6
      : state.throttleApplied < 0.2 && state.speed > 25 && blink
        ? 2.8
        : 0.45;

    if (state.tireCompound !== currentCompound) {
      setTireCompound(state.tireCompound);
    }
  };

  const dispose = () => {
    aoTex.dispose();
    dashDisplay.texture.dispose();
    for (const m of ownedMaterials) {
      m.dispose();
    }
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.userData.sharedGlbGeometry) {
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
    root,
    bodyGroup,
    frontAeroFlap,
    rearAeroFlap,
    frontLeftSteer,
    frontRightSteer,
    wheelSpinMeshes,
    tireRingMaterials,
    brakeGlowMaterials,
    rearLedMaterial,
    get currentCompound() {
      return currentCompound;
    },
    setCockpitView,
    updateFromState,
    setTireCompound,
    dispose,
  };
}

export function buildF1CarMesh(
  driver: DriverConfig,
  yahiaFlexTeam?: TeamId,
  initialCompound: TireCompound = 'soft',
): CarMeshRig {
  if (cachedGlbTemplate) {
    return buildGlbF1CarMesh(driver, yahiaFlexTeam, initialCompound, cachedGlbTemplate);
  }
  const team = resolveDriverTeam(driver, yahiaFlexTeam);
  const helmet = resolveDriverHelmet(driver, yahiaFlexTeam);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // Soft Contact AO shadow decal beneath car on asphalt (kept level against car roll)
  const aoTex = createContactAOTexture();
  const aoPivot = new THREE.Group();
  root.add(aoPivot);
  const contactAo = new THREE.Mesh(
    new THREE.PlaneGeometry(2.35, 5.25),
    new THREE.MeshBasicMaterial({
      map: aoTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  contactAo.rotation.x = -Math.PI / 2;
  contactAo.position.set(0, 0.025, 0.08);
  aoPivot.add(contactAo);

  // PBR Automotive Clearcoat Team Paint & Carbon Materials
  const primaryMat = new THREE.MeshPhysicalMaterial({
    color: team.primaryColor,
    metalness: 0.48,
    roughness: 0.24,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
  });
  const secondaryMat = new THREE.MeshPhysicalMaterial({
    color: team.secondaryColor,
    metalness: 0.52,
    roughness: 0.22,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
  });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: team.accentColor,
    metalness: 0.52,
    roughness: 0.22,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: team.carbonColor,
    metalness: 0.25,
    roughness: 0.52,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: '#181C24',
    metalness: 0.76,
    roughness: 0.30,
  });
  const caliperMat = new THREE.MeshPhysicalMaterial({
    color: team.wheelAccentColor,
    metalness: 0.45,
    roughness: 0.28,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
  });

  // Ground-effect Venturi Floor & Rear Diffuser
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.055, 4.18), carbonMat);
  floor.position.set(0, 0.135, -0.05);
  floor.castShadow = true;
  floor.receiveShadow = true;
  bodyGroup.add(floor);

  for (const side of [-1, 1] as const) {
    const floorEdgeWing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 2.55), accentMat);
    floorEdgeWing.position.set(side * 0.84, 0.155, -0.25);
    bodyGroup.add(floorEdgeWing);
  }

  const rearDiffuser = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.15, 0.58), carbonMat);
  rearDiffuser.position.set(0, 0.19, -2.26);
  rearDiffuser.rotation.x = 0.20;
  bodyGroup.add(rearDiffuser);

  // Recessed Cockpit Cavity & Survival Cell
  const cockpitFloor = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 1.15), carbonMat);
  cockpitFloor.position.set(0, 0.21, 0.36);
  bodyGroup.add(cockpitFloor);

  for (const side of [-1, 1] as const) {
    const tubWall = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.33, 1.18), primaryMat);
    tubWall.position.set(side * 0.295, 0.39, 0.36);
    tubWall.castShadow = true;
    bodyGroup.add(tubWall);

    const cockpitLip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.96), secondaryMat);
    cockpitLip.position.set(side * 0.29, 0.56, 0.34);
    bodyGroup.add(cockpitLip);
  }

  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.24), carbonMat);
  headrest.position.set(0, 0.50, -0.04);
  bodyGroup.add(headrest);

  // Sculpted Multi-Segment Tapered Nose (+Z forward)
  const cowlBulkhead = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.31, 0.58), primaryMat);
  cowlBulkhead.position.set(0, 0.38, 1.05);
  cowlBulkhead.rotation.x = 0.04;
  cowlBulkhead.castShadow = true;
  bodyGroup.add(cowlBulkhead);

  const noseMid = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.68), primaryMat);
  noseMid.position.set(0, 0.33, 1.62);
  noseMid.rotation.x = 0.07;
  noseMid.castShadow = true;
  bodyGroup.add(noseMid);

  const noseFront = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.17, 0.62), primaryMat);
  noseFront.position.set(0, 0.27, 2.20);
  noseFront.rotation.x = 0.10;
  noseFront.castShadow = true;
  bodyGroup.add(noseFront);

  const noseTip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.38), secondaryMat);
  noseTip.position.set(0, 0.21, 2.63);
  noseTip.rotation.x = 0.13;
  bodyGroup.add(noseTip);

  for (const side of [-1, 1] as const) {
    const fwPylon = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.14, 0.26), carbonMat);
    fwPylon.position.set(side * 0.085, 0.19, 2.50);
    bodyGroup.add(fwPylon);
  }

  // Nose & Shark-Fin Driver Number Decals
  const numberTex = createNumberDecalTexture(
    driver.number,
    team.id === 'redbull' ? '#FFD700' : '#FFFFFF',
    team.primaryColor,
  );
  const numberMat = new THREE.MeshPhysicalMaterial({
    map: numberTex,
    roughness: 0.28,
    metalness: 0.15,
    clearcoat: 0.85,
  });
  const noseNumberPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), numberMat);
  noseNumberPlate.rotation.x = -Math.PI / 2 + 0.08;
  noseNumberPlate.position.set(0, 0.456, 1.62);
  bodyGroup.add(noseNumberPlate);

  // Undercut Sidepods + Cooling Louvers + Mirrors on Stalks
  for (const side of [-1, 1] as const) {
    // Narrow lower undercut skirt revealing floor edge
    const undercut = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 1.84), carbonMat);
    undercut.position.set(side * 0.44, 0.24, -0.28);
    bodyGroup.add(undercut);

    // Sculpted upper sidepod shoulder + downwash ramp
    const upperPod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.20, 1.88), primaryMat);
    upperPod.position.set(side * 0.54, 0.40, -0.24);
    upperPod.castShadow = true;
    bodyGroup.add(upperPod);

    const rearPodTaper = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.17, 0.65), primaryMat);
    rearPodTaper.position.set(side * 0.44, 0.35, -1.32);
    rearPodTaper.rotation.y = side * -0.18;
    bodyGroup.add(rearPodTaper);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.065, 1.78), secondaryMat);
    stripe.position.set(side * 0.54, 0.46, -0.24);
    bodyGroup.add(stripe);

    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), darkMetalMat);
    intake.position.set(side * 0.54, 0.40, 0.72);
    bodyGroup.add(intake);

    // Sidepod cooling louvers (5 angled gills)
    for (let l = 0; l < 5; l++) {
      const louver = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.018, 0.045), darkMetalMat);
      louver.position.set(side * 0.52, 0.506, 0.20 - l * 0.14);
      louver.rotation.x = 0.24;
      bodyGroup.add(louver);
    }

    // Aero Wing Mirror on Stalk
    const mirrorStalk = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.022, 0.055), carbonMat);
    mirrorStalk.position.set(side * 0.45, 0.555, 0.68);
    bodyGroup.add(mirrorStalk);

    const mirrorPod = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.068, 0.09), primaryMat);
    mirrorPod.position.set(side * 0.57, 0.568, 0.68);
    bodyGroup.add(mirrorPod);

    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.11, 0.048),
      new THREE.MeshPhysicalMaterial({
        color: '#D8E6F5',
        metalness: 0.98,
        roughness: 0.04,
      }),
    );
    mirrorGlass.rotation.y = Math.PI;
    mirrorGlass.position.set(side * 0.57, 0.568, 0.633);
    bodyGroup.add(mirrorGlass);
  }

  // Engine Cover + Roll Hoop Airbox + Shark Fin + Fin Numbers + T-Cam
  const engineCover = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 1.66), primaryMat);
  engineCover.position.set(0, 0.57, -0.84);
  engineCover.castShadow = true;
  bodyGroup.add(engineCover);

  const sharkFin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.34, 1.08), accentMat);
  sharkFin.position.set(0, 0.85, -1.16);
  bodyGroup.add(sharkFin);

  for (const side of [-1, 1] as const) {
    const finNum = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), numberMat);
    finNum.position.set(side * 0.025, 0.85, -1.20);
    finNum.rotation.y = side * (Math.PI / 2);
    bodyGroup.add(finNum);
  }

  const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.45), carbonMat);
  airbox.position.set(0, 0.88, -0.22);
  bodyGroup.add(airbox);

  const tCamBar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.14), darkMetalMat);
  tCamBar.position.set(0, 1.03, -0.18);
  bodyGroup.add(tCamBar);

  // Halo Safety Frame (front center pylon + forward-swept hoop + rear shoulder mounts)
  const haloFrontPost = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.30, 8), carbonMat);
  haloFrontPost.position.set(0, 0.64, 0.72);
  haloFrontPost.rotation.x = -0.52;
  bodyGroup.add(haloFrontPost);

  const haloLoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.29, 0.024, 8, 20, Math.PI * 1.16),
    carbonMat,
  );
  haloLoop.scale.set(1.0, 1.35, 1.0);
  haloLoop.rotation.x = Math.PI / 2 - 0.14;
  haloLoop.rotation.z = -Math.PI * 0.08;
  haloLoop.position.set(0, 0.725, 0.255);
  bodyGroup.add(haloLoop);

  for (const side of [-1, 1] as const) {
    addSuspensionStrut(bodyGroup, side * 0.281, 0.711, 0.159, side * 0.275, 0.56, 0.02, 0.022, carbonMat);
  }

  // Animated Cockpit F1 Steering Wheel with RPM Shift LEDs (left-to-right from driver POV)
  const steerColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 8), darkMetalMat);
  steerColumn.rotation.x = Math.PI / 2 - 0.20;
  steerColumn.position.set(0, 0.546, 0.73);
  bodyGroup.add(steerColumn);

  const steeringWheelTilt = new THREE.Group();
  steeringWheelTilt.position.set(0, 0.568, 0.60);
  steeringWheelTilt.rotation.x = -0.20;
  bodyGroup.add(steeringWheelTilt);

  const steeringWheelGroup = new THREE.Group();
  steeringWheelTilt.add(steeringWheelGroup);

  const wheelPlate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.132, 0.026), carbonMat);
  steeringWheelGroup.add(wheelPlate);

  for (const side of [-1, 1] as const) {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.124, 0.036), accentMat);
    grip.position.set(side * 0.122, -0.004, 0);
    steeringWheelGroup.add(grip);
  }

  const lcdScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.11, 0.052),
    new THREE.MeshBasicMaterial({ color: '#00D8FF' }),
  );
  lcdScreen.rotation.y = Math.PI;
  lcdScreen.position.set(0, 0.004, -0.015);
  steeringWheelGroup.add(lcdScreen);

  const steeringLedMaterials: THREE.MeshBasicMaterial[] = [];
  const ledCount = 10;
  for (let i = 0; i < ledCount; i++) {
    const ledMat = new THREE.MeshBasicMaterial({ color: '#1E2430' });
    steeringLedMaterials.push(ledMat);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.011, 0.008), ledMat);
    // +X is driver-left, -X is driver-right -> sweep +0.088 down to -0.088 for left-to-right LEDs
    const lx = (0.5 - i / (ledCount - 1)) * 0.175;
    led.position.set(lx, 0.050, -0.015);
    steeringWheelGroup.add(led);
  }

  // Driver Torso (low inside tub) + Helmet Group (hidden in Cockpit Cam)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.20, 0.34), secondaryMat);
  torso.position.set(0, 0.36, 0.14);
  bodyGroup.add(torso);

  const driverHelmetGroup = new THREE.Group();
  bodyGroup.add(driverHelmetGroup);

  const helmetShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.145, 18, 16),
    new THREE.MeshPhysicalMaterial({
      color: helmet.shell,
      metalness: 0.45,
      roughness: 0.20,
      clearcoat: 0.92,
      clearcoatRoughness: 0.08,
    }),
  );
  helmetShell.position.set(0, 0.65, 0.18);
  driverHelmetGroup.add(helmetShell);

  const helmetStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.038, 0.27),
    new THREE.MeshPhysicalMaterial({
      color: helmet.stripe,
      roughness: 0.24,
      metalness: 0.35,
      clearcoat: 0.92,
      clearcoatRoughness: 0.08,
    }),
  );
  helmetStripe.position.set(0, 0.785, 0.18);
  driverHelmetGroup.add(helmetStripe);

  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.149, 0.149, 0.068, 18, 1, true, -Math.PI * 0.36, Math.PI * 0.72),
    new THREE.MeshPhysicalMaterial({
      color: helmet.visor,
      metalness: 0.96,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      iridescence: 0.9,
      iridescenceIOR: 1.65,
      side: THREE.DoubleSide,
    }),
  );
  visor.position.set(0, 0.655, 0.185);
  driverHelmetGroup.add(visor);

  // Front Wing + Animated Active Aero Upper Flap
  const frontWingMain = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.048, 0.44), carbonMat);
  frontWingMain.position.set(0, 0.155, 2.52);
  frontWingMain.castShadow = true;
  bodyGroup.add(frontWingMain);

  const frontAeroFlap = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.038, 0.22), accentMat);
  frontAeroFlap.position.set(0, 0.215, 2.40);
  frontAeroFlap.rotation.x = 0.28;
  bodyGroup.add(frontAeroFlap);

  for (const side of [-1, 1] as const) {
    const fwEndplate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.50), primaryMat);
    fwEndplate.position.set(side * 0.94, 0.24, 2.50);
    bodyGroup.add(fwEndplate);
  }

  // Rear Wing + Animated X-Mode Active Aero Flap + FIA Rain/ERS LED
  const rearPylon = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.28), carbonMat);
  rearPylon.position.set(0, 0.62, -2.14);
  bodyGroup.add(rearPylon);

  const rearMainPlane = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.05, 0.28), carbonMat);
  rearMainPlane.position.set(0, 0.82, -2.18);
  rearMainPlane.castShadow = true;
  bodyGroup.add(rearMainPlane);

  const rearAeroFlap = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.045, 0.24), accentMat);
  rearAeroFlap.position.set(0, 0.93, -2.23);
  rearAeroFlap.rotation.x = 0.48; // Z-mode high downforce angle by default
  bodyGroup.add(rearAeroFlap);

  for (const side of [-1, 1] as const) {
    const rwEndplate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.56, 0.52), primaryMat);
    rwEndplate.position.set(side * 0.56, 0.72, -2.18);
    rwEndplate.castShadow = true;
    bodyGroup.add(rwEndplate);
  }

  const rearLedMaterial = new THREE.MeshStandardMaterial({
    color: '#FF1E1E',
    emissive: '#FF0000',
    emissiveIntensity: 0.4,
    roughness: 0.2,
  });
  const rearLed = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.05), rearLedMaterial);
  rearLed.position.set(0, 0.34, -2.42);
  bodyGroup.add(rearLed);

  // 4 Wide F1 Wheels + 2026 Aero Rim Accents + Painted Brake Calipers + Brake Disc Glow
  const wheelSpinMeshes: THREE.Object3D[] = [];
  const tireRingMaterials: THREE.MeshStandardMaterial[] = [];
  const brakeGlowMaterials: THREE.MeshStandardMaterial[] = [];
  const compoundColor = TIRE_SPECS[initialCompound].color;

  const frontLeftSteer = new THREE.Group();
  frontLeftSteer.position.set(0.84, 0.34, 1.58);
  const frontRightSteer = new THREE.Group();
  frontRightSteer.position.set(-0.84, 0.34, 1.58);
  bodyGroup.add(frontLeftSteer, frontRightSteer);

  const tireRubberMat = new THREE.MeshStandardMaterial({
    color: '#17191E',
    roughness: 0.78,
    metalness: 0.08,
  });
  const wheelRimMat = new THREE.MeshStandardMaterial({
    color: '#222732',
    roughness: 0.30,
    metalness: 0.80,
  });
  const aeroRimAccentMat = new THREE.MeshPhysicalMaterial({
    color: team.wheelAccentColor,
    metalness: 0.55,
    roughness: 0.26,
    clearcoat: 0.85,
  });

  const buildWheel = (parent: THREE.Object3D, width: number, radius: number, side: number) => {
    const spinGroup = new THREE.Group();
    parent.add(spinGroup);
    wheelSpinMeshes.push(spinGroup);

    const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 24), tireRubberMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    spinGroup.add(tire);

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, width + 0.02, 16),
      wheelRimMat,
    );
    rim.rotation.z = Math.PI / 2;
    spinGroup.add(rim);

    // 2026 Aero Wheel Cover Spoke Cross + Team Color Rim Accents
    const spokeA = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.03, radius * 0.96, 0.042),
      darkMetalMat,
    );
    const spokeB = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.03, 0.042, radius * 0.96),
      aeroRimAccentMat,
    );
    spinGroup.add(spokeA, spokeB);

    const aeroRimFin = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.45, 0.016, 6, 20),
      aeroRimAccentMat,
    );
    aeroRimFin.rotation.y = Math.PI / 2;
    aeroRimFin.position.x = side * (width * 0.5 + 0.012);
    spinGroup.add(aeroRimFin);

    const ringMat = new THREE.MeshStandardMaterial({
      color: compoundColor,
      emissive: compoundColor,
      emissiveIntensity: 0.25,
      roughness: 0.35,
    });
    tireRingMaterials.push(ringMat);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.74, 0.024, 6, 24), ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = side * (width * 0.5 + 0.005);
    spinGroup.add(ring);

    const brakeGlowMat = new THREE.MeshStandardMaterial({
      color: '#3A1A0A',
      emissive: '#FF4500',
      emissiveIntensity: 0,
      roughness: 0.4,
    });
    brakeGlowMaterials.push(brakeGlowMat);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.44, radius * 0.44, 0.08, 14),
      brakeGlowMat,
    );
    disc.rotation.z = Math.PI / 2;
    disc.position.x = -side * (width * 0.35);
    parent.add(disc);

    // Painted Stationary Brake Caliper
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.11, radius * 0.32, radius * 0.26), caliperMat);
    caliper.position.set(-side * (width * 0.34), radius * 0.14, radius * 0.24);
    parent.add(caliper);
  };

  buildWheel(frontLeftSteer, 0.34, 0.34, 1);
  buildWheel(frontRightSteer, 0.34, 0.34, -1);

  const rearLeftMount = new THREE.Group();
  rearLeftMount.position.set(0.86, 0.36, -1.62);
  const rearRightMount = new THREE.Group();
  rearRightMount.position.set(-0.86, 0.36, -1.62);
  bodyGroup.add(rearLeftMount, rearRightMount);
  buildWheel(rearLeftMount, 0.42, 0.36, 1);
  buildWheel(rearRightMount, 0.42, 0.36, -1);

  // Double V-Wishbone Suspension + Pushrods (Front & Rear)
  for (const side of [-1, 1] as const) {
    // Front upper V-wishbone + lower V-wishbone + pushrod
    addSuspensionStrut(bodyGroup, side * 0.22, 0.41, 1.82, side * 0.78, 0.42, 1.58, 0.016, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.24, 0.41, 1.36, side * 0.78, 0.42, 1.58, 0.016, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.22, 0.25, 1.80, side * 0.78, 0.26, 1.58, 0.018, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.24, 0.25, 1.34, side * 0.78, 0.26, 1.58, 0.018, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.22, 0.44, 1.50, side * 0.76, 0.27, 1.58, 0.014, darkMetalMat);

    // Rear upper V-wishbone + lower V-wishbone + pullrod/pushrod
    addSuspensionStrut(bodyGroup, side * 0.22, 0.43, -1.36, side * 0.78, 0.44, -1.62, 0.017, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.22, 0.43, -1.86, side * 0.78, 0.44, -1.62, 0.017, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.24, 0.24, -1.38, side * 0.78, 0.25, -1.62, 0.019, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.24, 0.24, -1.88, side * 0.78, 0.25, -1.62, 0.019, carbonMat);
    addSuspensionStrut(bodyGroup, side * 0.22, 0.46, -1.48, side * 0.76, 0.26, -1.62, 0.014, darkMetalMat);
  }

  let currentCompound: TireCompound = initialCompound;
  let cockpitView = false;

  const setCockpitView = (isCockpit: boolean) => {
    if (cockpitView === isCockpit) return;
    cockpitView = isCockpit;
    driverHelmetGroup.visible = !isCockpit;
  };

  const setTireCompound = (compound: TireCompound) => {
    if (compound === currentCompound) return;
    currentCompound = compound;
    const hex = TIRE_SPECS[compound].color;
    for (const m of tireRingMaterials) {
      m.color.set(hex);
      m.emissive.set(hex);
    }
  };

  const updateFromState = (state: CarState, clockSec: number) => {
    root.position.set(state.x, state.y, state.z);
    root.rotation.y = state.heading;
    root.rotation.x = -state.pitch;
    root.rotation.z = state.roll;
    aoPivot.rotation.z = -state.roll;

    // Dynamic chassis suspension dive, squat, roll, aero heave & kerb/impact buzz
    const targetPitch = THREE.MathUtils.clamp(
      state.brakeApplied * 0.026 - state.throttleApplied * 0.014,
      -0.02,
      0.03,
    );
    const targetRoll = THREE.MathUtils.clamp(state.yawRate * state.speed * 0.0012, -0.04, 0.04);
    const aeroHeave = -Math.min(
      0.026,
      Math.pow(state.speed / 95, 2) * 0.026 * (1 - state.activeAeroOpen * 0.25),
    );
    const kerbBuzz = state.onKerb && state.speed > 10 ? Math.sin(clockSec * 58) * 0.012 : 0;
    const shockBuzz =
      state.collisionShock > 0.05 ? Math.sin(clockSec * 72) * state.collisionShock * 0.016 : 0;

    bodyGroup.rotation.z += (targetRoll - bodyGroup.rotation.z) * 0.25;
    bodyGroup.rotation.x += (targetPitch - bodyGroup.rotation.x) * 0.25;
    bodyGroup.position.y += (aeroHeave + kerbBuzz + shockBuzz - bodyGroup.position.y) * 0.35;

    // Active Aero X-Mode flattening animation
    frontAeroFlap.rotation.x = THREE.MathUtils.lerp(0.30, 0.02, state.activeAeroOpen);
    rearAeroFlap.rotation.x = THREE.MathUtils.lerp(0.50, 0.03, state.activeAeroOpen);
    rearAeroFlap.position.y = THREE.MathUtils.lerp(0.93, 0.96, state.activeAeroOpen);

    // Steering, steering wheel & RPM shift LEDs
    frontLeftSteer.rotation.y = -state.steerAngle;
    frontRightSteer.rotation.y = -state.steerAngle;
    steeringWheelGroup.rotation.z = state.steerAngle * 1.4;

    const rpmLit = Math.round(((state.rpm - 4500) / 8600) * ledCount);
    for (let i = 0; i < ledCount; i++) {
      if (i < rpmLit) {
        steeringLedMaterials[i].color.set(
          i < 4 ? '#10B981' : i < 7 ? '#EF4444' : '#38BDF8',
        );
      } else {
        steeringLedMaterials[i].color.set('#1E2430');
      }
    }

    for (const w of wheelSpinMeshes) {
      w.rotation.x = state.wheelSpinAngle;
    }

    // Brake disc thermal glow
    const targetGlow = state.isBrakingHard ? 1.8 : 0;
    for (const bm of brakeGlowMaterials) {
      bm.emissiveIntensity += (targetGlow - bm.emissiveIntensity) * 0.22;
    }

    // FIA rear ERS harvest/boost flashing LED
    const blink = Math.sin(clockSec * 16) > 0;
    rearLedMaterial.emissiveIntensity = state.boostActive
      ? 2.8
      : state.throttleApplied < 0.2 && state.speed > 25 && blink
        ? 2.2
        : 0.3;

    if (state.tireCompound !== currentCompound) {
      setTireCompound(state.tireCompound);
    }
  };

  const dispose = () => {
    numberTex.dispose();
    aoTex.dispose();
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
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
    root,
    bodyGroup,
    frontAeroFlap,
    rearAeroFlap,
    frontLeftSteer,
    frontRightSteer,
    wheelSpinMeshes,
    tireRingMaterials,
    brakeGlowMaterials,
    rearLedMaterial,
    get currentCompound() {
      return currentCompound;
    },
    setCockpitView,
    updateFromState,
    setTireCompound,
    dispose,
  };
}

export function buildGhostCarMesh(): THREE.Group {
  const ghost = new THREE.Group();
  ghost.rotation.order = 'YXZ';
  const mat = new THREE.MeshBasicMaterial({
    color: '#00F0FF',
    transparent: true,
    opacity: 0.30,
    wireframe: false,
    depthWrite: false,
  });

  if (cachedGlbTemplate) {
    const align = new THREE.Group();
    align.rotation.y = Math.PI / 2;
    align.position.y = -cachedGlbMinY;
    const clone = cachedGlbTemplate.clone(true);
    clone.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.userData.sharedGlbGeometry = true;
        obj.material = mat;
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });
    align.add(clone);
    ghost.add(align);
    return ghost;
  }

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.36, 3.6), mat);
  body.position.set(0, 0.35, 0.2);
  const fWing = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.08, 0.45), mat);
  fWing.position.set(0, 0.16, 2.45);
  const rWing = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.14, 0.35), mat);
  rWing.position.set(0, 0.85, -2.18);
  const pods = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.30, 1.9), mat);
  pods.position.set(0, 0.32, -0.2);
  ghost.add(body, fWing, rWing, pods);
  return ghost;
}
