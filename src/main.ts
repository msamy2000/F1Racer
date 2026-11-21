import * as THREE from 'three';
import { F1AudioEngine } from './audio/F1AudioEngine';
import { ALL_DRIVERS, TEAMS, YAHIA_DRIVER, type TeamId } from './data/teamsAndDrivers';
import { InputManager } from './engine/InputManager';
import {
  RaceManager,
  saveChampionshipState,
  scoreChampionshipRound,
  type ChampionshipState,
  type RaceSettings,
} from './engine/RaceManager';
import {
  buildF1CarMesh,
  buildGhostCarMesh,
  preloadF1CarModel,
  type CarMeshRig,
} from './rendering/CarMeshBuilder';
import { EffectsManager } from './rendering/EffectsManager';
import { SceneManager } from './rendering/SceneManager';
import { preloadTrackTextures } from './rendering/TextureLibrary';
import { buildTrackWorld, type BuiltTrackWorld } from './rendering/TrackMeshBuilder';
import { DeviceProfileManager } from './ui/DeviceProfile';
import { MenuUI } from './ui/MenuUI';
import { RaceHUD } from './ui/RaceHUD';
import './ui/styles.css';

const appEl = document.getElementById('app')!;
const canvasHost = document.createElement('div');
canvasHost.id = 'canvas-host';
const uiRoot = document.createElement('div');
uiRoot.id = 'ui-root';
const menuLayer = document.createElement('div');
const hudLayer = document.createElement('div');
uiRoot.append(menuLayer, hudLayer);
appEl.append(canvasHost, uiRoot);

const sceneManager = new SceneManager(canvasHost);
const input = new InputManager();
input.attach();
const audio = new F1AudioEngine();
void audio.preloadRawSamples();

let activeRace: RaceManager | null = null;
let activeChamp: ChampionshipState | null = null;
let activeTrackWorld: BuiltTrackWorld | null = null;
let activeEffects: EffectsManager | null = null;
const activeCarRigs = new Map<string, CarMeshRig>();
let ghostCarMesh: THREE.Group | null = null;
let paused = false;
let finishCelebrationTimer = -1;
let lastRaceSettings: RaceSettings | null = null;

const unlockAudioOnce = () => {
  audio.unlock();
};
window.addEventListener('pointerdown', unlockAudioOnce, { once: true });
window.addEventListener('keydown', unlockAudioOnce, { once: true });

function cleanupActiveSession(): void {
  audio.setEngineActive(false);
  if (activeEffects) {
    activeEffects.dispose();
    activeEffects = null;
  }
  if (activeTrackWorld) {
    activeTrackWorld.dispose();
    activeTrackWorld = null;
  }
  for (const rig of activeCarRigs.values()) {
    rig.dispose();
  }
  activeCarRigs.clear();
  if (ghostCarMesh) {
    ghostCarMesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (!o.userData.sharedGlbGeometry) o.geometry.dispose();
        if (!Array.isArray(o.material)) o.material.dispose();
      }
    });
    ghostCarMesh = null;
  }
  sceneManager.clearWorld();
  activeRace = null;
  paused = false;
  finishCelebrationTimer = -1;
}

const assetsReadyPromise = Promise.all([preloadF1CarModel(), preloadTrackTextures()]);

async function startSession(settings: RaceSettings, champ: ChampionshipState | null): Promise<void> {
  audio.unlock();
  audio.setMenuMusicActive(false);
  await assetsReadyPromise;
  cleanupActiveSession();
  accumulator = 0;
  lastRaceSettings = { ...settings, assists: { ...settings.assists } };
  activeChamp = champ;

  const race = new RaceManager(settings);
  activeRace = race;

  const world = buildTrackWorld(race.track);
  activeTrackWorld = world;
  sceneManager.applyAtmosphere(race.track.config.atmosphere);
  sceneManager.setRaceWorldGroup(world.group);

  activeEffects = new EffectsManager();
  world.group.add(activeEffects.group);

  for (const car of race.cars) {
    const driver = race.driversById.get(car.driverId)!;
    const rig = buildF1CarMesh(driver, settings.yahiaTeamId, car.tireCompound);
    world.group.add(rig.root);
    activeCarRigs.set(car.driverId, rig);
    rig.updateFromState(car, 0);
  }

  const playerRig = activeCarRigs.get(race.getPlayerCar().driverId);
  playerRig?.setCockpitView(
    race.phase !== 'countdown' && sceneManager.cameraRig.mode === 'cockpit',
  );

  if (settings.mode === 'time-trial') {
    ghostCarMesh = buildGhostCarMesh();
    ghostCarMesh.visible = false;
    world.group.add(ghostCarMesh);
  }

  input.resetContinuous();
  audio.setEngineActive(true);
  menuUI.hide();
  hud.show(race, sceneManager.cameraRig.mode, audio.muted);
}

function returnToMenu(driverId: string, yahiaTeamId: TeamId): void {
  cleanupActiveSession();
  hud.hide();
  const drv = ALL_DRIVERS.find((d) => d.id === driverId) ?? YAHIA_DRIVER;
  sceneManager.enterMenuShowroom(drv, yahiaTeamId);
  audio.setMenuMusicActive(true);
  menuUI.screen = 'home';
  menuUI.show();
}

const menuUI = new MenuUI(menuLayer, {
  onShowroomChanged(driverId, yahiaTeamId) {
    const drv = ALL_DRIVERS.find((d) => d.id === driverId) ?? YAHIA_DRIVER;
    sceneManager.enterMenuShowroom(drv, yahiaTeamId);
    if (!activeRace) {
      audio.setMenuMusicActive(true);
    }
  },
  onStartSession(settings, champ) {
    startSession(settings, champ);
  },
  onToggleMute() {
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
  isMuted() {
    return audio.muted;
  },
});

const hud = new RaceHUD(hudLayer, {
  onTogglePause() {
    if (!activeRace || activeRace.phase === 'finished') return;
    paused = !paused;
    audio.setEngineActive(!paused);
    hud.setPaused(paused);
  },
  onCycleCamera() {
    const mode = sceneManager.cameraRig.cycleMode();
    hud.setCameraLabel(mode);
  },
  onToggleMute() {
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
  onQuitToMenu() {
    returnToMenu(menuUI.playerDriverId, menuUI.yahiaTeamId);
  },
  onRestartRace() {
    if (lastRaceSettings) {
      startSession(lastRaceSettings, activeChamp);
    }
  },
  onTouchSteer(steer) {
    input.setTouchSteer(steer);
  },
  onTouchThrottle(active) {
    input.setTouchThrottle(active);
  },
  onTouchBrake(active) {
    input.setTouchBrake(active);
  },
  onTouchBoost(active) {
    input.setTouchBoost(active);
  },
  onTouchPit() {
    input.triggerTouchEdge('pit');
  },
  onTouchReset() {
    input.triggerTouchEdge('reset');
  },
  onSetAutoGas(enabled) {
    input.autoAccelerate = enabled;
  },
});

const deviceProfile = new DeviceProfileManager(uiRoot);
hud.setMobileMode(deviceProfile.isMobile);
deviceProfile.subscribe(({ isMobile }) => {
  hud.setMobileMode(isMobile);
});

// Boot directly into the 3D Showroom + Broadcast Home Screen, then hot-swap to real GLB car once loaded
sceneManager.enterMenuShowroom(YAHIA_DRIVER, 'mercedes');
hud.hide();
menuUI.show();
audio.setMenuMusicActive(true);

void preloadF1CarModel().then(() => {
  if (!activeRace) {
    const drv = ALL_DRIVERS.find((d) => d.id === menuUI.playerDriverId) ?? YAHIA_DRIVER;
    sceneManager.enterMenuShowroom(drv, menuUI.yahiaTeamId);
  }
});

window.addEventListener('resize', () => {
  sceneManager.resize(window.innerWidth, window.innerHeight);
});

const FIXED_DT = 1 / 60;
let accumulator = 0;
let prevTimestamp = performance.now();

function animate(nowMs: number): void {
  requestAnimationFrame(animate);

  const frameDt = Math.min(0.05, (nowMs - prevTimestamp) / 1000);
  prevTimestamp = nowMs;
  const clockSec = nowMs / 1000;

  if (!activeRace) {
    sceneManager.render(clockSec, true);
    return;
  }

  const race = activeRace;
  const pCar = race.getPlayerCar();

  // Sample controls per frame (preserving edge presses for Pause / Camera / Gears / Pit)
  const ctrl = input.sample(frameDt, pCar.speed);

  if (ctrl.pausePressed && race.phase !== 'finished') {
    paused = !paused;
    audio.setEngineActive(!paused);
    hud.setPaused(paused);
  }

  if (ctrl.cameraPressed && !paused) {
    const camMode = sceneManager.cameraRig.cycleMode();
    hud.setCameraLabel(camMode);
  }

  if (!paused && race.phase !== 'finished') {
    accumulator += frameDt;
    while (accumulator >= FIXED_DT) {
      const audioEvents = race.step(ctrl, FIXED_DT);
      if (audioEvents.lightStepTick) audio.playStartLightBeep(false);
      if (audioEvents.lightsOutGo) audio.playStartLightBeep(true);
      if (audioEvents.gearChanged) audio.playGearShift();
      if (audioEvents.kerbHit) audio.playKerbThud();
      if (audioEvents.radioChirp) audio.playRadioChirp();

      // Consume edge triggers after first physics substep
      ctrl.shiftUpPressed = false;
      ctrl.shiftDownPressed = false;
      ctrl.pitPressed = false;
      ctrl.resetPressed = false;
      accumulator -= FIXED_DT;

      if (audioEvents.raceFinished) {
        finishCelebrationTimer = 2.4;
        break;
      }
    }
  } else if (race.phase === 'finished' && finishCelebrationTimer > 0) {
    finishCelebrationTimer -= frameDt;
    if (finishCelebrationTimer <= 0) {
      audio.setEngineActive(false);
      hud.hide();
      const finishedResults = race.results;
      const finishedSettings = race.settings;
      const winnerEntry = finishedResults[0];
      const p1Driver = winnerEntry?.driver ?? race.getPlayerDriver();
      const pColors: [string, string, string] = [
        TEAMS[finishedResults[0]?.teamId ?? finishedSettings.yahiaTeamId].primaryColor,
        TEAMS[finishedResults[1]?.teamId ?? 'mercedes'].primaryColor,
        TEAMS[finishedResults[2]?.teamId ?? 'redbull'].primaryColor,
      ];
      const playerPos = finishedResults.find((r) => r.isPlayer)?.position ?? 99;

      cleanupActiveSession();
      sceneManager.enterPodiumCeremony(
        p1Driver,
        finishedSettings.yahiaTeamId,
        pColors,
      );
      audio.playPodiumCelebration(playerPos === 1);

      if (finishedSettings.mode === 'championship' && activeChamp) {
        activeChamp = scoreChampionshipRound(
          activeChamp,
          finishedSettings.circuitId,
          finishedResults,
        );
        saveChampionshipState(activeChamp);
      }

      menuUI.showResults(finishedResults, finishedSettings.mode === 'championship' ? activeChamp : null);
      return;
    }
  }

  // Update 3D car rigs, track lights, racing line & ghost car
  for (const car of race.cars) {
    const rig = activeCarRigs.get(car.driverId);
    rig?.updateFromState(car, clockSec);
  }

  if (ghostCarMesh) {
    if (race.currentGhostPose) {
      ghostCarMesh.visible = true;
      ghostCarMesh.position.set(
        race.currentGhostPose.x,
        race.currentGhostPose.y,
        race.currentGhostPose.z,
      );
      ghostCarMesh.rotation.y = race.currentGhostPose.heading;
      ghostCarMesh.rotation.x = -(race.currentGhostPose.pitch ?? 0);
      ghostCarMesh.rotation.z = race.currentGhostPose.roll ?? 0;
    } else {
      ghostCarMesh.visible = false;
    }
  }

  if (activeEffects && !paused) {
    activeEffects.update(race.cars, frameDt);
  }

  if (activeTrackWorld) {
    activeTrackWorld.updateStartLights(race.lightsLit);
    activeTrackWorld.updateRacingLine(
      pCar.speed,
      race.settings.assists.racingLine,
      clockSec,
    );
  }

  // Camera & Sun Shadow Follow
  const playerRig = activeCarRigs.get(pCar.driverId);
  if (race.phase === 'finished') {
    playerRig?.setCockpitView(false);
    sceneManager.cameraRig.updateVictoryOrbit(pCar, clockSec);
  } else {
    const introAlpha =
      race.phase === 'countdown'
        ? Math.max(0, 1 - race.countdownTimer / 3.8)
        : 0;
    playerRig?.setCockpitView(sceneManager.cameraRig.mode === 'cockpit' && introAlpha === 0);
    sceneManager.cameraRig.updateRace(pCar, frameDt, introAlpha);
  }
  sceneManager.updateSunFollow(pCar.x, pCar.y, pCar.z);

  audio.updateFromCar(pCar);
  hud.update(race);
  sceneManager.render(clockSec, false);
}

requestAnimationFrame(animate);
