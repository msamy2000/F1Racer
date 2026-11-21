import { TEAMS } from '../data/teamsAndDrivers';
import { TIRE_SPECS } from '../engine/CarPhysics';
import { formatLapTime, RaceManager } from '../engine/RaceManager';
import { CAMERA_LABELS, type CameraMode } from '../rendering/CameraRig';
import { mapAnalogWheelSteer } from '../engine/InputManager';
import { SAMPLE_COUNT } from '../engine/TrackSpline';
import type { PwaState } from './PwaManager';

export type MobileSteerMode = 'buttons' | 'wheel';

const STORAGE_MOBILE_STEER_MODE_KEY = 'f1_2026_mobile_steer_mode';

function loadMobileSteerMode(): MobileSteerMode {
  try {
    return localStorage.getItem(STORAGE_MOBILE_STEER_MODE_KEY) === 'wheel' ? 'wheel' : 'buttons';
  } catch {
    return 'buttons';
  }
}

function saveMobileSteerMode(mode: MobileSteerMode): void {
  try {
    localStorage.setItem(STORAGE_MOBILE_STEER_MODE_KEY, mode);
  } catch {
    // Ignore unavailable storage
  }
}

export interface RaceHUDCallbacks {
  onTogglePause(): void;
  onCycleCamera(): void;
  onToggleMute(): boolean;
  onQuitToMenu(): void;
  onRestartRace(): void;
  onTouchSteer(steer: number): void;
  onTouchThrottle(active: boolean): void;
  onTouchBrake(active: boolean): void;
  onTouchBoost(active: boolean): void;
  onTouchPit(): void;
  onTouchReset(): void;
  onSetAutoGas(enabled: boolean): void;
  onToggleFullscreen?(): void;
  getPwaState?(): PwaState;
  onToggleEasyAssists?(): boolean;
  isEasyAssistsEnabled?(): boolean;
  onToggleBas?(): boolean;
  isBasEnabled?(): boolean;
  onFinishTimeTrial?(): void;
}

export class RaceHUD {
  private readonly root: HTMLElement;
  private readonly callbacks: RaceHUDCallbacks;

  private towerRowsEl!: HTMLElement;
  private sessionTitleEl!: HTMLElement;
  private lapCounterEl!: HTMLElement;
  private lapTimerEl!: HTMLElement;
  private sectorEls: HTMLElement[] = [];
  private radioEl!: HTMLElement;
  private startLightsEl!: HTMLElement;
  private lightPods: HTMLElement[] = [];
  private speedEl!: HTMLElement;
  private gearEl!: HTMLElement;
  private rpmLeds: HTMLElement[] = [];
  private throttleBarEl!: HTMLElement;
  private brakeBarEl!: HTMLElement;
  private ersBarEl!: HTMLElement;
  private aeroBadgeEl!: HTMLElement;
  private boostBadgeEl!: HTMLElement;
  private overtakeBadgeEl!: HTMLElement;
  private basBadgeEl!: HTMLElement;
  private tireTextEl!: HTMLElement;
  private pitBadgeEl!: HTMLElement;
  private cameraLabelEl!: HTMLElement;
  private pauseBtnEl!: HTMLElement;
  private muteBtnEl!: HTMLElement;
  private touchToggleBtnEl!: HTMLElement;
  private fullscreenBtnEl!: HTMLElement;
  private pauseFullscreenBtnEl!: HTMLElement;
  private pauseAssistsBtnEl!: HTMLElement;
  private pauseBasBtnEl!: HTMLElement;
  private pauseFinishTtBtnEl!: HTMLElement;
  private pauseSteerModeBtnEl!: HTMLElement;
  private pauseCurLapEl!: HTMLElement;
  private pauseLastLapEl!: HTMLElement;
  private pauseBestLapEl!: HTMLElement;
  private lastPwaState: PwaState | null = null;
  private lastShownRace: RaceManager | null = null;
  private touchLayerEl!: HTMLElement;
  private touchBrakeBtnEl!: HTMLElement;
  private touchBoostBtnEl!: HTMLElement;
  private touchBoostPctEl!: HTMLElement;
  private steerButtonsEl!: HTMLElement;
  private steerLeftBtnEl!: HTMLElement;
  private steerRightBtnEl!: HTMLElement;
  private steerWheelEl!: HTMLElement;
  private steerKnobEl!: HTMLElement;
  private mobileSteerMode: MobileSteerMode = loadMobileSteerMode();
  private mPosEl!: HTMLElement;
  private mSpeedEl!: HTMLElement;
  private mGearEl!: HTMLElement;
  private mLapEl!: HTMLElement;
  private mLapTimeEl!: HTMLElement;
  private mBestLapEl!: HTMLElement;
  private mSectorEls: HTMLElement[] = [];
  private mBasEl!: HTMLElement;
  private mPenEl!: HTMLElement;
  private mErsFillEl!: HTMLElement;
  private pauseModalEl!: HTMLElement;
  private mobileMode = false;
  private touchControlsEnabled = false;

  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private minimapMinX = 0;
  private minimapMinZ = 0;
  private minimapScale = 1;
  private minimapOx = 0;
  private minimapOy = 0;

  private builtDom = false;

  constructor(root: HTMLElement, callbacks: RaceHUDCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  setMobileMode(isMobile: boolean): void {
    this.mobileMode = isMobile;
    this.touchControlsEnabled = isMobile;
    if (this.builtDom) {
      this.applyTouchState();
      const state = this.lastPwaState ?? this.callbacks.getPwaState?.();
      if (state) this.syncPwaState(state);
    }
  }

  show(race: RaceManager, cameraMode: CameraMode, isMuted: boolean): void {
    this.lastShownRace = race;
    this.root.classList.remove('hidden');
    if (!this.builtDom) {
      this.touchControlsEnabled = this.mobileMode;
      this.buildDOM();
    }
    this.applyTouchState();
    const state = this.lastPwaState ?? this.callbacks.getPwaState?.();
    if (state) this.syncPwaState(state);
    this.setupMinimapProjection(race);
    this.setCameraLabel(cameraMode);
    this.muteBtnEl.textContent = isMuted ? '🔇' : '🔊';
    this.setPaused(false);
  }

  syncPwaState(state: PwaState): void {
    this.lastPwaState = state;
    if (!this.builtDom) return;
    const showCornerFs = this.mobileMode && state.canToggleFullscreen && !state.isFullscreen;
    this.fullscreenBtnEl.classList.toggle('hidden', !showCornerFs);
    this.pauseFullscreenBtnEl.classList.toggle('hidden', !state.canToggleFullscreen);
    this.pauseFullscreenBtnEl.textContent = state.isFullscreen
      ? '✕ Exit Fullscreen'
      : '⛶ Enter Fullscreen';
  }

  private applyTouchState(): void {
    if (!this.builtDom) return;
    this.touchLayerEl.classList.toggle('hidden', !this.touchControlsEnabled);
    this.touchToggleBtnEl.classList.toggle('active', this.touchControlsEnabled);
    this.pauseBtnEl.textContent = this.mobileMode ? '⏸' : '⏸ Esc';
    this.callbacks.onSetAutoGas(this.touchControlsEnabled);
    if (!this.touchControlsEnabled) {
      this.steerLeftBtnEl.classList.remove('pressed');
      this.steerRightBtnEl.classList.remove('pressed');
      this.steerWheelEl.classList.remove('active');
      this.steerKnobEl.style.transform = 'translateX(0px) rotate(0deg)';
      this.callbacks.onTouchSteer(0);
      this.callbacks.onTouchBrake(false);
      this.callbacks.onTouchThrottle(false);
      this.callbacks.onTouchBoost(false);
    }
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setPaused(paused: boolean): void {
    if (!this.builtDom) return;
    if (paused) {
      this.syncPauseAssistLabels();
      if (this.lastShownRace) {
        this.syncPauseTiming(this.lastShownRace);
      }
    }
    this.pauseModalEl.classList.toggle('hidden', !paused);
  }

  private syncPauseTiming(race: RaceManager): void {
    if (!this.builtDom) return;
    const pCar = race.getPlayerCar();
    const curLapElapsed =
      race.phase === 'countdown' ? 0 : Math.max(0, race.raceClockMs - pCar.currentLapStartMs);
    const bestMs = pCar.bestLapMs > 0 ? pCar.bestLapMs : race.playerPersonalBestLapMs;
    this.pauseCurLapEl.textContent = formatLapTime(curLapElapsed);
    this.pauseLastLapEl.textContent = formatLapTime(pCar.lastLapMs);
    this.pauseBestLapEl.textContent = formatLapTime(bestMs);
    this.pauseFinishTtBtnEl.classList.toggle(
      'hidden',
      race.settings.mode !== 'time-trial' || !this.callbacks.onFinishTimeTrial,
    );
  }

  private syncPauseAssistLabels(): void {
    if (!this.builtDom) return;
    if (this.callbacks.isEasyAssistsEnabled) {
      const enabled = this.callbacks.isEasyAssistsEnabled();
      this.pauseAssistsBtnEl.textContent = enabled
        ? '🧭 Easy Drive Assists: ON'
        : '🧭 Easy Drive Assists: OFF';
      this.pauseAssistsBtnEl.classList.toggle('hidden', false);
    } else {
      this.pauseAssistsBtnEl.classList.add('hidden');
    }
    if (this.callbacks.isBasEnabled) {
      const basOn = this.callbacks.isBasEnabled();
      this.pauseBasBtnEl.textContent = basOn
        ? '🛑 BAS (Brake Assist): ON'
        : '🛑 BAS (Brake Assist): OFF';
      this.pauseBasBtnEl.classList.toggle('hidden', false);
    } else {
      this.pauseBasBtnEl.classList.add('hidden');
    }
    this.pauseSteerModeBtnEl.textContent =
      this.mobileSteerMode === 'buttons'
        ? '🎮 Steer: ◀▶ Buttons'
        : '🎮 Steer: 🎡 Analog Wheel';
  }

  private syncSteerModeUI(): void {
    if (!this.builtDom) return;
    this.steerButtonsEl.classList.toggle('hidden', this.mobileSteerMode !== 'buttons');
    this.steerWheelEl.classList.toggle('hidden', this.mobileSteerMode !== 'wheel');
    this.steerLeftBtnEl.classList.remove('pressed');
    this.steerRightBtnEl.classList.remove('pressed');
    this.steerWheelEl.classList.remove('active');
    this.steerKnobEl.style.transform = 'translateX(0px) rotate(0deg)';
    this.callbacks.onTouchSteer(0);
    this.syncPauseAssistLabels();
  }

  setCameraLabel(mode: CameraMode): void {
    if (this.cameraLabelEl) {
      this.cameraLabelEl.textContent = this.mobileMode ? '📷' : `📷 ${CAMERA_LABELS[mode]}`;
    }
  }

  setMuted(muted: boolean): void {
    if (this.muteBtnEl) {
      this.muteBtnEl.textContent = muted ? '🔇' : '🔊';
    }
  }

  private buildDOM(): void {
    this.root.innerHTML = `
      <div class="hud-root">
        <div class="timing-tower">
          <div class="tower-head">
            <span data-hud="session-title">GRAND PRIX</span>
            <span>F1 26</span>
          </div>
          <div data-hud="tower-rows"></div>
        </div>

        <div class="top-session-bar">
          <span class="lap-counter" data-hud="lap-counter">LAP 1/5</span>
          <span class="lap-timer" data-hud="lap-timer">0:00.000</span>
          <div class="sector-pills">
            <span class="sector-pill" data-hud="s1">S1</span>
            <span class="sector-pill" data-hud="s2">S2</span>
            <span class="sector-pill" data-hud="s3">S3</span>
          </div>
        </div>

        <div class="radio-toast hidden" data-hud="radio-toast"></div>

        <div class="start-lights-box hidden" data-hud="start-lights">
          ${[0, 1, 2, 3, 4]
            .map(
              (i) =>
                `<div class="light-pod" data-light="${i}"><div class="light-bulb"></div><div class="light-bulb"></div></div>`,
            )
            .join('')}
        </div>

        <!-- Asphalt-Inspired Minimalist Top-Center Mobile HUD -->
        <div class="asphalt-top-hud">
          <div class="asphalt-hud-row">
            <span class="asphalt-pos" data-hud="m-pos">P1/12</span>
            <div class="asphalt-speed-wrap">
              <span class="asphalt-speed" data-hud="m-speed">0</span>
              <span class="asphalt-unit">KM/H</span>
              <span class="asphalt-gear" data-hud="m-gear">G1</span>
            </div>
            <span class="asphalt-lap" data-hud="m-lap">LAP 1/5</span>
          </div>
          <div class="asphalt-timing-row">
            <span class="asphalt-lap-time" data-hud="m-lap-time">0:00.000</span>
            <span class="asphalt-best-lap" data-hud="m-best-lap">PB --:--.---</span>
            <div class="asphalt-sectors">
              <span class="asphalt-sec" data-hud="m-s1">S1</span>
              <span class="asphalt-sec" data-hud="m-s2">S2</span>
              <span class="asphalt-sec" data-hud="m-s3">S3</span>
            </div>
            <span class="asphalt-bas-pill" data-hud="m-bas">BAS</span>
            <span class="asphalt-pen-pill hidden" data-hud="m-pen">+0s</span>
          </div>
          <div class="asphalt-ers-track">
            <div class="asphalt-ers-fill" data-hud="m-ers-fill"></div>
          </div>
        </div>

        <div class="hud-corner-controls">
          <button class="hud-pill-btn hidden" data-hud-btn="fullscreen" title="Enter Fullscreen">⛶</button>
          <button class="hud-pill-btn" data-hud-btn="touch" title="Toggle Asphalt Touch Controls">📱 TOUCH</button>
          <button class="hud-pill-btn" data-hud-btn="cam">📷 TV POD</button>
          <button class="hud-pill-btn" data-hud-btn="mute">🔊</button>
          <button class="hud-pill-btn" data-hud-btn="pause">⏸ Esc</button>
        </div>

        <!-- Asphalt-Style Mobile On-Screen Touch Controls (Big ◀ ▶ Buttons or Analog Wheel + Boost / Brake) -->
        <div class="touch-controls-layer hidden" data-hud="touch-layer">
          <div class="touch-left-zone">
            <div class="touch-steer-pad" data-touch="steer-buttons" aria-label="Steering Buttons">
              <button class="touch-steer-btn" data-touch="steer-left" aria-label="Steer Left">◀</button>
              <button class="touch-steer-btn" data-touch="steer-right" aria-label="Steer Right">▶</button>
            </div>
            <div class="analog-steer-zone hidden" data-touch="steer-wheel" aria-label="Analog Steering Wheel">
              <div class="analog-steer-track">
                <span class="analog-chevron left">◀</span>
                <span class="analog-center-tick"></span>
                <span class="analog-chevron right">▶</span>
              </div>
              <div class="analog-steer-knob" data-touch="steer-knob">
                <svg viewBox="0 0 64 64" width="44" height="44" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">
                  <circle cx="32" cy="32" r="22" opacity="0.92" />
                  <line x1="12" y1="32" x2="52" y2="32" />
                  <line x1="32" y1="32" x2="32" y2="52" />
                  <circle cx="32" cy="32" r="5" fill="#e10600" stroke="none" />
                </svg>
              </div>
            </div>
          </div>
          <div class="touch-right-zone">
            <div class="touch-quick-row">
              <button class="touch-mini-pill" data-touch="pit">BOX</button>
              <button class="touch-mini-pill" data-touch="reset">↺</button>
            </div>
            <div class="touch-pedal-row">
              <button class="touch-brake-btn" data-touch="brake">
                <span>BRAKE</span>
                <small>HOLD: R</small>
              </button>
              <button class="touch-boost-btn" data-touch="boost">
                <span>⚡ BOOST</span>
                <small data-touch="boost-pct">100%</small>
              </button>
            </div>
          </div>
        </div>

        <div class="minimap-box">
          <canvas width="160" height="130" data-hud="minimap"></canvas>
        </div>

        <div class="telemetry-pod">
          <div class="rpm-strip" data-hud="rpm-strip">
            ${Array.from({ length: 15 }, () => `<div class="rpm-led"></div>`).join('')}
          </div>
          <div class="speed-gear-row">
            <div>
              <span class="speed-big" data-hud="speed">0</span>
              <span style="font-size:11px;color:var(--text-muted);margin-left:3px;">KM/H</span>
            </div>
            <div style="text-align:right;">
              <span style="font-size:11px;color:var(--text-muted);display:block;">GEAR</span>
              <span class="gear-big" data-hud="gear">1</span>
            </div>
          </div>

          <div class="pedal-bars">
            <div>
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">THROTTLE</div>
              <div class="bar-track"><div data-hud="throttle-bar" style="height:100%;width:0%;background:#10b981;"></div></div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">BRAKE</div>
              <div class="bar-track"><div data-hud="brake-bar" style="height:100%;width:0%;background:#ef4444;"></div></div>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:2px;">
              <span>ERS BATTERY (4.0 MJ)</span>
              <span data-hud="tire-text">SOFT 100% • 92°C</span>
            </div>
            <div class="bar-track"><div data-hud="ers-bar" style="height:100%;width:100%;background:#facc15;"></div></div>
          </div>

          <div class="tech-badges">
            <span class="tech-badge" data-hud="aero-badge">Z-MODE</span>
            <span class="tech-badge" data-hud="boost-badge">SPACE: BOOST</span>
            <span class="tech-badge" data-hud="overtake-badge">OTK WAIT</span>
            <span class="tech-badge bas-ready" data-hud="bas-badge">BAS READY</span>
            <span class="tech-badge hidden" data-hud="pit-badge" style="background:#f59e0b;color:#111;">BOX THIS LAP</span>
          </div>
        </div>

        <div class="modal-backdrop hidden" data-hud="pause-modal">
          <div class="podium-panel" style="width:min(420px, 100%);text-align:center;">
            <div class="section-title">Session Paused</div>
            <div class="pause-timing-strip">
              <div class="pause-time-cell"><span>CUR LAP</span><strong data-hud="pause-cur-lap">0:00.000</strong></div>
              <div class="pause-time-cell"><span>LAST LAP</span><strong data-hud="pause-last-lap">--:--.---</strong></div>
              <div class="pause-time-cell"><span>BEST LAP</span><strong style="color:#e879f9;" data-hud="pause-best-lap">--:--.---</strong></div>
            </div>
            <p class="pause-desktop-hint" style="font-size:13px;color:var(--text-muted);">
              W/S Gas & Brake • A/D Steer • Space Boost • C Camera • P Pit Box • R Track Reset
            </p>
            <p class="pause-mobile-hint" style="font-size:13px;color:var(--text-muted);">
              Tap ◀ ▶ to steer • Hold BRAKE for sharp corners • Tap ⚡ BOOST on straights
            </p>
            <button class="btn-primary" data-hud-btn="resume">Resume Driving</button>
            <button class="btn-primary hidden" data-hud-btn="finish-tt">🏁 Finish &amp; Lap Times</button>
            <button class="btn-secondary" data-hud-btn="pause-assists">🧭 Easy Drive Assists: ON</button>
            <button class="btn-secondary" data-hud-btn="pause-bas">🛑 BAS (Brake Assist): ON</button>
            <button class="btn-secondary mobile-only-pause-btn" data-hud-btn="pause-steer-mode">🎮 Steer: ◀▶ Buttons</button>
            <button class="btn-secondary hidden" data-hud-btn="pause-fullscreen">⛶ Fullscreen Mode</button>
            <button class="btn-secondary" data-hud-btn="restart">Restart Session</button>
            <button class="btn-secondary" data-hud-btn="quit">Quit to Main Menu</button>
          </div>
        </div>
      </div>
    `;

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.towerRowsEl = q('[data-hud="tower-rows"]');
    this.sessionTitleEl = q('[data-hud="session-title"]');
    this.lapCounterEl = q('[data-hud="lap-counter"]');
    this.lapTimerEl = q('[data-hud="lap-timer"]');
    this.sectorEls = [q('[data-hud="s1"]'), q('[data-hud="s2"]'), q('[data-hud="s3"]')];
    this.radioEl = q('[data-hud="radio-toast"]');
    this.startLightsEl = q('[data-hud="start-lights"]');
    this.lightPods = Array.from(this.root.querySelectorAll<HTMLElement>('[data-light]'));
    this.speedEl = q('[data-hud="speed"]');
    this.gearEl = q('[data-hud="gear"]');
    this.rpmLeds = Array.from(this.root.querySelectorAll<HTMLElement>('.rpm-led'));
    this.throttleBarEl = q('[data-hud="throttle-bar"]');
    this.brakeBarEl = q('[data-hud="brake-bar"]');
    this.ersBarEl = q('[data-hud="ers-bar"]');
    this.aeroBadgeEl = q('[data-hud="aero-badge"]');
    this.boostBadgeEl = q('[data-hud="boost-badge"]');
    this.overtakeBadgeEl = q('[data-hud="overtake-badge"]');
    this.basBadgeEl = q('[data-hud="bas-badge"]');
    this.tireTextEl = q('[data-hud="tire-text"]');
    this.pitBadgeEl = q('[data-hud="pit-badge"]');
    this.cameraLabelEl = q('[data-hud-btn="cam"]');
    this.pauseBtnEl = q('[data-hud-btn="pause"]');
    this.muteBtnEl = q('[data-hud-btn="mute"]');
    this.touchToggleBtnEl = q('[data-hud-btn="touch"]');
    this.fullscreenBtnEl = q('[data-hud-btn="fullscreen"]');
    this.pauseFullscreenBtnEl = q('[data-hud-btn="pause-fullscreen"]');
    this.pauseAssistsBtnEl = q('[data-hud-btn="pause-assists"]');
    this.pauseBasBtnEl = q('[data-hud-btn="pause-bas"]');
    this.pauseFinishTtBtnEl = q('[data-hud-btn="finish-tt"]');
    this.pauseSteerModeBtnEl = q('[data-hud-btn="pause-steer-mode"]');
    this.pauseCurLapEl = q('[data-hud="pause-cur-lap"]');
    this.pauseLastLapEl = q('[data-hud="pause-last-lap"]');
    this.pauseBestLapEl = q('[data-hud="pause-best-lap"]');
    this.touchLayerEl = q('[data-hud="touch-layer"]');
    this.touchBrakeBtnEl = q('[data-touch="brake"]');
    this.touchBoostBtnEl = q('[data-touch="boost"]');
    this.touchBoostPctEl = q('[data-touch="boost-pct"]');
    this.steerButtonsEl = q('[data-touch="steer-buttons"]');
    this.steerLeftBtnEl = q('[data-touch="steer-left"]');
    this.steerRightBtnEl = q('[data-touch="steer-right"]');
    this.steerWheelEl = q('[data-touch="steer-wheel"]');
    this.steerKnobEl = q('[data-touch="steer-knob"]');
    this.mPosEl = q('[data-hud="m-pos"]');
    this.mSpeedEl = q('[data-hud="m-speed"]');
    this.mGearEl = q('[data-hud="m-gear"]');
    this.mLapEl = q('[data-hud="m-lap"]');
    this.mLapTimeEl = q('[data-hud="m-lap-time"]');
    this.mBestLapEl = q('[data-hud="m-best-lap"]');
    this.mSectorEls = [q('[data-hud="m-s1"]'), q('[data-hud="m-s2"]'), q('[data-hud="m-s3"]')];
    this.mBasEl = q('[data-hud="m-bas"]');
    this.mPenEl = q('[data-hud="m-pen"]');
    this.mErsFillEl = q('[data-hud="m-ers-fill"]');
    this.pauseModalEl = q('[data-hud="pause-modal"]');
    this.minimapCanvas = q<HTMLCanvasElement>('[data-hud="minimap"]');
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;

    this.touchToggleBtnEl.addEventListener('click', () => {
      this.touchControlsEnabled = !this.touchControlsEnabled;
      this.applyTouchState();
    });
    this.fullscreenBtnEl.addEventListener('click', () => this.callbacks.onToggleFullscreen?.());
    this.pauseFullscreenBtnEl.addEventListener('click', () => this.callbacks.onToggleFullscreen?.());
    q('[data-hud-btn="cam"]').addEventListener('click', () => this.callbacks.onCycleCamera());
    q('[data-hud-btn="mute"]').addEventListener('click', () => {
      const m = this.callbacks.onToggleMute();
      this.setMuted(m);
    });
    q('[data-hud-btn="pause"]').addEventListener('click', () => this.callbacks.onTogglePause());
    q('[data-hud-btn="resume"]').addEventListener('click', () => this.callbacks.onTogglePause());
    this.pauseFinishTtBtnEl.addEventListener('click', () => this.callbacks.onFinishTimeTrial?.());
    this.pauseAssistsBtnEl.addEventListener('click', () => {
      this.callbacks.onToggleEasyAssists?.();
      this.syncPauseAssistLabels();
    });
    this.pauseBasBtnEl.addEventListener('click', () => {
      this.callbacks.onToggleBas?.();
      this.syncPauseAssistLabels();
    });
    this.pauseSteerModeBtnEl.addEventListener('click', () => {
      this.mobileSteerMode = this.mobileSteerMode === 'buttons' ? 'wheel' : 'buttons';
      saveMobileSteerMode(this.mobileSteerMode);
      this.syncSteerModeUI();
    });
    q('[data-hud-btn="restart"]').addEventListener('click', () => this.callbacks.onRestartRace());
    q('[data-hud-btn="quit"]').addEventListener('click', () => this.callbacks.onQuitToMenu());

    // Bind Asphalt Left/Right Steering Pad with unified pointer capture for effortless thumb slides
    const steerButtons = this.steerButtonsEl;
    const leftBtn = this.steerLeftBtnEl;
    const rightBtn = this.steerRightBtnEl;
    let activePadPointer: number | null = null;

    const updateButtonsFromPointer = (clientX: number) => {
      const leftRect = leftBtn.getBoundingClientRect();
      const rightRect = rightBtn.getBoundingClientRect();
      const dir = clientX <= leftRect.right ? -1 : clientX >= rightRect.left ? 1 : 0;
      leftBtn.classList.toggle('pressed', dir < 0);
      rightBtn.classList.toggle('pressed', dir > 0);
      this.callbacks.onTouchSteer(dir);
    };

    const clearButtons = () => {
      activePadPointer = null;
      leftBtn.classList.remove('pressed');
      rightBtn.classList.remove('pressed');
      this.callbacks.onTouchSteer(0);
    };

    steerButtons.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activePadPointer = e.pointerId;
      steerButtons.setPointerCapture?.(e.pointerId);
      updateButtonsFromPointer(e.clientX);
    });
    steerButtons.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePadPointer) return;
      e.preventDefault();
      updateButtonsFromPointer(e.clientX);
    });
    steerButtons.addEventListener('pointerup', (e) => {
      if (e.pointerId === activePadPointer) clearButtons();
    });
    steerButtons.addEventListener('pointercancel', (e) => {
      if (e.pointerId === activePadPointer) clearButtons();
    });

    // Bind Virtual Analog Steering Wheel with progressive center-deadzone precision curve
    const steerWheel = this.steerWheelEl;
    const steerKnob = this.steerKnobEl;
    let activeSteerPointer: number | null = null;

    const updateSteerFromPointer = (clientX: number) => {
      const rect = steerWheel.getBoundingClientRect();
      const centerX = rect.left + rect.width * 0.5;
      const steer = mapAnalogWheelSteer((clientX - centerX) / Math.max(1, rect.width * 0.44));
      steerWheel.classList.add('active');
      steerKnob.style.transform = `translateX(${steer * 48}px) rotate(${steer * 52}deg)`;
      this.callbacks.onTouchSteer(steer);
    };

    const clearSteer = () => {
      activeSteerPointer = null;
      steerWheel.classList.remove('active');
      steerKnob.style.transform = 'translateX(0px) rotate(0deg)';
      this.callbacks.onTouchSteer(0);
    };

    steerWheel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeSteerPointer = e.pointerId;
      steerWheel.setPointerCapture?.(e.pointerId);
      updateSteerFromPointer(e.clientX);
    });
    steerWheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeSteerPointer) return;
      e.preventDefault();
      updateSteerFromPointer(e.clientX);
    });
    steerWheel.addEventListener('pointerup', (e) => {
      if (e.pointerId === activeSteerPointer) clearSteer();
    });
    steerWheel.addEventListener('pointercancel', (e) => {
      if (e.pointerId === activeSteerPointer) clearSteer();
    });

    const bindHoldButton = (el: HTMLElement, onChange: (down: boolean) => void) => {
      let activeId: number | null = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        activeId = e.pointerId;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('pressed');
        onChange(true);
      });
      const release = (e: PointerEvent) => {
        if (e.pointerId !== activeId) return;
        activeId = null;
        el.classList.remove('pressed');
        onChange(false);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    };

    bindHoldButton(q('[data-touch="brake"]'), (down) => this.callbacks.onTouchBrake(down));
    bindHoldButton(this.touchBoostBtnEl, (down) => this.callbacks.onTouchBoost(down));

    q('[data-touch="pit"]').addEventListener('click', () => this.callbacks.onTouchPit());
    q('[data-touch="reset"]').addEventListener('click', () => this.callbacks.onTouchReset());

    this.builtDom = true;
    this.syncSteerModeUI();
  }

  private setupMinimapProjection(race: RaceManager): void {
    const min = race.track.boundsMin;
    const max = race.track.boundsMax;
    const w = Math.max(1, max.x - min.x);
    const h = Math.max(1, max.z - min.z);
    this.minimapScale = Math.min(140 / w, 110 / h);
    this.minimapMinX = min.x;
    this.minimapMinZ = min.z;
    this.minimapOx = (160 - w * this.minimapScale) * 0.5;
    this.minimapOy = (130 - h * this.minimapScale) * 0.5;
  }

  update(race: RaceManager): void {
    if (!this.builtDom) return;
    this.lastShownRace = race;
    const pCar = race.getPlayerCar();

    // Session header & Lap Counter
    if (race.phase === 'qualifying') {
      this.sessionTitleEl.textContent = '1-LAP QUALI';
      this.lapCounterEl.textContent = 'FLYING LAP';
    } else if (race.settings.mode === 'time-trial') {
      this.sessionTitleEl.textContent = 'TIME TRIAL';
      this.lapCounterEl.textContent = `LAP ${Math.max(1, pCar.lap)}`;
    } else {
      this.sessionTitleEl.textContent = race.track.config.grandPrixName.toUpperCase();
      this.lapCounterEl.textContent = `LAP ${Math.max(1, Math.min(race.settings.laps, pCar.lap))}/${race.settings.laps}`;
    }

    // Live Lap Timer
    const curLapElapsed =
      race.phase === 'countdown' ? 0 : Math.max(0, race.raceClockMs - pCar.currentLapStartMs);
    this.lapTimerEl.textContent = formatLapTime(curLapElapsed);

    // Sector pills
    for (let i = 0; i < 3; i++) {
      const st = race.playerSectorStatuses[i];
      const el = this.sectorEls[i];
      el.className = `sector-pill ${st !== 'none' ? st : ''}`;
      el.textContent = `S${i + 1}`;
    }

    // 5-Red-Lights overlay
    const showLights = race.phase === 'countdown';
    this.startLightsEl.classList.toggle('hidden', !showLights);
    if (showLights) {
      for (let i = 0; i < 5; i++) {
        this.lightPods[i].classList.toggle('lit', i < race.lightsLit);
      }
    }

    // Radio message toast (visible for 4.2s)
    if (race.radio && race.raceClockMs - race.radio.timestampMs < 4200) {
      this.radioEl.classList.remove('hidden');
      this.radioEl.className = `radio-toast ${race.radio.tone}`;
      this.radioEl.textContent = `📻 ENGINEER: ${race.radio.text}`;
    } else {
      this.radioEl.classList.add('hidden');
    }

    // Left Timing Tower
    const rows = race.getHUDRows();
    this.towerRowsEl.innerHTML = rows
      .map((r) => {
        const team = TEAMS[r.teamId];
        const tire = TIRE_SPECS[r.tireCompound];
        return `
          <div class="tower-row ${r.isPlayer ? 'player-row' : ''}">
            <span>${r.position}</span>
            <span style="height:12px;background:${team.uiColor};border-radius:2px;"></span>
            <span>${r.driver.code}</span>
            <span style="color:var(--text-muted);text-align:right;">${r.inPit ? 'PIT' : r.gapText}</span>
            <span class="tire-dot" style="border-color:${tire.color};color:${tire.color};">${tire.code}</span>
            <span>${r.hasFastestLap ? '⚡' : ''}${r.penaltySeconds > 0 ? `<span style="color:#ff4d4d;font-weight:800;">+${r.penaltySeconds}s</span>` : ''}</span>
          </div>
        `;
      })
      .join('');

    // Telemetry Pod
    const kmh = Math.round(Math.abs(pCar.speed) * 3.6);
    this.speedEl.textContent = String(kmh);
    this.gearEl.textContent = pCar.gear < 0 ? 'R' : String(pCar.gear);

    const rpmLit = Math.round(((pCar.rpm - 4500) / 8600) * 15);
    for (let i = 0; i < 15; i++) {
      let col = 'rgba(255,255,255,0.12)';
      if (i < rpmLit) {
        col = i < 6 ? '#10b981' : i < 11 ? '#ef4444' : '#38bdf8';
      }
      this.rpmLeds[i].style.background = col;
    }

    // Minimalist Asphalt Top-Center Floating HUD sync
    const playerRow = rows.find((r) => r.isPlayer);
    const posNum = playerRow?.position ?? 1;
    const gearText = pCar.gear < 0 ? 'R' : `G${pCar.gear}`;
    const lapText =
      race.phase === 'qualifying'
        ? 'QUALI'
        : race.settings.mode === 'time-trial'
          ? `LAP ${Math.max(1, pCar.lap)}`
          : `LAP ${Math.max(1, Math.min(race.settings.laps, pCar.lap))}/${race.settings.laps}`;
    const ersWidthPct = Math.min(100, Math.round((pCar.ersBattery / 1.125) * 100));

    this.mPosEl.textContent =
      race.settings.mode === 'time-trial' ? 'TIME TRIAL' : `P${posNum}/${race.cars.length}`;
    this.mSpeedEl.textContent = String(kmh);
    this.mGearEl.textContent = gearText;
    this.mLapEl.textContent = lapText;
    this.mLapTimeEl.textContent = formatLapTime(curLapElapsed);
    const bestMs = pCar.bestLapMs > 0 ? pCar.bestLapMs : race.playerPersonalBestLapMs;
    this.mBestLapEl.textContent = bestMs > 0 ? `PB ${formatLapTime(bestMs)}` : 'PB --:--.---';
    for (let i = 0; i < 3; i++) {
      const st = race.playerSectorStatuses[i];
      this.mSectorEls[i].className = `asphalt-sec ${st !== 'none' ? st : ''}`;
    }
    const basEnabled = race.settings.assists.brakingAssist !== false;
    this.mBasEl.classList.toggle('hidden', !basEnabled);
    this.mBasEl.classList.toggle('active', basEnabled && pCar.basActive);
    this.mPenEl.classList.toggle('hidden', pCar.penaltySeconds <= 0);
    if (pCar.penaltySeconds > 0) {
      this.mPenEl.textContent = `+${pCar.penaltySeconds}s`;
    }
    this.touchBrakeBtnEl.classList.toggle('bas-active', pCar.basActive);
    this.mErsFillEl.style.width = `${ersWidthPct}%`;
    this.mErsFillEl.classList.toggle('boosting', pCar.boostActive);

    this.throttleBarEl.style.width = `${Math.round(pCar.throttleApplied * 100)}%`;
    this.brakeBarEl.style.width = `${Math.round(pCar.brakeApplied * 100)}%`;
    this.ersBarEl.style.width = `${ersWidthPct}%`;
    this.ersBarEl.style.background = pCar.boostActive ? '#fde047' : '#00e5ff';
    if (this.touchBoostPctEl) {
      const pct = Math.min(100, Math.round(pCar.ersBattery * 100));
      this.touchBoostPctEl.textContent = pCar.boostActive ? 'ACTIVE' : `${pct}%`;
      this.touchBoostBtnEl.classList.toggle('ready', pct >= 15);
      this.touchBoostBtnEl.classList.toggle('boosting', pCar.boostActive);
    }

    this.aeroBadgeEl.textContent = pCar.activeAeroActive ? 'X-MODE: STRAIGHT' : 'Z-MODE: CORNER';
    this.aeroBadgeEl.className = `tech-badge ${pCar.activeAeroActive ? 'active-aero' : ''}`;

    this.boostBadgeEl.textContent = pCar.boostActive ? '⚡ BOOST ACTIVE' : 'SPACE: BOOST';
    this.boostBadgeEl.className = `tech-badge ${pCar.boostActive ? 'boost-on' : ''}`;

    this.overtakeBadgeEl.textContent = pCar.overtakeArmed ? 'OVERTAKE +0.5MJ' : 'OTK <1.0S';
    this.overtakeBadgeEl.className = `tech-badge ${pCar.overtakeArmed ? 'overtake-on' : ''}`;

    this.basBadgeEl.textContent = !basEnabled
      ? 'BAS OFF'
      : pCar.basActive
        ? '🛑 BAS ACTIVE'
        : 'BAS READY';
    this.basBadgeEl.className = `tech-badge ${!basEnabled ? '' : pCar.basActive ? 'bas-on' : 'bas-ready'}`;

    this.syncPauseTiming(race);

    const tSpec = TIRE_SPECS[pCar.tireCompound];
    const lifePct = Math.max(0, Math.round((1 - pCar.tireWear) * 100));
    const tempC = Math.round(pCar.tireTemp);
    this.tireTextEl.textContent = `${tSpec.label} ${lifePct}% • ${tempC}°C`;
    this.tireTextEl.style.color =
      lifePct < 30 || tempC > 108
        ? '#ef4444'
        : tempC < 84
          ? '#38bdf8'
          : tSpec.color;

    this.pitBadgeEl.classList.toggle('hidden', !pCar.pitRequested && !pCar.inPitLane);
    this.pitBadgeEl.textContent = pCar.pitServicing
      ? `PIT STOP ${pCar.pitStopTimer.toFixed(1)}s`
      : pCar.inPitLane
        ? 'PIT LIMITER 80'
        : 'BOX THIS LAP';

    this.renderMinimap(race);
  }

  private renderMinimap(race: RaceManager): void {
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, 160, 130);

    // Draw track outline with subtle backing stroke for crisp legibility over sky or tarmac
    ctx.beginPath();
    for (let i = 0; i < SAMPLE_COUNT; i += 6) {
      const p = race.track.samples[i].position;
      const mx = (p.x - this.minimapMinX) * this.minimapScale + this.minimapOx;
      const my = (p.z - this.minimapMinZ) * this.minimapScale + this.minimapOy;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 6.5;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Draw car dots
    for (const car of race.cars) {
      const driver = race.driversById.get(car.driverId)!;
      const teamId = driver.isFlexStar ? race.settings.yahiaTeamId : driver.teamId;
      const mx = (car.x - this.minimapMinX) * this.minimapScale + this.minimapOx;
      const my = (car.z - this.minimapMinZ) * this.minimapScale + this.minimapOy;
      ctx.beginPath();
      ctx.arc(mx, my, car.isPlayer ? 5.2 : 3, 0, Math.PI * 2);
      ctx.fillStyle = car.isPlayer ? '#FFFFFF' : TEAMS[teamId].uiColor;
      ctx.fill();
      if (car.isPlayer) {
        ctx.strokeStyle = '#E10600';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
    }
  }
}
