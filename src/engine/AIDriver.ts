import type { DriverConfig } from '../data/teamsAndDrivers';
import { TIRE_SPECS, type CarState } from './CarPhysics';
import type { ControlInput } from './InputManager';
import { SAMPLE_COUNT, TrackSpline } from './TrackSpline';

export type AIDifficulty = 'easy' | 'medium' | 'pro';

const DIFFICULTY_SCALE: Record<AIDifficulty, number> = {
  easy: 0.80,
  medium: 0.93,
  pro: 1.02,
};

export class AIDriver {
  readonly driver: DriverConfig;
  private preferredLaneOffset: number;
  private currentLane: number;
  private laneTimer = 0;

  constructor(driver: DriverConfig, seedIndex: number) {
    this.driver = driver;
    // Slight natural racing-line variation per driver
    this.preferredLaneOffset = ((seedIndex % 5) - 2) * 0.55;
    this.currentLane = this.preferredLaneOffset;
  }

  computeInput(
    car: CarState,
    track: TrackSpline,
    allCars: CarState[],
    difficulty: AIDifficulty,
    dt: number,
    totalRaceLaps: number,
    canMove: boolean,
  ): ControlInput {
    if (!canMove) {
      return {
        throttle: 0.65,
        brake: 0,
        steer: 0,
        boost: false,
        shiftUpPressed: false,
        shiftDownPressed: false,
        cameraPressed: false,
        pitPressed: false,
        resetPressed: false,
        pausePressed: false,
      };
    }

    this.laneTimer = Math.max(0, this.laneTimer - dt);

    // Pit strategy on 5+ lap races when tire wear is high
    if (
      totalRaceLaps >= 5 &&
      car.lap >= 2 &&
      car.lap < totalRaceLaps - 1 &&
      car.pitStopsCount === 0 &&
      !car.pitRequested &&
      car.tireWear > 0.68
    ) {
      car.pitRequested = true;
    }

    // Reaction-window speed lookahead (recommendedSpeed already bakes in braking distance)
    const dsMeters = track.totalLength / SAMPLE_COUNT;
    const wearExtend = 1 + car.tireWear * 0.35;
    const lookDist = (10 + car.speed * 0.42) * wearExtend;
    const reactionSamples = Math.max(1, Math.round(lookDist / dsMeters));

    let targetSpeed = track.sampleAtIndex(car.sampleIndex).recommendedSpeed;
    let maxCurvInWindow = Math.abs(track.sampleAtIndex(car.sampleIndex).curvature);
    for (let offset = 1; offset <= reactionSamples; offset++) {
      const s = track.sampleAtIndex(car.sampleIndex + offset);
      if (s.recommendedSpeed < targetSpeed) {
        targetSpeed = s.recommendedSpeed;
      }
      if (Math.abs(s.curvature) > maxCurvInWindow) {
        maxCurvInWindow = Math.abs(s.curvature);
      }
    }

    // Apply driver pace + difficulty scaling
    const skillFactor = 0.91 + (this.driver.pace - 82) * 0.0065;
    const diffScale = DIFFICULTY_SCALE[difficulty];
    targetSpeed *= skillFactor * diffScale;

    // Cap corner apex speed to physical tire grip (prevents Pro/worn-tire overshoots)
    const tireSpec = TIRE_SPECS[car.tireCompound];
    const wearGripMult =
      car.tireWear > 0.65
        ? 1.0 - ((car.tireWear - 0.65) / 0.35) * 0.26
        : 1.0 - car.tireWear * 0.05;
    const dirtyGrip = car.dirtyTiresTimer > 0 ? 0.90 : 1.0;
    const physGripMult = tireSpec.gripMultiplier * wearGripMult * dirtyGrip * car.carPerf;
    if (maxCurvInWindow > 0.0032) {
      const effectiveK = maxCurvInWindow - 0.0028 * physGripMult;
      const maxPhysApexSpeed =
        effectiveK > 1e-4 ? Math.sqrt((25.2 * physGripMult) / effectiveK) : 97.5;
      targetSpeed = Math.min(targetSpeed, Math.max(18.5, maxPhysApexSpeed * 0.99));
    }

    // Smooth outside -> inside apex -> outside exit racing line transitions
    const halfW = track.config.trackWidth * 0.5;
    const steerDist = Math.min(44, 15 + car.speed * 0.35);
    const steerSample = track.sampleAtS(car.s + steerDist / track.totalLength);
    const nearSample = track.sampleAtS(car.s + (10 + car.speed * 0.18) / track.totalLength);
    const farSample = track.sampleAtS(car.s + (42 + car.speed * 0.55) / track.totalLength);
    const behindSample = track.sampleAtS(car.s - 20 / track.totalLength);

    const wNear = Math.min(1, Math.abs(nearSample.curvature) / 0.016);
    const wFar = Math.min(1, Math.abs(farSample.curvature) / 0.016);
    const wBehind = Math.min(1, Math.abs(behindSample.curvature) / 0.016);

    const apexLane = Math.sign(nearSample.curvature) * wNear * (halfW * 0.54);
    const entryOutside =
      -Math.sign(farSample.curvature) * Math.max(0, wFar - wNear) * (halfW * 0.50);
    const exitOutside =
      -Math.sign(behindSample.curvature) * Math.max(0, wBehind - wNear) * (halfW * 0.44);
    const straightWeight = Math.max(0, 1 - Math.max(wNear, wFar, wBehind));

    let desiredLane =
      apexLane + entryOutside + exitOutside + this.preferredLaneOffset * straightWeight;

    let carDirectlyAhead = false;
    let wantsBoost = false;

    for (const other of allCars) {
      if (other.driverId === car.driverId || other.inPitLane) continue;
      let dsNorm = other.s - car.s;
      if (dsNorm < 0) dsNorm += 1;
      const distAhead = dsNorm * track.totalLength;

      if (distAhead > 1.5 && distAhead < 28) {
        const latDiff = other.lateralOffset - car.lateralOffset;
        if (Math.abs(latDiff) < 3.1) {
          carDirectlyAhead = true;
          // Move cleanly to whichever side has more track space
          const overtakeSide = other.lateralOffset > 0 ? -1 : 1;
          if (this.laneTimer <= 0) {
            this.preferredLaneOffset = overtakeSide * Math.min(halfW - 1.8, 3.6);
            this.laneTimer = 1.4;
          }
          desiredLane = this.preferredLaneOffset;

          if (distAhead < 8.5 && Math.abs(latDiff) < 1.9 && car.speed > other.speed) {
            targetSpeed = Math.min(targetSpeed, other.speed * 0.96);
          }

          if (
            steerSample.activeAeroZone &&
            car.ersBattery > 0.28 &&
            distAhead < 24
          ) {
            wantsBoost = true;
          }
        }
      }
    }

    if (
      !carDirectlyAhead &&
      car.overtakeArmed &&
      steerSample.activeAeroZone &&
      car.ersBattery > 0.35
    ) {
      wantsBoost = true;
    }

    desiredLane = Math.max(-(halfW - 1.6), Math.min(halfW - 1.6, desiredLane));
    this.currentLane += (desiredLane - this.currentLane) * Math.min(1, dt * 4.5);

    // Steering toward lookahead point + smooth lateral target
    const targetX = steerSample.position.x + steerSample.right.x * this.currentLane;
    const targetZ = steerSample.position.z + steerSample.right.z * this.currentLane;
    const desiredHeading = Math.atan2(targetX - car.x, targetZ - car.z);

    let headingErr = desiredHeading - car.heading;
    while (headingErr > Math.PI) headingErr -= Math.PI * 2;
    while (headingErr < -Math.PI) headingErr += Math.PI * 2;

    // Remember: turning right (+steer) decreases heading!
    const steerCmd = Math.max(-1, Math.min(1, -headingErr * 2.2));

    // Sharpened speed regulation & braking response
    const speedErr = targetSpeed - car.speed;
    let throttle = 0;
    let brake = 0;

    if (speedErr >= -0.6) {
      throttle = Math.min(1, 0.54 + speedErr * 0.16);
      if (Math.abs(steerCmd) > 0.65 && car.speed > 45) {
        throttle *= 0.82;
      }
    } else {
      brake = Math.min(1, (-speedErr - 0.6) * 0.32);
    }

    return {
      throttle,
      brake,
      steer: steerCmd,
      boost: wantsBoost,
      shiftUpPressed: false,
      shiftDownPressed: false,
      cameraPressed: false,
      pitPressed: false,
      resetPressed: false,
      pausePressed: false,
    };
  }
}
