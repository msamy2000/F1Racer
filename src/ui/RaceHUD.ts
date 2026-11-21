import { TEAMS } from '../data/teamsAndDrivers';
import { TIRE_SPECS } from '../engine/CarPhysics';
import { formatLapTime, RaceManager } from '../engine/RaceManager';
import { CAMERA_LABELS, type CameraMode } from '../rendering/CameraRig';
import { SAMPLE_COUNT } from '../engine/TrackSpline';

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
  private tireTextEl!: HTMLElement;
  private pitBadgeEl!: HTMLElement;
  private cameraLabelEl!: HTMLElement;
  private muteBtnEl!: HTMLElement;
  private touchToggleBtnEl!: HTMLElement;
  private touchLayerEl!: HTMLElement;
  private touchBoostBtnEl!: HTMLElement;
  private touchBoostPctEl!: HTMLElement;
  private touchAutoGasBtnEl!: HTMLElement;
  private touchGasBtnEl!: HTMLElement;
  private pauseModalEl!: HTMLElement;
  private touchControlsEnabled = false;
  private autoGasEnabled = true;

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

  show(race: RaceManager, cameraMode: CameraMode, isMuted: boolean): void {
    this.root.classList.remove('hidden');
    if (!this.builtDom) {
      this.touchControlsEnabled =
        typeof window !== 'undefined' &&
        ('ontouchstart' in window ||
          navigator.maxTouchPoints > 0 ||
          (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches));
      this.buildDOM();
    }
    this.applyTouchState();
    this.setupMinimapProjection(race);
    this.cameraLabelEl.textContent = CAMERA_LABELS[cameraMode];
    this.muteBtnEl.textContent = isMuted ? '🔇' : '🔊';
    this.setPaused(false);
  }

  private applyTouchState(): void {
    if (!this.builtDom) return;
    this.touchLayerEl.classList.toggle('hidden', !this.touchControlsEnabled);
    this.touchToggleBtnEl.classList.toggle('active', this.touchControlsEnabled);
    this.touchAutoGasBtnEl.textContent = this.autoGasEnabled ? 'AUTO GAS: ON' : 'AUTO GAS: OFF';
    this.touchAutoGasBtnEl.classList.toggle('active', this.autoGasEnabled);
    this.touchGasBtnEl.classList.toggle('hidden', this.autoGasEnabled);
    this.callbacks.onSetAutoGas(this.touchControlsEnabled && this.autoGasEnabled);
    if (!this.touchControlsEnabled) {
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
    this.pauseModalEl.classList.toggle('hidden', !paused);
  }

  setCameraLabel(mode: CameraMode): void {
    if (this.cameraLabelEl) {
      this.cameraLabelEl.textContent = CAMERA_LABELS[mode];
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

        <div class="hud-corner-controls">
          <button class="hud-pill-btn" data-hud-btn="touch" title="Toggle Asphalt Touch Controls">📱 TOUCH</button>
          <button class="hud-pill-btn" data-hud-btn="cam">📷 TV POD</button>
          <button class="hud-pill-btn" data-hud-btn="mute">🔊</button>
          <button class="hud-pill-btn" data-hud-btn="pause">⏸ Esc</button>
        </div>

        <!-- Asphalt-Style Mobile On-Screen Touch Controls -->
        <div class="touch-controls-layer hidden" data-hud="touch-layer">
          <div class="touch-left-zone" data-touch="steer-pad">
            <button class="touch-steer-btn" data-touch="steer-left" aria-label="Steer Left">◀</button>
            <button class="touch-steer-btn" data-touch="steer-right" aria-label="Steer Right">▶</button>
          </div>
          <div class="touch-right-zone">
            <div class="touch-quick-row">
              <button class="touch-mini-pill active" data-touch="auto-gas">AUTO GAS: ON</button>
              <button class="touch-mini-pill" data-touch="pit">BOX</button>
              <button class="touch-mini-pill" data-touch="reset">↺</button>
            </div>
            <div class="touch-pedal-row">
              <button class="touch-brake-btn" data-touch="brake">
                <span>BRAKE</span>
                <small>HOLD: R</small>
              </button>
              <button class="touch-gas-btn hidden" data-touch="gas">
                <span>GAS</span>
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
            <span class="tech-badge hidden" data-hud="pit-badge" style="background:#f59e0b;color:#111;">BOX THIS LAP</span>
          </div>
        </div>

        <div class="modal-backdrop hidden" data-hud="pause-modal">
          <div class="podium-panel" style="width:420px;text-align:center;">
            <div class="section-title">Session Paused</div>
            <p style="font-size:13px;color:var(--text-muted);">
              W/S Gas & Brake • A/D Steer • Space Boost • C Camera • P Pit Box • R Track Reset
            </p>
            <button class="btn-primary" data-hud-btn="resume">Resume Driving</button>
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
    this.tireTextEl = q('[data-hud="tire-text"]');
    this.pitBadgeEl = q('[data-hud="pit-badge"]');
    this.cameraLabelEl = q('[data-hud-btn="cam"]');
    this.muteBtnEl = q('[data-hud-btn="mute"]');
    this.touchToggleBtnEl = q('[data-hud-btn="touch"]');
    this.touchLayerEl = q('[data-hud="touch-layer"]');
    this.touchBoostBtnEl = q('[data-touch="boost"]');
    this.touchBoostPctEl = q('[data-touch="boost-pct"]');
    this.touchAutoGasBtnEl = q('[data-touch="auto-gas"]');
    this.touchGasBtnEl = q('[data-touch="gas"]');
    this.pauseModalEl = q('[data-hud="pause-modal"]');
    this.minimapCanvas = q<HTMLCanvasElement>('[data-hud="minimap"]');
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;

    this.touchToggleBtnEl.addEventListener('click', () => {
      this.touchControlsEnabled = !this.touchControlsEnabled;
      this.applyTouchState();
    });
    q('[data-hud-btn="cam"]').addEventListener('click', () => this.callbacks.onCycleCamera());
    q('[data-hud-btn="mute"]').addEventListener('click', () => {
      const m = this.callbacks.onToggleMute();
      this.setMuted(m);
    });
    q('[data-hud-btn="pause"]').addEventListener('click', () => this.callbacks.onTogglePause());
    q('[data-hud-btn="resume"]').addEventListener('click', () => this.callbacks.onTogglePause());
    q('[data-hud-btn="restart"]').addEventListener('click', () => this.callbacks.onRestartRace());
    q('[data-hud-btn="quit"]').addEventListener('click', () => this.callbacks.onQuitToMenu());

    // Bind Asphalt-style multi-touch pointer handlers (slide-friendly Left/Right steer pad!)
    const steerPad = q('[data-touch="steer-pad"]');
    const steerLeftBtn = q('[data-touch="steer-left"]');
    const steerRightBtn = q('[data-touch="steer-right"]');
    let activeSteerPointer: number | null = null;

    const updateSteerFromPointer = (clientX: number) => {
      const rect = steerPad.getBoundingClientRect();
      const midX = rect.left + rect.width * 0.5;
      const dir = clientX < midX ? -1 : 1;
      steerLeftBtn.classList.toggle('pressed', dir < 0);
      steerRightBtn.classList.toggle('pressed', dir > 0);
      this.callbacks.onTouchSteer(dir);
    };

    const clearSteer = () => {
      activeSteerPointer = null;
      steerLeftBtn.classList.remove('pressed');
      steerRightBtn.classList.remove('pressed');
      this.callbacks.onTouchSteer(0);
    };

    steerPad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeSteerPointer = e.pointerId;
      steerPad.setPointerCapture?.(e.pointerId);
      updateSteerFromPointer(e.clientX);
    });
    steerPad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeSteerPointer) return;
      e.preventDefault();
      updateSteerFromPointer(e.clientX);
    });
    steerPad.addEventListener('pointerup', (e) => {
      if (e.pointerId === activeSteerPointer) clearSteer();
    });
    steerPad.addEventListener('pointercancel', (e) => {
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
    bindHoldButton(this.touchGasBtnEl, (down) => this.callbacks.onTouchThrottle(down));
    bindHoldButton(this.touchBoostBtnEl, (down) => this.callbacks.onTouchBoost(down));

    this.touchAutoGasBtnEl.addEventListener('click', () => {
      this.autoGasEnabled = !this.autoGasEnabled;
      this.applyTouchState();
    });
    q('[data-touch="pit"]').addEventListener('click', () => this.callbacks.onTouchPit());
    q('[data-touch="reset"]').addEventListener('click', () => this.callbacks.onTouchReset());

    this.builtDom = true;
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
            <span>${r.hasFastestLap ? '⚡' : r.penaltySeconds > 0 ? `+${r.penaltySeconds}` : ''}</span>
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

    this.throttleBarEl.style.width = `${Math.round(pCar.throttleApplied * 100)}%`;
    this.brakeBarEl.style.width = `${Math.round(pCar.brakeApplied * 100)}%`;
    this.ersBarEl.style.width = `${Math.round((pCar.ersBattery / 1.125) * 100)}%`;
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

    // Draw track outline
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < SAMPLE_COUNT; i += 6) {
      const p = race.track.samples[i].position;
      const mx = (p.x - this.minimapMinX) * this.minimapScale + this.minimapOx;
      const my = (p.z - this.minimapMinZ) * this.minimapScale + this.minimapOy;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw car dots
    for (const car of race.cars) {
      const driver = race.driversById.get(car.driverId)!;
      const teamId = driver.isFlexStar ? race.settings.yahiaTeamId : driver.teamId;
      const mx = (car.x - this.minimapMinX) * this.minimapScale + this.minimapOx;
      const my = (car.z - this.minimapMinZ) * this.minimapScale + this.minimapOy;
      ctx.beginPath();
      ctx.arc(mx, my, car.isPlayer ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = car.isPlayer ? '#FFFFFF' : TEAMS[teamId].uiColor;
      ctx.fill();
      if (car.isPlayer) {
        ctx.strokeStyle = '#E10600';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
  }
}
