import * as THREE from 'three';
import type { CarState } from '../engine/CarPhysics';

const MAX_SPARKS = 180;
const MAX_PUFFS = 140;
const MAX_SKIDS = 600;
const MAX_PLUME = 96;

interface CarTrackHistory {
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  active: boolean;
  sparkAccum: number;
  puffAccum: number;
  plumeAccum: number;
}

export class EffectsManager {
  readonly group = new THREE.Group();

  private readonly sparksMesh: THREE.InstancedMesh;
  private readonly sparksPos = new Float32Array(MAX_SPARKS * 3);
  private readonly sparksVel = new Float32Array(MAX_SPARKS * 3);
  private readonly sparksGroundY = new Float32Array(MAX_SPARKS);
  private readonly sparksLife = new Float32Array(MAX_SPARKS);
  private readonly sparksMaxLife = new Float32Array(MAX_SPARKS);
  private activeSparks = 0;

  private readonly puffsMesh: THREE.InstancedMesh;
  private readonly puffsPos = new Float32Array(MAX_PUFFS * 3);
  private readonly puffsVel = new Float32Array(MAX_PUFFS * 3);
  private readonly puffsLife = new Float32Array(MAX_PUFFS);
  private readonly puffsMaxLife = new Float32Array(MAX_PUFFS);
  private readonly puffsKind = new Uint8Array(MAX_PUFFS); // 0 = tire smoke, 1 = dust/gravel
  private activePuffs = 0;

  private readonly skidsMesh: THREE.InstancedMesh;
  private skidWriteIdx = 0;
  private skidTotalCount = 0;

  private readonly plumeMesh: THREE.InstancedMesh;
  private readonly plumePos = new Float32Array(MAX_PLUME * 3);
  private readonly plumeVel = new Float32Array(MAX_PLUME * 3);
  private readonly plumeLife = new Float32Array(MAX_PLUME);
  private readonly plumeMaxLife = new Float32Array(MAX_PLUME);
  private activePlumes = 0;

  private readonly carHistory = new Map<string, CarTrackHistory>();

  // Reusable zero-GC scratch math objects
  private readonly scratchMat = new THREE.Matrix4();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scratchScale = new THREE.Vector3(1, 1, 1);
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor() {
    // 1. Titanium Skid-Block Sparks
    const sparkGeo = new THREE.BoxGeometry(0.032, 0.032, 0.42);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparksMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparksMesh.frustumCulled = false;
    this.sparksMesh.setColorAt(0, this.scratchColor.set('#FFD27D'));
    this.sparksMesh.count = 0;
    this.group.add(this.sparksMesh);

    // 2. Tire Smoke & Off-Track Dust Puffs
    const puffGeo = new THREE.DodecahedronGeometry(0.28, 0);
    const puffMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    });
    this.puffsMesh = new THREE.InstancedMesh(puffGeo, puffMat, MAX_PUFFS);
    this.puffsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffsMesh.frustumCulled = false;
    this.puffsMesh.setColorAt(0, this.scratchColor.set('#E6EAF2'));
    this.puffsMesh.count = 0;
    this.group.add(this.puffsMesh);

    // 3. Persistent Asphalt Skid Marks Ring Buffer
    const skidGeo = new THREE.PlaneGeometry(0.32, 1.0);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: '#111318',
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.skidsMesh = new THREE.InstancedMesh(skidGeo, skidMat, MAX_SKIDS);
    this.skidsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skidsMesh.frustumCulled = false;
    this.skidsMesh.count = 0;
    this.group.add(this.skidsMesh);

    // 4. ERS Boost Tailpipe Heat-Flame Streaks (sleek tapered cones aligned along exhaust velocity)
    const plumeGeo = new THREE.ConeGeometry(0.048, 0.46, 10, 1, true);
    plumeGeo.rotateX(Math.PI / 2);
    const plumeMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.plumeMesh = new THREE.InstancedMesh(plumeGeo, plumeMat, MAX_PLUME);
    this.plumeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plumeMesh.frustumCulled = false;
    this.plumeMesh.setColorAt(0, this.scratchColor.set('#00E5FF'));
    this.plumeMesh.count = 0;
    this.group.add(this.plumeMesh);
  }

  private getHistory(driverId: string): CarTrackHistory {
    let hist = this.carHistory.get(driverId);
    if (!hist) {
      hist = {
        lx: 0,
        ly: 0,
        lz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        active: false,
        sparkAccum: 0,
        puffAccum: 0,
        plumeAccum: 0,
      };
      this.carHistory.set(driverId, hist);
    }
    return hist;
  }

  private spawnSpark(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    groundY: number,
    maxLife: number,
  ): void {
    if (this.activeSparks >= MAX_SPARKS) return;
    const i = this.activeSparks++;
    const i3 = i * 3;
    this.sparksPos[i3] = x;
    this.sparksPos[i3 + 1] = y;
    this.sparksPos[i3 + 2] = z;
    this.sparksVel[i3] = vx;
    this.sparksVel[i3 + 1] = vy;
    this.sparksVel[i3 + 2] = vz;
    this.sparksGroundY[i] = groundY;
    this.sparksLife[i] = maxLife;
    this.sparksMaxLife[i] = maxLife;
  }

  private spawnPuff(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
    kind: 0 | 1,
  ): void {
    if (this.activePuffs >= MAX_PUFFS) return;
    const i = this.activePuffs++;
    const i3 = i * 3;
    this.puffsPos[i3] = x;
    this.puffsPos[i3 + 1] = y;
    this.puffsPos[i3 + 2] = z;
    this.puffsVel[i3] = vx;
    this.puffsVel[i3 + 1] = vy;
    this.puffsVel[i3 + 2] = vz;
    this.puffsLife[i] = maxLife;
    this.puffsMaxLife[i] = maxLife;
    this.puffsKind[i] = kind;
  }

  private spawnPlume(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
  ): void {
    if (this.activePlumes >= MAX_PLUME) return;
    const i = this.activePlumes++;
    const i3 = i * 3;
    this.plumePos[i3] = x;
    this.plumePos[i3 + 1] = y;
    this.plumePos[i3 + 2] = z;
    this.plumeVel[i3] = vx;
    this.plumeVel[i3 + 1] = vy;
    this.plumeVel[i3 + 2] = vz;
    this.plumeLife[i] = maxLife;
    this.plumeMaxLife[i] = maxLife;
  }

  private pushSkidSegment(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    roll: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return;

    const yaw = Math.atan2(dx, dz);
    const segPitch = Math.atan2(dy, dist);
    this.scratchPos.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5);
    this.scratchEuler.set(-segPitch, yaw, roll, 'YXZ');
    this.scratchQuat.setFromEuler(this.scratchEuler);
    this.scratchScale.set(1, 1, dist * 1.08);
    this.scratchMat.compose(this.scratchPos, this.scratchQuat, this.scratchScale);

    this.skidsMesh.setMatrixAt(this.skidWriteIdx, this.scratchMat);
    this.skidWriteIdx = (this.skidWriteIdx + 1) % MAX_SKIDS;
    if (this.skidTotalCount < MAX_SKIDS) {
      this.skidTotalCount++;
    }
    this.skidsMesh.count = this.skidTotalCount;
    this.skidsMesh.instanceMatrix.needsUpdate = true;
  }

  update(cars: CarState[], dt: number): void {
    const stepDt = Math.min(0.05, Math.max(0.001, dt));

    // Emit new particles & skid marks from active cars
    for (let c = 0; c < cars.length; c++) {
      const car = cars[c];
      if (car.pitServicing) continue;

      const hist = this.getHistory(car.driverId);
      const fwdX = Math.sin(car.heading);
      const fwdZ = Math.cos(car.heading);
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const sinPitch = Math.sin(car.pitch);

      // 1. Titanium skid-block sparks (high-speed bottoming, kerbs, or wall scrapes)
      const bottoming = car.speed > 66 && (Math.abs(car.pitch) > 0.015 || car.onKerb);
      const kerbSparks = car.onKerb && car.speed > 40;
      const scrapeSparks = car.collisionShock > 0.35 && car.speed > 18;
      if (bottoming || kerbSparks || scrapeSparks) {
        const rate = scrapeSparks ? 90 : bottoming ? 55 : 35;
        hist.sparkAccum += rate * stepDt;
        while (hist.sparkAccum >= 1) {
          hist.sparkAccum -= 1;
          const latJ = (Math.random() - 0.5) * 0.55;
          const sx = car.x - fwdX * 1.15 + rightX * latJ;
          const baseGroundY = car.y - 1.15 * sinPitch;
          const sy = baseGroundY + 0.08;
          const sz = car.z - fwdZ * 1.15 + rightZ * latJ;
          const backSpeed = car.speed * 0.42 + 8 + Math.random() * 8;
          const vx = -fwdX * backSpeed + rightX * ((Math.random() - 0.5) * 3.5);
          const vy = 1.2 + Math.random() * 2.8;
          const vz = -fwdZ * backSpeed + rightZ * ((Math.random() - 0.5) * 3.5);
          this.spawnSpark(sx, sy, sz, vx, vy, vz, baseGroundY + 0.03, 0.16 + Math.random() * 0.18);
        }
      } else {
        hist.sparkAccum = 0;
      }

      // 2. Tire smoke & off-track dust puffs
      const heavySlip =
        !car.offTrack &&
        car.speed > 12 &&
        (car.slipRatio > 0.30 || (car.isBrakingHard && car.slipRatio > 0.22) || Math.abs(car.lateralSpeed) > 2.3);
      const offTrackDust = car.offTrack && car.speed > 10;

      if (offTrackDust || heavySlip) {
        const rate = offTrackDust ? 34 : 26 * Math.max(0.5, car.slipRatio);
        hist.puffAccum += rate * stepDt;
        while (hist.puffAccum >= 1) {
          hist.puffAccum -= 1;
          const side = Math.random() > 0.5 ? 1 : -1;
          const axleZ = !offTrackDust && car.isBrakingHard && Math.abs(car.lateralSpeed) < 1.8 ? 1.56 : -1.62;
          const px = car.x + fwdX * axleZ + rightX * (side * 0.86);
          const py = car.y + axleZ * sinPitch + 0.18;
          const pz = car.z + fwdZ * axleZ + rightZ * (side * 0.86);
          const vx = -fwdX * (car.speed * 0.12) + (Math.random() - 0.5) * 1.8;
          const vy = 0.75 + Math.random() * 1.1;
          const vz = -fwdZ * (car.speed * 0.12) + (Math.random() - 0.5) * 1.8;
          this.spawnPuff(px, py, pz, vx, vy, vz, 0.45 + Math.random() * 0.25, offTrackDust ? 1 : 0);
        }
      } else {
        hist.puffAccum = 0;
      }

      // 3. Persistent asphalt skid marks ring buffer
      const isSkidding =
        !car.offTrack &&
        car.speed > 14 &&
        (car.slipRatio > 0.26 || (car.isBrakingHard && car.speed > 24) || Math.abs(car.lateralSpeed) > 2.1);

      if (isSkidding) {
        const rearX = car.x - fwdX * 1.62;
        const rearZ = car.z - fwdZ * 1.62;
        const curLx = rearX - rightX * 0.86;
        const curLz = rearZ - rightZ * 0.86;
        const curRx = rearX + rightX * 0.86;
        const curRz = rearZ + rightZ * 0.86;
        const curY = car.y - 1.62 * sinPitch + 0.036;

        if (!hist.active) {
          hist.lx = curLx;
          hist.ly = curY;
          hist.lz = curLz;
          hist.rx = curRx;
          hist.ry = curY;
          hist.rz = curRz;
          hist.active = true;
        } else {
          const distSq = (curLx - hist.lx) ** 2 + (curLz - hist.lz) ** 2;
          if (distSq > 36) {
            hist.lx = curLx;
            hist.ly = curY;
            hist.lz = curLz;
            hist.rx = curRx;
            hist.ry = curY;
            hist.rz = curRz;
          } else if (distSq >= 0.56) {
            this.pushSkidSegment(hist.lx, hist.ly, hist.lz, curLx, curY, curLz, 0);
            this.pushSkidSegment(hist.rx, hist.ry, hist.rz, curRx, curY, curRz, 0);
            hist.lx = curLx;
            hist.ly = curY;
            hist.lz = curLz;
            hist.rx = curRx;
            hist.ry = curY;
            hist.rz = curRz;
          }
        }
      } else {
        hist.active = false;
      }

      // 4. ERS Boost central exhaust tailpipe heat streak
      if (car.boostActive && car.speed > 14) {
        hist.plumeAccum += 42 * stepDt;
        while (hist.plumeAccum >= 1) {
          hist.plumeAccum -= 1;
          const bx = car.x - fwdX * 2.42 + rightX * ((Math.random() - 0.5) * 0.04);
          const by = car.y - 2.42 * sinPitch + 0.495 + (Math.random() - 0.5) * 0.03;
          const bz = car.z - fwdZ * 2.42 + rightZ * ((Math.random() - 0.5) * 0.04);
          const eject = car.speed * 0.35 + 10 + Math.random() * 5;
          this.spawnPlume(
            bx,
            by,
            bz,
            -fwdX * eject + (Math.random() - 0.5) * 0.35,
            0.05 + (Math.random() - 0.5) * 0.2,
            -fwdZ * eject + (Math.random() - 0.5) * 0.35,
            0.09 + Math.random() * 0.06,
          );
        }
      } else {
        hist.plumeAccum = 0;
      }
    }

    // Integrate & update Sparks
    for (let i = 0; i < this.activeSparks; ) {
      this.sparksLife[i] -= stepDt;
      if (this.sparksLife[i] <= 0) {
        const last = --this.activeSparks;
        if (i < last) {
          const i3 = i * 3;
          const l3 = last * 3;
          this.sparksPos[i3] = this.sparksPos[l3];
          this.sparksPos[i3 + 1] = this.sparksPos[l3 + 1];
          this.sparksPos[i3 + 2] = this.sparksPos[l3 + 2];
          this.sparksVel[i3] = this.sparksVel[l3];
          this.sparksVel[i3 + 1] = this.sparksVel[l3 + 1];
          this.sparksVel[i3 + 2] = this.sparksVel[l3 + 2];
          this.sparksGroundY[i] = this.sparksGroundY[last];
          this.sparksLife[i] = this.sparksLife[last];
          this.sparksMaxLife[i] = this.sparksMaxLife[last];
        }
        continue;
      }

      const i3 = i * 3;
      this.sparksVel[i3 + 1] -= 16 * stepDt;
      this.sparksPos[i3] += this.sparksVel[i3] * stepDt;
      this.sparksPos[i3 + 1] += this.sparksVel[i3 + 1] * stepDt;
      this.sparksPos[i3 + 2] += this.sparksVel[i3 + 2] * stepDt;

      if (this.sparksPos[i3 + 1] < this.sparksGroundY[i]) {
        this.sparksPos[i3 + 1] = this.sparksGroundY[i];
        this.sparksVel[i3 + 1] = Math.abs(this.sparksVel[i3 + 1]) * 0.45;
      }

      const t = this.sparksLife[i] / this.sparksMaxLife[i];
      this.scratchPos.set(this.sparksPos[i3], this.sparksPos[i3 + 1], this.sparksPos[i3 + 2]);
      this.scratchDir.set(this.sparksVel[i3], this.sparksVel[i3 + 1], this.sparksVel[i3 + 2]);
      const spd = this.scratchDir.length();
      if (spd > 0.01) {
        this.scratchDir.divideScalar(spd);
        this.scratchQuat.setFromUnitVectors(this.zAxis, this.scratchDir);
      }
      this.scratchScale.set(t, t, Math.max(0.35, t * 1.4));
      this.scratchMat.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.sparksMesh.setMatrixAt(i, this.scratchMat);

      this.scratchColor.setRGB(1.0, 0.35 + t * 0.60, t * 0.55);
      this.sparksMesh.setColorAt(i, this.scratchColor);
      i++;
    }
    this.sparksMesh.count = this.activeSparks;
    this.sparksMesh.instanceMatrix.needsUpdate = true;
    if (this.sparksMesh.instanceColor) this.sparksMesh.instanceColor.needsUpdate = true;

    // Integrate & update Tire Smoke / Dust Puffs
    for (let i = 0; i < this.activePuffs; ) {
      this.puffsLife[i] -= stepDt;
      if (this.puffsLife[i] <= 0) {
        const last = --this.activePuffs;
        if (i < last) {
          const i3 = i * 3;
          const l3 = last * 3;
          this.puffsPos[i3] = this.puffsPos[l3];
          this.puffsPos[i3 + 1] = this.puffsPos[l3 + 1];
          this.puffsPos[i3 + 2] = this.puffsPos[l3 + 2];
          this.puffsVel[i3] = this.puffsVel[l3];
          this.puffsVel[i3 + 1] = this.puffsVel[l3 + 1];
          this.puffsVel[i3 + 2] = this.puffsVel[l3 + 2];
          this.puffsLife[i] = this.puffsLife[last];
          this.puffsMaxLife[i] = this.puffsMaxLife[last];
          this.puffsKind[i] = this.puffsKind[last];
        }
        continue;
      }

      const i3 = i * 3;
      this.puffsPos[i3] += this.puffsVel[i3] * stepDt;
      this.puffsPos[i3 + 1] += this.puffsVel[i3 + 1] * stepDt;
      this.puffsPos[i3 + 2] += this.puffsVel[i3 + 2] * stepDt;

      const t = this.puffsLife[i] / this.puffsMaxLife[i];
      const sc = (0.45 + (1 - t) * 1.45) * Math.min(1, t * 2.2);
      this.scratchPos.set(this.puffsPos[i3], this.puffsPos[i3 + 1], this.puffsPos[i3 + 2]);
      this.scratchQuat.identity();
      this.scratchScale.set(sc, sc * 0.75, sc);
      this.scratchMat.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.puffsMesh.setMatrixAt(i, this.scratchMat);

      if (this.puffsKind[i] === 1) {
        this.scratchColor.setRGB(0.68 * t + 0.25, 0.58 * t + 0.22, 0.44 * t + 0.18);
      } else {
        const shade = 0.65 + t * 0.30;
        this.scratchColor.setRGB(shade, shade, shade * 1.03);
      }
      this.puffsMesh.setColorAt(i, this.scratchColor);
      i++;
    }
    this.puffsMesh.count = this.activePuffs;
    this.puffsMesh.instanceMatrix.needsUpdate = true;
    if (this.puffsMesh.instanceColor) this.puffsMesh.instanceColor.needsUpdate = true;

    // Integrate & update ERS Boost Plume
    for (let i = 0; i < this.activePlumes; ) {
      this.plumeLife[i] -= stepDt;
      if (this.plumeLife[i] <= 0) {
        const last = --this.activePlumes;
        if (i < last) {
          const i3 = i * 3;
          const l3 = last * 3;
          this.plumePos[i3] = this.plumePos[l3];
          this.plumePos[i3 + 1] = this.plumePos[l3 + 1];
          this.plumePos[i3 + 2] = this.plumePos[l3 + 2];
          this.plumeVel[i3] = this.plumeVel[l3];
          this.plumeVel[i3 + 1] = this.plumeVel[l3 + 1];
          this.plumeVel[i3 + 2] = this.plumeVel[l3 + 2];
          this.plumeLife[i] = this.plumeLife[last];
          this.plumeMaxLife[i] = this.plumeMaxLife[last];
        }
        continue;
      }

      const i3 = i * 3;
      this.plumePos[i3] += this.plumeVel[i3] * stepDt;
      this.plumePos[i3 + 1] += this.plumeVel[i3 + 1] * stepDt;
      this.plumePos[i3 + 2] += this.plumeVel[i3 + 2] * stepDt;

      const t = this.plumeLife[i] / this.plumeMaxLife[i];
      const sc = Math.max(0.2, t * 0.95);
      this.scratchPos.set(this.plumePos[i3], this.plumePos[i3 + 1], this.plumePos[i3 + 2]);
      this.scratchDir.set(this.plumeVel[i3], this.plumeVel[i3 + 1], this.plumeVel[i3 + 2]);
      const spd = this.scratchDir.length();
      if (spd > 0.01) {
        this.scratchDir.divideScalar(spd);
        this.scratchQuat.setFromUnitVectors(this.zAxis, this.scratchDir);
      } else {
        this.scratchQuat.identity();
      }
      this.scratchScale.set(sc, sc, sc * 1.4);
      this.scratchMat.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.plumeMesh.setMatrixAt(i, this.scratchMat);

      this.scratchColor.setRGB(0.25 + t * 0.55, 0.75 + t * 0.22, 1.0);
      this.plumeMesh.setColorAt(i, this.scratchColor);
      i++;
    }
    this.plumeMesh.count = this.activePlumes;
    this.plumeMesh.instanceMatrix.needsUpdate = true;
    if (this.plumeMesh.instanceColor) this.plumeMesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.carHistory.clear();
    this.sparksMesh.geometry.dispose();
    (this.sparksMesh.material as THREE.Material).dispose();
    this.puffsMesh.geometry.dispose();
    (this.puffsMesh.material as THREE.Material).dispose();
    this.skidsMesh.geometry.dispose();
    (this.skidsMesh.material as THREE.Material).dispose();
    this.plumeMesh.geometry.dispose();
    (this.plumeMesh.material as THREE.Material).dispose();
  }
}
