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

      built.dispose();
    });
  });
});
