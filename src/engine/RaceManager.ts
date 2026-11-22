import { CIRCUIT_ORDER, CIRCUITS, type CircuitId } from '../data/circuits';
import {
  ALL_DRIVERS,
  resolveDriverTeam,
  type DriverConfig,
  type TeamId,
} from '../data/teamsAndDrivers';
import { AIDriver, type AIDifficulty } from './AIDriver';
import {
  createInitialCarState,
  resolveCarCollisions,
  stepCarPhysics,
  type AssistConfig,
  type CarState,
  type TireCompound,
} from './CarPhysics';
import type { ControlInput } from './InputManager';
import { TrackSpline } from './TrackSpline';

export type GameMode = 'grand-prix' | 'championship' | 'time-trial';
export type SessionPhase =
  | 'qualifying'
  | 'countdown'
  | 'racing'
  | 'finished';

export type SectorStatus = 'none' | 'purple' | 'green' | 'yellow';

export interface GhostSample {
  t: number; // ms into lap
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch?: number;
  roll?: number;
  steerAngle: number;
  activeAeroOpen: number;
}

export interface RaceSettings {
  mode: GameMode;
  circuitId: CircuitId;
  playerDriverId: string;
  yahiaTeamId: TeamId;
  laps: number;
  difficulty: AIDifficulty;
  startingTire: TireCompound;
  qualifyingEnabled: boolean;
  assists: AssistConfig;
}

export interface RaceResultEntry {
  position: number;
  onTrackPosition?: number;
  driver: DriverConfig;
  teamId: TeamId;
  isPlayer: boolean;
  totalTimeMs: number;
  gapMs: number;
  bestLapMs: number;
  penaltySeconds: number;
  pointsAwarded: number;
  fastestLapBonus: boolean;
  pitStops: number;
}

export interface ChampionshipState {
  active: boolean;
  currentRoundIndex: number; // 0..3
  playerDriverId: string;
  yahiaTeamId: TeamId;
  difficulty: AIDifficulty;
  driverPoints: Record<string, number>;
  driverWins: Record<string, number>;
  teamPoints: Record<TeamId, number>;
  completedRounds: {
    circuitId: CircuitId;
    winnerId: string;
    playerPosition: number;
  }[];
}

export interface RadioMessage {
  text: string;
  tone: 'info' | 'alert' | 'celebrate';
  timestampMs: number;
}

export interface RaceAudioEvents {
  lightStepTick: boolean;
  lightsOutGo: boolean;
  gearChanged: boolean;
  kerbHit: boolean;
  radioChirp: boolean;
  raceFinished: boolean;
}

export interface HUDDriverRow {
  position: number;
  driver: DriverConfig;
  teamId: TeamId;
  isPlayer: boolean;
  gapText: string;
  tireCompound: TireCompound;
  inPit: boolean;
  hasFastestLap: boolean;
  penaltySeconds: number;
}

export const F1_POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const STORAGE_BEST_LAPS_KEY = 'f1_2026_best_laps_v1';
const STORAGE_GHOST_PREFIX = 'f1_2026_ghost_v1_';
const STORAGE_CHAMPIONSHIP_KEY = 'f1_2026_championship_v1';

export function formatLapTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--.---';
  const totalSec = ms / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const millis = Math.floor(ms % 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export function loadPersonalBestLaps(): Partial<Record<CircuitId, number>> {
  try {
    const raw = localStorage.getItem(STORAGE_BEST_LAPS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<CircuitId, number>>) : {};
  } catch {
    return {};
  }
}

export function savePersonalBestLap(circuitId: CircuitId, ms: number): void {
  try {
    const map = loadPersonalBestLaps();
    const prev = map[circuitId];
    if (!prev || ms < prev) {
      map[circuitId] = Math.round(ms);
      localStorage.setItem(STORAGE_BEST_LAPS_KEY, JSON.stringify(map));
    }
  } catch {
    // Ignore storage unavailability
  }
}

export function loadGhostLap(circuitId: CircuitId): GhostSample[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_GHOST_PREFIX + circuitId);
    return raw ? (JSON.parse(raw) as GhostSample[]) : null;
  } catch {
    return null;
  }
}

export function saveGhostLap(circuitId: CircuitId, samples: GhostSample[]): void {
  try {
    if (samples.length > 20) {
      localStorage.setItem(STORAGE_GHOST_PREFIX + circuitId, JSON.stringify(samples));
    }
  } catch {
    // Ignore storage limits
  }
}

export function loadChampionshipState(): ChampionshipState | null {
  try {
    const raw = localStorage.getItem(STORAGE_CHAMPIONSHIP_KEY);
    return raw ? (JSON.parse(raw) as ChampionshipState) : null;
  } catch {
    return null;
  }
}

export function saveChampionshipState(state: ChampionshipState | null): void {
  try {
    if (!state) {
      localStorage.removeItem(STORAGE_CHAMPIONSHIP_KEY);
    } else {
      localStorage.setItem(STORAGE_CHAMPIONSHIP_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore
  }
}

export function createNewChampionshipState(
  playerDriverId: string,
  yahiaTeamId: TeamId,
  difficulty: AIDifficulty,
): ChampionshipState {
  const driverPoints: Record<string, number> = {};
  const driverWins: Record<string, number> = {};
  for (const d of ALL_DRIVERS) {
    driverPoints[d.id] = 0;
    driverWins[d.id] = 0;
  }
  return {
    active: true,
    currentRoundIndex: 0,
    playerDriverId,
    yahiaTeamId,
    difficulty,
    driverPoints,
    driverWins,
    teamPoints: {
      mercedes: 0,
      redbull: 0,
      mclaren: 0,
      ferrari: 0,
      racingbulls: 0,
      alpine: 0,
    },
    completedRounds: [],
  };
}

export function scoreChampionshipRound(
  champ: ChampionshipState,
  circuitId: CircuitId,
  results: RaceResultEntry[],
): ChampionshipState {
  const next: ChampionshipState = {
    ...champ,
    driverPoints: { ...champ.driverPoints },
    driverWins: { ...champ.driverWins },
    teamPoints: { ...champ.teamPoints },
    completedRounds: [...champ.completedRounds],
  };

  for (const r of results) {
    next.driverPoints[r.driver.id] = (next.driverPoints[r.driver.id] ?? 0) + r.pointsAwarded;
    next.teamPoints[r.teamId] = (next.teamPoints[r.teamId] ?? 0) + r.pointsAwarded;
    if (r.position === 1) {
      next.driverWins[r.driver.id] = (next.driverWins[r.driver.id] ?? 0) + 1;
    }
  }

  const playerEntry = results.find((r) => r.isPlayer);
  next.completedRounds.push({
    circuitId,
    winnerId: results[0]?.driver.id ?? 'yahia',
    playerPosition: playerEntry?.position ?? 1,
  });

  next.currentRoundIndex = Math.min(
    CIRCUIT_ORDER.length,
    champ.currentRoundIndex + 1,
  );
  if (next.currentRoundIndex >= CIRCUIT_ORDER.length) {
    next.active = false;
  }
  return next;
}

export class RaceManager {
  readonly settings: RaceSettings;
  readonly track: TrackSpline;
  readonly cars: CarState[] = [];
  readonly driversById = new Map<string, DriverConfig>();
  readonly aiDrivers = new Map<string, AIDriver>();

  phase: SessionPhase;
  lightsLit = 0;
  lightsOutHoldRemaining = 0;
  countdownTimer = 0;
  raceClockMs = 0;

  overallBestLapMs = 0;
  overallFastestDriverId = '';
  overallBestSectors: [number, number, number] = [0, 0, 0];
  playerBestSectors: [number, number, number] = [0, 0, 0];
  playerSectorStatuses: [SectorStatus, SectorStatus, SectorStatus] = ['none', 'none', 'none'];
  playerPersonalBestLapMs = 0;

  radio: RadioMessage | null = null;
  qualifyingLapMs = 0;
  qualifyingGridOrder: string[] | null = null;
  results: RaceResultEntry[] = [];

  // Time Trial ghost
  private savedGhost: GhostSample[] | null = null;
  private recordingGhost: GhostSample[] = [];
  private ghostRecordAccum = 0;
  currentGhostPose: GhostSample | null = null;

  private prevPlayerGear = 1;
  private prevPlayerKerb = false;
  private lowTireRadioSent = false;
  private finalLapRadioSent = false;

  constructor(settings: RaceSettings) {
    this.settings = settings;
    this.track = new TrackSpline(CIRCUITS[settings.circuitId]);

    for (const d of ALL_DRIVERS) {
      this.driversById.set(d.id, d);
    }

    const personalBests = loadPersonalBestLaps();
    this.playerPersonalBestLapMs = personalBests[settings.circuitId] ?? 0;

    if (settings.mode === 'time-trial') {
      this.savedGhost = loadGhostLap(settings.circuitId);
      this.phase = 'racing';
      this.setupTimeTrial();
    } else if (settings.qualifyingEnabled) {
      this.phase = 'qualifying';
      this.setupQualifying();
    } else {
      this.phase = 'countdown';
      this.setupRaceGrid(this.buildDefaultGridOrder());
    }
  }

  private buildDefaultGridOrder(): string[] {
    // Grid ordered roughly by 2026 championship pace, placing player around P4 for thrilling overtakes!
    const aiOrder = ALL_DRIVERS.filter((d) => d.id !== this.settings.playerDriverId)
      .sort((a, b) => b.pace - a.pace)
      .map((d) => d.id);
    const insertIdx = Math.min(3, aiOrder.length);
    aiOrder.splice(insertIdx, 0, this.settings.playerDriverId);
    return aiOrder;
  }

  private setupTimeTrial(): void {
    const playerDriver = this.driversById.get(this.settings.playerDriverId)!;
    const team = resolveDriverTeam(playerDriver, this.settings.yahiaTeamId);
    const car = createInitialCarState(
      playerDriver.id,
      true,
      team.carPerf,
      this.track,
      0,
      'soft',
      true,
    );
    car.lap = 1;
    car.currentLapStartMs = 0;
    car.sectorStartMs = 0;
    this.cars.push(car);
    this.emitRadio(`Time Trial live at ${this.track.config.name}. Push for Purple sectors!`, 'info');
  }

  private setupQualifying(): void {
    const playerDriver = this.driversById.get(this.settings.playerDriverId)!;
    const team = resolveDriverTeam(playerDriver, this.settings.yahiaTeamId);
    const car = createInitialCarState(
      playerDriver.id,
      true,
      team.carPerf,
      this.track,
      0,
      'soft',
      true,
    );
    car.lap = 1;
    car.currentLapStartMs = 0;
    car.sectorStartMs = 0;
    this.cars.push(car);
    this.emitRadio('1-Lap Qualifying Shootout! Set your fastest lap to earn Pole Position!', 'info');
  }

  private setupRaceGrid(gridOrder: string[]): void {
    this.cars.length = 0;
    this.aiDrivers.clear();
    this.lightsLit = 0;
    this.countdownTimer = 0;
    this.lightsOutHoldRemaining = 0.65 + Math.random() * 0.95;
    this.raceClockMs = 0;

    gridOrder.forEach((driverId, slot) => {
      const driver = this.driversById.get(driverId)!;
      const isPlayer = driverId === this.settings.playerDriverId;
      const team = resolveDriverTeam(driver, this.settings.yahiaTeamId);
      const tire: TireCompound = isPlayer
        ? this.settings.startingTire
        : slot % 3 === 0
          ? 'soft'
          : 'medium';

      const car = createInitialCarState(
        driverId,
        isPlayer,
        team.carPerf,
        this.track,
        slot,
        tire,
        false,
      );
      this.cars.push(car);
      if (!isPlayer) {
        this.aiDrivers.set(driverId, new AIDriver(driver, slot));
      }
    });

    const pCar = this.getPlayerCar();
    this.prevPlayerGear = pCar.gear;
    this.emitRadio(
      `Lights sequence starting at ${this.track.config.name}. Watch the 5 red lights!`,
      'info',
    );
  }

  getPlayerCar(): CarState {
    return this.cars.find((c) => c.isPlayer) ?? this.cars[0];
  }

  getPlayerDriver(): DriverConfig {
    return this.driversById.get(this.settings.playerDriverId)!;
  }

  emitRadio(text: string, tone: RadioMessage['tone'] = 'info'): void {
    this.radio = { text, tone, timestampMs: this.raceClockMs };
  }

  step(playerInput: ControlInput, dt: number): RaceAudioEvents {
    const events: RaceAudioEvents = {
      lightStepTick: false,
      lightsOutGo: false,
      gearChanged: false,
      kerbHit: false,
      radioChirp: false,
      raceFinished: false,
    };

    const prevRadioTs = this.radio?.timestampMs ?? -1;

    // Countdown 5-red-lights sequence
    if (this.phase === 'countdown') {
      this.countdownTimer += dt;
      const targetLights = Math.min(5, Math.floor(this.countdownTimer / 0.85));
      if (targetLights > this.lightsLit) {
        this.lightsLit = targetLights;
        events.lightStepTick = true;
      }
      if (this.lightsLit === 5) {
        this.lightsOutHoldRemaining -= dt;
        if (this.lightsOutHoldRemaining <= 0) {
          this.lightsLit = 0;
          this.phase = 'racing';
          events.lightsOutGo = true;
          this.emitRadio('LIGHTS OUT AND AWAY WE GO!', 'celebrate');
        }
      }
    }

    const canMove = this.phase === 'racing' || this.phase === 'qualifying';
    if (canMove) {
      this.raceClockMs += dt * 1000;
    }

    const totalLaps =
      this.settings.mode === 'time-trial'
        ? 999
        : this.phase === 'qualifying'
          ? 1
          : this.settings.laps;

    for (const car of this.cars) {
      let ctrl: ControlInput;
      if (car.isPlayer && !car.finished) {
        ctrl = playerInput;
      } else {
        const ai =
          this.aiDrivers.get(car.driverId) ??
          new AIDriver(this.driversById.get(car.driverId)!, 0);
        if (!this.aiDrivers.has(car.driverId)) {
          this.aiDrivers.set(car.driverId, ai);
        }
        ctrl = ai.computeInput(
          car,
          this.track,
          this.cars,
          this.settings.difficulty,
          dt,
          totalLaps,
          canMove,
        );
      }

      const prevWarnings = car.trackLimitWarnings;
      stepCarPhysics(
        car,
        ctrl,
        this.track,
        dt,
        this.cars,
        this.settings.assists,
        totalLaps,
        canMove,
      );

      if (car.isPlayer && car.trackLimitWarnings > prevWarnings) {
        if (car.trackLimitWarnings > 3) {
          this.emitRadio(
            totalLaps < 900
              ? 'Track limits exceeded (all 4 wheels off) — +3s penalty applied!'
              : 'Track limits exceeded (all 4 wheels off) — stay on track!',
            'alert',
          );
        } else if (car.trackLimitWarnings === 3) {
          this.emitRadio(
            'Black & White Flag (3/3)! Next full 4-wheel cut = +3s penalty.',
            'alert',
          );
        } else {
          this.emitRadio(
            `Track limits (all 4 wheels off) — Warning ${car.trackLimitWarnings}/3.`,
            'alert',
          );
        }
      }
    }

    if (canMove) {
      if (this.cars.length > 1) {
        resolveCarCollisions(this.cars, this.track);
      }
      for (const car of this.cars) {
        this.updateLapAndSectors(car, car.s, totalLaps);
      }
    }

    // Time trial ghost recording & playback
    if (this.settings.mode === 'time-trial') {
      const pCar = this.getPlayerCar();
      const lapElapsed = this.raceClockMs - pCar.currentLapStartMs;
      this.ghostRecordAccum += dt;
      if (this.ghostRecordAccum >= 0.05) {
        this.ghostRecordAccum = 0;
        this.recordingGhost.push({
          t: lapElapsed,
          x: pCar.x,
          y: pCar.y,
          z: pCar.z,
          heading: pCar.heading,
          pitch: pCar.pitch,
          roll: pCar.roll,
          steerAngle: pCar.steerAngle,
          activeAeroOpen: pCar.activeAeroOpen,
        });
      }
      this.currentGhostPose = this.sampleSavedGhost(lapElapsed);
    }

    // Player audio & radio feedback cues
    const playerCar = this.getPlayerCar();
    if (playerCar.gear !== this.prevPlayerGear) {
      events.gearChanged = true;
      this.prevPlayerGear = playerCar.gear;
    }
    if (playerCar.onKerb && !this.prevPlayerKerb && playerCar.speed > 20) {
      events.kerbHit = true;
    }
    this.prevPlayerKerb = playerCar.onKerb;

    if (
      this.phase === 'racing' &&
      this.settings.mode !== 'time-trial' &&
      !this.lowTireRadioSent &&
      playerCar.tireWear > 0.72 &&
      playerCar.lap < this.settings.laps
    ) {
      this.lowTireRadioSent = true;
      this.emitRadio('Rear tires dropping off — press P to Box this lap!', 'alert');
    }

    if (
      this.phase === 'racing' &&
      this.settings.mode !== 'time-trial' &&
      !this.finalLapRadioSent &&
      playerCar.lap === this.settings.laps &&
      this.settings.laps > 1
    ) {
      this.finalLapRadioSent = true;
      this.emitRadio('Final lap! Push everything with Boost on the straights!', 'celebrate');
    }

    // Complete session transitions
    if (this.phase === 'qualifying' && playerCar.finished) {
      this.finishQualifyingAndStartRace();
    } else if (
      this.phase === 'racing' &&
      this.settings.mode !== 'time-trial' &&
      playerCar.finished
    ) {
      this.finalizeRaceResults();
      const pRes = this.results.find((r) => r.isPlayer);
      if (pRes && pRes.penaltySeconds > 0) {
        if (pRes.onTrackPosition && pRes.position > pRes.onTrackPosition) {
          this.emitRadio(
            `+${pRes.penaltySeconds}s time penalty applied — classified P${pRes.position} (down from P${pRes.onTrackPosition}).`,
            'alert',
          );
        } else {
          this.emitRadio(
            `+${pRes.penaltySeconds}s time penalty applied — classified P${pRes.position}.`,
            'info',
          );
        }
      }
      this.phase = 'finished';
      events.raceFinished = true;
    }

    if ((this.radio?.timestampMs ?? -1) > prevRadioTs) {
      events.radioChirp = true;
    }

    return events;
  }

  private updateLapAndSectors(car: CarState, newS: number, totalLaps: number): void {
    const prevS = car.prevS;
    const forwardDs = ((newS - prevS) % 1 + 1) % 1;

    // 2026 Overtake Mode 1-lap countdown
    if (car.overtakeRemainingS > 0 && forwardDs < 0.25) {
      car.overtakeRemainingS = Math.max(0, car.overtakeRemainingS - forwardDs);
      if (car.overtakeRemainingS <= 0) {
        car.overtakeArmed = false;
      }
    }

    // 2026 Overtake Mode detection check
    const det = this.track.config.overtakeDetectionS;
    const crossedDet =
      prevS <= newS ? prevS < det && newS >= det : forwardDs < 0.25 && (prevS < det || newS >= det);
    if (crossedDet && this.cars.length > 1) {
      const gapAheadSec = this.computeTimeGapAhead(car);
      if (gapAheadSec > 0 && gapAheadSec <= 1.0) {
        if (!car.overtakeArmed && car.isPlayer) {
          this.emitRadio('Overtake Mode ARMED! +0.5 MJ reserve & full high-speed pull unlocked!', 'celebrate');
        }
        car.overtakeArmed = true;
        car.overtakeRemainingS = 1.0;
      } else {
        car.overtakeArmed = false;
        car.overtakeRemainingS = 0;
      }
    }

    // Sector completion checks (S1 -> S2, S2 -> S3)
    const s1End = this.track.config.sector1End;
    const s2End = this.track.config.sector2End;

    if (car.lap >= 1) {
      if (car.currentSector === 1 && prevS < s1End && newS >= s1End) {
        const sTime = this.raceClockMs - car.sectorStartMs;
        this.recordSectorTime(car, 0, sTime);
        car.currentSector = 2;
        car.sectorStartMs = this.raceClockMs;
      } else if (car.currentSector === 2 && prevS < s2End && newS >= s2End) {
        const sTime = this.raceClockMs - car.sectorStartMs;
        this.recordSectorTime(car, 1, sTime);
        car.currentSector = 3;
        car.sectorStartMs = this.raceClockMs;
      }
    }

    // Start/Finish line wrap check (avoid false trigger while reversing or on grid before crossing)
    if (prevS > 0.82 && newS < 0.18) {
      if (car.lap === 0) {
        car.lap = 1;
        car.currentLapStartMs = this.raceClockMs;
        car.sectorStartMs = this.raceClockMs;
        car.currentSector = 1;
      } else {
        // Completed a lap!
        const s3Time = this.raceClockMs - car.sectorStartMs;
        this.recordSectorTime(car, 2, s3Time);

        const completedLapNum = car.lap;
        const lapTime = this.raceClockMs - car.currentLapStartMs;
        car.lastLapMs = lapTime;
        if (lapTime > 12000) {
          car.completedLapTimesMs.push(Math.round(lapTime));
        }

        let announcedPersonalBest = false;
        if (lapTime > 12000 && (car.bestLapMs === 0 || lapTime < car.bestLapMs)) {
          car.bestLapMs = lapTime;
          if (car.isPlayer) {
            if (
              this.playerPersonalBestLapMs === 0 ||
              lapTime < this.playerPersonalBestLapMs
            ) {
              this.playerPersonalBestLapMs = lapTime;
              savePersonalBestLap(this.settings.circuitId, lapTime);
              if (this.settings.mode === 'time-trial') {
                saveGhostLap(this.settings.circuitId, this.recordingGhost);
                this.savedGhost = [...this.recordingGhost];
                this.emitRadio(`NEW PERSONAL BEST: ${formatLapTime(lapTime)}! Ghost saved!`, 'celebrate');
                announcedPersonalBest = true;
              }
            }
          }
        }

        if (car.isPlayer && lapTime > 12000 && !announcedPersonalBest) {
          this.emitRadio(
            `Lap ${completedLapNum}: ${formatLapTime(lapTime)} • Best: ${formatLapTime(car.bestLapMs)}`,
            'info',
          );
        }

        if (
          lapTime > 12000 &&
          (this.overallBestLapMs === 0 || lapTime < this.overallBestLapMs)
        ) {
          this.overallBestLapMs = lapTime;
          this.overallFastestDriverId = car.driverId;
        }

        if (this.settings.mode === 'time-trial') {
          this.recordingGhost = [];
          this.ghostRecordAccum = 0;
        }

        if (car.lap >= totalLaps && this.settings.mode !== 'time-trial') {
          car.finished = true;
          car.finishTimeMs = this.raceClockMs;
        } else {
          car.lap += 1;
          car.currentLapStartMs = this.raceClockMs;
          car.sectorStartMs = this.raceClockMs;
          car.currentSector = 1;
        }
      }
    }

    car.totalProgress = (car.lap === 0 ? newS - 1 : car.lap - 1 + newS);
  }

  private recordSectorTime(car: CarState, idx: 0 | 1 | 2, ms: number): void {
    if (ms <= 1000) return;
    car.sectorTimesMs[idx] = ms;

    const prevOverall = this.overallBestSectors[idx];
    const isOverallBest = prevOverall === 0 || ms < prevOverall;
    if (isOverallBest) {
      this.overallBestSectors[idx] = ms;
    }

    if (car.isPlayer) {
      const prevPersonal = this.playerBestSectors[idx];
      const isPersonalBest = prevPersonal === 0 || ms < prevPersonal;
      if (isPersonalBest) {
        this.playerBestSectors[idx] = ms;
      }

      this.playerSectorStatuses[idx] = isOverallBest
        ? 'purple'
        : isPersonalBest
          ? 'green'
          : 'yellow';

      if (isOverallBest && car.lap >= 1 && this.settings.mode !== 'time-trial') {
        this.emitRadio(`Purple Sector ${idx + 1}! Fastest on track!`, 'celebrate');
      }
    }
  }

  private computeTimeGapAhead(car: CarState): number {
    let minDist = Infinity;
    for (const other of this.cars) {
      if (other.driverId === car.driverId || other.inPitLane) continue;
      const dProg = other.totalProgress - car.totalProgress;
      if (dProg > 0 && dProg < 0.25) {
        const distMeters = dProg * this.track.totalLength;
        if (distMeters < minDist) minDist = distMeters;
      }
    }
    if (!Number.isFinite(minDist)) return -1;
    return minDist / Math.max(25, car.speed);
  }

  private finishQualifyingAndStartRace(): void {
    const pCar = this.getPlayerCar();
    this.qualifyingLapMs = (pCar.lastLapMs || this.raceClockMs) + pCar.penaltySeconds * 1000;

    // Generate authentic AI 1-lap qualifying times around track record + pace
    const baseRecordMs = this.track.config.lapRecord.timeMs;
    const diffPaceAdjust =
      this.settings.difficulty === 'easy'
        ? 1.07
        : this.settings.difficulty === 'medium'
          ? 1.01
          : 0.985;

    const qualiEntries: { id: string; timeMs: number }[] = [
      { id: this.settings.playerDriverId, timeMs: this.qualifyingLapMs },
    ];

    for (const d of ALL_DRIVERS) {
      if (d.id === this.settings.playerDriverId) continue;
      const team = resolveDriverTeam(d, this.settings.yahiaTeamId);
      const perfDelta = (1.015 - team.carPerf) * 28000 + (98 - d.pace) * 140;
      const jitter = (Math.random() - 0.5) * 450;
      qualiEntries.push({
        id: d.id,
        timeMs: baseRecordMs * diffPaceAdjust + perfDelta + jitter,
      });
    }

    qualiEntries.sort((a, b) => a.timeMs - b.timeMs);
    this.qualifyingGridOrder = qualiEntries.map((e) => e.id);
    this.overallBestLapMs = 0;
    this.overallFastestDriverId = '';
    this.phase = 'countdown';
    this.setupRaceGrid(this.qualifyingGridOrder);

    const pGridPos = this.qualifyingGridOrder.indexOf(this.settings.playerDriverId) + 1;
    this.emitRadio(
      `Qualifying complete: P${pGridPos} (${formatLapTime(this.qualifyingLapMs)})! Ready for lights out!`,
      pGridPos <= 3 ? 'celebrate' : 'info',
    );
  }

  private finalizeRaceResults(): void {
    const sorted = this.getSortedCars();
    const leaderCar = sorted[0];
    const leaderTime = leaderCar.finishTimeMs || this.raceClockMs;
    const avgLapSpeed =
      (this.track.totalLength / Math.max(1, this.track.config.lapRecord.timeMs / 1000)) * 0.94;

    // 1. Compute raw on-track finish times (estimated for cars still on final meters using circuit pace)
    const rawTimes = sorted.map((c, idx) => {
      if (c.finished && c.finishTimeMs > 0) return c.finishTimeMs;
      const remProgress = Math.max(0.002, this.settings.laps - c.totalProgress);
      const remMeters = remProgress * this.track.totalLength;
      const estSpeed =
        remMeters < 120 ? Math.max(48, (c.speed + avgLapSpeed) * 0.5) : avgLapSpeed;
      const estRemMs = (remMeters / estSpeed) * 1000;
      return Math.max(leaderTime + idx * 140, this.raceClockMs + estRemMs);
    });

    // Ensure raw on-track finish times preserve crossing order cleanly
    for (let i = 1; i < rawTimes.length; i++) {
      if (rawTimes[i] <= rawTimes[i - 1]) {
        rawTimes[i] = rawTimes[i - 1] + 85;
      }
    }

    // 2. Add FIA time penalties (penaltySeconds * 1000) to overall time and re-classify!
    const classified = sorted
      .map((car, idx) => ({
        car,
        onTrackPosition: idx + 1,
        totalTimeMs: rawTimes[idx] + car.penaltySeconds * 1000,
      }))
      .sort((a, b) => a.totalTimeMs - b.totalTimeMs);

    const baseLapsMs = this.track.config.lapRecord.timeMs * 1.01;
    const winnerTotalMs = classified[0]?.totalTimeMs ?? leaderTime;

    this.results = classified.map(({ car, onTrackPosition, totalTimeMs }, idx) => {
      const driver = this.driversById.get(car.driverId)!;
      const team = resolveDriverTeam(driver, this.settings.yahiaTeamId);
      const pos = idx + 1;
      const basePts = pos <= F1_POINTS_TABLE.length ? F1_POINTS_TABLE[pos - 1] : 0;
      const hasFastest =
        car.driverId === this.overallFastestDriverId && pos <= 10;
      const flPts = hasFastest ? 1 : 0;
      const bestLap =
        car.bestLapMs > 0
          ? car.bestLapMs
          : baseLapsMs + (100 - driver.pace) * 140;

      return {
        position: pos,
        onTrackPosition,
        driver,
        teamId: team.id,
        isPlayer: car.isPlayer,
        totalTimeMs,
        gapMs: idx === 0 ? 0 : Math.max(0, totalTimeMs - winnerTotalMs),
        bestLapMs: bestLap,
        penaltySeconds: car.penaltySeconds,
        pointsAwarded: basePts + flPts,
        fastestLapBonus: hasFastest,
        pitStops: car.pitStopsCount,
      };
    });
  }

  private sampleSavedGhost(lapElapsedMs: number): GhostSample | null {
    if (!this.savedGhost || this.savedGhost.length < 2) return null;
    const ghost = this.savedGhost;
    if (lapElapsedMs <= ghost[0].t) return ghost[0];
    if (lapElapsedMs >= ghost[ghost.length - 1].t) {
      return ghost[ghost.length - 1];
    }

    // Binary search nearest pair
    let lo = 0;
    let hi = ghost.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ghost[mid].t <= lapElapsedMs) lo = mid;
      else hi = mid;
    }
    const a = ghost[lo];
    const b = ghost[hi];
    const alpha = Math.max(0, Math.min(1, (lapElapsedMs - a.t) / Math.max(1, b.t - a.t)));
    let hDiff = b.heading - a.heading;
    while (hDiff > Math.PI) hDiff -= Math.PI * 2;
    while (hDiff < -Math.PI) hDiff += Math.PI * 2;

    return {
      t: lapElapsedMs,
      x: a.x + (b.x - a.x) * alpha,
      y: a.y + (b.y - a.y) * alpha,
      z: a.z + (b.z - a.z) * alpha,
      heading: a.heading + hDiff * alpha,
      pitch: (a.pitch ?? 0) + ((b.pitch ?? 0) - (a.pitch ?? 0)) * alpha,
      roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * alpha,
      steerAngle: a.steerAngle + (b.steerAngle - a.steerAngle) * alpha,
      activeAeroOpen: a.activeAeroOpen + (b.activeAeroOpen - a.activeAeroOpen) * alpha,
    };
  }

  getSortedCars(): CarState[] {
    return [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
  }

  buildTimeTrialResults(): RaceResultEntry[] {
    const car = this.getPlayerCar();
    const driver = this.driversById.get(car.driverId)!;
    const team = resolveDriverTeam(driver, this.settings.yahiaTeamId);
    const totalMs =
      car.completedLapTimesMs.length > 0
        ? car.completedLapTimesMs.reduce((sum, ms) => sum + ms, 0)
        : this.raceClockMs;
    const bestMs = car.bestLapMs > 0 ? car.bestLapMs : car.lastLapMs;
    return [
      {
        position: 1,
        driver,
        teamId: team.id,
        isPlayer: true,
        totalTimeMs: totalMs,
        gapMs: 0,
        bestLapMs: bestMs,
        penaltySeconds: 0,
        pointsAwarded: 0,
        fastestLapBonus: bestMs > 0,
        pitStops: 0,
      },
    ];
  }

  getHUDRows(): HUDDriverRow[] {
    if (this.phase === 'finished' && this.results.length > 0) {
      const carsById = new Map(this.cars.map((c) => [c.driverId, c]));
      return this.results.map((r, idx) => {
        const car = carsById.get(r.driver.id);
        return {
          position: r.position,
          driver: r.driver,
          teamId: r.teamId,
          isPlayer: r.isPlayer,
          gapText: idx === 0 ? 'LEADER' : `+${(r.gapMs / 1000).toFixed(1)}s`,
          tireCompound: car?.tireCompound ?? this.settings.startingTire,
          inPit: Boolean(car && (car.inPitLane || car.pitServicing)),
          hasFastestLap: r.fastestLapBonus,
          penaltySeconds: r.penaltySeconds,
        };
      });
    }

    const sorted = this.getSortedCars();
    const leader = sorted[0];

    return sorted.map((car, idx) => {
      const driver = this.driversById.get(car.driverId)!;
      const team = resolveDriverTeam(driver, this.settings.yahiaTeamId);
      let gapText = 'LEADER';
      if (idx > 0 && leader) {
        if (car.finished && leader.finished) {
          const gapSec = Math.max(0.1, (car.finishTimeMs - leader.finishTimeMs) / 1000);
          gapText = `+${gapSec.toFixed(1)}s`;
        } else {
          const dProg = Math.max(0, leader.totalProgress - car.totalProgress);
          const gapSec = (dProg * this.track.totalLength) / 68.0;
          gapText = dProg >= 1 ? `+${Math.floor(dProg)}L` : `+${gapSec.toFixed(1)}s`;
        }
      }
      return {
        position: idx + 1,
        driver,
        teamId: team.id,
        isPlayer: car.isPlayer,
        gapText,
        tireCompound: car.tireCompound,
        inPit: car.inPitLane || car.pitServicing,
        hasFastestLap: car.driverId === this.overallFastestDriverId && this.overallBestLapMs > 0,
        penaltySeconds: car.penaltySeconds,
      };
    });
  }
}
