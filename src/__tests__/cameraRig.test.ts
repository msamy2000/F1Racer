import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../data/circuits';
import { createInitialCarState } from '../engine/CarPhysics';
import { TrackSpline } from '../engine/TrackSpline';
import { CAMERA_LABELS, CameraRig } from '../rendering/CameraRig';

describe('CameraRig — Modes, Zero-Lag Onboard Lock, Showroom & 3D Framing', () => {
  const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);

  it('defaults to tv-pod and cycles tv-pod -> chase -> cockpit -> tv-pod', () => {
    const rig = new CameraRig(16 / 9);
    expect(rig.mode).toBe('tv-pod');
    expect(CAMERA_LABELS['tv-pod']).toContain('TV POD');

    expect(rig.cycleMode()).toBe('chase');
    expect(rig.cycleMode()).toBe('cockpit');
    expect(rig.cycleMode()).toBe('tv-pod');
  });

  it('updates aspect ratio and projection matrix cleanly via setAspect()', () => {
    const rig = new CameraRig(16 / 9);
    rig.setAspect(21 / 9);
    expect(rig.camera.aspect).toBeCloseTo(21 / 9, 5);
    expect(rig.camera.near).toBeLessThanOrEqual(0.1);
    expect(rig.camera.far).toBeGreaterThanOrEqual(3000);
  });

  it('orbits smoothly in updateMenuShowroom with finite coordinates', () => {
    const rig = new CameraRig(16 / 9);
    rig.updateMenuShowroom(0);
    const p0 = rig.camera.position.clone();
    rig.updateMenuShowroom(2.5);
    const p1 = rig.camera.position.clone();

    expect(Number.isFinite(p0.x) && Number.isFinite(p0.y) && Number.isFinite(p0.z)).toBe(true);
    expect(Number.isFinite(p1.x) && Number.isFinite(p1.y) && Number.isFinite(p1.z)).toBe(true);
    expect(p0.distanceTo(p1)).toBeGreaterThan(1.0);
    expect(rig.camera.fov).toBe(44);
  });

  it('orbits around the car in updateVictoryOrbit', () => {
    const rig = new CameraRig(16 / 9);
    const car = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);
    car.x = 120;
    car.y = 14;
    car.z = -80;

    rig.updateVictoryOrbit(car, 1.2);
    const dist = Math.hypot(rig.camera.position.x - car.x, rig.camera.position.z - car.z);
    expect(dist).toBeCloseTo(6.5, 2);
    expect(rig.camera.position.y).toBeCloseTo(car.y + 2.3, 2);
  });

  it('keeps TV Pod (T-Cam) rigidly locked to car chassis with zero world-space lag at 95 m/s', () => {
    const rig = new CameraRig(16 / 9);
    const car = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);
    car.heading = 0;
    car.pitch = 0.06;
    car.roll = 0.03;
    car.speed = 95;
    car.x = 50;
    car.y = 8;
    car.z = 200;

    rig.updateRace(car, 1 / 60, 0);
    const dx = rig.camera.position.x - car.x;
    const dy = rig.camera.position.y - car.y;
    const dz = rig.camera.position.z - car.z;
    expect(Math.hypot(dx, dy, dz)).toBeLessThan(1.6);

    // Jump car forward 1.58m (1 frame at 95 m/s) — camera must move with zero lag
    car.z += 1.58;
    rig.updateRace(car, 1 / 60, 0);
    expect(Math.abs(rig.camera.position.z - (car.z - 0.38))).toBeLessThan(0.15);
  });

  it('positions Cockpit camera at driver eye point inside Halo with zero world lag', () => {
    const rig = new CameraRig(16 / 9);
    rig.mode = 'cockpit';
    const car = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);
    car.heading = 0;
    car.pitch = 0;
    car.roll = 0;
    car.speed = 70;
    car.x = 10;
    car.y = 2;
    car.z = 40;

    rig.updateRace(car, 1 / 60, 0);
    expect(rig.camera.position.y).toBeCloseTo(car.y + 0.725, 1);
    expect(rig.camera.position.z).toBeGreaterThan(car.z + 0.15);
    expect(rig.camera.position.z).toBeLessThan(car.z + 0.35);
  });

  it('positions Chase Cam behind and elevated above the car and widens FOV on ERS boost', () => {
    const rig = new CameraRig(16 / 9);
    rig.mode = 'chase';
    const car = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);
    car.heading = 0;
    car.pitch = 0;
    car.speed = 80;
    car.x = 0;
    car.y = 0;
    car.z = 0;

    for (let i = 0; i < 60; i++) rig.updateRace(car, 1 / 60, 0);
    const baseFov = rig.camera.fov;
    expect(rig.camera.position.z).toBeLessThan(-5.5);
    expect(rig.camera.position.y).toBeGreaterThan(2.0);

    car.boostActive = true;
    for (let i = 0; i < 60; i++) rig.updateRace(car, 1 / 60, 0);
    expect(rig.camera.fov).toBeGreaterThan(baseFov + 1.5);
  });

  it('sweeps smoothly during countdown intro (countdownIntroAlpha > 0) without NaN', () => {
    const rig = new CameraRig(16 / 9);
    const car = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);

    for (const alpha of [1.0, 0.65, 0.3, 0.05]) {
      rig.updateRace(car, 1 / 60, alpha);
      expect(Number.isFinite(rig.camera.position.x)).toBe(true);
      expect(Number.isFinite(rig.camera.position.y)).toBe(true);
      expect(Number.isFinite(rig.camera.position.z)).toBe(true);
    }
  });

  it('glides smoothly across the 3D Grand Prix Podium stage in updatePodiumStage()', () => {
    const rig = new CameraRig(16 / 9);
    rig.updatePodiumStage(0);
    const p0 = rig.camera.position.clone();
    rig.updatePodiumStage(2.4);
    const p1 = rig.camera.position.clone();

    expect(Number.isFinite(p0.x) && Number.isFinite(p0.y) && Number.isFinite(p0.z)).toBe(true);
    expect(Number.isFinite(p1.x) && Number.isFinite(p1.y) && Number.isFinite(p1.z)).toBe(true);
    expect(p0.distanceTo(p1)).toBeGreaterThan(1.5);
    expect(rig.camera.fov).toBe(46);
  });
});
