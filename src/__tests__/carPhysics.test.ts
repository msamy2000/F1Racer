import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../data/circuits';
import {
  createInitialCarState,
  resolveCarCollisions,
  stepCarPhysics,
  TIRE_SPECS,
  type AssistConfig,
  type CarState,
} from '../engine/CarPhysics';
import type { ControlInput } from '../engine/InputManager';
import { TrackSpline } from '../engine/TrackSpline';

const ASSISTS: AssistConfig = {
  gearbox: 'auto',
  tractionControl: 'medium',
  abs: true,
  racingLine: 'corners',
};

function makeControl(overrides: Partial<ControlInput> = {}): ControlInput {
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

describe('CarPhysics — 2026 Active Aero, ERS, Tires & Handling', () => {
  const monza = new TrackSpline(CIRCUITS.monza);

  it('accelerates smoothly through gears and decelerates hard under braking', () => {
    const car = createInitialCarState('yahia', true, 1.015, monza, 0, 'soft', false);
    const dt = 1 / 60;

    for (let i = 0; i < 300; i++) {
      stepCarPhysics(car, makeControl({ throttle: 1 }), monza, dt, [car], ASSISTS, 5, true);
    }
    const peakSpeed = car.speed;
    expect(peakSpeed).toBeGreaterThan(78); // > 280 km/h within 5 seconds
    expect(car.gear).toBeGreaterThanOrEqual(6);

    for (let i = 0; i < 90; i++) {
      stepCarPhysics(car, makeControl({ brake: 1 }), monza, dt, [car], ASSISTS, 5, true);
    }
    expect(car.speed).toBeLessThan(peakSpeed * 0.45);
    expect(car.isBrakingHard).toBe(true);
  });

  it('activates 2026 Active Aero (X-Mode) on FIA straights and closes on steering/braking', () => {
    const car = createInitialCarState('yahia', true, 1.015, monza, 0, 'soft', true);
    car.s = 0.02; // Inside Monza Main Straight Active Aero zone
    const smp = monza.sampleAtS(0.02);
    car.x = smp.position.x;
    car.y = smp.position.y;
    car.z = smp.position.z;
    car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    car.speed = 65;

    const dt = 1 / 60;
    for (let i = 0; i < 40; i++) {
      stepCarPhysics(car, makeControl({ throttle: 1 }), monza, dt, [car], ASSISTS, 5, true);
    }
    expect(car.activeAeroActive).toBe(true);
    expect(car.activeAeroOpen).toBeGreaterThan(0.8);

    // Braking snaps Active Aero shut to Z-Mode
    for (let i = 0; i < 30; i++) {
      stepCarPhysics(car, makeControl({ brake: 1 }), monza, dt, [car], ASSISTS, 5, true);
    }
    expect(car.activeAeroActive).toBe(false);
    expect(car.activeAeroOpen).toBeLessThan(0.2);
  });

  it('deploys ERS Boost, harvests under braking, and grants +0.5 MJ reserve with Overtake Mode', () => {
    const car = createInitialCarState('yahia', true, 1.015, monza, 0, 'soft', true);
    car.speed = 62;
    const dt = 1 / 60;
    const startBattery = car.ersBattery;

    for (let i = 0; i < 60; i++) {
      stepCarPhysics(
        car,
        makeControl({ throttle: 1, boost: true }),
        monza,
        dt,
        [car],
        ASSISTS,
        5,
        true,
      );
    }
    expect(car.boostActive).toBe(true);
    expect(car.ersBattery).toBeLessThan(startBattery);

    // Braking harvests energy back
    const afterBoost = car.ersBattery;
    for (let i = 0; i < 90; i++) {
      stepCarPhysics(car, makeControl({ brake: 1 }), monza, dt, [car], ASSISTS, 5, true);
    }
    expect(car.ersBattery).toBeGreaterThan(afterBoost);

    // Overtake mode allows battery reserve up to 1.125 (4.5 MJ)
    car.overtakeArmed = true;
    for (let i = 0; i < 200; i++) {
      car.speed = 45;
      stepCarPhysics(car, makeControl({ brake: 1 }), monza, dt, [car], ASSISTS, 5, true);
    }
    expect(car.ersBattery).toBeGreaterThan(1.0);
    expect(car.ersBattery).toBeLessThanOrEqual(1.125);
  });

  it('models Pirelli Soft/Medium/Hard grip and wear hierarchy accurately', () => {
    expect(TIRE_SPECS.soft.gripMultiplier).toBeGreaterThan(TIRE_SPECS.medium.gripMultiplier);
    expect(TIRE_SPECS.medium.gripMultiplier).toBeGreaterThan(TIRE_SPECS.hard.gripMultiplier);
    expect(TIRE_SPECS.soft.wearPerKm).toBeGreaterThan(TIRE_SPECS.medium.wearPerKm);
    expect(TIRE_SPECS.medium.wearPerKm).toBeGreaterThan(TIRE_SPECS.hard.wearPerKm);
  });

  it('arms BOX THIS LAP on main straight without stopping, then enters pit lane at pitEntryS', () => {
    const car = createInitialCarState('yahia', true, 1.015, monza, 0, 'soft', true);
    // Test pressing P on main straight (s = 0.04, past pit entry mouth) only arms pitRequested
    car.s = 0.04;
    const sMain = monza.sampleAtS(0.04);
    car.x = sMain.position.x;
    car.y = sMain.position.y;
    car.z = sMain.position.z;
    car.heading = Math.atan2(sMain.tangent.x, sMain.tangent.z);
    car.sampleIndex = sMain.index;
    car.speed = 65;

    const dt = 1 / 60;
    stepCarPhysics(car, makeControl({ throttle: 1, pitPressed: true }), monza, dt, [car], ASSISTS, 5, true);
    expect(car.pitRequested).toBe(true);
    expect(car.inPitLane).toBe(false);

    // Now test entering pit lane cleanly at pitEntryS
    car.tireWear = 0.78;
    car.s = monza.config.pitEntryS + 0.01;
    const smp = monza.sampleAtS(car.s);
    car.x = smp.position.x;
    car.y = smp.position.y;
    car.z = smp.position.z;
    car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    car.sampleIndex = smp.index;
    car.speed = 40;

    let sawServicing = false;
    for (let i = 0; i < 1800; i++) {
      stepCarPhysics(car, makeControl({ throttle: 1 }), monza, dt, [car], ASSISTS, 5, true);
      if (car.pitServicing) {
        sawServicing = true;
      }
      if (car.pitStopsCount > 0) break;
    }

    expect(sawServicing).toBe(true);
    expect(car.pitStopsCount).toBe(1);
    expect(car.tireWear).toBeLessThan(0.05);
    expect(car.tireTemp).toBe(68);
    expect(car.tireCompound).toBe('medium');
  });

  it('applies 3D slope gravity and updates car.pitch and car.roll on Red Bull Ring hills', () => {
    const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
    const uphillSmp = rbr.samples.reduce((best, cur) =>
      cur.tangent.y > best.tangent.y ? cur : best,
    );
    const downhillSmp = rbr.samples.reduce((best, cur) =>
      cur.tangent.y < best.tangent.y ? cur : best,
    );

    const placeCar = (smp: typeof uphillSmp): CarState => {
      const c = createInitialCarState('yahia', true, 1.0, rbr, 0, 'soft', true);
      c.x = smp.position.x;
      c.y = smp.position.y;
      c.z = smp.position.z;
      c.s = smp.s;
      c.sampleIndex = smp.index;
      c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      c.speed = 45;
      return c;
    };

    const uphillCar = placeCar(uphillSmp);
    const downhillCar = placeCar(downhillSmp);
    const dt = 1 / 60;

    for (let i = 0; i < 45; i++) {
      stepCarPhysics(uphillCar, makeControl(), rbr, dt, [uphillCar], ASSISTS, 5, true);
      stepCarPhysics(downhillCar, makeControl(), rbr, dt, [downhillCar], ASSISTS, 5, true);
    }

    expect(uphillCar.pitch).toBeGreaterThan(0.02);
    expect(downhillCar.pitch).toBeLessThan(-0.02);
    expect(downhillCar.speed).toBeGreaterThan(uphillCar.speed);
  });

  it('models friction circle: trail-braking boosts turn-in while full-lock braking induces understeer', () => {
    const placeStraight = (abs: boolean): { car: CarState; assists: AssistConfig; initHeading: number } => {
      const c = createInitialCarState('yahia', true, 1.015, monza, 0, 'soft', true);
      const smp = monza.sampleAtS(0.02);
      c.x = smp.position.x;
      c.y = smp.position.y;
      c.z = smp.position.z;
      c.s = smp.s;
      c.sampleIndex = smp.index;
      c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      c.speed = 54;
      return {
        car: c,
        assists: { ...ASSISTS, abs },
        initHeading: c.heading,
      };
    };

    const coast = placeStraight(false);
    const trail = placeStraight(false);
    const fullLockNoAbs = placeStraight(false);
    const fullLockAbs = placeStraight(true);
    const dt = 1 / 60;

    for (let i = 0; i < 24; i++) {
      stepCarPhysics(coast.car, makeControl({ steer: 0.85 }), monza, dt, [coast.car], coast.assists, 5, true);
      stepCarPhysics(trail.car, makeControl({ brake: 0.35, steer: 0.85 }), monza, dt, [trail.car], trail.assists, 5, true);
      stepCarPhysics(fullLockNoAbs.car, makeControl({ brake: 1.0, steer: 0.85 }), monza, dt, [fullLockNoAbs.car], fullLockNoAbs.assists, 5, true);
      stepCarPhysics(fullLockAbs.car, makeControl({ brake: 1.0, steer: 0.85 }), monza, dt, [fullLockAbs.car], fullLockAbs.assists, 5, true);
    }

    const yawCoast = Math.abs(coast.car.heading - coast.initHeading);
    const yawTrail = Math.abs(trail.car.heading - trail.initHeading);
    const yawFullNoAbs = Math.abs(fullLockNoAbs.car.heading - fullLockNoAbs.initHeading);
    const yawFullAbs = Math.abs(fullLockAbs.car.heading - fullLockAbs.initHeading);

    expect(yawTrail).toBeGreaterThan(yawCoast);
    expect(yawTrail).toBeGreaterThan(yawFullAbs);
    expect(yawFullAbs).toBeGreaterThan(yawFullNoAbs);
    expect(fullLockNoAbs.car.slipRatio).toBeGreaterThan(trail.car.slipRatio);
  });

  it('simulates corner-exit power oversteer modulated by tractionControl', () => {
    const setupSlowCorner = () => {
      const c = createInitialCarState('yahia', true, 1.015, monza, 0, 'soft', true);
      const smp = monza.sampleAtS(0.02);
      c.x = smp.position.x;
      c.y = smp.position.y;
      c.z = smp.position.z;
      c.s = smp.s;
      c.sampleIndex = smp.index;
      c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      c.speed = 24;
      return c;
    };

    const tcFullCar = setupSlowCorner();
    const tcOffCar = setupSlowCorner();
    const dt = 1 / 60;

    for (let i = 0; i < 30; i++) {
      stepCarPhysics(
        tcFullCar,
        makeControl({ throttle: 1, steer: 0.9 }),
        monza,
        dt,
        [tcFullCar],
        { ...ASSISTS, tractionControl: 'full' },
        5,
        true,
      );
      stepCarPhysics(
        tcOffCar,
        makeControl({ throttle: 1, steer: 0.9 }),
        monza,
        dt,
        [tcOffCar],
        { ...ASSISTS, tractionControl: 'off' },
        5,
        true,
      );
    }

    expect(tcOffCar.slipRatio).toBeGreaterThan(tcFullCar.slipRatio);
    expect(Math.abs(tcOffCar.lateralSpeed)).toBeGreaterThan(Math.abs(tcFullCar.lateralSpeed));
  });

  it('updates tire temperatures toward thermal window under load and cooling on straights', () => {
    const coldCar = createInitialCarState('yahia', true, 1.015, monza, 0, 'soft', true);
    expect(coldCar.tireTemp).toBe(92);
    coldCar.tireTemp = 68; // post-pit temperature
    const dt = 1 / 60;

    for (let i = 0; i < 180; i++) {
      const smp = monza.sampleAtS(coldCar.s);
      coldCar.x = smp.position.x;
      coldCar.z = smp.position.z;
      coldCar.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      coldCar.speed = 55;
      stepCarPhysics(
        coldCar,
        makeControl({ throttle: 0.6, steer: 0.85 }),
        monza,
        dt,
        [coldCar],
        ASSISTS,
        5,
        true,
      );
    }
    expect(coldCar.tireTemp).toBeGreaterThan(76);

    // Overheated tires cool down when cruising straight
    coldCar.tireTemp = 122;
    const smpStraight = monza.sampleAtS(0.02);
    coldCar.x = smpStraight.position.x;
    coldCar.z = smpStraight.position.z;
    coldCar.s = smpStraight.s;
    coldCar.sampleIndex = smpStraight.index;
    coldCar.heading = Math.atan2(smpStraight.tangent.x, smpStraight.tangent.z);
    coldCar.yawRate = 0;
    coldCar.lateralSpeed = 0;
    coldCar.slipRatio = 0;
    coldCar.speed = 88;
    for (let i = 0; i < 180; i++) {
      stepCarPhysics(
        coldCar,
        makeControl({ throttle: 1 }),
        monza,
        dt,
        [coldCar],
        ASSISTS,
        5,
        true,
      );
    }
    expect(coldCar.tireTemp).toBeLessThan(116);
  });

  it('applies dirty-air wake downforce loss when trailing closely in slipstream', () => {
    const makePair = (withLeader: boolean) => {
      const smp = monza.sampleAtS(0.02);
      const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
      car.x = smp.position.x;
      car.y = smp.position.y;
      car.z = smp.position.z;
      car.s = smp.s;
      car.sampleIndex = smp.index;
      car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      car.speed = 80;

      const all = [car];
      if (withLeader) {
        const leaderS = (smp.s + 12 / monza.totalLength) % 1;
        const lSmp = monza.sampleAtS(leaderS);
        const leader = createInitialCarState('verstappen', false, 1.0, monza, 1, 'soft', true);
        leader.x = lSmp.position.x;
        leader.y = lSmp.position.y;
        leader.z = lSmp.position.z;
        leader.s = leaderS;
        leader.sampleIndex = lSmp.index;
        leader.heading = Math.atan2(lSmp.tangent.x, lSmp.tangent.z);
        leader.speed = 80;
        all.push(leader);
      }
      return { car, all };
    };

    const clean = makePair(false);
    const dirty = makePair(true);
    const dt = 1 / 60;

    for (let i = 0; i < 15; i++) {
      stepCarPhysics(clean.car, makeControl({ steer: 0.9 }), monza, dt, clean.all, ASSISTS, 5, true);
      stepCarPhysics(dirty.all[1], makeControl({ steer: 0.9 }), monza, dt, dirty.all, ASSISTS, 5, true);
      stepCarPhysics(dirty.car, makeControl({ steer: 0.9 }), monza, dt, dirty.all, ASSISTS, 5, true);
    }

    expect(dirty.car.slipstreamStrength).toBeGreaterThan(0.5);
    expect(Math.abs(dirty.car.yawRate)).toBeLessThan(Math.abs(clean.car.yawRate));
  });

  it('resolves car collisions symmetrically across diagonal overlaps and minimum penetration axis', () => {
    const makeCars = (dx: number, dz: number, speedA = 50, speedB = 45): [CarState, CarState] => {
      const a = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
      const b = createInitialCarState('norris', false, 1.0, monza, 1, 'soft', true);
      a.x = 0;
      a.z = 0;
      a.heading = 0; // +Z forward, -X right
      a.speed = speedA;
      b.x = dx;
      b.z = dz;
      b.heading = 0;
      b.speed = speedB;
      return [a, b];
    };

    // 1. Diagonal broadphase overlap (along = 4.4, across = -1.8 -> distSq = 22.6 > 4.6^2)
    const [da, db] = makeCars(-1.8, 4.4);
    resolveCarCollisions([da, db]);
    expect(Math.abs(db.z - da.z) >= 4.6 || Math.abs(db.x - da.x) >= 1.95).toBe(true);
    expect(da.collisionShock).toBeGreaterThan(0);
    expect(db.collisionShock).toBeGreaterThan(0);

    // 2. Order-independent symmetry check
    const [sA1, sB1] = makeCars(-1.4, 1.2, 62, 54);
    const [sA2, sB2] = makeCars(-1.4, 1.2, 62, 54);
    resolveCarCollisions([sA1, sB1]);
    resolveCarCollisions([sB2, sA2]);
    expect(sA1.x).toBeCloseTo(sA2.x, 6);
    expect(sA1.z).toBeCloseTo(sA2.z, 6);
    expect(sB1.x).toBeCloseTo(sB2.x, 6);
    expect(sB1.z).toBeCloseTo(sB2.z, 6);
    expect(sA1.speed).toBeCloseTo(sA2.speed, 6);
    expect(sB1.speed).toBeCloseTo(sB2.speed, 6);
    expect(sA1.lateralSpeed).toBeCloseTo(sA2.lateralSpeed, 6);
    expect(sB1.lateralSpeed).toBeCloseTo(sB2.lateralSpeed, 6);

    // 3. Minimum penetration axis: side-by-side (penLat = 0.45 < penLong = 3.6) pushes laterally
    const [la, lb] = makeCars(-1.5, 1.0);
    resolveCarCollisions([la, lb]);
    expect(lb.z - la.z).toBeCloseTo(1.0, 6);
    expect(Math.abs(lb.x - la.x)).toBeGreaterThan(1.95);

    // 4. Nose-to-tail bumper tap (penLong = 0.3 < penLat = 1.65) pushes longitudinally
    const [fa, fb] = makeCars(-0.3, 4.3, 60, 46);
    resolveCarCollisions([fa, fb]);
    expect(fb.x - fa.x).toBeCloseTo(-0.3, 6);
    expect(fb.z - fa.z).toBeGreaterThan(4.6);
    expect(fa.speed).toBeLessThan(60);
    expect(fb.speed).toBeGreaterThan(46);
  });

  it('deflects glancing wall brushes gently compared to steep-angle barrier impacts', () => {
    const setupWallHit = (angleRad: number): CarState => {
      const c = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
      const smp = monza.sampleAtS(0.02);
      const limit = monza.config.trackWidth * 0.5 + 4.35;
      c.x = smp.position.x + smp.right.x * limit;
      c.y = smp.position.y;
      c.z = smp.position.z + smp.right.z * limit;
      c.s = smp.s;
      c.sampleIndex = smp.index;
      // Positive angle turns left (-right), negative turns right (+right into barrier)
      c.heading = Math.atan2(smp.tangent.x, smp.tangent.z) - angleRad;
      c.speed = 65;
      return c;
    };

    const glancing = setupWallHit(0.06); // ~3.4 deg brush
    const heavy = setupWallHit(0.85); // ~48.7 deg impact
    const dt = 1 / 60;

    stepCarPhysics(glancing, makeControl({ throttle: 1 }), monza, dt, [glancing], ASSISTS, 5, true);
    stepCarPhysics(heavy, makeControl({ throttle: 1 }), monza, dt, [heavy], ASSISTS, 5, true);

    expect(glancing.speed).toBeGreaterThan(60);
    expect(heavy.speed).toBeLessThan(glancing.speed * 0.72);
    expect(heavy.collisionShock).toBeGreaterThan(glancing.collisionShock);
  });

  it('applies damped lateral impulse and wheel-rub speed scrub on lateral wheel-to-wheel contact', () => {
    const placeSideBySide = (latOffsetA: number, latOffsetB: number): [CarState, CarState] => {
      const smp = monza.sampleAtS(0.03);
      const makeAtLat = (id: string, isPlayer: boolean, lat: number, speed: number): CarState => {
        const c = createInitialCarState(id, isPlayer, 1.0, monza, 0, 'soft', true);
        c.x = smp.position.x + smp.right.x * lat;
        c.y = smp.position.y;
        c.z = smp.position.z + smp.right.z * lat;
        c.s = smp.s;
        c.sampleIndex = smp.index;
        c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
        c.speed = speed;
        c.lateralSpeed = 0;
        return c;
      };
      return [makeAtLat('yahia', true, latOffsetA, 60), makeAtLat('norris', false, latOffsetB, 58)];
    };

    // Case 1: B is to the right of A (sign = +1)
    const [a1, b1] = placeSideBySide(-0.6, 0.7);
    resolveCarCollisions([a1, b1], monza);
    expect(a1.lateralSpeed).toBeCloseTo(-0.45, 6);
    expect(b1.lateralSpeed).toBeCloseTo(0.45, 6);
    expect(a1.speed).toBeCloseTo(60 * 0.985, 6);
    expect(b1.speed).toBeCloseTo(58 * 0.985, 6);

    // Subsequent 60 Hz steps separate cars laterally via momentum while damping lateralSpeed
    const dt = 1 / 60;
    const initSep = Math.hypot(b1.x - a1.x, b1.z - a1.z);
    for (let i = 0; i < 6; i++) {
      stepCarPhysics(a1, makeControl({ throttle: 0.8 }), monza, dt, [a1, b1], ASSISTS, 5, true);
      stepCarPhysics(b1, makeControl({ throttle: 0.8 }), monza, dt, [a1, b1], ASSISTS, 5, true);
    }
    const postSep = Math.hypot(b1.x - a1.x, b1.z - a1.z);
    expect(postSep).toBeGreaterThan(initSep);
    expect(Math.abs(a1.lateralSpeed)).toBeLessThan(0.45);
    expect(Math.abs(b1.lateralSpeed)).toBeLessThan(0.45);

    // Case 2: B is to the left of A (sign = -1)
    const [a2, b2] = placeSideBySide(0.7, -0.6);
    resolveCarCollisions([a2, b2], monza);
    expect(a2.lateralSpeed).toBeCloseTo(0.45, 6);
    expect(b2.lateralSpeed).toBeCloseTo(-0.45, 6);

    // Case 3: Consecutive-frame rubbing (including active steering pressure) does not compound -1.5%/frame speed collapse
    const [a3, b3] = placeSideBySide(-0.6, 0.7);
    for (let f = 0; f < 12; f++) {
      stepCarPhysics(a3, makeControl({ throttle: 1 }), monza, dt, [a3, b3], ASSISTS, 5, true);
      stepCarPhysics(b3, makeControl({ throttle: 1 }), monza, dt, [a3, b3], ASSISTS, 5, true);
      resolveCarCollisions([a3, b3], monza);
    }
    expect(a3.speed).toBeGreaterThan(59);
    expect(b3.speed).toBeGreaterThan(57);

    // Case 4: Active multi-frame side-by-side rub (steering into rival) retains speed without stalling
    const [a4, b4] = placeSideBySide(-0.6, 0.7);
    for (let f = 0; f < 24; f++) {
      stepCarPhysics(a4, makeControl({ throttle: 1, steer: 0.25 }), monza, dt, [a4, b4], ASSISTS, 5, true);
      stepCarPhysics(b4, makeControl({ throttle: 1, steer: -0.25 }), monza, dt, [a4, b4], ASSISTS, 5, true);
      resolveCarCollisions([a4, b4], monza);
    }
    expect(a4.speed).toBeGreaterThan(56);
    expect(b4.speed).toBeGreaterThan(54);

    // Case 5: Recent wall-brush collisionShock does not suppress a fresh wheel-to-wheel impulse/scrub
    const [aw, bw] = placeSideBySide(-0.6, 0.7);
    aw.collisionShock = 0.4;
    resolveCarCollisions([aw, bw], monza);
    expect(aw.lateralSpeed).toBeCloseTo(-0.45, 6);
    expect(bw.lateralSpeed).toBeCloseTo(0.45, 6);
    expect(aw.speed).toBeCloseTo(60 * 0.985, 6);
    expect(bw.speed).toBeCloseTo(58 * 0.985, 6);

    // Case 6: 3-car simultaneous lateral collision is strictly order-independent
    const makeThree = () => {
      const smp = monza.sampleAtS(0.03);
      return (['yahia', 'norris', 'leclerc'] as const).map((id, idx) => {
        const c = createInitialCarState(id, idx === 0, 1.0, monza, idx, 'soft', true);
        const lat = (idx - 1) * 1.5;
        c.x = smp.position.x + smp.right.x * lat;
        c.y = smp.position.y;
        c.z = smp.position.z + smp.right.z * lat;
        c.s = smp.s;
        c.sampleIndex = smp.index;
        c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
        c.speed = 60;
        return c;
      });
    };
    const [t1a, t1b, t1c] = makeThree();
    const [t2a, t2b, t2c] = makeThree();
    resolveCarCollisions([t1a, t1b, t1c], monza);
    resolveCarCollisions([t2c, t2b, t2a], monza);
    expect(t1a.x).toBeCloseTo(t2a.x, 6);
    expect(t1b.x).toBeCloseTo(t2b.x, 6);
    expect(t1c.x).toBeCloseTo(t2c.x, 6);
    expect(t1a.lateralSpeed).toBeCloseTo(t2a.lateralSpeed, 6);
    expect(t1b.lateralSpeed).toBeCloseTo(t2b.lateralSpeed, 6);
    expect(t1c.lateralSpeed).toBeCloseTo(t2c.lateralSpeed, 6);
    expect(t1a.speed).toBeCloseTo(t2a.speed, 6);
    expect(t1c.speed).toBeCloseTo(t2c.speed, 6);

    // Case 7: Opposite-heading (180° spun car) lateral collision separates outward and is order-independent
    const [o1a, o1b] = placeSideBySide(-0.6, 0.6);
    const [o2a, o2b] = placeSideBySide(-0.6, 0.6);
    o1b.heading += Math.PI;
    o2b.heading += Math.PI;
    resolveCarCollisions([o1a, o1b], monza);
    resolveCarCollisions([o2b, o2a], monza);
    expect(o1a.lateralSpeed).toBeCloseTo(o2a.lateralSpeed, 6);
    expect(o1b.lateralSpeed).toBeCloseTo(o2b.lateralSpeed, 6);
    expect(o1a.lateralSpeed).toBeCloseTo(-0.45, 6);
    expect(o1b.lateralSpeed).toBeCloseTo(-0.45, 6);
    const oppSepBefore = Math.hypot(o1b.x - o1a.x, o1b.z - o1a.z);
    o1a.speed = 0;
    o1b.speed = 0;
    stepCarPhysics(o1a, makeControl(), monza, dt, [o1a, o1b], ASSISTS, 5, true);
    stepCarPhysics(o1b, makeControl(), monza, dt, [o1a, o1b], ASSISTS, 5, true);
    expect(Math.hypot(o1b.x - o1a.x, o1b.z - o1a.z)).toBeGreaterThan(oppSepBefore);
  });

  it('clamps wall-adjacent car-to-car collisions strictly within barrierLimit on the same 60 Hz frame', () => {
    const placePairAtSample = (
      track: TrackSpline,
      sVal: number,
      latA: number,
      latB: number,
    ): [CarState, CarState] => {
      const smp = track.sampleAtS(sVal);
      const makeAtLat = (id: string, isPlayer: boolean, lat: number): CarState => {
        const c = createInitialCarState(id, isPlayer, 1.0, track, 0, 'soft', true);
        c.x = smp.position.x + smp.right.x * lat;
        c.y = smp.position.y;
        c.z = smp.position.z + smp.right.z * lat;
        c.s = smp.s;
        c.sampleIndex = smp.index;
        c.lateralOffset = lat;
        c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
        c.speed = 65;
        return c;
      };
      return [makeAtLat('yahia', true, latA), makeAtLat('leclerc', false, latB)];
    };

    // 1. Right-wall pin on Monza straight (both array orders must stay strictly <= barrierLimit)
    const monzaLimit = monza.config.trackWidth * 0.5 + 4.4;
    const [ra1, rb1] = placePairAtSample(monza, 0.02, monzaLimit - 1.35, monzaLimit - 0.06);
    const [ra2, rb2] = placePairAtSample(monza, 0.02, monzaLimit - 1.35, monzaLimit - 0.06);

    resolveCarCollisions([ra1, rb1], monza);
    resolveCarCollisions([rb2, ra2], monza);

    for (const car of [ra1, rb1, ra2, rb2]) {
      const proj = monza.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
      expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(monzaLimit);
      expect(Math.abs(proj.lateralOffset)).toBeLessThanOrEqual(monzaLimit);
    }
    expect(rb1.lateralSpeed).toBeLessThanOrEqual(0);
    expect(Math.hypot(rb1.x - ra1.x, rb1.z - ra1.z)).toBeGreaterThanOrEqual(1.95);
    expect(ra1.x).toBeCloseTo(ra2.x, 6);
    expect(rb1.x).toBeCloseTo(rb2.x, 6);

    // 2. Left-wall pin on a curved Red Bull Ring uphill/downhill section
    const rbr = new TrackSpline(CIRCUITS['red-bull-ring']);
    const rbrLimit = rbr.config.trackWidth * 0.5 + 4.4;
    const cornerSample = rbr.samples.reduce((best, cur) =>
      Math.abs(cur.curvature) > Math.abs(best.curvature) ? cur : best,
    );
    const [la, lb] = placePairAtSample(
      rbr,
      cornerSample.s,
      -(rbrLimit - 1.25),
      -(rbrLimit - 0.05),
    );
    resolveCarCollisions([la, lb], rbr);

    for (const car of [la, lb]) {
      const proj = rbr.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
      expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(rbrLimit);
      expect(Math.abs(proj.lateralOffset)).toBeLessThanOrEqual(rbrLimit);
      expect(Number.isFinite(car.y)).toBe(true);
    }
    expect(lb.lateralSpeed).toBeGreaterThanOrEqual(0);

    // 3. Multi-frame 60 Hz wall-rubbing simulation keeps both cars strictly inside barriers
    const dt = 1 / 60;
    const [ma, mb] = placePairAtSample(monza, 0.02, monzaLimit - 1.6, monzaLimit - 0.2);
    for (let frame = 0; frame < 30; frame++) {
      stepCarPhysics(ma, makeControl({ throttle: 0.9, steer: 0.25 }), monza, dt, [ma, mb], ASSISTS, 5, true);
      stepCarPhysics(mb, makeControl({ throttle: 0.9, steer: 0 }), monza, dt, [ma, mb], ASSISTS, 5, true);
      resolveCarCollisions([ma, mb], monza);
      for (const car of [ma, mb]) {
        const proj = monza.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
        expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(monzaLimit);
        expect(Math.abs(proj.lateralOffset)).toBeLessThanOrEqual(monzaLimit);
      }
    }

    // 4. Longitudinal bumper push on a tight curve outside barrier clamps cleanly
    const outSign = cornerSample.curvature > 0 ? -1 : 1;
    const frontS = (cornerSample.s + 2.5 / rbr.totalLength) % 1;
    const [ca] = placePairAtSample(rbr, cornerSample.s, outSign * (rbrLimit - 0.02), 0);
    const [cb] = placePairAtSample(rbr, frontS, outSign * (rbrLimit - 0.02), 0);
    resolveCarCollisions([ca, cb], rbr);
    for (const car of [ca, cb]) {
      const proj = rbr.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
      expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(rbrLimit);
      expect(Math.abs(proj.lateralOffset)).toBeLessThanOrEqual(rbrLimit);
    }

    // 5. Pit-lane cars use pit-lane barrierLimit (halfWidth + 14.5)
    const pitLimit = monza.config.trackWidth * 0.5 + 14.5;
    const pitS = (monza.config.pitEntryS + 0.04) % 1;
    const [pa, pb] = placePairAtSample(monza, pitS, pitLimit - 1.2, pitLimit - 0.05);
    pa.inPitLane = true;
    pb.inPitLane = true;
    resolveCarCollisions([pa, pb], monza);
    for (const car of [pa, pb]) {
      const proj = monza.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
      expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(pitLimit);
      expect(Math.abs(proj.lateralOffset)).toBeLessThanOrEqual(pitLimit);
    }

    // 6. 3-car wall-pinned squeeze resolves all gaps >= 1.95m strictly inside barrierLimit, order-independently
    const makeWallTriplet = () => {
      const smp = monza.sampleAtS(0.02);
      const lats = [monzaLimit - 2.6, monzaLimit - 1.3, monzaLimit - 0.1];
      return (['yahia', 'leclerc', 'norris'] as const).map((id, idx) => {
        const c = createInitialCarState(id, idx === 0, 1.0, monza, idx, 'soft', true);
        c.x = smp.position.x + smp.right.x * lats[idx];
        c.y = smp.position.y;
        c.z = smp.position.z + smp.right.z * lats[idx];
        c.s = smp.s;
        c.sampleIndex = smp.index;
        c.lateralOffset = lats[idx];
        c.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
        c.speed = 65;
        return c;
      });
    };
    const [w1a, w1b, w1c] = makeWallTriplet();
    const [w2a, w2b, w2c] = makeWallTriplet();
    resolveCarCollisions([w1a, w1b, w1c], monza);
    resolveCarCollisions([w2c, w2b, w2a], monza);

    for (const car of [w1a, w1b, w1c, w2a, w2b, w2c]) {
      const proj = monza.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
      expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(monzaLimit);
      expect(Math.abs(proj.lateralOffset)).toBeLessThanOrEqual(monzaLimit);
    }
    expect(Math.hypot(w1b.x - w1a.x, w1b.z - w1a.z)).toBeGreaterThanOrEqual(1.95);
    expect(Math.hypot(w1c.x - w1b.x, w1c.z - w1b.z)).toBeGreaterThanOrEqual(1.95);
    expect(w1a.x).toBeCloseTo(w2a.x, 6);
    expect(w1b.x).toBeCloseTo(w2b.x, 6);
    expect(w1c.x).toBeCloseTo(w2c.x, 6);
  });

  it('orders tire compound grip (soft > medium > hard) and wearPerKm (soft > medium > hard)', () => {
    expect(TIRE_SPECS.soft.gripMultiplier).toBeGreaterThan(TIRE_SPECS.medium.gripMultiplier);
    expect(TIRE_SPECS.medium.gripMultiplier).toBeGreaterThan(TIRE_SPECS.hard.gripMultiplier);
    expect(TIRE_SPECS.soft.wearPerKm).toBeGreaterThan(TIRE_SPECS.medium.wearPerKm);
    expect(TIRE_SPECS.medium.wearPerKm).toBeGreaterThan(TIRE_SPECS.hard.wearPerKm);
  });

  it('supports manual gearbox upshift & downshift and clamps within gears 1..8', () => {
    const manualAssists = { ...ASSISTS, gearbox: 'manual' as const };
    const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    car.gear = 2;
    car.speed = 35;

    stepCarPhysics(car, makeControl({ throttle: 1, shiftUpPressed: true }), monza, 1 / 60, [car], manualAssists, 5, true);
    expect(car.gear).toBe(3);

    car.shiftCooldown = 0;
    stepCarPhysics(car, makeControl({ throttle: 0.5, shiftDownPressed: true }), monza, 1 / 60, [car], manualAssists, 5, true);
    expect(car.gear).toBe(2);

    // Downshifting at gear 1 stays at gear 1
    car.gear = 1;
    car.shiftCooldown = 0;
    stepCarPhysics(car, makeControl({ shiftDownPressed: true }), monza, 1 / 60, [car], manualAssists, 5, true);
    expect(car.gear).toBe(1);

    // Upshifting at gear 8 stays at gear 8
    car.gear = 8;
    car.shiftCooldown = 0;
    stepCarPhysics(car, makeControl({ shiftUpPressed: true }), monza, 1 / 60, [car], manualAssists, 5, true);
    expect(car.gear).toBe(8);
  });

  it('depletes ERS battery while boosting and harvests under heavy braking', () => {
    const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    car.speed = 65;
    car.ersBattery = 0.8;

    for (let i = 0; i < 60; i++) {
      stepCarPhysics(car, makeControl({ throttle: 1, boost: true }), monza, 1 / 60, [car], ASSISTS, 5, true);
    }
    const afterBoost = car.ersBattery;
    expect(afterBoost).toBeLessThan(0.8);

    // Now brake hard to harvest via MGU-K
    for (let i = 0; i < 45; i++) {
      stepCarPhysics(car, makeControl({ brake: 1 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    }
    expect(car.ersBattery).toBeGreaterThan(afterBoost);
  });

  it('warms cold tires under load and cools tires when coasting on straights', () => {
    const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    car.tireTemp = 72;
    car.speed = 68;

    for (let i = 0; i < 120; i++) {
      stepCarPhysics(car, makeControl({ throttle: 0.9, steer: 0.65 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    }
    expect(car.tireTemp).toBeGreaterThan(74);

    // Overheated tire cools when cruising gently straight
    car.tireTemp = 118;
    car.speed = 45;
    for (let i = 0; i < 180; i++) {
      stepCarPhysics(car, makeControl({ throttle: 0.25 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    }
    expect(car.tireTemp).toBeLessThan(118);
  });

  it('clamps car strictly inside barrier limits even when pushed far off-track', () => {
    const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    const smp = monza.sampleAtS(0.15);
    car.x = smp.position.x + smp.right.x * 22;
    car.y = smp.position.y;
    car.z = smp.position.z + smp.right.z * 22;
    car.s = smp.s;
    car.sampleIndex = smp.index;
    car.lateralOffset = 22;
    car.speed = 40;

    stepCarPhysics(car, makeControl({ throttle: 0.2 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    const maxWall = monza.config.trackWidth * 0.5 + 5.1;
    expect(Math.abs(car.lateralOffset)).toBeLessThanOrEqual(maxWall);
    expect(car.collisionShock).toBeGreaterThan(0);
  });

  it('applies off-track drag and dirties tires when driving beyond track limits', () => {
    const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    const smp = monza.sampleAtS(0.08);
    const offLat = monza.config.trackWidth * 0.5 + 2.8;
    car.x = smp.position.x + smp.right.x * offLat;
    car.y = smp.position.y;
    car.z = smp.position.z + smp.right.z * offLat;
    car.s = smp.s;
    car.sampleIndex = smp.index;
    car.lateralOffset = offLat;
    car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    car.speed = 60;

    stepCarPhysics(car, makeControl({ throttle: 0.5 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    expect(car.offTrack).toBe(true);
    expect(car.dirtyTiresTimer).toBeGreaterThan(0);
  });

  it('heavily slows down cars driving on roadside gravel/grass even at full throttle', () => {
    const smp = monza.sampleAtS(0.05);
    const onTrack = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    const offRoad = createInitialCarState('verstappen', false, 1.0, monza, 1, 'soft', true);

    const offLat = monza.config.trackWidth * 0.5 + 3.2;
    for (const [car, lat] of [
      [onTrack, 0],
      [offRoad, offLat],
    ] as const) {
      car.x = smp.position.x + smp.right.x * lat;
      car.y = smp.position.y;
      car.z = smp.position.z + smp.right.z * lat;
      car.s = smp.s;
      car.sampleIndex = smp.index;
      car.lateralOffset = lat;
      car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      car.speed = 75; // 270 km/h
      car.gear = 6;
    }

    for (let i = 0; i < 90; i++) {
      stepCarPhysics(onTrack, makeControl({ throttle: 1 }), monza, 1 / 60, [onTrack], ASSISTS, 5, true);
      stepCarPhysics(offRoad, makeControl({ throttle: 1 }), monza, 1 / 60, [offRoad], ASSISTS, 5, true);
    }

    // Roadside gravel/grass must bleed speed heavily compared to asphalt (by > 20 m/s = > 72 km/h!)
    expect(offRoad.speed).toBeLessThan(58);
    expect(onTrack.speed - offRoad.speed).toBeGreaterThan(20);
  });

  it('can accelerate out of deep roadside runoff from 0 km/h and engage Reverse (R) when holding Brake', () => {
    const smp = monza.sampleAtS(0.05);
    const car = createInitialCarState('yahia', true, 1.0, monza, 0, 'soft', true);
    const wallLat = monza.config.trackWidth * 0.5 + 4.3;
    car.x = smp.position.x + smp.right.x * wallLat;
    car.y = smp.position.y;
    car.z = smp.position.z + smp.right.z * wallLat;
    car.s = smp.s;
    car.sampleIndex = smp.index;
    car.lateralOffset = wallLat;
    car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    car.speed = 0;

    // 1. Must accelerate cleanly from 0 km/h even pressed right against the barrier off-track
    for (let i = 0; i < 60; i++) {
      stepCarPhysics(car, makeControl({ throttle: 1, steer: -0.6 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    }
    expect(car.speed).toBeGreaterThan(4.5);

    // 2. Stopping and holding Brake engages Reverse gear (-1) and backs out cleanly
    car.speed = 0;
    for (let i = 0; i < 60; i++) {
      stepCarPhysics(car, makeControl({ brake: 1, steer: 0.5 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    }
    expect(car.gear).toBe(-1);
    expect(car.speed).toBeLessThan(-3.0);

    // 3. Pressing Throttle brakes out of Reverse and returns to Gear 1 forward
    for (let i = 0; i < 90; i++) {
      stepCarPhysics(car, makeControl({ throttle: 1 }), monza, 1 / 60, [car], ASSISTS, 5, true);
    }
    expect(car.gear).toBeGreaterThanOrEqual(1);
    expect(car.speed).toBeGreaterThan(3.0);
  });
});
