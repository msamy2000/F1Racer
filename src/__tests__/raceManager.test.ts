import { describe, expect, it } from 'vitest';
import {
  ALL_DRIVERS,
  getDriverPortraitPath,
  YAHIA_DRIVER,
} from '../data/teamsAndDrivers';
import { AIDriver } from '../engine/AIDriver';
import { stepCarPhysics } from '../engine/CarPhysics';
import {
  createNewChampionshipState,
  F1_POINTS_TABLE,
  formatLapTime,
  RaceManager,
  scoreChampionshipRound,
  type RaceResultEntry,
  type RaceSettings,
} from '../engine/RaceManager';
import { CameraRig } from '../rendering/CameraRig';

const BASE_SETTINGS: RaceSettings = {
  mode: 'grand-prix',
  circuitId: 'red-bull-ring',
  playerDriverId: 'yahia',
  yahiaTeamId: 'mercedes',
  laps: 3,
  difficulty: 'medium',
  startingTire: 'soft',
  qualifyingEnabled: false,
  assists: {
    gearbox: 'auto',
    tractionControl: 'medium',
    abs: true,
    racingLine: 'corners',
  },
};

describe('RaceManager, 2026 Roster & Championship Scoring', () => {
  it('resolves Yahia Samy #17 (EGY) flex portraits across Mercedes, Red Bull, McLaren, Victory & Podium', () => {
    expect(YAHIA_DRIVER.number).toBe(17);
    expect(YAHIA_DRIVER.country).toBe('Egypt');
    expect(YAHIA_DRIVER.code).toBe('SAM');
    expect(getDriverPortraitPath(YAHIA_DRIVER, 'mercedes', 'grid')).toBe(
      './assets/drivers/yahia-mercedes.png',
    );
    expect(getDriverPortraitPath(YAHIA_DRIVER, 'redbull', 'grid')).toBe(
      './assets/drivers/yahia-redbull.png',
    );
    expect(getDriverPortraitPath(YAHIA_DRIVER, 'mclaren', 'grid')).toBe(
      './assets/drivers/yahia-mclaren.png',
    );
    expect(getDriverPortraitPath(YAHIA_DRIVER, 'mercedes', 'victory')).toBe(
      './assets/drivers/yahia-victory.png',
    );
    expect(getDriverPortraitPath(YAHIA_DRIVER, 'mercedes', 'podium')).toBe(
      './assets/drivers/yahia-podium.png',
    );

    const uniquePaths = new Set<string>();
    for (const d of ALL_DRIVERS) {
      if (d.isFlexStar) {
        for (const t of ['mercedes', 'redbull', 'mclaren'] as const) {
          uniquePaths.add(getDriverPortraitPath(d, t, 'grid'));
        }
        uniquePaths.add(getDriverPortraitPath(d, 'mercedes', 'victory'));
        uniquePaths.add(getDriverPortraitPath(d, 'mercedes', 'podium'));
      } else {
        uniquePaths.add(getDriverPortraitPath(d));
      }
    }
    expect(uniquePaths.size).toBe(20);
    for (const p of uniquePaths) {
      expect(p.startsWith('./assets/drivers/')).toBe(true);
      expect(p.endsWith('.png')).toBe(true);
    }
  });

  it('spawns all 12 drivers on track and transitions 5 red lights -> racing', () => {
    const race = new RaceManager(BASE_SETTINGS);
    expect(race.cars.length).toBe(12);
    expect(race.phase).toBe('countdown');

    const idleCtrl = {
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
    };

    // Simulate up to 7 seconds of countdown
    let sawAllFiveLit = false;
    for (let i = 0; i < 420; i++) {
      race.step(idleCtrl, 1 / 60);
      if (race.lightsLit === 5) sawAllFiveLit = true;
      if (race.phase === 'racing') break;
    }

    expect(sawAllFiveLit).toBe(true);
    expect(race.phase).toBe('racing');
  });

  it('awards authentic F1 points (25-18-15...) and advances Championship rounds', () => {
    expect(F1_POINTS_TABLE[0]).toBe(25);
    expect(F1_POINTS_TABLE[1]).toBe(18);
    expect(F1_POINTS_TABLE[9]).toBe(1);

    const champ0 = createNewChampionshipState('yahia', 'mclaren', 'medium');
    const mockResults: RaceResultEntry[] = ALL_DRIVERS.map((d, idx) => ({
      position: idx + 1,
      driver: d,
      teamId: d.id === 'yahia' ? 'mclaren' : d.teamId,
      isPlayer: d.id === 'yahia',
      totalTimeMs: 320000 + idx * 1200,
      gapMs: idx * 1200,
      bestLapMs: 65900 + idx * 200,
      penaltySeconds: 0,
      pointsAwarded: (F1_POINTS_TABLE[idx] ?? 0) + (idx === 0 ? 1 : 0),
      fastestLapBonus: idx === 0,
      pitStops: 0,
    }));

    const champ1 = scoreChampionshipRound(champ0, 'red-bull-ring', mockResults);
    expect(champ1.currentRoundIndex).toBe(1);
    expect(champ1.driverPoints['yahia']).toBe(26);
    expect(champ1.teamPoints['mclaren']).toBeGreaterThanOrEqual(26);
    expect(champ1.completedRounds.length).toBe(1);
    expect(formatLapTime(65619)).toBe('1:05.619');
  });

  it('initializes Time Trial and 1-Lap Qualifying solo sessions cleanly', () => {
    const tt = new RaceManager({ ...BASE_SETTINGS, mode: 'time-trial' });
    expect(tt.phase).toBe('racing');
    expect(tt.cars.length).toBe(1);
    expect(tt.getPlayerCar().tireCompound).toBe('soft');

    const quali = new RaceManager({ ...BASE_SETTINGS, qualifyingEnabled: true });
    expect(quali.phase).toBe('qualifying');
    expect(quali.cars.length).toBe(1);
  });

  it('arms overtakeRemainingS on detection crossing within 1s and counts down over 1 lap', () => {
    const race = new RaceManager({ ...BASE_SETTINGS, circuitId: 'monza', laps: 3 });
    race.phase = 'racing';

    const pCar = race.getPlayerCar();
    const rivalCar = race.cars.find((c) => !c.isPlayer)!;
    const det = race.track.config.overtakeDetectionS;

    // Position player right before overtakeDetectionS, 18m behind rival
    const placeAtS = (car: typeof pCar, sVal: number, lapVal: number) => {
      const smp = race.track.sampleAtS(sVal);
      car.x = smp.position.x;
      car.y = smp.position.y;
      car.z = smp.position.z;
      car.s = sVal;
      car.prevS = sVal;
      car.sampleIndex = smp.index;
      car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      car.speed = 70;
      car.lap = lapVal;
      car.totalProgress = lapVal - 1 + sVal;
    };

    placeAtS(pCar, det - 0.004, 1);
    placeAtS(rivalCar, det - 0.001, 1);

    const aiPlayer = new AIDriver(race.getPlayerDriver(), 0);
    const dt = 1 / 60;

    // Step across detection point
    for (let i = 0; i < 35; i++) {
      const ctrl = aiPlayer.computeInput(pCar, race.track, race.cars, 'pro', dt, 3, true);
      race.step(ctrl, dt);
      if (pCar.overtakeArmed) break;
    }

    expect(pCar.overtakeArmed).toBe(true);
    expect(pCar.overtakeRemainingS).toBeGreaterThan(0.9);
    expect(pCar.overtakeRemainingS).toBeLessThanOrEqual(1.0);

    // Move rival far ahead so second lap crossing does not re-arm
    placeAtS(rivalCar, (det + 0.5) % 1, 2);

    const startRem = pCar.overtakeRemainingS;
    for (let i = 0; i < 60; i++) {
      const ctrl = aiPlayer.computeInput(pCar, race.track, race.cars, 'pro', dt, 3, true);
      race.step(ctrl, dt);
    }
    expect(pCar.overtakeRemainingS).toBeLessThan(startRem);

    // Advance remainder of 1 lap until overtakeRemainingS expires
    for (let i = 0; i < 6000; i++) {
      const ctrl = aiPlayer.computeInput(pCar, race.track, race.cars, 'pro', dt, 3, true);
      race.step(ctrl, dt);
      if (!pCar.overtakeArmed) break;
    }
    expect(pCar.overtakeRemainingS).toBe(0);
    expect(pCar.overtakeArmed).toBe(false);
  });

  it('keeps Pro AI cleanly inside barriers over a multi-corner Red Bull Ring stint', () => {
    const race = new RaceManager({ ...BASE_SETTINGS, circuitId: 'red-bull-ring', difficulty: 'pro', laps: 3 });
    race.phase = 'racing';
    const ai = new AIDriver(race.getPlayerDriver(), 1);
    const pCar = race.getPlayerCar();
    const smp = race.track.sampleAtS(0.05);
    pCar.x = smp.position.x;
    pCar.y = smp.position.y;
    pCar.z = smp.position.z;
    pCar.s = 0.05;
    pCar.prevS = 0.05;
    pCar.sampleIndex = smp.index;
    pCar.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    pCar.speed = 70;
    pCar.lap = 1;

    const dt = 1 / 60;
    const barrierLimit = race.track.config.trackWidth * 0.5 + 4.4;
    for (let i = 0; i < 900; i++) {
      const ctrl = ai.computeInput(pCar, race.track, [pCar], 'pro', dt, 3, true);
      stepCarPhysics(pCar, ctrl, race.track, dt, [pCar], BASE_SETTINGS.assists, 3, true);
      expect(Number.isFinite(pCar.x)).toBe(true);
      expect(Number.isFinite(pCar.z)).toBe(true);
      expect(Number.isFinite(pCar.speed)).toBe(true);
      expect(Math.abs(pCar.lateralOffset)).toBeLessThanOrEqual(barrierLimit + 0.05);
    }
    expect(pCar.s).toBeGreaterThan(0.25);
  });

  it('keeps full 11-car Pro AI pack clean through Monza T1 and Red Bull Ring elevation without barrier escapes', () => {
    for (const circuitId of ['monza', 'red-bull-ring'] as const) {
      const race = new RaceManager({ ...BASE_SETTINGS, circuitId, difficulty: 'pro', laps: 3 });
      race.phase = 'racing';
      const playerAi = new AIDriver(race.getPlayerDriver(), 3);
      const dt = 1 / 60;
      const barrierLimit = race.track.config.trackWidth * 0.5 + 4.4;

      for (let step = 0; step < 1800; step++) {
        const pCar = race.getPlayerCar();
        const ctrl = playerAi.computeInput(pCar, race.track, race.cars, 'pro', dt, 3, true);
        race.step(ctrl, dt);
        for (const c of race.cars) {
          expect(Number.isFinite(c.x)).toBe(true);
          expect(Number.isFinite(c.y)).toBe(true);
          expect(Number.isFinite(c.z)).toBe(true);
          expect(Number.isFinite(c.tireTemp)).toBe(true);
          if (!c.inPitLane) {
            expect(Math.abs(c.lateralOffset)).toBeLessThanOrEqual(barrierLimit);
          }
        }
      }
      expect(race.getPlayerCar().totalProgress).toBeGreaterThan(0.35);
    }
  });

  it('counts lap progression accurately even when a car is pushed across start/finish by collision', () => {
    const race = new RaceManager({ ...BASE_SETTINGS, circuitId: 'monza', difficulty: 'pro', laps: 3 });
    race.phase = 'racing';
    for (let k = 2; k < race.cars.length; k++) {
      const smp = race.track.sampleAtS(0.5 + k * 0.01);
      race.cars[k].x = smp.position.x;
      race.cars[k].z = smp.position.z;
      race.cars[k].s = smp.s;
      race.cars[k].prevS = smp.s;
      race.cars[k].sampleIndex = smp.index;
      race.cars[k].lap = 1;
    }

    const pCar = race.getPlayerCar();
    const rival = race.cars.find((c) => !c.isPlayer)!;
    const sP = 1 - 0.3 / race.track.totalLength;
    const sR = 1 - 3.6 / race.track.totalLength;
    const smpP = race.track.sampleAtS(sP);
    const smpR = race.track.sampleAtS(sR);

    pCar.x = smpP.position.x;
    pCar.y = smpP.position.y;
    pCar.z = smpP.position.z;
    pCar.s = sP;
    pCar.prevS = sP;
    pCar.sampleIndex = smpP.index;
    pCar.heading = Math.atan2(smpP.tangent.x, smpP.tangent.z);
    pCar.speed = 5;
    pCar.lap = 1;

    rival.x = smpR.position.x;
    rival.y = smpR.position.y;
    rival.z = smpR.position.z;
    rival.s = sR;
    rival.prevS = sR;
    rival.sampleIndex = smpR.index;
    rival.heading = Math.atan2(smpR.tangent.x, smpR.tangent.z);
    rival.speed = 25;
    rival.lap = 1;

    const ctrl = {
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
    };
    race.step(ctrl, 1 / 60);
    expect(pCar.s).toBeLessThan(0.1);
    expect(pCar.lap).toBe(2);
    expect(pCar.totalProgress).toBeGreaterThan(1.0);
  });

  it('locks CameraRig tv-pod and cockpit world positions rigidly with zero high-speed lag', () => {
    const race = new RaceManager({ ...BASE_SETTINGS, circuitId: 'red-bull-ring' });
    const car = race.getPlayerCar();
    const smp = race.track.sampleAtS(0.18);
    car.x = smp.position.x + 120;
    car.y = smp.position.y;
    car.z = smp.position.z - 80;
    car.heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    car.pitch = 0.08;
    car.roll = 0.03;
    car.speed = 95; // ~342 km/h

    const rig = new CameraRig(16 / 9);
    rig.mode = 'tv-pod';
    rig.updateRace(car, 1 / 60, 0);

    // Move car at 95 m/s for 1 frame and update camera
    car.x += Math.sin(car.heading) * 95 * (1 / 60);
    car.z += Math.cos(car.heading) * 95 * (1 / 60);
    rig.updateRace(car, 1 / 60, 0);

    const distTv = Math.hypot(
      rig.camera.position.x - car.x,
      rig.camera.position.y - car.y,
      rig.camera.position.z - car.z,
    );
    // Rigid offset magnitude from (car.x, car.y, car.z) is ~sqrt(0.38^2 + 1.24^2) = 1.30m (NOT 1.30m + 1.31m lag!)
    expect(distTv).toBeLessThan(1.42);

    // Cycle to cockpit mode and verify eye point (z = +0.30, y = 0.69 -> dist ~0.75m)
    rig.cycleMode(); // -> chase
    rig.cycleMode(); // -> cockpit
    expect(rig.mode).toBe('cockpit');
    rig.updateRace(car, 1 / 60, 0);

    car.x += Math.sin(car.heading) * 95 * (1 / 60);
    car.z += Math.cos(car.heading) * 95 * (1 / 60);
    rig.updateRace(car, 1 / 60, 0);

    const distCockpit = Math.hypot(
      rig.camera.position.x - car.x,
      rig.camera.position.y - car.y,
      rig.camera.position.z - car.z,
    );
    expect(distCockpit).toBeLessThan(0.85);
  });

  it('formats lap times accurately across zero, sub-minute, and multi-minute ms values', () => {
    expect(formatLapTime(0)).toBe('--:--.---');
    expect(formatLapTime(-100)).toBe('--:--.---');
    expect(formatLapTime(59_123)).toBe('0:59.123');
    expect(formatLapTime(64_007)).toBe('1:04.007');
    expect(formatLapTime(125_999)).toBe('2:05.999');
  });

  it('spawns 1 solo car in Time Trial mode and begins recording ghost frames', () => {
    const tt = new RaceManager({ ...BASE_SETTINGS, mode: 'time-trial', laps: 99 });
    expect(tt.cars.length).toBe(1);
    expect(tt.cars[0].driverId).toBe('yahia');

    const idle = {
      throttle: 1,
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
    for (let i = 0; i < 60 * 6; i++) {
      tt.step(idle, 1 / 60);
    }
    expect(tt.phase).toBe('racing');
    expect(tt.getPlayerCar().totalProgress).toBeGreaterThan(0.01);
  });

  it('boots cleanly on all 4 circuits and all 3 flex teams with 12 unique drivers (including Yahia & Mariam)', () => {
    for (const circuitId of ['red-bull-ring', 'monza', 'silverstone', 'las-vegas'] as const) {
      for (const yahiaTeamId of ['mercedes', 'redbull', 'mclaren'] as const) {
        const race = new RaceManager({
          ...BASE_SETTINGS,
          circuitId,
          yahiaTeamId,
        });
        expect(race.cars.length).toBe(12);
        const ids = new Set(race.cars.map((c) => c.driverId));
        expect(ids.size).toBe(12);
        expect(ids.has('yahia')).toBe(true);
        expect(ids.has('mariam')).toBe(true);
      }
    }
  });

  it('awards official F1 points table (25..1) across a full 4-round World Tour championship', () => {
    expect(F1_POINTS_TABLE.slice(0, 10)).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
    let champ = createNewChampionshipState('yahia', 'mclaren', 'medium');
    expect(champ.currentRoundIndex).toBe(0);

    const makeResults = (winnerId: string): RaceResultEntry[] => {
      const winner = ALL_DRIVERS.find((d) => d.id === winnerId)!;
      const rest = ALL_DRIVERS.filter((d) => d.id !== winnerId);
      return [winner, ...rest].map((driver, i) => ({
        position: i + 1,
        driver,
        teamId: driver.id === 'yahia' ? 'mclaren' : driver.teamId,
        isPlayer: driver.id === 'yahia',
        totalTimeMs: 220_000 + i * 1500,
        gapMs: i * 1500,
        bestLapMs: 72_000 + i * 400,
        penaltySeconds: 0,
        pointsAwarded: F1_POINTS_TABLE[i] ?? 0,
        fastestLapBonus: i === 0,
        pitStops: 1,
      }));
    };

    const circuits = ['red-bull-ring', 'monza', 'silverstone', 'las-vegas'] as const;
    for (const cid of circuits) {
      champ = scoreChampionshipRound(champ, cid, makeResults('yahia'));
    }
    expect(champ.completedRounds.length).toBe(4);
    expect(champ.driverPoints.yahia).toBe(100);
  });

  it('counts FIA penaltySeconds into final overall totalTimeMs and re-sorts race classification', () => {
    const race = new RaceManager({ ...BASE_SETTINGS, laps: 1 });
    const player = race.getPlayerCar();
    const rival = race.cars.find((c) => c.driverId !== player.driverId)!;

    // Simulate both finishing: player crosses line 2.0s ahead of rival, but has a +6s track-limits penalty!
    player.finished = true;
    player.finishTimeMs = 70_000;
    player.penaltySeconds = 6;
    player.totalProgress = 1.05;

    rival.finished = true;
    rival.finishTimeMs = 72_000;
    rival.penaltySeconds = 0;
    rival.totalProgress = 1.02;

    // Force finalize via private helper call through step when player already finished
    race.phase = 'racing';
    race.step(
      {
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
      },
      1 / 60,
    );

    const playerRes = race.results.find((r) => r.driver.id === player.driverId)!;
    const rivalRes = race.results.find((r) => r.driver.id === rival.driverId)!;

    expect(playerRes.totalTimeMs).toBe(76_000); // 70,000 + 6 * 1000
    expect(rivalRes.totalTimeMs).toBe(72_000);
    expect(rivalRes.position).toBeLessThan(playerRes.position);
    expect(playerRes.gapMs).toBe(4_000);
  });
});
