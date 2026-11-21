import { CIRCUIT_ORDER, CIRCUITS, type CircuitId } from '../data/circuits';
import {
  ALL_DRIVERS,
  getDriverPortraitPath,
  MARIAM_DRIVER,
  PLAYABLE_DRIVERS,
  resolveDriverTeam,
  SEASON_2026_TICKER,
  TEAMS,
  YAHIA_DRIVER,
  type TeamId,
} from '../data/teamsAndDrivers';
import type { AIDifficulty } from '../engine/AIDriver';
import type { AssistConfig, TireCompound } from '../engine/CarPhysics';
import {
  createNewChampionshipState,
  formatLapTime,
  loadChampionshipState,
  loadPersonalBestLaps,
  saveChampionshipState,
  type ChampionshipState,
  type GameMode,
  type RaceResultEntry,
  type RaceSettings,
} from '../engine/RaceManager';

import type { PwaState } from './PwaManager';

export type MenuScreen = 'home' | 'driver' | 'setup' | 'results';

export interface MenuCallbacks {
  onShowroomChanged(driverId: string, yahiaTeamId: TeamId): void;
  onStartSession(settings: RaceSettings, championship: ChampionshipState | null): void;
  onToggleMute(): boolean;
  isMuted(): boolean;
  getPwaState(): PwaState;
  onToggleFullscreen(): void;
  onRequestInstall(): void;
  onEnsureMobileFullscreen(): void;
}

function buildCircuitSvgPath(points: [number, number, number][]): string {
  if (points.length === 0) return '';
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, , z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxZ - minZ);
  const scale = Math.min(180 / w, 66 / h);
  const offX = (200 - w * scale) * 0.5;
  const offY = (76 - h * scale) * 0.5;

  const coords = points.map(([x, , z]) => {
    const px = ((x - minX) * scale + offX).toFixed(1);
    const py = ((z - minZ) * scale + offY).toFixed(1);
    return `${px},${py}`;
  });
  return `M ${coords.join(' L ')} Z`;
}

export class MenuUI {
  private readonly root: HTMLElement;
  private readonly callbacks: MenuCallbacks;

  screen: MenuScreen = 'home';
  mode: GameMode = 'grand-prix';
  playerDriverId = 'yahia';
  yahiaTeamId: TeamId = 'mercedes';
  circuitId: CircuitId = 'red-bull-ring';
  laps = 5;
  difficulty: AIDifficulty = 'medium';
  startingTire: TireCompound = 'soft';
  qualifyingEnabled = false;
  assists: AssistConfig = {
    gearbox: 'auto',
    tractionControl: 'full',
    abs: true,
    racingLine: 'full',
    steeringAssist: true,
    brakingAssist: true,
  };

  private tickerIdx = 0;
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private lastResults: RaceResultEntry[] = [];
  private lastChamp: ChampionshipState | null = null;
  private activeChamp: ChampionshipState | null = loadChampionshipState();
  private podiumCinemaMode = false;
  private flexTeamByDriver: Record<string, TeamId> = {
    yahia: YAHIA_DRIVER.teamId,
    mariam: MARIAM_DRIVER.teamId,
  };
  private preloadedPortraits: HTMLImageElement[] = [];

  constructor(root: HTMLElement, callbacks: MenuCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.preloadFlexPortraits();
    this.tickerInterval = globalThis.setInterval(() => {
      this.tickerIdx = (this.tickerIdx + 1) % SEASON_2026_TICKER.length;
      const tickerEl = this.root.querySelector<HTMLElement>('[data-ticker-text]');
      if (tickerEl) {
        tickerEl.textContent = SEASON_2026_TICKER[this.tickerIdx];
      }
    }, 4500);
  }

  private preloadFlexPortraits(): void {
    if (typeof Image === 'undefined') return;
    for (const drv of [YAHIA_DRIVER, MARIAM_DRIVER]) {
      const teams = drv.flexTeams ?? (['mercedes', 'redbull', 'mclaren'] as TeamId[]);
      for (const tid of teams) {
        const img = new Image();
        img.decoding = 'sync';
        img.src = getDriverPortraitPath(drv, tid, 'grid');
        this.preloadedPortraits.push(img);
      }
    }
  }

  destroy(): void {
    if (this.tickerInterval !== null) {
      globalThis.clearInterval(this.tickerInterval);
    }
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  showResults(results: RaceResultEntry[], championship: ChampionshipState | null): void {
    this.lastResults = results;
    this.lastChamp = championship;
    this.activeChamp = loadChampionshipState();
    this.screen = 'results';
    this.show();
  }

  private selectDriver(driverId: string, flexTeam?: TeamId): void {
    this.playerDriverId = driverId;
    const drv = ALL_DRIVERS.find((d) => d.id === driverId);
    if (drv?.isFlexStar) {
      if (flexTeam) {
        this.flexTeamByDriver[driverId] = flexTeam;
      }
      this.yahiaTeamId = this.flexTeamByDriver[driverId] ?? drv.teamId;
    } else if (flexTeam) {
      this.yahiaTeamId = flexTeam;
    }
    this.callbacks.onShowroomChanged(this.playerDriverId, this.yahiaTeamId);
    this.render();
  }

  private launchCurrentSettings(champOverride?: ChampionshipState | null): void {
    // Request mobile fullscreen + landscape synchronously inside click gesture before async asset awaits
    this.callbacks.onEnsureMobileFullscreen();

    const champ = champOverride ?? (this.mode === 'championship' ? this.activeChamp : null);
    const circuitId =
      this.mode === 'championship' && champ
        ? CIRCUIT_ORDER[Math.min(CIRCUIT_ORDER.length - 1, champ.currentRoundIndex)]
        : this.circuitId;

    this.callbacks.onStartSession(
      {
        mode: this.mode,
        circuitId,
        playerDriverId: this.playerDriverId,
        yahiaTeamId: this.yahiaTeamId,
        laps: this.mode === 'time-trial' ? 999 : this.laps,
        difficulty: this.difficulty,
        startingTire: this.mode === 'time-trial' ? 'soft' : this.startingTire,
        qualifyingEnabled: this.mode === 'time-trial' ? false : this.qualifyingEnabled,
        assists: { ...this.assists },
      },
      champ,
    );
  }

  render(): void {
    const selectedDriver =
      ALL_DRIVERS.find((d) => d.id === this.playerDriverId) ?? YAHIA_DRIVER;
    const selectedTeam = resolveDriverTeam(selectedDriver, this.yahiaTeamId);
    const muted = this.callbacks.isMuted();
    const pwa = this.callbacks.getPwaState();
    const showInstall = !pwa.isStandalone && (pwa.canInstallPrompt || pwa.isIosSafari);

    const topBar = `
      <div class="menu-topbar-wrap">
        <div class="broadcast-topbar">
          <div class="brand-lockup">
            <span class="f1-pill">F1 26</span>
            <div>
              <div class="brand-title">2026 World Tour</div>
              <div class="brand-sub">Active Aero • 350 kW Boost • Overtake Era</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="brand-sub topbar-driver-chip" style="color:#fff;font-weight:700;">
              ${selectedDriver.flag} #${selectedDriver.number} ${selectedDriver.name} • ${selectedTeam.shortName}
            </span>
            <button class="btn-secondary mobile-pwa-btn ${showInstall ? '' : 'hidden'}" data-action="pwa-install">📲 App</button>
            <button class="btn-secondary mobile-pwa-btn ${pwa.canToggleFullscreen ? '' : 'hidden'}" data-action="toggle-fullscreen">${pwa.isFullscreen ? '✕ Exit' : '⛶ Full'}</button>
            <button class="btn-secondary" data-action="toggle-mute">${muted ? '🔇 Muted' : '🔊 Audio On'}</button>
          </div>
        </div>
        <div class="ticker-bar">
          <span class="ticker-dot"></span>
          <span data-ticker-text>${SEASON_2026_TICKER[this.tickerIdx]}</span>
        </div>
      </div>
    `;

    let body = '';
    if (this.screen === 'home') {
      body = this.renderHome(selectedDriver, selectedTeam);
    } else if (this.screen === 'driver') {
      body = this.renderDriverSelect();
    } else if (this.screen === 'setup') {
      body = this.renderSetup();
    } else {
      body = this.renderResults();
    }

    const prevCarousel = this.root.querySelector<HTMLElement>('.drivers-carousel-wrap');
    const prevScrollLeft = prevCarousel ? prevCarousel.scrollLeft : 0;

    const isResults = this.screen === 'results';
    this.root.innerHTML = `<div class="menu-shell interactive ${isResults ? 'is-results' : ''}">${topBar}<div class="menu-content-dock">${body}</div></div>`;

    if (prevScrollLeft > 0) {
      const nextCarousel = this.root.querySelector<HTMLElement>('.drivers-carousel-wrap');
      if (nextCarousel) {
        nextCarousel.scrollLeft = prevScrollLeft;
      }
    }

    this.bindEvents();
  }

  syncPwaState(state: PwaState): void {
    const installBtn = this.root.querySelector<HTMLElement>('[data-action="pwa-install"]');
    if (installBtn) {
      const showInstall = !state.isStandalone && (state.canInstallPrompt || state.isIosSafari);
      installBtn.classList.toggle('hidden', !showInstall);
    }

    const fullBtn = this.root.querySelector<HTMLElement>('[data-action="toggle-fullscreen"]');
    if (fullBtn) {
      fullBtn.classList.toggle('hidden', !state.canToggleFullscreen);
      fullBtn.textContent = state.isFullscreen ? '✕ Exit' : '⛶ Full';
    }
  }

  private renderHome(
    selectedDriver: typeof YAHIA_DRIVER,
    selectedTeam: ReturnType<typeof resolveDriverTeam>,
  ): string {
    const resumeBanner =
      this.activeChamp && this.activeChamp.active
        ? `
          <button class="mode-btn" data-action="resume-championship" style="border-left-color:#FFD700;">
            <div>
              <div class="mode-title">Resume 2026 Championship — Round ${this.activeChamp.currentRoundIndex + 1}/4</div>
              <div class="mode-desc">Next stop: ${CIRCUITS[CIRCUIT_ORDER[this.activeChamp.currentRoundIndex]].name}</div>
            </div>
            <span class="mode-cta" style="background:#FFD700;color:#111;">RESUME</span>
          </button>
        `
        : '';

    return `
      <div class="home-grid">
        <div class="hero-panel">
          <div class="hero-eyebrow">Official 2026 Regulation Era • Special Driver Edition</div>
          <h1 class="hero-headline">Race The <span>2026 Grid</span> As Yahia Samy #17</h1>
          <p style="font-size:14px;color:var(--text-muted);line-height:1.45;">
            Battle World Champion Kimi Antonelli, Max Verstappen, Lando Norris, and the 2026 field across 4 real circuits — featuring Active Aero wings, manual Boost, and 1-second Overtake Mode.
          </p>
          <div class="mode-stack">
            ${resumeBanner}
            <button class="mode-btn" data-action="go-mode" data-mode="grand-prix">
              <div>
                <div class="mode-title">Quick Grand Prix</div>
                <div class="mode-desc">Pick your driver, circuit, optional 1-Lap Qualifying & race strategy</div>
              </div>
              <span class="mode-cta">RACE</span>
            </button>
            <button class="mode-btn" data-action="go-mode" data-mode="championship" style="border-left-color:#00D2BE;">
              <div>
                <div class="mode-title">2026 4-Race World Tour</div>
                <div class="mode-desc">Red Bull Ring → Monza → Silverstone → Las Vegas Night Finale</div>
              </div>
              <span class="mode-cta" style="background:#00D2BE;color:#081214;">TOUR</span>
            </button>
            <button class="mode-btn" data-action="go-mode" data-mode="time-trial" style="border-left-color:#c026d3;">
              <div>
                <div class="mode-title">Time Trial + Ghost Car</div>
                <div class="mode-desc">Chase Purple sectors & race against your saved personal-best Ghost</div>
              </div>
              <span class="mode-cta" style="background:#c026d3;">HOTLAP</span>
            </button>
          </div>
          <div class="controls-cheat">
            <div><span class="kbd">W</span> / <span class="kbd">↑</span> Throttle</div>
            <div><span class="kbd">S</span> / <span class="kbd">↓</span> Brake</div>
            <div><span class="kbd">A</span><span class="kbd">D</span> / <span class="kbd">←</span><span class="kbd">→</span> Steer</div>
            <div><span class="kbd">SPACE</span> 2026 Boost</div>
            <div><span class="kbd">C</span> Camera (T-Cam/Chase/Cockpit)</div>
            <div><span class="kbd">P</span> Pit Box • <span class="kbd">E</span>/<span class="kbd">Q</span> Gears</div>
          </div>
        </div>
        <div class="showroom-badge" style="border-top:4px solid ${selectedTeam.uiColor};">
          <div style="display:flex;align-items:center;gap:12px;">
            <img src="${getDriverPortraitPath(selectedDriver, this.yahiaTeamId, 'grid')}"
                 alt="${selectedDriver.name}"
                 style="width:74px;height:74px;border-radius:10px;object-fit:cover;border:1px solid rgba(255,255,255,0.2);" />
            <div>
              <div style="font-size:11px;color:var(--cyan-tech);font-weight:800;letter-spacing:0.1em;">3D SHOWROOM ACTIVE</div>
              <div style="font-size:19px;font-weight:900;">${selectedDriver.flag} #${selectedDriver.number} ${selectedDriver.name}</div>
              <div style="font-size:13px;color:var(--text-muted);">${selectedTeam.name}</div>
            </div>
          </div>
          <button class="btn-secondary" style="width:100%;margin-top:12px;" data-action="open-driver">
            Change Driver / Team Seat
          </button>
        </div>
      </div>
    `;
  }

  private renderDriverSelect(): string {
    const renderFlexHeroCard = (driver: typeof YAHIA_DRIVER, badgeLabel: string) => {
      const selected = this.playerDriverId === driver.id;
      const activeTeamId = this.flexTeamByDriver[driver.id] ?? driver.teamId;
      const team = TEAMS[activeTeamId];
      const pills = (['mercedes', 'redbull', 'mclaren'] as TeamId[])
        .map((tid) => {
          const t = TEAMS[tid];
          const active = activeTeamId === tid;
          return `
            <button class="team-pill ${active ? 'active' : ''}"
                    data-action="pick-flex-team"
                    data-driver="${driver.id}"
                    data-team="${tid}"
                    style="${active ? `background:${t.primaryColor};color:${tid === 'redbull' ? '#fff' : '#0b0d14'};` : ''}">
              ${t.shortName}
            </button>
          `;
        })
        .join('');

      return `
        <div class="yahia-hero-card ${selected ? 'selected' : ''}"
             data-action="pick-driver"
             data-driver="${driver.id}"
             style="--team-accent:${team.uiColor};">
          <div class="driver-portrait-frame">
            <img src="${getDriverPortraitPath(driver, activeTeamId, 'grid')}"
                 data-fallback-src="./assets/drivers/${driver.portraitBase}-${driver.teamId}.png"
                 loading="eager"
                 decoding="sync"
                 alt="${driver.name}" />
          </div>
          <div style="display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:11px;font-weight:900;letter-spacing:0.12em;color:#FFD700;text-transform:uppercase;">
                  ${badgeLabel}
                </span>
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:${selected ? '#10b981' : 'var(--text-muted)'};">
                  ${selected ? '● SELECTED' : 'CLICK TO DRIVE'}
                </span>
              </div>
              <div class="hero-driver-name" style="font-size:24px;font-weight:900;margin-top:2px;">
                ${driver.flag} #${driver.number} ${driver.name} <span style="font-size:14px;color:var(--text-muted);">(${driver.code})</span>
              </div>
              <div class="hero-driver-desc" style="font-size:12px;color:var(--text-muted);">
                Sign with Mercedes, Red Bull, or McLaren — suit, 3D helmet &amp; car livery update live!
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:800;margin-top:6px;">
                Choose Constructor Seat:
              </div>
              <div class="flex-team-pills">${pills}</div>
            </div>
          </div>
        </div>
      `;
    };

    const flexHeroCards = `
      <div class="flex-hero-grid">
        ${renderFlexHeroCard(YAHIA_DRIVER, '★ Featured Rookie Star • Flex Seat')}
        ${renderFlexHeroCard(MARIAM_DRIVER, '★ Featured Rising Star • Flex Seat')}
      </div>
    `;

    const realCards = PLAYABLE_DRIVERS.filter((d) => !d.isFlexStar)
      .map((d) => {
        const team = TEAMS[d.teamId];
        const isSel = this.playerDriverId === d.id;
        return `
          <div class="driver-card ${isSel ? 'selected' : ''}"
               data-action="pick-driver"
               data-driver="${d.id}"
               style="--team-accent:${team.uiColor};">
            <div class="driver-card-top">
              <div class="driver-thumb">
                <img src="${getDriverPortraitPath(d)}" alt="${d.name}" />
              </div>
              <div style="min-width:0;">
                <div style="font-size:11px;font-weight:800;color:${team.uiColor};text-transform:uppercase;">
                  ${team.shortName} • #${d.number}
                </div>
                <div style="font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.flag} ${d.name}</div>
                <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;">
                  2026: P${d.standing2026} • ${d.points2026} pts • ${d.wins2026}W
                </div>
              </div>
            </div>
            <div>
              <div class="stat-row"><span>Pace Rating</span><strong>${d.pace}</strong></div>
              <div class="stat-bar">
                <div class="stat-fill" style="width:${d.pace}%;background:${team.uiColor};"></div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="section-header">
        <div>
          <div class="brand-sub">Step 1 of 2 • 2026 Top-3 Teams + Flex Star Seat</div>
          <div class="section-title">Select Your Driver</div>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn-secondary" data-action="back-home">Back</button>
          <button class="btn-primary" data-action="next-setup">Next: Circuit & Setup →</button>
        </div>
      </div>

      <div class="drivers-carousel-wrap">
        ${flexHeroCards}

        <div class="drivers-grid">${realCards}</div>
      </div>
    `;
  }

  private renderSetup(): string {
    const bests = loadPersonalBestLaps();
    const isChamp = this.mode === 'championship';
    const isTT = this.mode === 'time-trial';

    const circuitCards = CIRCUIT_ORDER.map((cid, idx) => {
      const c = CIRCUITS[cid];
      const isSel = isChamp ? idx === 0 : this.circuitId === cid;
      const pb = bests[cid];
      const svgPath = buildCircuitSvgPath(c.controlPoints);
      return `
        <div class="circuit-card ${isSel ? 'selected' : ''}"
             ${isChamp ? '' : `data-action="pick-circuit" data-circuit="${cid}"`}
             style="${isChamp ? 'cursor:default;opacity:0.92;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span style="font-size:15px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.flag} ${c.name}</span>
            <span style="font-size:11px;font-weight:800;white-space:nowrap;flex-shrink:0;color:${c.atmosphere === 'vegas-night' ? '#00E5FF' : '#98a3b8'};">
              ${c.atmosphere === 'vegas-night' ? '🌙 NIGHT RACE' : `ROUND ${idx + 1}`}
            </span>
          </div>
          <div class="circuit-svg-box">
            <svg viewBox="0 0 200 76" width="100%" height="100%">
              <path d="${svgPath}" fill="none" stroke="${isSel ? '#E10600' : '#94a3b8'}" stroke-width="3.5" stroke-linejoin="round" />
            </svg>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">
            <span>${(c.realLengthMeters / 1000).toFixed(3)} km • ${c.turns} Turns</span>
            <span>Record: ${c.lapRecord.time}</span>
          </div>
          <div style="font-size:11px;color:${pb ? '#c026d3' : 'var(--text-muted)'};font-weight:700;">
            ${pb ? `Personal Best: ${formatLapTime(pb)}` : c.description}
          </div>
        </div>
      `;
    }).join('');

    const seg = (group: string, val: string, label: string, current: string) =>
      `<button class="seg-btn ${current === val ? 'active' : ''}" data-action="set-opt" data-group="${group}" data-val="${val}">${label}</button>`;

    return `
      <div class="section-header">
        <div>
          <div class="brand-sub">Step 2 of 2 • ${this.mode.toUpperCase()}</div>
          <div class="section-title">${isChamp ? '2026 4-Circuit Tour Calendar' : 'Select Circuit & Strategy'}</div>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn-secondary" data-action="open-driver">← Driver</button>
          <button class="btn-primary" data-action="start-race">Lights Out — Start! 🏁</button>
        </div>
      </div>

      <div class="setup-layout">
        <div class="circuit-grid">${circuitCards}</div>

        <div class="setup-options-panel">
          ${
            isTT
              ? `<div style="font-size:13px;color:var(--cyan-tech);font-weight:700;">Time Trial: Fresh Soft tires, unlimited hotlaps, live Purple/Green sectors & Ghost Car!</div>`
              : `
                <div class="option-group">
                  <label>Race Distance</label>
                  <div class="seg-row">
                    ${seg('laps', '3', '3 Laps', String(this.laps))}
                    ${seg('laps', '5', '5 Laps', String(this.laps))}
                    ${seg('laps', '10', '10 Laps', String(this.laps))}
                  </div>
                </div>
                <div class="option-group">
                  <label>AI Pace Difficulty</label>
                  <div class="seg-row">
                    ${seg('difficulty', 'easy', 'Easy (80%)', this.difficulty)}
                    ${seg('difficulty', 'medium', 'Medium (93%)', this.difficulty)}
                    ${seg('difficulty', 'pro', 'Pro (102%)', this.difficulty)}
                  </div>
                </div>
                <div class="option-group">
                  <label>Starting Pirelli Compound</label>
                  <div class="seg-row">
                    ${seg('tire', 'soft', '🔴 Soft', this.startingTire)}
                    ${seg('tire', 'medium', '🟡 Medium', this.startingTire)}
                    ${seg('tire', 'hard', '⚪ Hard', this.startingTire)}
                  </div>
                </div>
                <div class="option-group">
                  <label>Grid Format</label>
                  <div class="seg-row">
                    ${seg('quali', 'false', 'Instant Grid', String(this.qualifyingEnabled))}
                    ${seg('quali', 'true', '1-Lap Qualifying', String(this.qualifyingEnabled))}
                  </div>
                </div>
              `
          }

          <div class="option-group">
            <label>Gearbox & Driving Assists</label>
            <div class="seg-row" style="margin-bottom:6px;">
              ${seg('gearbox', 'auto', 'Auto Gears', this.assists.gearbox)}
              ${seg('gearbox', 'manual', 'Manual (E/Q)', this.assists.gearbox)}
            </div>
            <div class="seg-row" style="margin-bottom:6px;">
              ${seg('tc', 'full', 'TC Full', this.assists.tractionControl)}
              ${seg('tc', 'medium', 'TC Med', this.assists.tractionControl)}
              ${seg('tc', 'off', 'TC Off', this.assists.tractionControl)}
            </div>
            <div class="seg-row" style="margin-bottom:6px;">
              ${seg('abs', 'true', 'ABS On', String(this.assists.abs))}
              ${seg('abs', 'false', 'ABS Off', String(this.assists.abs))}
            </div>
            <div class="seg-row" style="margin-bottom:6px;">
              ${seg('steerAssist', 'true', 'Steer Assist On', String(this.assists.steeringAssist !== false))}
              ${seg('steerAssist', 'false', 'Off', String(this.assists.steeringAssist !== false))}
            </div>
            <div class="seg-row" style="margin-bottom:6px;">
              ${seg('brakeAssist', 'true', 'Brake Assist On', String(this.assists.brakingAssist !== false))}
              ${seg('brakeAssist', 'false', 'Off', String(this.assists.brakingAssist !== false))}
            </div>
            <div class="seg-row">
              ${seg('line', 'corners', 'Corners Line', this.assists.racingLine)}
              ${seg('line', 'full', 'Full Line', this.assists.racingLine)}
              ${seg('line', 'off', 'Line Off', this.assists.racingLine)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderResults(): string {
    const top3 = this.lastResults.slice(0, 3);
    const podiumCards = top3
      .map((entry) => {
        const team = TEAMS[entry.teamId];
        const pose =
          entry.driver.isFlexStar
            ? entry.position === 1
              ? 'victory'
              : 'podium'
            : 'grid';
        const portrait = getDriverPortraitPath(entry.driver, this.yahiaTeamId, pose);
        const medal = entry.position === 1 ? '🏆 P1 WINNER' : entry.position === 2 ? '🥈 P2' : '🥉 P3';
        const stepClass = entry.position === 1 ? 'p1' : entry.position === 2 ? 'p2' : 'p3';
        return `
          <div class="podium-card ${stepClass}" style="border-top:4px solid ${team.primaryColor};">
            <div style="font-size:13px;font-weight:900;letter-spacing:0.08em;color:${entry.position === 1 ? '#FFD700' : entry.position === 2 ? '#e2e8f0' : '#f59e0b'};margin-bottom:8px;">
              ${medal}
            </div>
            <img src="${portrait}" alt="${entry.driver.name}"
                 style="width:${entry.position === 1 ? 140 : 116}px;height:${entry.position === 1 ? 140 : 116}px;border-radius:14px;object-fit:cover;margin:0 auto 8px;display:block;border:3px solid ${entry.position === 1 ? '#FFD700' : team.primaryColor};box-shadow:0 8px 24px rgba(0,0,0,0.45);" />
            <div style="font-size:${entry.position === 1 ? 20 : 17}px;font-weight:900;">${entry.driver.flag} ${entry.driver.name}</div>
            <div style="font-size:12px;color:var(--text-muted);">${team.shortName} • +${entry.pointsAwarded} pts</div>
            <div class="podium-step-base ${stepClass}">${entry.position}</div>
          </div>
        `;
      })
      .join('');

    const playerRes = this.lastResults.find((r) => r.isPlayer);
    const winnerRes = this.lastResults[0];
    const gpName = CIRCUITS[this.circuitId].grandPrixName;
    const heroHeadline =
      playerRes && playerRes.position === 1
        ? `🏆 ${playerRes.driver.name.toUpperCase()} WINS THE ${gpName.toUpperCase()}!`
        : playerRes && playerRes.position <= 3
          ? `🥂 PODIUM CELEBRATION! ${playerRes.driver.name.toUpperCase()} FINISHES P${playerRes.position}!`
          : `🏁 ${winnerRes ? winnerRes.driver.name.toUpperCase() : 'RACE'} WINS THE ${gpName.toUpperCase()}`;

    const rowsHtml = this.lastResults
      .map((r) => {
        const team = TEAMS[r.teamId];
        const penBadge =
          r.penaltySeconds > 0
            ? `<span style="color:#ff4d4d;font-weight:800;">+${r.penaltySeconds}s</span>`
            : `<span style="color:var(--text-muted);">—</span>`;
        return `
          <tr style="${r.isPlayer ? 'background:rgba(225,6,0,0.18);font-weight:700;' : ''}">
            <td>P${r.position}</td>
            <td><span style="display:inline-block;width:4px;height:12px;background:${team.primaryColor};margin-right:6px;"></span>${r.driver.flag} ${r.driver.name}</td>
            <td>${team.shortName}</td>
            <td style="font-family:var(--font-mono);">${r.position === 1 ? formatLapTime(r.totalTimeMs) : `+${(r.gapMs / 1000).toFixed(2)}s`}</td>
            <td style="font-family:var(--font-mono);${r.fastestLapBonus ? 'color:#e879f9;font-weight:700;' : ''}">
              ${formatLapTime(r.bestLapMs)} ${r.fastestLapBonus ? '⚡' : ''}
            </td>
            <td style="font-family:var(--font-mono);">${penBadge}</td>
            <td>${r.pitStops}</td>
            <td><strong>${r.pointsAwarded}</strong></td>
          </tr>
        `;
      })
      .join('');

    let champSection = '';
    if (this.lastChamp) {
      const sortedStandings = ALL_DRIVERS.map((d) => ({
        driver: d,
        pts: this.lastChamp!.driverPoints[d.id] ?? 0,
        wins: this.lastChamp!.driverWins[d.id] ?? 0,
      })).sort((a, b) => b.pts - a.pts);

      const hasMoreRounds = this.lastChamp.currentRoundIndex < CIRCUIT_ORDER.length;
      const nextCircuit = hasMoreRounds
        ? CIRCUITS[CIRCUIT_ORDER[this.lastChamp.currentRoundIndex]]
        : null;

      champSection = `
        <div style="background:#151a28;border:1px solid var(--border-subtle);border-radius:12px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:16px;">2026 World Tour Standings (${this.lastChamp.completedRounds.length}/4 Rounds)</strong>
            ${
              nextCircuit
                ? `<button class="btn-primary" data-action="next-champ-round">Next Round: ${nextCircuit.name} →</button>`
                : `<span style="color:#FFD700;font-weight:900;">🏆 WORLD TOUR COMPLETE! CHAMPION: ${sortedStandings[0].driver.name.toUpperCase()}</span>`
            }
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;font-size:12px;">
            ${sortedStandings
              .slice(0, 6)
              .map(
                (s, i) => `
              <div style="background:rgba(255,255,255,0.05);padding:6px 9px;border-radius:6px;display:flex;justify-content:space-between;">
                <span>${i + 1}. ${s.driver.flag} ${s.driver.code}</span>
                <strong>${s.pts} pts (${s.wins}W)</strong>
              </div>`,
              )
              .join('')}
          </div>
        </div>
      `;
    }

    if (this.podiumCinemaMode) {
      return `
        <div class="podium-cinema-overlay">
          <div class="podium-hero-banner">
            <div class="brand-sub" style="color:#FFD700;">CHAMPAGNE & TROPHIES • LIVE 3D PODIUM CEREMONY</div>
            <div class="podium-hero-title">${heroHeadline}</div>
          </div>
          <div class="podium-cinema-dock">
            <button class="btn-secondary" data-action="toggle-podium-cinema">📊 Official Classification</button>
            <button class="btn-secondary" data-action="back-home">Main Menu</button>
            <button class="btn-primary" data-action="rematch">Race Again</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="podium-panel" style="margin:0 auto;">
        <div class="podium-hero-banner" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
            <div>
              <div class="brand-sub" style="color:#FFD700;">Official FIA Grand Prix Classification</div>
              <div class="podium-hero-title">${heroHeadline}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn-secondary" data-action="toggle-podium-cinema">🎉 Full 3D Stage</button>
              <button class="btn-secondary" data-action="back-home">Main Menu</button>
              <button class="btn-primary" data-action="rematch">Race Again</button>
            </div>
          </div>
        </div>
        <div class="podium-cards">${podiumCards}</div>
        ${champSection}
        <table class="results-table">
          <thead>
            <tr><th>Pos</th><th>Driver</th><th>Constructor</th><th>Time / Gap</th><th>Best Lap</th><th>Pen</th><th>Pits</th><th>Pts</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLImageElement>('img[data-fallback-src]').forEach((img) => {
      img.addEventListener('error', () => {
        const fb = img.dataset.fallbackSrc;
        if (fb && img.getAttribute('src') !== fb) {
          img.src = fb;
        }
      });
    });

    this.root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const action = el.dataset.action;
        if (action === 'toggle-mute') {
          this.callbacks.onToggleMute();
          this.render();
          return;
        }
        if (action === 'pwa-install') {
          this.callbacks.onRequestInstall();
          return;
        }
        if (action === 'toggle-fullscreen') {
          this.callbacks.onToggleFullscreen();
          return;
        }
        if (action === 'go-mode') {
          this.mode = (el.dataset.mode as GameMode) || 'grand-prix';
          this.screen = 'driver';
          this.render();
          return;
        }
        if (action === 'resume-championship' && this.activeChamp) {
          this.mode = 'championship';
          this.playerDriverId = this.activeChamp.playerDriverId;
          this.yahiaTeamId = this.activeChamp.yahiaTeamId;
          if (this.activeChamp.playerDriverId in this.flexTeamByDriver) {
            this.flexTeamByDriver[this.activeChamp.playerDriverId] = this.yahiaTeamId;
          }
          this.difficulty = this.activeChamp.difficulty;
          this.circuitId = CIRCUIT_ORDER[this.activeChamp.currentRoundIndex];
          this.launchCurrentSettings(this.activeChamp);
          return;
        }
        if (action === 'open-driver') {
          this.screen = 'driver';
          this.render();
          return;
        }
        if (action === 'toggle-podium-cinema') {
          this.podiumCinemaMode = !this.podiumCinemaMode;
          this.render();
          return;
        }
        if (action === 'back-home') {
          this.podiumCinemaMode = false;
          this.screen = 'home';
          this.callbacks.onShowroomChanged(this.playerDriverId, this.yahiaTeamId);
          this.render();
          return;
        }
        if (action === 'next-setup') {
          this.screen = 'setup';
          this.render();
          return;
        }
        if (action === 'pick-flex-team' || action === 'pick-yahia-team') {
          e.stopPropagation();
          const team = el.dataset.team as TeamId;
          const driverId = el.dataset.driver || 'yahia';
          this.selectDriver(driverId, team);
          return;
        }
        if (action === 'pick-driver') {
          const did = el.dataset.driver || 'yahia';
          this.selectDriver(did);
          return;
        }
        if (action === 'pick-circuit') {
          this.circuitId = el.dataset.circuit as CircuitId;
          this.render();
          return;
        }
        if (action === 'set-opt') {
          const g = el.dataset.group;
          const v = el.dataset.val || '';
          if (g === 'laps') this.laps = Number(v);
          if (g === 'difficulty') this.difficulty = v as AIDifficulty;
          if (g === 'tire') this.startingTire = v as TireCompound;
          if (g === 'quali') this.qualifyingEnabled = v === 'true';
          if (g === 'gearbox') this.assists.gearbox = v as 'auto' | 'manual';
          if (g === 'tc') this.assists.tractionControl = v as 'full' | 'medium' | 'off';
          if (g === 'abs') this.assists.abs = v === 'true';
          if (g === 'steerAssist') this.assists.steeringAssist = v === 'true';
          if (g === 'brakeAssist') this.assists.brakingAssist = v === 'true';
          if (g === 'line') this.assists.racingLine = v as 'full' | 'corners' | 'off';
          this.render();
          return;
        }
        if (action === 'start-race') {
          let champ: ChampionshipState | null = null;
          if (this.mode === 'championship') {
            champ = createNewChampionshipState(
              this.playerDriverId,
              this.yahiaTeamId,
              this.difficulty,
            );
            saveChampionshipState(champ);
            this.activeChamp = champ;
            this.circuitId = CIRCUIT_ORDER[0];
          }
          this.launchCurrentSettings(champ);
          return;
        }
        if (action === 'next-champ-round' && this.lastChamp) {
          this.mode = 'championship';
          this.circuitId = CIRCUIT_ORDER[this.lastChamp.currentRoundIndex];
          this.launchCurrentSettings(this.lastChamp);
          return;
        }
        if (action === 'rematch') {
          this.launchCurrentSettings(this.activeChamp);
        }
      });
    });
  }
}
