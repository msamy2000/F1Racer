import { describe, expect, it } from 'vitest';
import { CIRCUIT_ORDER, CIRCUITS, type CircuitConfig } from '../data/circuits';
import { SAMPLE_COUNT, TrackSpline } from '../engine/TrackSpline';

describe('TrackSpline — Real-World 2026 Circuits', () => {
  for (const cid of CIRCUIT_ORDER) {
    describe(cid, () => {
      const cfg = CIRCUITS[cid];
      const spline = new TrackSpline(cfg);

      it('scales arc length cleanly to real-world circuit length', () => {
        expect(spline.samples.length).toBe(SAMPLE_COUNT);
        const relDiff = Math.abs(spline.totalLength - cfg.realLengthMeters) / cfg.realLengthMeters;
        expect(relDiff).toBeLessThan(0.05);
      });

      it('forms a smooth closed loop without self-intersections', () => {
        const first = spline.samples[0].position;
        const last = spline.samples[SAMPLE_COUNT - 1].position;
        const gap = first.distanceTo(last);
        const avgStep = spline.totalLength / SAMPLE_COUNT;
        expect(gap).toBeLessThan(avgStep * 1.8);

        const minSep = spline.computeMinNonAdjacentSeparationXZ();
        expect(minSep).toBeGreaterThanOrEqual(26);
      });

      it('produces finite up-stabilized frames (right.y === 0) and realistic braking-speed profiles', () => {
        for (const smp of spline.samples) {
          expect(Number.isFinite(smp.curvature)).toBe(true);
          expect(Number.isFinite(smp.pitch)).toBe(true);
          expect(Number.isFinite(smp.verticalCurvature)).toBe(true);
          expect(Number.isFinite(smp.camber)).toBe(true);
          expect(smp.right.y).toBe(0);
          expect(smp.recommendedSpeed).toBeGreaterThanOrEqual(18);
          expect(smp.recommendedSpeed).toBeLessThanOrEqual(99);
          expect(Math.abs(smp.tangent.length() - 1)).toBeLessThan(0.01);
          expect(Math.abs(smp.right.length() - 1)).toBeLessThan(0.01);
          expect(Math.abs(smp.up.length() - 1)).toBeLessThan(0.01);
          expect(Math.abs(smp.tangent.dot(smp.right))).toBeLessThan(0.05);
        }
        expect(spline.brakingBoards.length).toBeGreaterThanOrEqual(3);
      });

      it('interpolates pitch, verticalCurvature, camber and preserves right.y === 0 in sampleAtS', () => {
        const sTest = 0.2345;
        const interp = spline.sampleAtS(sTest);
        expect(interp.right.y).toBe(0);
        expect(Number.isFinite(interp.pitch)).toBe(true);
        expect(Number.isFinite(interp.verticalCurvature)).toBe(true);
        expect(Number.isFinite(interp.camber)).toBe(true);
      });
    });
  }

  it('computes 3D pitch & verticalCurvature on hills without polluting horizontal XZ curvature', () => {
    const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
    const maxPitch = Math.max(...rbr.samples.map((s) => Math.abs(s.pitch)));
    const maxVert = Math.max(...rbr.samples.map((s) => Math.abs(s.verticalCurvature)));
    expect(maxPitch).toBeGreaterThan(0.04);
    expect(maxVert).toBeGreaterThan(0.0001);

    // Flat Monza should have ~0 pitch and ~0 verticalCurvature
    const monza = new TrackSpline(CIRCUITS.monza);
    for (const smp of monza.samples) {
      expect(Math.abs(smp.pitch)).toBeLessThan(1e-5);
      expect(Math.abs(smp.verticalCurvature)).toBeLessThan(1e-5);
    }

    // Synthetic closed oval with a steep vertical hill along straight X/Z segments
    const syntheticHillCfg: CircuitConfig = {
      ...CIRCUITS.monza,
      realLengthMeters: 2000,
      controlPoints: [
        [0, 0, -300],
        [0, 25, -100],
        [0, 50, 100],
        [0, 0, 300],
        [200, 0, 300],
        [200, 0, -300],
      ],
    };
    const hillSpline = new TrackSpline(syntheticHillCfg);
    // Find the actual hilltop crest (maximum Y) along the x ≈ 0 straight
    const crestSample = hillSpline.samples
      .filter((s) => Math.abs(s.position.x) < 12)
      .reduce((best, cur) => (cur.position.y > best.position.y ? cur : best));
    expect(crestSample.position.y).toBeGreaterThan(40);
    expect(Math.abs(crestSample.curvature)).toBeLessThan(0.003);
    expect(crestSample.verticalCurvature).toBeLessThan(-0.0005);
  });
});
