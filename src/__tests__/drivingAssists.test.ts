import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../data/circuits';
import {
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
});
