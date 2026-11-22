import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../data/circuits';
import {
  countWheelsOffTrack,
  createInitialCarState,
  stepCarPhysics,
  type AssistConfig,
} from '../engine/CarPhysics';
import { mapAnalogWheelSteer, type ControlInput } from '../engine/InputManager';
import { TrackSpline } from '../engine/TrackSpline';

function makeCtrl(overrides: Partial<ControlInput> = {}): ControlInput {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    boost: false,
    shiftUpPressed: false,
    shiftDownPressed: false,
    cameraPressed: false,
    pitPressed: false,
    resetPressed: false,
    pausePressed: false,
    ...overrides,
  };
}

const EASY_ASSISTS: AssistConfig = {
  gearbox: 'auto',
  tractionControl: 'full',
  abs: true,
  racingLine: 'full',
  steeringAssist: true,
  brakingAssist: true,
};

const RAW_ASSISTS: AssistConfig = {
  gearbox: 'auto',
  tractionControl: 'medium',
  abs: true,
  racingLine: 'corners',
  steeringAssist: false,
  brakingAssist: false,
};

describe('Asphalt Driving Controls & Smart Driving Assists', () => {
  const monza = new TrackSpline(CIRCUITS.monza);
  const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);

  it('applies a forgiving center deadzone and progressive precision curve in mapAnalogWheelSteer', () => {
    expect(mapAnalogWheelSteer(0)).toBe(0);
    expect(mapAnalogWheelSteer(0.1)).toBe(0);
    expect(mapAnalogWheelSteer(-0.12)).toBe(0);

    const gentle = mapAnalogWheelSteer(0.35);
    expect(gentle).toBeGreaterThan(0);
    expect(gentle).toBeLessThan(0.12);
    expect(mapAnalogWheelSteer(-0.35)).toBeCloseTo(-gentle, 6);

    expect(mapAnalogWheelSteer(1)).toBeCloseTo(1, 6);
    expect(mapAnalogWheelSteer(2.4)).toBeCloseTo(1, 6);
    expect(mapAnalogWheelSteer(-2.4)).toBeCloseTo(-1, 6);
  });

  it('keeps hands-off car cleanly on Monza and Red Bull Ring for 18 seconds with substantial pace', () => {
    const dt = 1 / 60;
    for (const track of [monza, rbr]) {
      const car = createInitialCarState('yahia', true, 1.0, track, 0, 'soft', true);
      const maxWall = track.config.trackWidth * 0.5 + 4.41;
      let distMeters = 0;

      for (let i = 0; i < 60 * 18; i++) {
        stepCarPhysics(
          car,
          makeCtrl({ throttle: 1, steer: 0 }),
          track,
          dt,
          [car],
          EASY_ASSISTS,
          5,
          true,
        );
        distMeters += car.speed * dt;
        expect(Number.isFinite(car.x)).toBe(true);
        expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(maxWall);
      }

      expect(distMeters).toBeGreaterThan(700);
      expect(car.offTrack).toBe(false);
    }
  });

  it('preserves player lateral lane freedom when actively steering right or left', () => {
    const dt = 1 / 60;
    const carRight = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    const smp = monza.sampleAtS(0.02);
    carRight.x = smp.position.x;
    carRight.y = smp.position.y;
    carRight.z = smp.position.z;
    carRight.s = smp.s;
    carRight.sampleIndex = smp.index;
    carRight.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    carRight.speed = 55;

    for (let i = 0; i < 24; i++) {
      stepCarPhysics(
        carRight,
        makeCtrl({ throttle: 1, steer: 0.9 }),
        monza,
        dt,
        [carRight],
        EASY_ASSISTS,
        5,
        true,
      );
    }

    expect(carRight.lateralOffset).toBeGreaterThan(2.5);
  });

  it('brakes automatically into Monza T1 chicane when overspeeding unless player holds Boost', () => {
    const dt = 1 / 60;
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

    const makeApproachCar = () => {
      const c = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
      c.s = sApproach.s;
      c.sampleIndex = approachIdx;
      c.x = sApproach.position.x;
      c.y = sApproach.position.y;
      c.z = sApproach.position.z;
      c.heading = Math.atan2(sApproach.tangent.x, sApproach.tangent.z);
      c.speed = 88;
      return c;
    };

    const assistedCar = makeApproachCar();
    const unassistedCar = makeApproachCar();
    const boostedCar = makeApproachCar();

    for (let i = 0; i < 30; i++) {
      stepCarPhysics(
        assistedCar,
        makeCtrl({ throttle: 1, boost: false }),
        monza,
        dt,
        [assistedCar],
        EASY_ASSISTS,
        5,
        true,
      );
      stepCarPhysics(
        unassistedCar,
        makeCtrl({ throttle: 1, boost: false }),
        monza,
        dt,
        [unassistedCar],
        RAW_ASSISTS,
        5,
        true,
      );
      stepCarPhysics(
        boostedCar,
        makeCtrl({ throttle: 1, boost: true }),
        monza,
        dt,
        [boostedCar],
        EASY_ASSISTS,
        5,
        true,
      );
    }

    expect(assistedCar.speed).toBeLessThan(unassistedCar.speed - 8);
    expect(assistedCar.brakeApplied).toBeGreaterThan(0.3);
    expect(boostedCar.speed).toBeGreaterThan(assistedCar.speed + 8);
  });

  it('calms gentle high-speed steering yaw rate with steeringAssist enabled', () => {
    const dt = 1 / 60;
    const smp = monza.sampleAtS(0.02);

    const makeFastCar = () => {
      const c = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
      c.s = smp.s;
      c.sampleIndex = smp.index;
      c.x = smp.position.x;
      c.y = smp.position.y;
      c.z = smp.position.z;
      c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      c.speed = 85;
      return c;
    };

    const smoothCar = makeFastCar();
    const rawCar = makeFastCar();

    for (let i = 0; i < 15; i++) {
      stepCarPhysics(
        smoothCar,
        makeCtrl({ throttle: 1, steer: 0.25 }),
        monza,
        dt,
        [smoothCar],
        { ...RAW_ASSISTS, steeringAssist: true },
        5,
        true,
      );
      stepCarPhysics(
        rawCar,
        makeCtrl({ throttle: 1, steer: 0.25 }),
        monza,
        dt,
        [rawCar],
        RAW_ASSISTS,
        5,
        true,
      );
    }

    expect(Math.abs(smoothCar.yawRate)).toBeLessThan(Math.abs(rawCar.yawRate) * 0.65);
  });

  it('activates kinematic stopping-distance BAS from 92 m/s into Monza T1', () => {
    const dt = 1 / 60;
    let tightIdx = 0;
    let lowestRec = Infinity;
    for (let i = 0; i < monza.samples.length; i++) {
      if (monza.samples[i].recommendedSpeed < lowestRec) {
        lowestRec = monza.samples[i].recommendedSpeed;
        tightIdx = i;
      }
    }
    const approachIdx = (tightIdx - 12 + monza.samples.length) % monza.samples.length;
    const t1Approach = monza.samples[approachIdx];
    const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    car.s = t1Approach.s;
    car.sampleIndex = approachIdx;
    car.x = t1Approach.position.x;
    car.y = t1Approach.position.y;
    car.z = t1Approach.position.z;
    car.heading = Math.atan2(t1Approach.tangent.x, t1Approach.tangent.z);
    car.speed = 92;

    let sawBasActive = false;
    let peakBasIntensity = 0;
    for (let i = 0; i < 90; i++) {
      stepCarPhysics(
        car,
        makeCtrl({ throttle: 1, boost: false }),
        monza,
        dt,
        [car],
        EASY_ASSISTS,
        5,
        true,
      );
      if (car.basActive) {
        sawBasActive = true;
        peakBasIntensity = Math.max(peakBasIntensity, car.basIntensity);
      }
    }

    expect(sawBasActive).toBe(true);
    expect(peakBasIntensity).toBeGreaterThan(0.2);
    expect(car.speed).toBeLessThan(65);
  });

  it('amplifies emergency manual brake pressure with BAS when closing rapidly on a slower car', () => {
    const dt = 1 / 60;
    const smp = monza.sampleAtS(0.02);
    const makePair = () => {
      const p = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
      p.s = smp.s;
      p.sampleIndex = smp.index;
      p.x = smp.position.x;
      p.y = smp.position.y;
      p.z = smp.position.z;
      p.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      p.speed = 70;

      const ahead = createInitialCarState('verstappen', false, 1.0, monza, 0, 'soft', false);
      const sAhead = monza.sampleAtS(0.02 + 14 / monza.totalLength);
      ahead.s = sAhead.s;
      ahead.sampleIndex = sAhead.index;
      ahead.x = sAhead.position.x;
      ahead.y = sAhead.position.y;
      ahead.z = sAhead.position.z;
      ahead.heading = Math.atan2(sAhead.tangent.x, sAhead.tangent.z);
      ahead.speed = 35;
      return { p, ahead };
    };

    const withBas = makePair();
    const withoutBas = makePair();

    stepCarPhysics(
      withBas.p,
      makeCtrl({ brake: 0.5 }),
      monza,
      dt,
      [withBas.p, withBas.ahead],
      EASY_ASSISTS,
      5,
      true,
    );
    stepCarPhysics(
      withoutBas.p,
      makeCtrl({ brake: 0.5 }),
      monza,
      dt,
      [withoutBas.p, withoutBas.ahead],
      RAW_ASSISTS,
      5,
      true,
    );

    expect(withBas.p.basActive).toBe(true);
    expect(withBas.p.brakeApplied).toBeGreaterThan(0.9);
    expect(withoutBas.p.basActive).toBe(false);
    expect(withoutBas.p.brakeApplied).toBeCloseTo(0.5, 4);
  });

  it('counts 0, 1, 2, 3, and 4 wheels off-track accurately and never penalizes 1-2 wheels or single-frame exits', () => {
    const hw = monza.config.trackWidth * 0.5; // 7.25m, limit = 7.37m
    expect(countWheelsOffTrack(6.0, 0, hw)).toBe(0);
    expect(countWheelsOffTrack(6.6, 0.25, hw)).toBe(1);
    expect(countWheelsOffTrack(7.0, 0, hw)).toBe(2);
    expect(countWheelsOffTrack(7.9, 0.25, hw)).toBe(3);
    expect(countWheelsOffTrack(8.4, 0, hw)).toBe(4);

    // Find a sharp right-hand apex on Monza to test sustained 4-wheel inside corner cutting
    const apex = monza.samples.reduce((best, cur) =>
      cur.curvature > best.curvature ? cur : best,
    );
    expect(apex.curvature).toBeGreaterThan(0.015);

    const placeLateral = (car: ReturnType<typeof createInitialCarState>, lat: number) => {
      car.s = apex.s;
      car.sampleIndex = apex.index;
      car.x = apex.position.x + apex.right.x * lat;
      car.y = apex.position.y;
      car.z = apex.position.z + apex.right.z * lat;
      car.heading = Math.atan2(apex.tangent.x, apex.tangent.z);
      car.speed = 48;
    };

    // 1-2 wheels over the white line: never offTrack, zero warnings even held for 1 second
    const twoWheelsCar = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    for (let i = 0; i < 60; i++) {
      placeLateral(twoWheelsCar, hw + 0.05);
      stepCarPhysics(twoWheelsCar, makeCtrl({ throttle: 0.8 }), monza, 1 / 60, [twoWheelsCar], RAW_ASSISTS, 5, true);
      expect(twoWheelsCar.wheelsOffTrack).toBe(2);
      expect(twoWheelsCar.offTrack).toBe(false);
    }
    expect(twoWheelsCar.trackLimitWarnings).toBe(0);
    expect(twoWheelsCar.penaltySeconds).toBe(0);

    // Single-frame 4-wheel excursion: zero warnings
    const cutCar = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    placeLateral(cutCar, hw + 2.4);
    stepCarPhysics(cutCar, makeCtrl({ throttle: 0.8 }), monza, 1 / 60, [cutCar], RAW_ASSISTS, 5, true);
    expect(cutCar.wheelsOffTrack).toBe(4);
    expect(cutCar.offTrack).toBe(true);
    expect(cutCar.trackLimitWarnings).toBe(0);

    // Sustained >= 0.35s 4-wheel inside cut: 1 warning with 6s cooldown; 4th strike adds +3s
    for (let strike = 1; strike <= 4; strike++) {
      cutCar.cornerCutCooldown = 0;
      cutCar.cornerCutHoldTimer = 0;
      for (let f = 0; f < 24; f++) {
        placeLateral(cutCar, hw + 2.4);
        stepCarPhysics(cutCar, makeCtrl({ throttle: 0.8 }), monza, 1 / 60, [cutCar], RAW_ASSISTS, 5, true);
      }
      expect(cutCar.trackLimitWarnings).toBe(strike);
      expect(cutCar.cornerCutCooldown).toBeGreaterThan(5.0);
    }
    expect(cutCar.penaltySeconds).toBe(3);
  });

  it('decouples Easy Drive steeringAssist and BAS brakingAssist so each acts independently', () => {
    const dt = 1 / 60;
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

    const makeApproachCar = () => {
      const c = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
      c.s = sApproach.s;
      c.sampleIndex = approachIdx;
      c.x = sApproach.position.x + sApproach.right.x * 3.0;
      c.y = sApproach.position.y;
      c.z = sApproach.position.z + sApproach.right.z * 3.0;
      c.heading = Math.atan2(sApproach.tangent.x, sApproach.tangent.z);
      c.speed = 88;
      return c;
    };

    const basOnlyCar = makeApproachCar();
    const steerOnlyCar = makeApproachCar();

    for (let i = 0; i < 20; i++) {
      stepCarPhysics(
        basOnlyCar,
        makeCtrl({ throttle: 1 }),
        monza,
        dt,
        [basOnlyCar],
        { ...RAW_ASSISTS, steeringAssist: false, brakingAssist: true },
        5,
        true,
      );
      stepCarPhysics(
        steerOnlyCar,
        makeCtrl({ throttle: 1 }),
        monza,
        dt,
        [steerOnlyCar],
        { ...RAW_ASSISTS, steeringAssist: true, brakingAssist: false },
        5,
        true,
      );
    }

    // BAS-only brakes cleanly without engaging steeringAssist; Steer-only never triggers basActive
    expect(basOnlyCar.basActive).toBe(true);
    expect(basOnlyCar.speed).toBeLessThan(steerOnlyCar.speed - 6);
    expect(steerOnlyCar.basActive).toBe(false);
    expect(steerOnlyCar.brakeApplied).toBe(0);
  });
});
