import * as THREE from 'three';
import type { ControlInput } from './InputManager';
import { isSInZone, TrackSpline, type TrackProjection } from './TrackSpline';

export type TireCompound = 'soft' | 'medium' | 'hard';

export interface TireSpec {
  id: TireCompound;
  label: string;
  code: 'S' | 'M' | 'H';
  color: string;
  gripMultiplier: number;
  wearPerKm: number;
}

export const TIRE_SPECS: Record<TireCompound, TireSpec> = {
  soft: {
    id: 'soft',
    label: 'SOFT',
    code: 'S',
    color: '#E10600',
    gripMultiplier: 1.075,
    wearPerKm: 0.030,
  },
  medium: {
    id: 'medium',
    label: 'MEDIUM',
    code: 'M',
    color: '#FFD700',
    gripMultiplier: 1.02,
    wearPerKm: 0.018,
  },
  hard: {
    id: 'hard',
    label: 'HARD',
    code: 'H',
    color: '#F3F4F6',
    gripMultiplier: 0.975,
    wearPerKm: 0.011,
  },
};

export interface AssistConfig {
  gearbox: 'auto' | 'manual';
  tractionControl: 'full' | 'medium' | 'off';
  abs: boolean;
  racingLine: 'full' | 'corners' | 'off';
  steeringAssist?: boolean;
  brakingAssist?: boolean;
}

export interface CarState {
  driverId: string;
  isPlayer: boolean;
  carPerf: number; // ~0.95..1.02

  // Kinematics
  x: number;
  y: number;
  z: number;
  heading: number; // yaw radians (+Z at 0, +X at PI/2)
  pitch: number; // radians (+ = nose up / uphill)
  roll: number; // radians (+ = left side higher / banked right)
  speed: number; // m/s forward speed
  lateralSpeed: number; // m/s lateral slip
  yawRate: number;
  steerAngle: number; // current visual wheel steer radians
  wheelSpinAngle: number;
  slipRatio: number; // 0..1 combined tire slip intensity

  // Powertrain & 2026 Tech
  gear: number; // 1..8
  rpm: number;
  shiftCooldown: number;
  activeAeroOpen: number; // 0 (Z-mode corner) .. 1 (X-mode straight)
  activeAeroActive: boolean;
  ersBattery: number; // 0 .. 1.125 (1.0 = 4.0 MJ; +0.125 = +0.5 MJ Overtake reserve)
  boostActive: boolean;
  overtakeArmed: boolean;
  overtakeRemainingS: number; // counts down after crossing detection
  slipstreamStrength: number; // 0..1

  // Tires & Pit
  tireCompound: TireCompound;
  tireWear: number; // 0..1
  tireTemp: number; // degrees C (optimal window 88..104)
  dirtyTiresTimer: number;
  onKerb: boolean;
  offTrack: boolean;
  pitRequested: boolean;
  inPitLane: boolean;
  pitServicing: boolean;
  pitStopTimer: number;
  pitStopDoneThisVisit: boolean;
  pitStopsCount: number;

  // Telemetry / feedback
  throttleApplied: number;
  brakeApplied: number;
  isBrakingHard: boolean;
  collisionShock: number;
  rubCooldown: number;

  // Track & Race progress
  sampleIndex: number;
  s: number; // [0, 1)
  prevS: number;
  lateralOffset: number;
  headingError: number;
  lap: number; // 1-indexed once race starts (0 before crossing grid start)
  totalProgress: number; // continuous lap + s
  finished: boolean;
  finishTimeMs: number;
  bestLapMs: number;
  lastLapMs: number;
  currentLapStartMs: number;
  sectorTimesMs: [number, number, number];
  currentSector: 1 | 2 | 3;
  sectorStartMs: number;
  trackLimitWarnings: number;
  penaltySeconds: number;
  cornerCutCooldown: number;
}

const GEAR_RATIOS = [0, 3.65, 2.74, 2.16, 1.75, 1.44, 1.21, 1.03, 0.89];
const GEAR_MAX_SPEEDS = [0, 29, 41, 53, 64, 75, 85, 93, 102]; // m/s

export function createInitialCarState(
  driverId: string,
  isPlayer: boolean,
  carPerf: number,
  track: TrackSpline,
  gridSlot: number, // 0 = Pole
  tireCompound: TireCompound,
  rollingStart = false,
): CarState {
  const ds = track.totalLength;
  // Staggered F1 starting grid behind start line (5.2m longitudinal spacing, ±2.1m lateral)
  const backMeters = rollingStart ? 18 : 8 + gridSlot * 5.2;
  const startS = (((1 - backMeters / ds) % 1) + 1) % 1;
  const lateralOffset = rollingStart ? 0 : gridSlot % 2 === 0 ? -2.1 : 2.1;
  const sample = track.sampleAtS(startS);

  const x = sample.position.x + sample.right.x * lateralOffset;
  const y = sample.position.y;
  const z = sample.position.z + sample.right.z * lateralOffset;
  const heading = Math.atan2(sample.tangent.x, sample.tangent.z);

  const initialSpeed = rollingStart ? Math.min(72, sample.recommendedSpeed * 0.9) : 0;

  return {
    driverId,
    isPlayer,
    carPerf,
    x,
    y,
    z,
    heading,
    pitch: sample.pitch,
    roll: sample.camber,
    speed: initialSpeed,
    lateralSpeed: 0,
    yawRate: 0,
    steerAngle: 0,
    wheelSpinAngle: 0,
    slipRatio: 0,
    gear: rollingStart ? 5 : 1,
    rpm: rollingStart ? 10500 : 4500,
    shiftCooldown: 0,
    activeAeroOpen: 0,
    activeAeroActive: false,
    ersBattery: 1.0,
    boostActive: false,
    overtakeArmed: false,
    overtakeRemainingS: 0,
    slipstreamStrength: 0,
    tireCompound,
    tireWear: 0,
    tireTemp: 92,
    dirtyTiresTimer: 0,
    onKerb: false,
    offTrack: false,
    pitRequested: false,
    inPitLane: false,
    pitServicing: false,
    pitStopTimer: 0,
    pitStopDoneThisVisit: false,
    pitStopsCount: 0,
    throttleApplied: 0,
    brakeApplied: 0,
    isBrakingHard: false,
    collisionShock: 0,
    rubCooldown: 0,
    sampleIndex: sample.index,
    s: startS,
    prevS: startS,
    lateralOffset,
    headingError: 0,
    lap: rollingStart ? 1 : 0,
    totalProgress: startS - 1, // < 0 before crossing start/finish line on Lap 1
    finished: false,
    finishTimeMs: 0,
    bestLapMs: 0,
    lastLapMs: 0,
    currentLapStartMs: 0,
    sectorTimesMs: [0, 0, 0],
    currentSector: 1,
    sectorStartMs: 0,
    trackLimitWarnings: 0,
    penaltySeconds: 0,
    cornerCutCooldown: 0,
  };
}

export function stepCarPhysics(
  car: CarState,
  input: ControlInput,
  track: TrackSpline,
  dt: number,
  allCars: CarState[],
  assists: AssistConfig,
  totalRaceLaps: number,
  canMove: boolean,
): TrackProjection {
  car.collisionShock = Math.max(0, car.collisionShock - dt * 4);
  car.rubCooldown = Math.max(0, car.rubCooldown - dt);
  car.shiftCooldown = Math.max(0, car.shiftCooldown - dt);
  car.dirtyTiresTimer = Math.max(0, car.dirtyTiresTimer - dt);
  car.cornerCutCooldown = Math.max(0, car.cornerCutCooldown - dt);

  if (input.pitPressed && car.isPlayer && canMove) {
    car.pitRequested = !car.pitRequested;
  }

  // Waiting on starting grid before lights out
  if (!canMove) {
    car.throttleApplied = input.throttle;
    car.brakeApplied = input.brake;
    car.rpm = 4800 + input.throttle * 7600;
    return track.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
  }

  // Pit stop servicing standstill
  if (car.pitServicing) {
    car.speed = 0;
    car.lateralSpeed = 0;
    car.throttleApplied = 0;
    car.brakeApplied = 1;
    car.rpm = 4400;
    car.pitStopTimer -= dt;
    if (car.pitStopTimer <= 0) {
      car.pitServicing = false;
      car.pitStopDoneThisVisit = true;
      car.pitRequested = false;
      car.pitStopsCount += 1;
      car.tireWear = 0;
      car.tireTemp = 68;
      car.slipRatio = 0;
      car.tireCompound = car.tireCompound === 'soft' ? 'medium' : 'soft';
      car.ersBattery = Math.max(car.ersBattery, 0.85);
    }
    const pitProj = track.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
    applyTrackProjectionToCar(car, pitProj, true);
    return pitProj;
  }

  const proj = track.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);
  const sample = proj.sample;
  const halfWidth = track.config.trackWidth * 0.5;

  // Check Pit-lane branch activation (only enter at the pit entry mouth near pitEntryS)
  const inPitEntryMouth = isSInZone(
    proj.s,
    track.config.pitEntryS,
    (track.config.pitEntryS + 0.035) % 1,
  );
  const inPitWindow = isSInZone(
    proj.s,
    track.config.pitEntryS,
    track.config.pitExitS,
  );
  if (car.pitRequested && inPitEntryMouth && !car.inPitLane) {
    car.inPitLane = true;
    car.pitStopDoneThisVisit = false;
  }
  if (car.inPitLane && !inPitWindow) {
    car.inPitLane = false;
    car.pitRequested = false;
  }

  // If driving in pit lane, smoothly guide onto pit lane and enforce 80 km/h limiter
  let effectiveSteer = input.steer;
  let effectiveThrottle = input.throttle;
  let effectiveBrake = input.brake;

  if (car.inPitLane) {
    const targetLat = track.getPitLaneLateralOffset(proj.s);
    const latErr = targetLat - proj.lateralOffset;
    const autoSteer = Math.max(-0.85, Math.min(0.85, latErr * 0.14 + proj.headingError * 1.4));
    effectiveSteer = autoSteer;

    // Detect pit box arrival roughly halfway through pit lane
    const entry = track.config.pitEntryS;
    const exit = track.config.pitExitS;
    const span = entry <= exit ? exit - entry : 1 - entry + exit;
    const pitProg =
      proj.s >= entry ? (proj.s - entry) / span : (1 - entry + proj.s) / span;

    if (!car.pitStopDoneThisVisit && pitProg >= 0.45 && pitProg <= 0.62) {
      car.pitServicing = true;
      car.pitStopTimer = 2.4;
      car.speed = 0;
      applyTrackProjectionToCar(car, proj, true);
      return proj;
    }

    const pitLimitMps = 22.2; // 80 km/h
    if (car.speed > pitLimitMps) {
      effectiveThrottle = 0;
      effectiveBrake = Math.min(1, (car.speed - pitLimitMps) * 0.45);
    } else {
      effectiveThrottle = Math.max(effectiveThrottle, 0.72);
    }
  }

  // Optional player-friendly driving assists (off in pit lane; bypassed on Boost / manual Brake)
  if (car.isPlayer && !car.inPitLane && car.speed > 1.5) {
    if (assists.brakingAssist && car.speed > 14 && !input.boost) {
      const dsMeters = track.totalLength / Math.max(1, track.samples.length);
      const lookDist = 14 + car.speed * 0.48;
      const steps = Math.max(2, Math.round(lookDist / dsMeters));
      let minRecSpeed = track.sampleAtIndex(proj.sampleIndex).recommendedSpeed;
      for (let i = 1; i <= steps; i++) {
        const s = track.sampleAtIndex(proj.sampleIndex + i);
        if (s.recommendedSpeed < minRecSpeed) {
          minRecSpeed = s.recommendedSpeed;
        }
      }
      if (car.speed > minRecSpeed * 1.06) {
        const overspeed = car.speed - minRecSpeed * 1.04;
        const assistBrake = Math.min(0.86, overspeed * 0.14);
        effectiveThrottle = Math.min(effectiveThrottle, Math.max(0, 1 - overspeed * 0.25));
        effectiveBrake = Math.max(effectiveBrake, assistBrake);
      }
    }

    if (assists.steeringAssist) {
      const rawAbs = Math.abs(effectiveSteer);
      const precisionSteer =
        Math.sign(effectiveSteer) * (0.34 * rawAbs + 0.66 * rawAbs * rawAbs);
      const hiSpeedCalm = 1 - Math.min(0.46, Math.max(0, (car.speed - 28) / 130));
      const shapedPlayerSteer = precisionSteer * hiSpeedCalm;

      const safeHalf = Math.max(2.0, halfWidth - 1.65);
      const laneHint = rawAbs < 0.08 ? proj.lateralOffset * 0.94 : proj.lateralOffset;
      const targetLane = THREE.MathUtils.clamp(laneHint, -safeHalf, safeHalf);
      const lookAheadMeters = Math.min(42, 12 + car.speed * 0.28);
      const aheadSample = track.sampleAtS(
        (proj.s + lookAheadMeters / Math.max(1, track.totalLength)) % 1,
      );
      const aimX = aheadSample.position.x + aheadSample.right.x * targetLane;
      const aimZ = aheadSample.position.z + aheadSample.right.z * targetLane;
      const desiredHeading = Math.atan2(aimX - car.x, aimZ - car.z);
      let aimErr = desiredHeading - car.heading;
      while (aimErr > Math.PI) aimErr -= Math.PI * 2;
      while (aimErr < -Math.PI) aimErr += Math.PI * 2;

      // Positive steer turns right (decreases heading)
      const autoFollowSteer = THREE.MathUtils.clamp(-aimErr * 1.95, -0.96, 0.96);

      if (rawAbs < 0.08) {
        const edgeBoost = Math.abs(proj.lateralOffset) > safeHalf * 0.85 ? 0.95 : 0.82;
        effectiveSteer = THREE.MathUtils.clamp(shapedPlayerSteer + autoFollowSteer * edgeBoost, -1, 1);
      } else {
        let blended = shapedPlayerSteer + autoFollowSteer * 0.30;
        const outsideSafe = Math.abs(proj.lateralOffset) > safeHalf;
        const pushingOut =
          Math.sign(proj.lateralOffset) === Math.sign(effectiveSteer) ||
          Math.sign(proj.lateralOffset) === Math.sign(aimErr);
        if (outsideSafe && pushingOut) {
          blended += autoFollowSteer * 0.38;
        }
        effectiveSteer = THREE.MathUtils.clamp(blended, -1, 1);
      }
    }
  }

  // Surface detection (asphalt / kerbs / off-track gravel-grass)
  const absLat = Math.abs(proj.lateralOffset);
  car.onKerb =
    !car.inPitLane &&
    absLat >= halfWidth - 1.15 &&
    absLat <= halfWidth + 1.2 &&
    ((proj.lateralOffset < 0 && sample.hasLeftKerb) ||
      (proj.lateralOffset > 0 && sample.hasRightKerb));
  car.offTrack = !car.inPitLane && absLat > halfWidth + 0.55;
  if (car.offTrack) {
    car.dirtyTiresTimer = 2.0;
  }

  // Track limit corner-cut check for player (cutting far inside a sharp corner at speed)
  if (
    car.isPlayer &&
    !car.inPitLane &&
    car.cornerCutCooldown <= 0 &&
    absLat > halfWidth + 1.65 &&
    car.speed > 26
  ) {
    // Inside cut if curvature and lateralOffset match
    const cuttingInside =
      (sample.curvature > 0.008 && proj.lateralOffset > halfWidth + 1.65) ||
      (sample.curvature < -0.008 && proj.lateralOffset < -(halfWidth + 1.65));
    if (cuttingInside) {
      car.trackLimitWarnings += 1;
      car.cornerCutCooldown = 3.5;
      if (car.trackLimitWarnings > 3) {
        car.penaltySeconds += 3;
      }
    }
  }

  // 2026 Active Aerodynamics (X-Mode straight vs Z-Mode corner)
  const steeringSmall = Math.abs(effectiveSteer) < 0.16;
  const shouldOpenAero =
    !car.inPitLane &&
    sample.activeAeroZone &&
    steeringSmall &&
    effectiveThrottle > 0.55 &&
    effectiveBrake < 0.1 &&
    car.speed > 34;

  car.activeAeroActive = shouldOpenAero;
  const aeroRate = shouldOpenAero ? 5.5 : 10.5;
  const aeroTarget = shouldOpenAero ? 1 : 0;
  car.activeAeroOpen +=
    Math.sign(aeroTarget - car.activeAeroOpen) *
    Math.min(Math.abs(aeroTarget - car.activeAeroOpen), aeroRate * dt);

  // Slipstream calculation behind any rival within 45m longitudinally & +-2.5m laterally
  let bestSlipstream = 0;
  if (!car.inPitLane && car.speed > 32) {
    for (const other of allCars) {
      if (other.driverId === car.driverId || other.inPitLane) continue;
      let dsNorm = other.s - proj.s;
      if (dsNorm < 0) dsNorm += 1;
      const distAhead = dsNorm * track.totalLength;
      if (distAhead > 3.5 && distAhead < 46) {
        const latGap = Math.abs(other.lateralOffset - proj.lateralOffset);
        if (latGap < 2.6) {
          const factor = (1 - distAhead / 46) * (1 - latGap / 2.6);
          if (factor > bestSlipstream) bestSlipstream = factor;
        }
      }
    }
  }
  car.slipstreamStrength = bestSlipstream;

  // 2026 ERS Battery (4.0 MJ) + Boost + Overtake Mode
  const maxBattery = car.overtakeArmed ? 1.125 : 1.0;
  car.ersBattery = Math.min(maxBattery, car.ersBattery);

  const wantsBoost = input.boost && !car.inPitLane && effectiveThrottle > 0.25 && car.ersBattery > 0.015;
  car.boostActive = wantsBoost;
  if (wantsBoost) {
    car.ersBattery = Math.max(0, car.ersBattery - 0.175 * dt);
  } else {
    // MGU-K harvests on braking & lift-off regeneration
    const brakeHarvest = effectiveBrake * (car.speed > 18 ? 0.16 : 0.04);
    const liftHarvest = effectiveThrottle < 0.15 && car.speed > 25 ? 0.065 : 0.012;
    car.ersBattery = Math.min(maxBattery, car.ersBattery + (brakeHarvest + liftHarvest) * dt);
  }

  // Tire Grip Curve, Wear & Thermal Window (88°C - 104°C optimal)
  const tireSpec = TIRE_SPECS[car.tireCompound];
  const distanceKm = (Math.abs(car.speed) * dt) / 1000;
  const lapWearFactor = totalRaceLaps <= 3 ? 1.25 : totalRaceLaps <= 5 ? 1.35 : 0.85;
  const wearStress = 1 + Math.abs(effectiveSteer) * 0.45 + (car.offTrack ? 1.1 : 0);
  car.tireWear = Math.min(1, car.tireWear + distanceKm * tireSpec.wearPerKm * lapWearFactor * wearStress);

  let wearGripMult = 1.0;
  if (car.tireWear > 0.65) {
    const over = (car.tireWear - 0.65) / 0.35;
    wearGripMult = 1.0 - over * 0.26;
  } else {
    wearGripMult = 1.0 - car.tireWear * 0.05;
  }

  let tempGripMult = 1.0;
  if (car.tireTemp < 88) {
    tempGripMult = 1.0 - Math.min(0.14, ((88 - car.tireTemp) / 28) * 0.14);
  } else if (car.tireTemp > 104) {
    tempGripMult = 1.0 - Math.min(0.12, ((car.tireTemp - 104) / 30) * 0.12);
  }

  const dirtyGrip = car.dirtyTiresTimer > 0 ? 0.90 : 1.0;
  const surfaceGrip = car.offTrack ? 0.66 : car.onKerb ? 0.96 : 1.0;
  const totalGrip = tireSpec.gripMultiplier * wearGripMult * tempGripMult * dirtyGrip * surfaceGrip;

  // Vertical curvature normal load (compression valley > 1, crest unloading < 1) & corner camber
  const vertLoadFactor = THREE.MathUtils.clamp(
    1 + (car.speed * car.speed * sample.verticalCurvature) / 9.81,
    0.65,
    1.35,
  );
  const carCamber = sample.camber * Math.cos(proj.headingError);
  const turnSign =
    Math.abs(effectiveSteer) > 0.02 ? Math.sign(effectiveSteer) : -Math.sign(car.yawRate || 0);
  const camberSupport = turnSign * Math.sin(carCamber);
  const camberGripMult = THREE.MathUtils.clamp(1 + camberSupport * 0.55, 0.88, 1.12);

  // Gearbox (Auto, Manual E/Q, or Reverse when holding Brake at standstill)
  const inReverse =
    !car.inPitLane &&
    ((car.speed <= 0.6 && effectiveBrake > 0.15 && effectiveThrottle < 0.08) ||
      (car.speed < -0.15 && effectiveThrottle < 0.12));

  if (inReverse) {
    car.gear = -1;
  } else {
    if (car.gear < 1) car.gear = 1;
    if (assists.gearbox === 'manual' && car.isPlayer) {
      if (input.shiftUpPressed && car.gear < 8 && car.shiftCooldown <= 0) {
        car.gear += 1;
        car.shiftCooldown = 0.08;
      }
      if (input.shiftDownPressed && car.gear > 1 && car.shiftCooldown <= 0) {
        car.gear -= 1;
        car.shiftCooldown = 0.08;
      }
    } else {
      // Responsive F1 Automatic shifting
      if (car.shiftCooldown <= 0) {
        const upshiftSpeed = GEAR_MAX_SPEEDS[car.gear] * 0.94;
        const downshiftSpeed = car.gear > 1 ? GEAR_MAX_SPEEDS[car.gear - 1] * 0.72 : -1;
        if (car.speed > upshiftSpeed && car.gear < 8) {
          car.gear += 1;
          car.shiftCooldown = 0.11;
        } else if (car.speed < downshiftSpeed && car.gear > 1) {
          car.gear -= 1;
          car.shiftCooldown = 0.11;
        }
      }
    }
  }

  // Longitudinal Acceleration (ICE + 350 kW MGU-K)
  const safeGear = Math.max(1, Math.min(8, car.gear));
  const gearMax = GEAR_MAX_SPEEDS[safeGear];
  const absSpeed = Math.abs(car.speed);
  const speedRatioInGear = Math.min(1.15, Math.max(0.18, absSpeed / gearMax));
  const torqueFactor = 1.16 - 0.28 * Math.abs(speedRatioInGear - 0.65);

  // Authentic 2026 high-speed electrical taper above 290 km/h (80.5 m/s) UNLESS Overtake Mode is active!
  let mgukHighSpeedFactor = 1.0;
  if (car.speed > 80.5 && !car.overtakeArmed) {
    const taper = Math.min(1, (car.speed - 80.5) / 16);
    mgukHighSpeedFactor = 1.0 - taper * 0.22;
  }

  const boostMult = car.boostActive ? 1.18 : 1.0;
  const overtakeBonus = car.overtakeArmed && car.speed > 72 ? 1.06 : 1.0;
  const baseDriveAccel = 16.4 * car.carPerf * torqueFactor * mgukHighSpeedFactor * boostMult * overtakeBonus;

  // Corner-exit power oversteer modulated by Traction Control
  let tcFactor = 1.0;
  let powerSlip = 0;
  let powerOversteerYaw = 0;
  let powerOversteerSlide = 0;
  if (effectiveThrottle > 0.52 && car.speed < 56) {
    const throttleExcess = (effectiveThrottle - 0.52) / 0.48;
    const speedBand = Math.max(0, 1 - car.speed / 56);
    const cornerLoad = Math.min(
      1,
      Math.abs(effectiveSteer) * 0.95 + Math.abs(car.lateralSpeed) * 0.14,
    );
    const rawDemand = throttleExcess * speedBand * cornerLoad;
    if (rawDemand > 0.05) {
      if (assists.tractionControl === 'off') {
        tcFactor = 1.0 - rawDemand * 0.16;
        powerSlip = rawDemand * 0.85;
        powerOversteerYaw = rawDemand * 1.35;
        powerOversteerSlide = rawDemand * 3.8;
      } else if (assists.tractionControl === 'medium') {
        tcFactor = 1.0 - rawDemand * 0.07;
        powerSlip = rawDemand * 0.36;
        powerOversteerYaw = rawDemand * 0.42;
        powerOversteerSlide = rawDemand * 1.3;
      } else {
        tcFactor = 1.0 - rawDemand * 0.03;
        powerSlip = rawDemand * 0.10;
      }
    }
    if (car.isPlayer && assists.steeringAssist) {
      powerSlip *= 0.35;
      powerOversteerYaw *= 0.35;
      powerOversteerSlide *= 0.35;
    }
  }

  // Roadside / Off-track gravel & grass slowdown (velocity-proportional so car NEVER gets stuck at 0 km/h!)
  const trackHalfW = track.config.trackWidth * 0.5;
  const offTrackDepth = car.offTrack
    ? Math.max(0, Math.abs(proj.lateralOffset) - (trackHalfW + 0.5))
    : 0;
  const baseOffTrackMult = car.offTrack
    ? Math.max(0.55, 0.78 - offTrackDepth * 0.05)
    : 1.0;
  // Ensure brisk low-speed torque so a car stopped in gravel/against a wall can always pull away cleanly
  const offTrackDriveMult =
    car.offTrack && absSpeed < 12 ? Math.max(baseOffTrackMult, 0.85) : baseOffTrackMult;

  const driveForce =
    effectiveThrottle * baseDriveAccel * Math.min(1.15, totalGrip) * tcFactor * offTrackDriveMult;

  // Aerodynamic Drag & Rolling Resistance (heavy speed-proportional gravel/grass drag off-track!)
  const aeroDragReduction = car.activeAeroOpen * 0.23;
  const slipstreamDragReduction = car.slipstreamStrength * 0.13;
  const dragCoeff = 0.00142 * (1 - aeroDragReduction - slipstreamDragReduction);
  const aeroDrag = dragCoeff * absSpeed * absSpeed;
  const rollingDrag = car.offTrack
    ? 0.95 + 0.185 * absSpeed + Math.min(3.5, offTrackDepth) * (0.28 + 0.052 * absSpeed)
    : 0.22 + 0.006 * absSpeed;

  // Dirty-air wake downforce loss + Downforce + Combined-slip Braking
  const dirtyAirFactor = 1 - car.slipstreamStrength * 0.12;
  const downforceBonus =
    (1 - car.activeAeroOpen * 0.22) * dirtyAirFactor * (absSpeed * absSpeed) * 0.0038;
  const absMult = assists.abs ? 1.0 : 0.93;
  const latLoadRatio = Math.min(
    1,
    Math.abs(car.yawRate * absSpeed) / Math.max(12, 26 * totalGrip),
  );
  const combinedBrakeAvail = Math.sqrt(Math.max(0.55, 1 - 0.36 * latLoadRatio * latLoadRatio));
  const brakeDecel =
    effectiveBrake *
    (31.5 * totalGrip * vertLoadFactor * absMult * combinedBrakeAvail + downforceBonus * 0.32);

  car.isBrakingHard = effectiveBrake > 0.6 && car.speed > 20;

  // 3D slope gravity along car heading
  const slopeGravityAccel = -9.81 * sample.tangent.y * Math.cos(proj.headingError);

  let netAccel = 0;
  if (inReverse) {
    // Reverse gear: S/Down accelerates backward up to -16 m/s (-58 km/h); W/Up brakes back to 0
    const revAccel = effectiveBrake * 10.5 * Math.min(1.0, totalGrip);
    const revBrake = effectiveThrottle * 24.0;
    const revDrag = rollingDrag * 0.65;
    netAccel = -revAccel + revBrake + Math.sign(-car.speed) * revDrag + slopeGravityAccel * 0.4;
    car.speed = Math.max(-16.0, Math.min(0, car.speed + netAccel * dt));
    if (Math.abs(car.speed) < 0.08 && effectiveBrake < 0.08) {
      car.speed = 0;
    }
  } else if (car.speed < 0) {
    // Coming out of reverse with throttle: smoothly decelerate reverse speed to 0
    netAccel = 26.0 * Math.max(0.4, effectiveThrottle);
    car.speed = Math.min(0, car.speed + netAccel * dt);
  } else {
    netAccel = driveForce - aeroDrag - rollingDrag - brakeDecel + slopeGravityAccel;
    if (car.speed <= 0.1 && effectiveThrottle <= 0.05) {
      netAccel = 0;
      car.speed = 0;
    }
    car.speed = Math.max(0, Math.min(101.5, car.speed + netAccel * dt));
  }
  car.throttleApplied = effectiveThrottle;
  car.brakeApplied = effectiveBrake;

  // Longitudinal weight transfer & combined-slip friction circle
  const weightTransfer = THREE.MathUtils.clamp(-netAccel / 32.0, -0.35, 0.45);
  const frontAxleLoad = 1 + weightTransfer * 0.28;

  let brakeLatMod = 1.0;
  if (effectiveBrake > 0.02) {
    if (effectiveBrake <= 0.65) {
      // Light/medium trail-braking transfers weight onto front tires -> sharper turn-in
      const t = effectiveBrake / 0.65;
      brakeLatMod = 1.0 + Math.sin(t * Math.PI) * 0.15;
    } else {
      // Full-lock heavy braking saturates front friction circle -> understeer
      const over = (effectiveBrake - 0.65) / 0.35;
      const minLat = assists.abs ? 0.70 : 0.44;
      brakeLatMod = 1.0 - over * (1.0 - minLat);
    }
  }

  const brakeSlip =
    car.speed > 5
      ? effectiveBrake > 0.65
        ? ((effectiveBrake - 0.65) / 0.35) * (assists.abs ? 0.26 : 0.88)
        : effectiveBrake * 0.14
      : 0;
  const latSlip = Math.min(1, Math.abs(car.lateralSpeed) / 9.5);
  const targetSlip = Math.min(1, Math.max(brakeSlip, powerSlip, latSlip));
  car.slipRatio += (targetSlip - car.slipRatio) * Math.min(1, dt * 12);

  // RPM calculation
  const gearMin = safeGear > 1 ? GEAR_MAX_SPEEDS[safeGear - 1] * 0.62 : 0;
  const gearNorm =
    car.gear < 0
      ? Math.min(1, Math.abs(car.speed) / 18)
      : Math.max(0, Math.min(1.06, (car.speed - gearMin) / Math.max(12, gearMax - gearMin)));
  const targetRpm = 4600 + gearNorm * 8200 + (car.boostActive ? 350 : 0);
  car.rpm += (targetRpm - car.rpm) * Math.min(1, dt * 16);

  // Cornering & Lateral Dynamics (Bicycle-style speed-sensitive F1 steering + friction circle)
  const cornerGripAccel =
    (25.2 * vertLoadFactor * camberGripMult + downforceBonus * 0.85) *
      totalGrip *
      car.carPerf *
      brakeLatMod +
    9.81 * camberSupport;
  const speedMag = Math.abs(car.speed);
  const maxAngularTurn = speedMag > 0.35 ? cornerGripAccel / Math.max(6, speedMag) : 0;

  // Speed-sensitive steering curvature with trail-braking bite & full-lock understeer
  const lowSpeedGain = speedMag < 28 ? 1.25 : 1.0;
  const steerTurnMod =
    brakeLatMod < 1.0
      ? 0.52 + 0.48 * brakeLatMod
      : Math.min(1.16, brakeLatMod * (0.94 + frontAxleLoad * 0.06));
  const steerCurvature =
    effectiveSteer * 0.068 * lowSpeedGain * steerTurnMod * (1 - Math.min(0.62, speedMag / 138));
  const rawYawRate =
    -car.speed * steerCurvature - Math.sign(effectiveSteer || 0) * powerOversteerYaw;
  const clampedYawRate =
    Math.sign(rawYawRate) * Math.min(Math.abs(rawYawRate), maxAngularTurn * 1.25);

  car.yawRate += (clampedYawRate - car.yawRate) * Math.min(1, dt * 13);
  car.heading += car.yawRate * dt;
  car.steerAngle = effectiveSteer * 0.42;
  car.wheelSpinAngle += (car.speed / 0.34) * dt;

  // Lateral slip & corner-exit power oversteer slide
  const lateralG = -car.speed * car.yawRate;
  const slipMag =
    Math.abs(lateralG) > cornerGripAccel * 0.82
      ? -Math.sign(lateralG) * (Math.abs(lateralG) - cornerGripAccel * 0.82) * 0.22
      : 0;
  const oversteerOut = -Math.sign(effectiveSteer || 0) * powerOversteerSlide;
  let slipTarget = slipMag + oversteerOut;
  if (car.isPlayer && assists.steeringAssist) {
    slipTarget *= 0.55;
  }
  car.lateralSpeed += (slipTarget - car.lateralSpeed) * Math.min(1, dt * 8);

  // Live tire thermal simulation (88°C - 104°C optimal window)
  const latWork = Math.abs(car.yawRate * car.speed);
  const speedWarm = (car.speed / 95) * 18;
  const compoundHeatMult =
    car.tireCompound === 'soft' ? 1.12 : car.tireCompound === 'medium' ? 1.0 : 0.90;
  const workTempOffset =
    (latWork * 0.62 +
      Math.abs(car.lateralSpeed) * 2.2 +
      car.slipRatio * 12.0 +
      effectiveBrake * (car.speed / 80) * 10.0) *
    compoundHeatMult;
  const targetTireTemp = 68 + speedWarm + workTempOffset;
  const tempRate = targetTireTemp > car.tireTemp ? 0.24 : 0.06 + (car.speed / 100) * 0.07;
  car.tireTemp = THREE.MathUtils.clamp(
    car.tireTemp + (targetTireTemp - car.tireTemp) * Math.min(1, tempRate * dt),
    50,
    145,
  );

  // Integrate XZ world position
  const fwdX = Math.sin(car.heading);
  const fwdZ = Math.cos(car.heading);
  const rightX = -fwdZ;
  const rightZ = fwdX;

  car.x += (fwdX * car.speed + rightX * car.lateralSpeed) * dt;
  car.z += (fwdZ * car.speed + rightZ * car.lateralSpeed) * dt;

  // Barrier containment (angle-dependent glancing wall deflection, never snag or tunnel!)
  let postProj = track.projectToTrack(car.x, car.z, car.heading, proj.sampleIndex);
  const barrierLimit = car.inPitLane ? halfWidth + 14.5 : halfWidth + 4.4;
  if (Math.abs(postProj.lateralOffset) > barrierLimit) {
    for (let iter = 0; iter < 4 && Math.abs(postProj.lateralOffset) > barrierLimit; iter++) {
      const sign = Math.sign(postProj.lateralOffset);
      const excess = Math.abs(postProj.lateralOffset) - barrierLimit;
      car.x -= postProj.sample.right.x * sign * (excess + 1e-4);
      car.z -= postProj.sample.right.z * sign * (excess + 1e-4);
      postProj = track.projectToTrack(car.x, car.z, car.heading, postProj.sampleIndex);
    }

    const trackYaw = Math.atan2(postProj.sample.tangent.x, postProj.sample.tangent.z);
    let diff = trackYaw - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const impactSin = Math.abs(Math.sin(diff));
    const alignGain = Math.min(0.68, 0.20 + impactSin * 0.55);
    car.heading += diff * alignGain;

    const speedRetention = Math.max(0.36, 1 - impactSin * 0.62 - 0.008);
    car.speed *= speedRetention;
    car.lateralSpeed *= -0.15;

    const shock = Math.min(1, (0.20 + impactSin * 0.85) * Math.min(1.2, car.speed / 45 + 0.25));
    car.collisionShock = Math.max(car.collisionShock, shock);
    postProj = track.projectToTrack(car.x, car.z, car.heading, postProj.sampleIndex);
  }

  applyTrackProjectionToCar(car, postProj, true);
  return postProj;
}

function applyTrackProjectionToCar(
  car: CarState,
  proj: TrackProjection,
  updatePrevS: boolean,
): void {
  car.y = proj.sample.position.y;
  car.pitch =
    proj.sample.pitch * Math.cos(proj.headingError) +
    proj.sample.camber * Math.sin(proj.headingError);
  car.roll =
    proj.sample.camber * Math.cos(proj.headingError) -
    proj.sample.pitch * Math.sin(proj.headingError);
  car.sampleIndex = proj.sampleIndex;
  if (updatePrevS) {
    car.prevS = car.s;
  }
  car.s = proj.s;
  car.lateralOffset = proj.lateralOffset;
  car.headingError = proj.headingError;
}

/**
 * Resolves symmetric car-to-car wheel-bumping separation along true minimum penetration depth,
 * applying a damped lateral impulse and wheel-rub speed scrub on lateral contact, and optionally
 * clamping collided cars strictly within the track's barrier limit.
 */
export function resolveCarCollisions(cars: CarState[], track?: TrackSpline): void {
  const n = cars.length;
  if (n < 2) return;

  const minLong = 4.6;
  const minLat = 1.95;
  const maxDiagSq = minLong * minLong + minLat * minLat;

  const preX = new Float64Array(n);
  const preZ = new Float64Array(n);
  const preSpd = new Float64Array(n);
  const preLatSpd = new Float64Array(n);
  const preRubCd = new Float64Array(n);
  const dxAccum = new Float64Array(n);
  const dzAccum = new Float64Array(n);
  const latImpAccum = new Float64Array(n);
  const latRubbed = new Uint8Array(n);
  const longSpdAccum = new Float64Array(n);
  const longCount = new Uint16Array(n);
  const touched = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    preX[i] = cars[i].x;
    preZ[i] = cars[i].z;
    preSpd[i] = cars[i].speed;
    preLatSpd[i] = cars[i].lateralSpeed;
    preRubCd[i] = cars[i].rubCooldown ?? 0;
  }

  const measurePairOverlap = (
    a: CarState,
    b: CarState,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) => {
    const dx = bx - ax;
    const dz = bz - az;
    const distSq = dx * dx + dz * dz;
    if (distSq > maxDiagSq) return null;

    // Midpoint heading frame guarantees order-independent symmetry between car a and car b
    let fwdX = Math.sin(a.heading) + Math.sin(b.heading);
    let fwdZ = Math.cos(a.heading) + Math.cos(b.heading);
    let fLen = Math.hypot(fwdX, fwdZ);
    if (fLen < 1e-4) {
      // Canonical order-independent fallback for ~180° opposing headings
      const sax = Math.sin(a.heading);
      const saz = Math.cos(a.heading);
      const sbx = Math.sin(b.heading);
      const sbz = Math.cos(b.heading);
      if (sax > sbx || (sax === sbx && saz >= sbz)) {
        fwdX = sax;
        fwdZ = saz;
      } else {
        fwdX = sbx;
        fwdZ = sbz;
      }
      fLen = Math.hypot(fwdX, fwdZ) || 1;
    }
    fwdX /= fLen;
    fwdZ /= fLen;
    const rightX = -fwdZ;
    const rightZ = fwdX;

    const along = dx * fwdX + dz * fwdZ;
    const across = distSq < 1e-8 ? 0 : dx * rightX + dz * rightZ;

    if (Math.abs(along) < minLong && Math.abs(across) < minLat) {
      return {
        fwdX,
        fwdZ,
        rightX,
        rightZ,
        along,
        across,
        penLong: minLong - Math.abs(along),
        penLat: minLat - Math.abs(across),
      };
    }
    return null;
  };

  // Phase 1: symmetric snapshot-based separation and velocity impulses
  for (let i = 0; i < n; i++) {
    const a = cars[i];
    if (a.pitServicing) continue;
    for (let j = i + 1; j < n; j++) {
      const b = cars[j];
      if (b.pitServicing || a.inPitLane !== b.inPitLane) continue;

      const hit = measurePairOverlap(a, b, preX[i], preZ[i], preX[j], preZ[j]);
      if (!hit) continue;

      const { fwdX, fwdZ, rightX, rightZ, along, across, penLong, penLat } = hit;

      if (penLat <= penLong) {
        const sign =
          Math.abs(across) < 1e-8 ? (a.driverId <= b.driverId ? 1 : -1) : across >= 0 ? 1 : -1;
        const halfPush = penLat * 0.52;
        dxAccum[i] -= rightX * sign * halfPush;
        dzAccum[i] -= rightZ * sign * halfPush;
        dxAccum[j] += rightX * sign * halfPush;
        dzAccum[j] += rightZ * sign * halfPush;

        // Project world separation normal onto each car's own right vector (handles spun/angled cars)
        const sepX = rightX * sign;
        const sepZ = rightZ * sign;
        const rightAX = -Math.cos(a.heading);
        const rightAZ = Math.sin(a.heading);
        const rightBX = -Math.cos(b.heading);
        const rightBZ = Math.sin(b.heading);
        const projA = sepX * rightAX + sepZ * rightAZ;
        const projB = sepX * rightBX + sepZ * rightBZ;

        let relSep = 0;
        if (preRubCd[i] > 0 || preRubCd[j] > 0) {
          const vaX = Math.sin(a.heading) * preSpd[i] + rightAX * preLatSpd[i];
          const vaZ = Math.cos(a.heading) * preSpd[i] + rightAZ * preLatSpd[i];
          const vbX = Math.sin(b.heading) * preSpd[j] + rightBX * preLatSpd[j];
          const vbZ = Math.cos(b.heading) * preSpd[j] + rightBZ * preLatSpd[j];
          relSep = (vbX - vaX) * sepX + (vbZ - vaZ) * sepZ;
        }

        if (preRubCd[i] <= 0) {
          latImpAccum[i] -= 0.45 * projA;
          latRubbed[i] = 1;
        } else if (relSep < 0.25) {
          latImpAccum[i] -= 0.14 * projA;
        }

        if (preRubCd[j] <= 0) {
          latImpAccum[j] += 0.45 * projB;
          latRubbed[j] = 1;
        } else if (relSep < 0.25) {
          latImpAccum[j] += 0.14 * projB;
        }
      } else {
        const sign =
          Math.abs(along) < 1e-8 ? (a.driverId <= b.driverId ? 1 : -1) : along >= 0 ? 1 : -1;
        const halfPush = penLong * 0.52;
        dxAccum[i] -= fwdX * sign * halfPush;
        dzAccum[i] -= fwdZ * sign * halfPush;
        dxAccum[j] += fwdX * sign * halfPush;
        dzAccum[j] += fwdZ * sign * halfPush;

        if (sign > 0 && preSpd[i] > preSpd[j]) {
          const avg = (preSpd[i] + preSpd[j]) * 0.5;
          longSpdAccum[i] += avg * 0.96;
          longCount[i] += 1;
          longSpdAccum[j] += Math.min(101.5, avg * 1.03);
          longCount[j] += 1;
        } else if (sign < 0 && preSpd[j] > preSpd[i]) {
          const avg = (preSpd[i] + preSpd[j]) * 0.5;
          longSpdAccum[j] += avg * 0.96;
          longCount[j] += 1;
          longSpdAccum[i] += Math.min(101.5, avg * 1.03);
          longCount[i] += 1;
        }
      }

      touched[i] = 1;
      touched[j] = 1;
    }
  }

  let anyTouched = false;
  for (let i = 0; i < n; i++) {
    if (!touched[i]) continue;
    anyTouched = true;
    const car = cars[i];
    car.x += dxAccum[i];
    car.z += dzAccum[i];
    car.lateralSpeed += latImpAccum[i];
    if (longCount[i] > 0) {
      car.speed = longSpdAccum[i] / longCount[i];
    }
    if (latRubbed[i]) {
      car.speed *= 0.985;
      car.rubCooldown = 0.14;
    }
    car.collisionShock = Math.max(car.collisionShock, 0.35);
  }

  if (!anyTouched) return;

  const halfWidth = track ? track.config.trackWidth * 0.5 : 0;
  const wallSign = new Int8Array(n);
  const chainWall = new Int8Array(n);

  const clampCarToBarrier = (idx: number): void => {
    if (!track) return;
    const car = cars[idx];
    const barrierLimit = car.inPitLane ? halfWidth + 14.5 : halfWidth + 4.4;
    let proj = track.projectToTrack(car.x, car.z, car.heading, car.sampleIndex);

    if (Math.abs(proj.lateralOffset) > barrierLimit) {
      const sign = Math.sign(proj.lateralOffset);
      wallSign[idx] = sign;
      chainWall[idx] = sign;

      for (let iter = 0; iter < 4 && Math.abs(proj.lateralOffset) > barrierLimit; iter++) {
        const curSign = Math.sign(proj.lateralOffset);
        const excess = Math.abs(proj.lateralOffset) - barrierLimit;
        car.x -= proj.sample.right.x * curSign * (excess + 1e-4);
        car.z -= proj.sample.right.z * curSign * (excess + 1e-4);
        proj = track.projectToTrack(car.x, car.z, car.heading, proj.sampleIndex);
      }

      if (car.lateralSpeed * sign > 0) {
        car.lateralSpeed *= -0.15;
      }

      const trackYaw = Math.atan2(proj.sample.tangent.x, proj.sample.tangent.z);
      let diff = trackYaw - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.sin(diff) * sign > 0) {
        const impactSin = Math.abs(Math.sin(diff));
        const alignGain = Math.min(0.68, 0.20 + impactSin * 0.55);
        car.heading += diff * alignGain;
        const speedRetention = Math.max(0.36, 1 - impactSin * 0.62 - 0.008);
        car.speed *= speedRetention;
        const shock = Math.min(
          1,
          (0.20 + impactSin * 0.85) * Math.min(1.2, car.speed / 45 + 0.25),
        );
        car.collisionShock = Math.max(car.collisionShock, shock);
        proj = track.projectToTrack(car.x, car.z, car.heading, proj.sampleIndex);
      }
    }

    applyTrackProjectionToCar(car, proj, false);
  };

  if (track) {
    for (let i = 0; i < n; i++) {
      if (touched[i]) {
        clampCarToBarrier(i);
      }
    }
  }

  // Phase 2: iterative position + barrier-aware projection for multi-car & wall-pinned squeezes
  const curRightX = track ? new Float64Array(n) : null;
  const curRightZ = track ? new Float64Array(n) : null;
  const overlaps: { i: number; j: number; px: number; pz: number }[] = [];

  for (let iter = 0; iter < 8; iter++) {
    overlaps.length = 0;
    for (let i = 0; i < n; i++) {
      dxAccum[i] = 0;
      dzAccum[i] = 0;
      preX[i] = cars[i].x;
      preZ[i] = cars[i].z;
      if (wallSign[i] !== 0) {
        chainWall[i] = wallSign[i];
      }
      if (track && curRightX && curRightZ) {
        const pr = track.projectToTrack(cars[i].x, cars[i].z, cars[i].heading, cars[i].sampleIndex);
        curRightX[i] = pr.sample.right.x;
        curRightZ[i] = pr.sample.right.z;
      }
    }

    for (let i = 0; i < n; i++) {
      const a = cars[i];
      if (a.pitServicing) continue;
      for (let j = i + 1; j < n; j++) {
        const b = cars[j];
        if (b.pitServicing || a.inPitLane !== b.inPitLane) continue;
        const hit = measurePairOverlap(a, b, preX[i], preZ[i], preX[j], preZ[j]);
        if (!hit) continue;

        const { fwdX, fwdZ, rightX, rightZ, along, across, penLong, penLat } = hit;
        let px = 0;
        let pz = 0;
        if (penLat <= penLong) {
          const s =
            Math.abs(across) < 1e-8 ? (a.driverId <= b.driverId ? 1 : -1) : across >= 0 ? 1 : -1;
          const fullPush = penLat * 1.04;
          px = rightX * s * fullPush;
          pz = rightZ * s * fullPush;
        } else {
          const s =
            Math.abs(along) < 1e-8 ? (a.driverId <= b.driverId ? 1 : -1) : along >= 0 ? 1 : -1;
          const fullPush = penLong * 1.04;
          px = fwdX * s * fullPush;
          pz = fwdZ * s * fullPush;
        }
        overlaps.push({ i, j, px, pz });
      }
    }

    if (overlaps.length === 0) break;

    if (track && curRightX && curRightZ) {
      for (let pass = 0; pass < n; pass++) {
        let changed = false;
        for (const o of overlaps) {
          if (
            chainWall[o.j] !== 0 &&
            chainWall[o.i] === 0 &&
            (o.px * curRightX[o.j] + o.pz * curRightZ[o.j]) * chainWall[o.j] > 0
          ) {
            chainWall[o.i] = chainWall[o.j];
            changed = true;
          }
          if (
            chainWall[o.i] !== 0 &&
            chainWall[o.j] === 0 &&
            (-o.px * curRightX[o.i] - o.pz * curRightZ[o.i]) * chainWall[o.i] > 0
          ) {
            chainWall[o.j] = chainWall[o.i];
            changed = true;
          }
        }
        if (!changed) break;
      }
    }

    for (const { i, j, px, pz } of overlaps) {
      const aBlocked =
        track !== undefined &&
        curRightX !== null &&
        curRightZ !== null &&
        chainWall[i] !== 0 &&
        (-px * curRightX[i] - pz * curRightZ[i]) * chainWall[i] > 0;
      const bBlocked =
        track !== undefined &&
        curRightX !== null &&
        curRightZ !== null &&
        chainWall[j] !== 0 &&
        (px * curRightX[j] + pz * curRightZ[j]) * chainWall[j] > 0;

      if (!aBlocked && bBlocked) {
        dxAccum[i] -= px;
        dzAccum[i] -= pz;
      } else if (aBlocked && !bBlocked) {
        dxAccum[j] += px;
        dzAccum[j] += pz;
      } else if (!aBlocked && !bBlocked) {
        dxAccum[i] -= px * 0.5;
        dzAccum[i] -= pz * 0.5;
        dxAccum[j] += px * 0.5;
        dzAccum[j] += pz * 0.5;
      }
    }

    let movedAny = false;
    for (let i = 0; i < n; i++) {
      if (dxAccum[i] !== 0 || dzAccum[i] !== 0) {
        movedAny = true;
        cars[i].x += dxAccum[i];
        cars[i].z += dzAccum[i];
        if (track) {
          clampCarToBarrier(i);
        }
      }
    }
    if (!movedAny) break;
  }
}

export function resetCarToTrack(car: CarState, track: TrackSpline): void {
  const sample = track.sampleAtS(car.s);
  car.x = sample.position.x;
  car.y = sample.position.y;
  car.z = sample.position.z;
  car.heading = Math.atan2(sample.tangent.x, sample.tangent.z);
  car.pitch = sample.pitch;
  car.roll = sample.camber;
  car.speed = Math.min(car.speed, 22);
  car.lateralSpeed = 0;
  car.yawRate = 0;
  car.slipRatio = 0;
  car.rubCooldown = 0;
  car.inPitLane = false;
  car.pitServicing = false;
  car.pitRequested = false;
}

export { GEAR_RATIOS };
