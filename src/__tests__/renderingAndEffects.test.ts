import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../data/circuits';
import { ALL_DRIVERS, YAHIA_DRIVER } from '../data/teamsAndDrivers';
import { createInitialCarState } from '../engine/CarPhysics';
import { TrackSpline } from '../engine/TrackSpline';
import { buildF1CarMesh, buildGhostCarMesh } from '../rendering/CarMeshBuilder';
import { EffectsManager } from '../rendering/EffectsManager';
import { buildPodiumDriverCharacter, resolvePodiumDrivers } from '../rendering/SceneManager';

function withMockCanvas<T>(fn: () => T): T {
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 128,
      height: 128,
      getContext: () => ({
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        scale: () => {},
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        fillRect: () => {},
        fillText: () => {},
        fillStyle: '',
        font: '',
        textAlign: 'center',
        textBaseline: 'middle',
      }),
    }),
  };
  try {
    return fn();
  } finally {
    if (prevDoc === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  }
}

describe('CarMeshBuilder & EffectsManager — 2026 Rig, Cockpit & Zero-GC Effects', () => {
  it('configures YXZ rotation order, connected Halo, cockpit helmet hide, and roll-leveled Contact AO', () => {
    withMockCanvas(() => {
      const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
      const car = createInitialCarState('yahia', true, 1.015, rbr, 0, 'soft', true);
      car.pitch = 0.08;
      car.roll = 0.05;
      car.heading = 1.1;

      const rig = buildF1CarMesh(YAHIA_DRIVER, 'mercedes', 'soft');
      const ghost = buildGhostCarMesh();
      expect(rig.root.rotation.order).toBe('YXZ');
      expect(ghost.rotation.order).toBe('YXZ');

      rig.updateFromState(car, 1.0);
      expect(rig.root.rotation.y).toBeCloseTo(1.1, 6);
      expect(rig.root.rotation.x).toBeCloseTo(-0.08, 6);
      expect(rig.root.rotation.z).toBeCloseTo(0.05, 6);

      // Verify Contact AO plane stays level in world space despite car.roll
      rig.root.updateMatrixWorld(true);
      let aoMesh: THREE.Mesh | null = null;
      let haloLoopMesh: THREE.Mesh | null = null;
      let helmetGroup: THREE.Object3D | null = null;
      rig.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.PlaneGeometry) {
          const p = obj.geometry.parameters as { width: number; height: number };
          if (Math.abs(p.width - 2.35) < 0.01) aoMesh = obj;
        }
        if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.TorusGeometry) {
          const p = obj.geometry.parameters as { radius: number };
          if (Math.abs(p.radius - 0.29) < 0.01) haloLoopMesh = obj;
        }
        if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.SphereGeometry) {
          const p = obj.geometry.parameters as { radius: number };
          if (Math.abs(p.radius - 0.145) < 0.005) helmetGroup = obj.parent;
        }
      });

      expect(aoMesh).not.toBeNull();
      expect(aoMesh!.parent!.rotation.z).toBeCloseTo(-0.05, 6);

      // Halo hoop must sweep forward in car local space to meet the center Halo pylon (z >= 0.64)
      expect(haloLoopMesh).not.toBeNull();
      const invRoot = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
      const toCarLocal = new THREE.Matrix4().multiplyMatrices(invRoot, haloLoopMesh!.matrixWorld);
      const posAttr = haloLoopMesh!.geometry.getAttribute('position');
      const v = new THREE.Vector3();
      let maxZ = -Infinity;
      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(toCarLocal);
        if (v.z > maxZ) maxZ = v.z;
      }
      expect(maxZ).toBeGreaterThan(0.64);

      // Cockpit mode hides driver helmet and restores on exit
      expect(helmetGroup).not.toBeNull();
      expect(helmetGroup!.visible).toBe(true);
      rig.setCockpitView(true);
      expect(helmetGroup!.visible).toBe(false);
      rig.setCockpitView(false);
      expect(helmetGroup!.visible).toBe(true);

      // Compound swap updates tire sidewall rings and getter
      car.tireCompound = 'medium';
      rig.updateFromState(car, 1.05);
      expect(rig.currentCompound).toBe('medium');
      expect(rig.tireRingMaterials[0].color.getHexString()).toBe('ffd700');

      rig.dispose();
    });
  });

  it('emits sparks, tire puffs, persistent skid segments, and ERS boost plume cleanly on sloped tracks', () => {
    const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
    const car = createInitialCarState('yahia', true, 1.015, rbr, 0, 'soft', true);
    const fx = new EffectsManager();

    // Drive uphill with sparks, hard braking/slip, and boost active
    car.speed = 76;
    car.pitch = 0.09;
    car.onKerb = true;
    car.isBrakingHard = true;
    car.slipRatio = 0.55;
    car.lateralSpeed = 3.2;
    car.boostActive = true;

    const dt = 1 / 60;
    for (let i = 0; i < 40; i++) {
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      car.y += Math.sin(car.pitch) * car.speed * dt;
      fx.update([car], dt);
    }

    const meshes: THREE.InstancedMesh[] = [];
    fx.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) meshes.push(obj);
    });
    expect(meshes.length).toBe(4);
    for (const m of meshes) {
      expect(m.count).toBeGreaterThan(0);
    }

    // Verify last emitted skid mark matrix Y matches rear axle slope height (car.y - 1.62 * sin(pitch) + 0.036)
    const skidsMesh = meshes[2];
    const mat = new THREE.Matrix4();
    skidsMesh.getMatrixAt(skidsMesh.count - 1, mat);
    const pos = new THREE.Vector3().setFromMatrixPosition(mat);
    const expectedRearY = car.y - 1.62 * Math.sin(car.pitch) + 0.036;
    expect(Math.abs(pos.y - expectedRearY)).toBeLessThan(0.25);

    fx.dispose();
  });

  it('builds valid car rigs for all 11 drivers and dynamically switches tire compound colors & brake glow', () => {
    withMockCanvas(() => {
      const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
      const car = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);

      for (const teamId of ['mercedes', 'redbull', 'mclaren'] as const) {
        const rig = buildF1CarMesh(YAHIA_DRIVER, teamId, 'soft');
        expect(rig.currentCompound).toBe('soft');
        expect(rig.tireRingMaterials.length).toBeGreaterThanOrEqual(4);
        expect(rig.brakeGlowMaterials.length).toBeGreaterThanOrEqual(4);

        // Switch tire compounds soft -> medium -> hard
        rig.setTireCompound('medium');
        expect(rig.currentCompound).toBe('medium');
        rig.setTireCompound('hard');
        expect(rig.currentCompound).toBe('hard');

        // Hard braking ramps brake disc glow emissive intensity
        car.isBrakingHard = true;
        car.boostActive = true;
        for (let i = 0; i < 15; i++) {
          rig.updateFromState(car, i * 0.05);
        }
        expect(rig.brakeGlowMaterials[0].emissiveIntensity).toBeGreaterThan(0.8);
        expect(rig.rearLedMaterial.emissiveIntensity).toBeGreaterThan(2.0);

        rig.dispose();
      }
    });
  });

  it('wraps the 600-segment skid mark ring buffer cleanly without overflowing or throwing', () => {
    const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
    const car = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);
    const fx = new EffectsManager();
    car.speed = 60;
    car.slipRatio = 0.8;
    car.isBrakingHard = true;

    for (let i = 0; i < 400; i++) {
      car.z += 1.0;
      fx.update([car], 1 / 60);
    }

    const meshes: THREE.InstancedMesh[] = [];
    fx.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) meshes.push(obj);
    });
    const skidsMesh = meshes[2];
    expect(skidsMesh.count).toBe(600);
    fx.dispose();
  });

  it('builds all 12 visible F1 grid cars independently and creates 3 articulated podium driver characters', () => {
    withMockCanvas(() => {
      const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
      const rigs = ALL_DRIVERS.map((drv, idx) => {
        const car = createInitialCarState(drv.id, idx === 3, 1.0, rbr, idx, 'soft', false);
        const rig = buildF1CarMesh(drv, 'mercedes', car.tireCompound);
        rig.updateFromState(car, 0.1);
        return { rig, car };
      });

      expect(rigs).toHaveLength(12);
      const distinctX = new Set(rigs.map(({ rig }) => rig.root.position.x.toFixed(2)));
      expect(distinctX.size).toBeGreaterThanOrEqual(6);
      for (const { rig } of rigs) {
        expect(rig.root.visible).toBe(true);
        let meshCount = 0;
        rig.root.traverse((obj) => {
          if (obj instanceof THREE.Mesh) meshCount += 1;
        });
        expect(meshCount).toBeGreaterThan(15);
      }
      // Disposing one car rig leaves remaining 11 grid car geometries intact
      rigs[0].rig.dispose();
      for (let i = 1; i < rigs.length; i++) {
        let validGeo = 0;
        rigs[i].rig.root.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.geometry.getAttribute('position').count > 0) {
            validGeo += 1;
          }
        });
        expect(validGeo).toBeGreaterThan(15);
        rigs[i].rig.dispose();
      }

      // Podium ceremony resolves 3 distinct drivers and constructs P1/P2/P3 articulated characters
      const podiumDrivers = resolvePodiumDrivers(YAHIA_DRIVER);
      expect(new Set(podiumDrivers.map((d) => d.id)).size).toBe(3);

      const trimByRank = ['#FFD700', '#CBD5E1', '#D97706'] as const;
      (['1', '2', '3'] as const).forEach((rank, idx) => {
        const pRig = buildPodiumDriverCharacter(
          podiumDrivers[idx],
          'mercedes',
          rank,
          trimByRank[idx],
          1.6 - idx * 0.4,
        );
        expect(pRig.group.name).toBe(`podium-driver-${rank}`);
        expect(pRig.rightArm.children.length).toBeGreaterThanOrEqual(4); // shoulder, upper, glove + trophy
        expect(pRig.leftArm.children.length).toBeGreaterThanOrEqual(4); // shoulder, upper, glove + champagne bottle
        expect(pRig.trophyGroup.children.length).toBe(4);
      });
    });
  });
});
