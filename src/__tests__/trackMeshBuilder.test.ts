import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CIRCUIT_ORDER, CIRCUITS } from '../data/circuits';
import { isSInZone, SAMPLE_COUNT, TrackSpline } from '../engine/TrackSpline';
import { buildRibbonGeometry, buildTrackWorld } from '../rendering/TrackMeshBuilder';

function withMockCanvas<T>(fn: () => T): T {
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => ({
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        scale: () => {},
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        beginPath: () => {},
        moveTo: () => {},
        bezierCurveTo: () => {},
        stroke: () => {},
        arc: () => {},
        fill: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        fillText: () => {},
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
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

describe('TrackMeshBuilder — Ribbon Normals, Closed Seam & World Clearances', () => {
  it('orients horizontal track ribbon normals upward (+Y) with monotonic closed UVs', () => {
    for (const cid of ['red-bull-ring', 'monza'] as const) {
      const track = new TrackSpline(CIRCUITS[cid]);
      const halfW = track.config.trackWidth * 0.5;
      const left: THREE.Vector3[] = [];
      const right: THREE.Vector3[] = [];

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const s = track.samples[i];
        left.push(s.position.clone().addScaledVector(s.right, -halfW));
        right.push(s.position.clone().addScaledVector(s.right, halfW));
      }

      const uvRepeat = 120;
      const geo = buildRibbonGeometry(left, right, true, uvRepeat);
      const normals = geo.getAttribute('normal');
      const uvs = geo.getAttribute('uv');

      expect(normals.count).toBe((SAMPLE_COUNT + 1) * 2);
      for (let i = 0; i < normals.count; i++) {
        expect(normals.getY(i)).toBeGreaterThan(0.9);
      }

      // Check monotonic closed UV along v without wrap-back seam jump
      let prevV = -1;
      for (let row = 0; row <= SAMPLE_COUNT; row++) {
        const v = uvs.getY(row * 2);
        expect(v).toBeGreaterThan(prevV);
        prevV = v;
      }
      expect(uvs.getY(SAMPLE_COUNT * 2)).toBeCloseTo(uvRepeat, 4);
    }
  });

  it('builds finite world geometry for all 4 circuits, keeps ground below spline minY, and clears pit/alpine hazards', () => {
    withMockCanvas(() => {
      for (const cid of CIRCUIT_ORDER) {
        const track = new TrackSpline(CIRCUITS[cid]);
        const built = buildTrackWorld(track);
        const halfW = track.config.trackWidth * 0.5;

        let groundY: number | null = null;
        built.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            const posAttr = obj.geometry.getAttribute('position');
            for (let i = 0; i < posAttr.count; i++) {
              expect(Number.isFinite(posAttr.getX(i))).toBe(true);
              expect(Number.isFinite(posAttr.getY(i))).toBe(true);
              expect(Number.isFinite(posAttr.getZ(i))).toBe(true);
            }
            if (obj.geometry instanceof THREE.PlaneGeometry) {
              const params = obj.geometry.parameters as { width: number; height: number };
              if (params.width >= 5000) {
                groundY = obj.position.y;
              }
            }
            // Vegas light poles must never stand inside the pit lane corridor
            if (cid === 'las-vegas' && obj.geometry instanceof THREE.CylinderGeometry) {
              const p = obj.geometry.parameters as { height: number };
              if (Math.abs(p.height - 10) < 0.1) {
                const proj = track.projectToTrack(obj.position.x, obj.position.z, 0);
                if (isSInZone(proj.s, track.config.pitEntryS, track.config.pitExitS)) {
                  expect(Math.sign(proj.lateralOffset)).not.toBe(track.config.pitSide);
                }
              }
            }
            // Red Bull Ring distant alpine hills must stay strictly outside track bounds
            if (cid === 'red-bull-ring' && obj.geometry instanceof THREE.ConeGeometry) {
              const p = obj.geometry.parameters as { radius: number };
              if (p.radius >= 200) {
                const proj = track.projectToTrack(obj.position.x, obj.position.z, 0);
                expect(Math.abs(proj.lateralOffset)).toBeGreaterThan(p.radius + halfW);
              }
            }
          }
        });

        expect(groundY).not.toBeNull();
        expect(groundY!).toBeLessThan(track.boundsMin.y - 0.5);
        built.dispose();
      }
    });
  }, 15000);

  it('controls 5 red start lights, racing line modes (full/corners/off), and Las Vegas Sphere landmark', () => {
    withMockCanvas(() => {
      const vegas = new TrackSpline(CIRCUITS['las-vegas']);
      const built = buildTrackWorld(vegas);

      expect(built.startLightMaterials.length).toBe(5);
      expect(built.vegasSphereMat).not.toBeNull();

      built.updateStartLights(0);
      expect(built.startLightMaterials.every((m) => m.emissiveIntensity < 0.2)).toBe(true);

      built.updateStartLights(3);
      expect(built.startLightMaterials[0].emissiveIntensity).toBeGreaterThan(3.0);
      expect(built.startLightMaterials[2].emissiveIntensity).toBeGreaterThan(3.0);
      expect(built.startLightMaterials[3].emissiveIntensity).toBeLessThan(0.2);

      built.updateStartLights(5);
      expect(built.startLightMaterials.every((m) => m.emissiveIntensity > 3.0)).toBe(true);

      built.updateRacingLine(70, 'off', 1.0);
      expect(built.racingLineMesh.visible).toBe(false);

      built.updateRacingLine(70, 'corners', 1.0);
      expect(built.racingLineMesh.visible).toBe(true);

      built.updateRacingLine(70, 'full', 1.0);
      expect(built.racingLineMesh.visible).toBe(true);

      // Verify the MSG Sphere (Big Shiny Ball) sits inside the T5-T9 Sphere Arena horseshoe at real GPS coordinates
      const sphereCenter = CIRCUITS['las-vegas'].landmarkCenter!;
      expect(sphereCenter).toBeDefined();
      for (const sArena of [0.28, 0.33, 0.37]) {
        const smp = vegas.sampleAtS(sArena);
        const distToSphere = Math.hypot(
          smp.position.x - sphereCenter[0],
          smp.position.z - sphereCenter[2],
        );
        // Track wraps ~140-235m around the 72m-radius Sphere center inside the arena horseshoe
        expect(distToSphere).toBeGreaterThan(110);
        expect(distToSphere).toBeLessThan(260);
      }

      built.dispose();
    });
  });

  it('builds distinct outdoor ecosystems & landmarks per daylight circuit (no shared mountains or treeline wall)', () => {
    withMockCanvas(() => {
      const rbrWorld = buildTrackWorld(new TrackSpline(CIRCUITS['red-bull-ring']));
      const monzaWorld = buildTrackWorld(new TrackSpline(CIRCUITS.monza));
      const silWorld = buildTrackWorld(new TrackSpline(CIRCUITS.silverstone));

      expect(rbrWorld.group.getObjectByName('horizon-red-bull-ring')).toBeDefined();
      expect(rbrWorld.group.getObjectByName('alpine-mountain-range')).toBeDefined();
      expect(rbrWorld.group.getObjectByName('rbr-hillside-chalet')).toBeDefined();

      expect(monzaWorld.group.getObjectByName('horizon-monza')).toBeDefined();
      expect(monzaWorld.group.getObjectByName('lombardy-prealps-range')).toBeDefined();
      expect(monzaWorld.group.getObjectByName('monza-park-wall')).toBeDefined();
      expect(monzaWorld.group.getObjectByName('monza-park-bridge')).toBeDefined();

      expect(silWorld.group.getObjectByName('horizon-silverstone')).toBeDefined();
      expect(silWorld.group.getObjectByName('alpine-mountain-range')).toBeUndefined();
      expect(silWorld.group.getObjectByName('lombardy-prealps-range')).toBeUndefined();
      expect(silWorld.group.getObjectByName('silverstone-wing')).toBeDefined();
      expect(silWorld.group.getObjectByName('silverstone-campsite')).toBeDefined();
      expect(silWorld.group.getObjectByName('silverstone-cranes')).toBeDefined();

      rbrWorld.dispose();
      monzaWorld.dispose();
      silWorld.dispose();
    });
  });

  it('isolates Las Vegas Strip night ecosystem & Exosphere from all daylight horizon walls', () => {
    withMockCanvas(() => {
      const vegasWorld = buildTrackWorld(new TrackSpline(CIRCUITS['las-vegas']));
      expect(vegasWorld.vegasSphereMat).not.toBeNull();
      expect(vegasWorld.group.getObjectByName('horizon-red-bull-ring')).toBeUndefined();
      expect(vegasWorld.group.getObjectByName('horizon-monza')).toBeUndefined();
      expect(vegasWorld.group.getObjectByName('horizon-silverstone')).toBeUndefined();
      expect(vegasWorld.group.getObjectByName('alpine-mountain-range')).toBeUndefined();
      vegasWorld.dispose();
    });
  });

  it('preserves Styrian Alpine elevation (>35m) & chalet landmarks exclusively on Red Bull Ring', () => {
    withMockCanvas(() => {
      const rbrSpline = new TrackSpline(CIRCUITS['red-bull-ring']);
      expect(rbrSpline.boundsMax.y - rbrSpline.boundsMin.y).toBeGreaterThan(35);

      const rbrWorld = buildTrackWorld(rbrSpline);
      expect(rbrWorld.vegasSphereMat).toBeNull();
      expect(rbrWorld.group.getObjectByName('alpine-mountain-range')).toBeDefined();
      expect(rbrWorld.group.getObjectByName('rbr-hillside-chalet')).toBeDefined();
      expect(rbrWorld.group.getObjectByName('monza-park-wall')).toBeUndefined();
      expect(rbrWorld.group.getObjectByName('silverstone-wing')).toBeUndefined();
      rbrWorld.dispose();
    });
  });

  it('preserves Monza Royal Park walls, historic bridges & Lombardy Prealps exclusively on Monza', () => {
    withMockCanvas(() => {
      const monzaWorld = buildTrackWorld(new TrackSpline(CIRCUITS.monza));
      expect(monzaWorld.vegasSphereMat).toBeNull();
      expect(monzaWorld.group.getObjectByName('lombardy-prealps-range')).toBeDefined();
      expect(monzaWorld.group.getObjectByName('monza-park-wall')).toBeDefined();
      expect(monzaWorld.group.getObjectByName('monza-park-bridge')).toBeDefined();
      expect(monzaWorld.group.getObjectByName('rbr-hillside-chalet')).toBeUndefined();
      expect(monzaWorld.group.getObjectByName('silverstone-wing')).toBeUndefined();
      monzaWorld.dispose();
    });
  });

  it('preserves flat British airfield elevation (<15m) & Wing/campsite/cranes exclusively on Silverstone', () => {
    withMockCanvas(() => {
      const silSpline = new TrackSpline(CIRCUITS.silverstone);
      expect(silSpline.boundsMax.y - silSpline.boundsMin.y).toBeLessThan(15);

      const silWorld = buildTrackWorld(silSpline);
      expect(silWorld.vegasSphereMat).toBeNull();
      expect(silWorld.group.getObjectByName('silverstone-wing')).toBeDefined();
      expect(silWorld.group.getObjectByName('silverstone-campsite')).toBeDefined();
      expect(silWorld.group.getObjectByName('silverstone-cranes')).toBeDefined();
      expect(silWorld.group.getObjectByName('rbr-hillside-chalet')).toBeUndefined();
      expect(silWorld.group.getObjectByName('monza-park-wall')).toBeUndefined();
      silWorld.dispose();
    });
  });

  it('disposes all 4 circuit track worlds cleanly without throwing', () => {
    withMockCanvas(() => {
      for (const cid of CIRCUIT_ORDER) {
        const built = buildTrackWorld(new TrackSpline(CIRCUITS[cid]));
        expect(() => built.dispose()).not.toThrow();
      }
    });
  });
});
