import * as THREE from 'three';
import type { CarState } from '../engine/CarPhysics';

export type CameraMode = 'tv-pod' | 'chase' | 'cockpit';

const CAMERA_MODES: CameraMode[] = ['tv-pod', 'chase', 'cockpit'];

export const CAMERA_LABELS: Record<CameraMode, string> = {
  'tv-pod': 'TV POD (T-CAM)',
  chase: 'CHASE CAM',
  cockpit: 'COCKPIT / HALO',
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'tv-pod';

  private smoothedPos = new THREE.Vector3();
  private smoothedTarget = new THREE.Vector3();
  private initialized = false;

  // Smooth local G-force head sway (zero world-space lag on onboard cams)
  private swayX = 0;
  private swayZ = 0;
  private readonly scratchLocal = new THREE.Vector3();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scratchUp = new THREE.Vector3(0, 1, 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(64, aspect, 0.08, 4200);
  }

  cycleMode(): CameraMode {
    const idx = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(idx + 1) % CAMERA_MODES.length];
    this.initialized = false;
    return this.mode;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  updateMenuShowroom(clockSec: number, isMobileUI = false): void {
    const angle = clockSec * 0.35;
    const radius = isMobileUI ? 5.4 : 5.1;
    const centerX = isMobileUI ? 0 : -1.45;
    const baseY = isMobileUI ? 1.85 : 1.75;
    const lookY = isMobileUI ? 0.25 : 0.42;
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 44;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      Math.sin(angle) * radius + centerX,
      baseY + Math.sin(clockSec * 0.6) * 0.15,
      Math.cos(angle) * radius,
    );
    this.camera.lookAt(centerX, lookY, 0);
  }

  updateVictoryOrbit(car: CarState, clockSec: number): void {
    const angle = car.heading + clockSec * 0.55;
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      car.x + Math.sin(angle) * 6.5,
      car.y + 2.3,
      car.z + Math.cos(angle) * 6.5,
    );
    this.camera.lookAt(car.x, car.y + 0.65, car.z);
  }

  /** Cinematic sweeping Grand Prix Podium Celebration camera framing the P1 car, 3-tier dais & champagne spray. */
  updatePodiumStage(clockSec: number): void {
    const sweep = Math.sin(clockSec * 0.32) * 0.52;
    const radius = 9.2 + Math.sin(clockSec * 0.22) * 0.7;
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 46;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      Math.sin(sweep) * radius,
      2.75 + Math.sin(clockSec * 0.45) * 0.28,
      Math.cos(sweep) * radius + 1.4,
    );
    this.camera.lookAt(0, 1.35, -0.4);
  }

  updateRace(car: CarState, dt: number, countdownIntroAlpha = 0): void {
    const fwdX = Math.sin(car.heading);
    const fwdZ = Math.cos(car.heading);
    const rightX = -fwdZ;
    const rightZ = fwdX;

    const speedRatio = Math.min(1, car.speed / 95);
    const shake =
      car.collisionShock * 0.08 +
      (car.onKerb ? Math.sin(performance.now() * 0.07) * 0.014 : 0);

    // Smooth local G-force head sway
    const targetSwayX = THREE.MathUtils.clamp(-car.yawRate * car.speed * 0.0018, -0.055, 0.055);
    const targetSwayZ = THREE.MathUtils.clamp(
      car.brakeApplied * 0.036 - car.throttleApplied * 0.02,
      -0.025,
      0.042,
    );
    const swayAlpha = Math.min(1, dt * 12);
    this.swayX += (targetSwayX - this.swayX) * swayAlpha;
    this.swayZ += (targetSwayZ - this.swayZ) * swayAlpha;

    let targetFov: number;
    const sinPitch = Math.sin(car.pitch);
    const cosPitch = Math.cos(car.pitch);

    if (countdownIntroAlpha > 0) {
      // Grid intro sweeping pan behind & beside the car before settling to chosen cam
      const sweep = countdownIntroAlpha;
      this.scratchPos.set(
        car.x - fwdX * (3.8 + sweep * 4.5) + rightX * (sweep * 3.2),
        car.y + 1.55 + sweep * 0.85,
        car.z - fwdZ * (3.8 + sweep * 4.5) + rightZ * (sweep * 3.2),
      );
      this.scratchTarget.set(
        car.x + fwdX * 14 * cosPitch,
        car.y + 0.6 + 14 * sinPitch,
        car.z + fwdZ * 14 * cosPitch,
      );
      targetFov = 58;
      this.camera.up.set(0, 1, 0);

      const posAlpha = this.initialized ? Math.min(1, dt * 14) : 1;
      this.smoothedPos.lerp(this.scratchPos, posAlpha);
      this.smoothedTarget.lerp(this.scratchTarget, posAlpha);
      this.initialized = true;
      this.camera.position.copy(this.smoothedPos);
      this.camera.lookAt(this.smoothedTarget);
    } else if (this.mode === 'tv-pod') {
      // Rigid onboard T-Cam locked strictly to (car.x, car.y, car.z) with local G-force sway
      this.scratchEuler.set(-car.pitch, car.heading, car.roll, 'YXZ');
      this.scratchLocal
        .set(this.swayX * 0.65 - car.steerAngle * 0.14, 1.24 + shake, -0.38 + this.swayZ * 0.45)
        .applyEuler(this.scratchEuler);
      this.scratchPos.set(
        car.x + this.scratchLocal.x,
        car.y + this.scratchLocal.y,
        car.z + this.scratchLocal.z,
      );

      const lookDist = 26;
      this.scratchTarget.set(
        car.x + fwdX * lookDist * cosPitch + rightX * (car.steerAngle * 1.4),
        car.y + 0.56 + lookDist * sinPitch,
        car.z + fwdZ * lookDist * cosPitch + rightZ * (car.steerAngle * 1.4),
      );
      targetFov = 64 + speedRatio * 12 + (car.boostActive ? 3.5 : 0);

      this.scratchEuler.set(-car.pitch, car.heading, car.roll * 0.6, 'YXZ');
      this.scratchUp.set(0, 1, 0).applyEuler(this.scratchEuler);
      this.camera.up.copy(this.scratchUp);

      this.smoothedPos.copy(this.scratchPos);
      this.smoothedTarget.copy(this.scratchTarget);
      this.initialized = true;
      this.camera.position.copy(this.scratchPos);
      this.camera.lookAt(this.scratchTarget);
    } else if (this.mode === 'cockpit') {
      // Rigid Cockpit driver eye point at (z = +0.24, y = 0.725) framing Halo + live F1 steering wheel & OLED dash
      this.scratchEuler.set(-car.pitch, car.heading, car.roll, 'YXZ');
      this.scratchLocal
        .set(this.swayX, 0.725 + shake * 0.45, 0.24 + this.swayZ)
        .applyEuler(this.scratchEuler);
      this.scratchPos.set(
        car.x + this.scratchLocal.x,
        car.y + this.scratchLocal.y,
        car.z + this.scratchLocal.z,
      );

      const lookDist = 26;
      this.scratchTarget.set(
        car.x + fwdX * lookDist * cosPitch + rightX * (car.steerAngle * 1.8),
        car.y + 0.50 + lookDist * sinPitch,
        car.z + fwdZ * lookDist * cosPitch + rightZ * (car.steerAngle * 1.8),
      );
      targetFov = 64 + speedRatio * 8;

      this.scratchUp.set(0, 1, 0).applyEuler(this.scratchEuler);
      this.camera.up.copy(this.scratchUp);

      this.smoothedPos.copy(this.scratchPos);
      this.smoothedTarget.copy(this.scratchTarget);
      this.initialized = true;
      this.camera.position.copy(this.scratchPos);
      this.camera.lookAt(this.scratchTarget);
    } else {
      // Chase Cam — elevated so car sits cleanly clear of bottom-right HUD
      const dist = 6.2 + speedRatio * 0.85;
      this.scratchPos.set(
        car.x - fwdX * dist - rightX * (car.steerAngle * 0.65),
        car.y + 2.45 - dist * sinPitch * 0.5 + shake,
        car.z - fwdZ * dist - rightZ * (car.steerAngle * 0.65),
      );
      const lookDist = 14;
      this.scratchTarget.set(
        car.x + fwdX * lookDist * cosPitch,
        car.y + 0.95 + lookDist * sinPitch,
        car.z + fwdZ * lookDist * cosPitch,
      );
      targetFov = 60 + speedRatio * 11 + (car.boostActive ? 3 : 0);
      this.camera.up.set(0, 1, 0);

      const posAlpha = this.initialized ? Math.min(1, dt * 11) : 1;
      const tgtAlpha = this.initialized ? Math.min(1, dt * 14) : 1;
      this.smoothedPos.lerp(this.scratchPos, posAlpha);
      this.smoothedTarget.lerp(this.scratchTarget, tgtAlpha);
      this.initialized = true;
      this.camera.position.copy(this.smoothedPos);
      this.camera.lookAt(this.smoothedTarget);
    }

    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
    this.camera.updateProjectionMatrix();
  }
}
