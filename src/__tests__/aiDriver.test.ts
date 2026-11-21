import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../data/circuits';
import { ALL_DRIVERS } from '../data/teamsAndDrivers';
import { AIDriver } from '../engine/AIDriver';
import {
  createInitialCarState,
  stepCarPhysics,
  type AssistConfig,
} from '../engine/CarPhysics';
import { TrackSpline } from '../engine/TrackSpline';

const AI_ASSISTS: AssistConfig = {
  gearbox: 'auto',
  tractionControl: 'medium',
  abs: true,
  racingLine: 'off',
};

describe('AIDriver — Difficulty Scaling, Braking, Strategy & Overtaking', () => {
  const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
  const monza = new TrackSpline(CIRCUITS.monza);
  const silverstone = new TrackSpline(CIRCUITS.silverstone);
  const vegas = new TrackSpline(CIRCUITS['las-vegas']);

  const verstappen = ALL_DRIVERS.find((d) => d.id === 'verstappen')!;
  const antonelli = ALL_DRIVERS.find((d) => d.id === 'antonelli')!;

  it('revs cleanly at 0.65 throttle with zero brake/steer/boost during countdown (canMove = false)', () => {
    const ai = new AIDriver(verstappen, 0);
    const car = createInitialCarState(verstappen.id, false, 1.0, rbr, 0, 'soft', true);
    const ctrl = ai.computeInput(car, rbr, [car], 'pro', 1 / 60, 5, false);
    expect(ctrl.throttle).toBeCloseTo(0.65, 5);
    expect(ctrl.brake).toBe(0);
    expect(ctrl.steer).toBe(0);
    expect(ctrl.boost).toBe(false);
  });

  it('scales racing pace cleanly across easy < medium < pro difficulties', () => {
    const runLapDistance = (difficulty: 'easy' | 'medium' | 'pro') => {
      const ai = new AIDriver(verstappen, 1);
      const car = createInitialCarState(verstappen.id, false, 1.0, monza, 0, 'soft', true);
      let distMeters = 0;
      for (let i = 0; i < 60 * 18; i++) {
        const ctrl = ai.computeInput(car, monza, [car], difficulty, 1 / 60, 3, true);
        stepCarPhysics(car, ctrl, monza, 1 / 60, [car], AI_ASSISTS, 3, true);
        distMeters += car.speed * (1 / 60);
      }
      return distMeters;
    };

    const easyDist = runLapDistance('easy');
    const medDist = runLapDistance('medium');
    const proDist = runLapDistance('pro');

    expect(medDist).toBeGreaterThan(easyDist);
    expect(proDist).toBeGreaterThan(medDist);
  });

  it('applies hard braking when approaching a tight corner well above recommended speed', () => {
    const ai = new AIDriver(antonelli, 2);
    // Find tightest corner on Monza (Turn 1 chicane)
    let tightIdx = 0;
    let lowestRec = Infinity;
    for (let i = 0; i < monza.samples.length; i++) {
      if (monza.samples[i].recommendedSpeed < lowestRec) {
        lowestRec = monza.samples[i].recommendedSpeed;
        tightIdx = i;
      }
    }
    const approachIdx = (tightIdx - 6 + monza.samples.length) % monza.samples.length;
    const sApproach = monza.samples[approachIdx];

    const car = createInitialCarState(antonelli.id, false, 1.0, monza, 0, 'soft', true);
    car.s = sApproach.s;
    car.sampleIndex = approachIdx;
    car.x = sApproach.position.x;
    car.y = sApproach.position.y;
    car.z = sApproach.position.z;
    car.heading = Math.atan2(sApproach.tangent.x, sApproach.tangent.z);
    car.speed = 88; // ~317 km/h into a chicane!

    const ctrl = ai.computeInput(car, monza, [car], 'pro', 1 / 60, 5, true);
    expect(ctrl.brake).toBeGreaterThan(0.5);
    expect(ctrl.throttle).toBe(0);
  });

  it('arms pitRequested on 5+ lap races when tireWear exceeds 0.68 in the pit window', () => {
    const ai = new AIDriver(verstappen, 0);
    const car = createInitialCarState(verstappen.id, false, 1.0, rbr, 0, 'soft', true);
    car.lap = 3;
    car.tireWear = 0.72;
    car.pitStopsCount = 0;
    car.pitRequested = false;

    ai.computeInput(car, rbr, [car], 'pro', 1 / 60, 6, true);
    expect(car.pitRequested).toBe(true);
  });

  it('does NOT arm pitRequested on short 3-lap races or on the final lap', () => {
    const ai = new AIDriver(verstappen, 0);

    const shortRaceCar = createInitialCarState(verstappen.id, false, 1.0, rbr, 0, 'soft', true);
    shortRaceCar.lap = 2;
    shortRaceCar.tireWear = 0.85;
    ai.computeInput(shortRaceCar, rbr, [shortRaceCar], 'pro', 1 / 60, 3, true);
    expect(shortRaceCar.pitRequested).toBe(false);

    const finalLapCar = createInitialCarState(verstappen.id, false, 1.0, rbr, 0, 'soft', true);
    finalLapCar.lap = 5;
    finalLapCar.tireWear = 0.85;
    ai.computeInput(finalLapCar, rbr, [finalLapCar], 'pro', 1 / 60, 5, true);
    expect(finalLapCar.pitRequested).toBe(false);
  });

  it('deploys ERS boost and shifts lane when overtaking a slower car in an Active Aero zone', () => {
    const ai = new AIDriver(verstappen, 0);
    // Find a sample inside an activeAeroZone on Monza
    const aeroSample = monza.samples.find((s) => s.activeAeroZone)!;
    expect(aeroSample).toBeDefined();

    const chaser = createInitialCarState(verstappen.id, false, 1.0, monza, 0, 'soft', true);
    chaser.s = aeroSample.s;
    chaser.sampleIndex = aeroSample.index;
    chaser.x = aeroSample.position.x;
    chaser.y = aeroSample.position.y;
    chaser.z = aeroSample.position.z;
    chaser.heading = Math.atan2(aeroSample.tangent.x, aeroSample.tangent.z);
    chaser.speed = 72;
    chaser.ersBattery = 0.85;
    chaser.lateralOffset = 0;

    const targetS = (aeroSample.s + 14 / monza.totalLength) % 1;
    const aheadSample = monza.sampleAtS(targetS);
    const slower = createInitialCarState(antonelli.id, false, 0.95, monza, 1, 'hard', true);
    slower.s = targetS;
    slower.sampleIndex = aheadSample.index;
    slower.x = aheadSample.position.x;
    slower.y = aheadSample.position.y;
    slower.z = aheadSample.position.z;
    slower.speed = 55;
    slower.lateralOffset = 0.2;

    const ctrl = ai.computeInput(chaser, monza, [chaser, slower], 'pro', 1 / 60, 5, true);
    expect(ctrl.boost).toBe(true);
    expect(Math.abs(ctrl.steer)).toBeGreaterThan(0.01);
  });

  it('reduces apex speed when tires are heavily worn vs fresh Softs', () => {
    const aiFresh = new AIDriver(verstappen, 0);
    const aiWorn = new AIDriver(verstappen, 0);

    // Locate medium/tight corner on Red Bull Ring
    const cornerSample = rbr.samples.find((s) => Math.abs(s.curvature) > 0.012)!;
    const makeCornerCar = (wear: number) => {
      const c = createInitialCarState(verstappen.id, false, 1.0, rbr, 0, 'soft', true);
      c.s = cornerSample.s;
      c.sampleIndex = cornerSample.index;
      c.x = cornerSample.position.x;
      c.y = cornerSample.position.y;
      c.z = cornerSample.position.z;
      c.heading = Math.atan2(cornerSample.tangent.x, cornerSample.tangent.z);
      c.speed = 55;
      c.tireWear = wear;
      return c;
    };

    const freshCar = makeCornerCar(0.02);
    const wornCar = makeCornerCar(0.88);
    const freshCtrl = aiFresh.computeInput(freshCar, rbr, [freshCar], 'pro', 1 / 60, 5, true);
    const wornCtrl = aiWorn.computeInput(wornCar, rbr, [wornCar], 'pro', 1 / 60, 5, true);

    expect(wornCtrl.brake).toBeGreaterThanOrEqual(freshCtrl.brake);
  });

  it('drives cleanly without NaN or barrier escape on Silverstone and Las Vegas', () => {
    for (const track of [silverstone, vegas]) {
      const ai = new AIDriver(antonelli, 3);
      const car = createInitialCarState(antonelli.id, false, 1.0, track, 0, 'medium', true);
      const maxWall = track.config.trackWidth * 0.5 + 6.5;

      let distMeters = 0;
      for (let i = 0; i < 60 * 20; i++) {
        const ctrl = ai.computeInput(car, track, [car], 'pro', 1 / 60, 3, true);
        stepCarPhysics(car, ctrl, track, 1 / 60, [car], AI_ASSISTS, 3, true);
        distMeters += car.speed * (1 / 60);
        expect(Number.isFinite(car.x)).toBe(true);
        expect(Number.isFinite(car.y)).toBe(true);
        expect(Number.isFinite(car.z)).toBe(true);
        expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(maxWall);
      }
      expect(distMeters).toBeGreaterThan(700);
    }
  });
});
