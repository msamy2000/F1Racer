import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_DRIVERS } from '../data/teamsAndDrivers';
import { F1_POINTS_TABLE, RaceManager, type ChampionshipState, type RaceSettings } from '../engine/RaceManager';
import { MenuUI } from '../ui/MenuUI';
import { RaceHUD } from '../ui/RaceHUD';
import type { PwaState } from '../ui/PwaManager';

interface NodeFsSubset {
  readFileSync(path: URL, encoding: 'utf-8'): string;
}

const loadFs = async (): Promise<NodeFsSubset> => {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
};

interface MockActionEl {
  dataset: Record<string, string>;
  addEventListener(type: string, cb: (e: { stopPropagation: () => void }) => void): void;
  click(): void;
}

function createMenuHarness() {
  const preloadedSrcs: string[] = [];
  class MockImage {
    decoding = '';
    set src(val: string) {
      preloadedSrcs.push(val);
    }
  }

  vi.stubGlobal('Image', MockImage);
  vi.stubGlobal('window', {
    setInterval: () => 1,
    clearInterval: () => {},
  });

  let currentHtml = '';
  let actionEls: MockActionEl[] = [];

  const root = {
    classList: {
      remove: () => {},
      add: () => {},
    },
    set innerHTML(html: string) {
      currentHtml = html;
      actionEls = [];
      const tagRe = /<([a-z0-9]+)([^>]*data-action="[^"]+"[^>]*)>/gi;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(html)) !== null) {
        const attrs = m[2];
        const dataset: Record<string, string> = {};
        const attrRe = /data-([a-z-]+)="([^"]*)"/g;
        let am: RegExpExecArray | null;
        while ((am = attrRe.exec(attrs)) !== null) {
          const camel = am[1].replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
          dataset[camel] = am[2];
        }
        const handlers: Array<(e: { stopPropagation: () => void }) => void> = [];
        actionEls.push({
          dataset,
          addEventListener(type, cb) {
            if (type === 'click') handlers.push(cb);
          },
          click() {
            for (const cb of handlers) cb({ stopPropagation: () => {} });
          },
        });
      }
    },
    get innerHTML() {
      return currentHtml;
    },
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-action]') return actionEls;
      return [];
    },
  };

  const pwaState: PwaState = {
    isStandalone: false,
    isFullscreen: false,
    canRequestFullscreen: false,
    canToggleFullscreen: false,
    canInstallPrompt: false,
    isIosSafari: false,
  };

  let muted = false;
  const showroomCalls: Array<{ driverId: string; teamId: string }> = [];
  const launchedSessions: Array<{ settings: RaceSettings; championship: ChampionshipState | null }> = [];
  const menu = new MenuUI(root as unknown as HTMLElement, {
    onShowroomChanged(driverId, yahiaTeamId) {
      showroomCalls.push({ driverId, teamId: yahiaTeamId });
    },
    onStartSession(settings, championship) {
      launchedSessions.push({ settings, championship });
    },
    onToggleMute: () => {
      muted = !muted;
      return muted;
    },
    isMuted: () => muted,
    getPwaState: () => pwaState,
    onToggleFullscreen: () => {},
    onRequestInstall: () => {},
    onEnsureMobileFullscreen: () => {},
  });

  const findAction = (action: string, driver?: string, team?: string) =>
    actionEls.find(
      (el) =>
        el.dataset.action === action &&
        (driver === undefined || el.dataset.driver === driver) &&
        (team === undefined || el.dataset.team === team),
    );

  const findOpt = (group: string, val: string) =>
    actionEls.find(
      (el) => el.dataset.action === 'set-opt' && el.dataset.group === group && el.dataset.val === val,
    );

  const getCardImgSrc = (driverId: string): string | null => {
    const marker = `data-driver="${driverId}"`;
    const idx = currentHtml.indexOf(marker);
    if (idx === -1) return null;
    const snippet = currentHtml.slice(idx, idx + 450);
    const imgMatch = snippet.match(/<img\s+src="([^"]+)"/);
    return imgMatch ? imgMatch[1] : null;
  };

  return {
    menu,
    preloadedSrcs,
    showroomCalls,
    launchedSessions,
    getMuted: () => muted,
    getActionEls: () => actionEls,
    findAction,
    findOpt,
    getCardImgSrc,
    getHtml: () => currentHtml,
  };
}

describe('MenuUI — Flex Driver Portraits & Independent Seat State', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preloads all 6 flex-star grid portraits and retains Mariam seat when selected', () => {
    const { menu, preloadedSrcs, findAction, getCardImgSrc } = createMenuHarness();

    expect(preloadedSrcs).toEqual([
      './assets/drivers/yahia-mercedes.png',
      './assets/drivers/yahia-redbull.png',
      './assets/drivers/yahia-mclaren.png',
      './assets/drivers/mariam-mercedes.png',
      './assets/drivers/mariam-redbull.png',
      './assets/drivers/mariam-mclaren.png',
    ]);

    menu.screen = 'driver';
    menu.show();

    expect(getCardImgSrc('yahia')).toBe('./assets/drivers/yahia-mercedes.png');
    expect(getCardImgSrc('mariam')).toBe('./assets/drivers/mariam-mclaren.png');

    // Selecting Mariam preserves her McLaren seat & portrait rather than jumping to Mercedes
    findAction('pick-driver', 'mariam')?.click();
    expect(menu.playerDriverId).toBe('mariam');
    expect(menu.yahiaTeamId).toBe('mclaren');
    expect(getCardImgSrc('mariam')).toBe('./assets/drivers/mariam-mclaren.png');

    // Selecting Mariam's Red Bull & Mercedes pills updates only Mariam's seat cleanly
    findAction('pick-flex-team', 'mariam', 'redbull')?.click();
    expect(menu.yahiaTeamId).toBe('redbull');
    expect(getCardImgSrc('mariam')).toBe('./assets/drivers/mariam-redbull.png');
    expect(getCardImgSrc('yahia')).toBe('./assets/drivers/yahia-mercedes.png');

    findAction('pick-flex-team', 'mariam', 'mercedes')?.click();
    expect(menu.yahiaTeamId).toBe('mercedes');
    expect(getCardImgSrc('mariam')).toBe('./assets/drivers/mariam-mercedes.png');

    // Selecting Yahia after switching Mariam to Red Bull restores Yahia's remembered seat
    findAction('pick-flex-team', 'mariam', 'redbull')?.click();
    findAction('pick-driver', 'yahia')?.click();
    expect(menu.playerDriverId).toBe('yahia');
    expect(menu.yahiaTeamId).toBe('mercedes');
    expect(getCardImgSrc('yahia')).toBe('./assets/drivers/yahia-mercedes.png');
    expect(getCardImgSrc('mariam')).toBe('./assets/drivers/mariam-redbull.png');

    menu.destroy();
  });

  it('allows selecting all 12 drivers including Kimi Antonelli, Max Verstappen, Hamilton and Leclerc', () => {
    const { menu, showroomCalls, findAction, getHtml } = createMenuHarness();
    menu.screen = 'driver';
    menu.show();

    for (const [did, expectedTeam] of [
      ['antonelli', 'mercedes'],
      ['verstappen', 'redbull'],
      ['norris', 'mclaren'],
      ['hamilton', 'ferrari'],
      ['leclerc', 'ferrari'],
    ] as const) {
      findAction('pick-driver', did)?.click();
      expect(menu.playerDriverId).toBe(did);
      expect(showroomCalls.at(-1)?.driverId).toBe(did);

      // Selected driver card renders "● SELECTED" and appears in header
      const html = getHtml();
      const idx = html.indexOf(`data-driver="${did}"`);
      expect(idx).toBeGreaterThan(-1);
      const tagStart = html.lastIndexOf('<div', idx);
      const cardSlice = html.slice(tagStart, idx + 700);
      expect(cardSlice).toContain('● SELECTED');
      expect(cardSlice).toContain('driver-card selected');
      expect(html).toContain(expectedTeam === 'redbull' ? 'Red Bull' : expectedTeam === 'mercedes' ? 'Mercedes' : expectedTeam === 'mclaren' ? 'McLaren' : 'Ferrari');

      // Ensure flex stars are unselected when an official 2026 grid driver is chosen
      const yIdx = html.indexOf('data-driver="yahia"');
      expect(html.slice(yIdx, yIdx + 850)).not.toContain('● SELECTED');
    }

    menu.destroy();
  });

  it('precaches all 6 flex-star grid portraits in sw.js without blocking image cache writes', async () => {
    const fs = await loadFs();
    const sw = fs.readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf-8');
    expect(sw).toMatch(/f1-2026-world-tour-v\d+/);
    expect(sw).toContain('f1-2026-world-tour-v12');
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf-8');
    expect(html).toContain('<title>F1 2026 World Tour</title>');
    expect(html).not.toContain('Yahia');
    expect(html).not.toContain('Mariam');
    const manifest = fs.readFileSync(
      new URL('../../public/manifest.webmanifest', import.meta.url),
      'utf-8',
    );
    expect(manifest).not.toContain('Yahia');
    expect(manifest).not.toContain('Mariam');
    for (const name of [
      'yahia-mercedes.png',
      'yahia-redbull.png',
      'yahia-mclaren.png',
      'mariam-mercedes.png',
      'mariam-redbull.png',
      'mariam-mclaren.png',
    ]) {
      expect(sw).toContain(`./assets/drivers/${name}`);
    }
    expect(sw).toContain('event.waitUntil(');
  });

  it('renders BAS On/BAS Off setup toggle and mobile-ready results timing summary with penalty downgrade & lap chips', () => {
    const { menu, findAction, findOpt, getHtml } = createMenuHarness();
    menu.screen = 'setup';
    menu.show();
    const setupHtml = getHtml();
    expect(setupHtml).toContain('Easy Drive (Steer) On');
    expect(setupHtml).toContain('Easy Drive Off');
    expect(setupHtml).toContain('BAS On');
    expect(setupHtml).toContain('BAS Off');

    // Defaults: User Assist (Easy Drive) OFF, BAS ON; both toggle independently
    expect(menu.assists.steeringAssist).toBe(false);
    expect(menu.assists.brakingAssist).toBe(true);
    findOpt('steerAssist', 'true')?.click();
    expect(menu.assists.steeringAssist).toBe(true);
    expect(menu.assists.brakingAssist).toBe(true);
    findOpt('brakeAssist', 'false')?.click();
    expect(menu.assists.steeringAssist).toBe(true);
    expect(menu.assists.brakingAssist).toBe(false);
    findOpt('steerAssist', 'false')?.click();
    findOpt('brakeAssist', 'true')?.click();
    expect(menu.assists.steeringAssist).toBe(false);
    expect(menu.assists.brakingAssist).toBe(true);

    // Cross-platform SVG country flags render on both Setup circuit cards & Driver Select (never bare Windows-broken emoji)
    expect(setupHtml).toContain('<svg class="country-flag-icon" data-flag="AT"');
    expect(setupHtml).toContain('<svg class="country-flag-icon" data-flag="IT"');
    expect(setupHtml).toContain('<svg class="country-flag-icon" data-flag="GB"');
    expect(setupHtml).toContain('<svg class="country-flag-icon" data-flag="US"');
    menu.screen = 'driver';
    menu.show();
    const driverHtml = getHtml();
    for (const iso of ['EG', 'IT', 'NL', 'GB', 'AU', 'FR', 'MC', 'NZ']) {
      expect(driverHtml).toContain(`<svg class="country-flag-icon" data-flag="${iso}"`);
    }
    expect(driverHtml).not.toContain('🇪🇬');
    expect(driverHtml).not.toContain('🇬🇧');

    // Render race results with penalty downgrade P1 -> P2 and player lap times
    const mockResults = ALL_DRIVERS.slice(0, 4).map((driver, idx) => {
      const isPlayer = idx === 1;
      return {
        position: idx + 1,
        onTrackPosition: isPlayer ? 1 : idx + 1,
        driver,
        teamId: driver.teamId,
        isPlayer,
        totalTimeMs: 210_000 + idx * 1400,
        gapMs: idx * 1400,
        bestLapMs: 68_120 + idx * 350,
        penaltySeconds: isPlayer ? 3 : 0,
        pointsAwarded: F1_POINTS_TABLE[idx],
        fastestLapBonus: idx === 0,
        pitStops: 0,
      };
    });

    menu.showResults(mockResults, null, [70_450, 68_470, 69_100], false);
    const resHtml = getHtml();
    expect(resHtml).toContain('player-timing-summary');
    expect(resHtml).toContain('+3s (P1→P2)');
    expect(resHtml).toContain('lap-chip is-best');
    expect(resHtml).toContain('L2 1:08.470');
    expect(resHtml).toContain('results-table-wrap');
    expect(resHtml).toContain('col-constructor');
    expect(resHtml).toContain('col-pits');
    expect(resHtml).toContain('PODIUM FINISH!');
    expect(resHtml).toContain('Full 3D Stage');
    expect(resHtml).not.toContain('📊');
    expect(resHtml).not.toContain('🎉');
    expect(resHtml).not.toContain('🥂');
    expect(resHtml).not.toContain('CHAMPAGNE');

    // Switching to Full 3D Stage renders clean Official Classification button without ugly icons/champagne
    findAction('toggle-podium-cinema')?.click();
    const cinemaHtml = getHtml();
    expect(cinemaHtml).toContain('GRAND PRIX PODIUM • LIVE 3D CEREMONY');
    expect(cinemaHtml).toContain('Official Classification');
    expect(cinemaHtml).not.toContain('📊');
    expect(cinemaHtml).not.toContain('🎉');
    expect(cinemaHtml).not.toContain('🥂');
    expect(cinemaHtml).not.toContain('CHAMPAGNE');

    menu.destroy();
  });

  it('updates mobile HUD lap time, best lap, sectors, BAS indicator, penalty badge & pause timing strip in RaceHUD', () => {
    const elements = new Map<string, ReturnType<typeof makeEl>>();
    const makeEl = () => {
      const classes = new Set<string>();
      const listeners = new Map<string, Array<(e?: unknown) => void>>();
      const el = {
        className: '',
        textContent: '',
        innerHTML: '',
        style: {} as Record<string, string>,
        classList: {
          add: (...c: string[]) => c.forEach((x) => classes.add(x)),
          remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
          toggle: (c: string, force?: boolean) => {
            if (force === undefined) {
              if (classes.has(c)) classes.delete(c);
              else classes.add(c);
            } else if (force) {
              classes.add(c);
            } else {
              classes.delete(c);
            }
          },
          contains: (c: string) => classes.has(c),
        },
        addEventListener: (ev: string, fn: (e?: unknown) => void) => {
          const arr = listeners.get(ev) ?? [];
          arr.push(fn);
          listeners.set(ev, arr);
        },
        getBoundingClientRect: () => ({ left: 0, right: 100, width: 100 }),
        getContext: () => ({
          clearRect: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          closePath: () => {},
          stroke: () => {},
          arc: () => {},
          fill: () => {},
          strokeStyle: '',
          fillStyle: '',
          lineWidth: 1,
        }),
      };
      return el;
    };

    const getEl = (sel: string) => {
      let existing = elements.get(sel);
      if (!existing) {
        existing = makeEl();
        elements.set(sel, existing);
      }
      return existing;
    };

    const lights = Array.from({ length: 5 }, () => makeEl());
    const rpmLeds = Array.from({ length: 15 }, () => makeEl());

    const root = {
      innerHTML: '',
      classList: makeEl().classList,
      querySelector: (sel: string) => getEl(sel),
      querySelectorAll: (sel: string) => {
        if (sel === '[data-light]') return lights;
        if (sel === '.rpm-led') return rpmLeds;
        return [];
      },
    };

    let basEnabled = true;
    const hud = new RaceHUD(root as unknown as HTMLElement, {
      onTogglePause: () => {},
      onCycleCamera: () => {},
      onToggleMute: () => false,
      onQuitToMenu: () => {},
      onRestartRace: () => {},
      onTouchSteer: () => {},
      onTouchThrottle: () => {},
      onTouchBrake: () => {},
      onTouchBoost: () => {},
      onTouchPit: () => {},
      onTouchReset: () => {},
      onSetAutoGas: () => {},
      isBasEnabled: () => basEnabled,
      onToggleBas: () => {
        basEnabled = !basEnabled;
        return basEnabled;
      },
    });

    const settings: RaceSettings = {
      mode: 'grand-prix',
      circuitId: 'red-bull-ring',
      playerDriverId: 'yahia',
      yahiaTeamId: 'mercedes',
      laps: 5,
      difficulty: 'medium',
      startingTire: 'soft',
      qualifyingEnabled: false,
      assists: {
        gearbox: 'auto',
        tractionControl: 'full',
        abs: true,
        racingLine: 'full',
        steeringAssist: true,
        brakingAssist: true,
      },
    };
    const race = new RaceManager(settings);
    race.phase = 'racing';
    race.raceClockMs = 82_500;
    const pCar = race.getPlayerCar();
    pCar.lap = 2;
    pCar.currentLapStartMs = 68_000;
    pCar.lastLapMs = 68_000;
    pCar.bestLapMs = 67_500;
    pCar.basActive = true;
    pCar.penaltySeconds = 3;
    race.playerSectorStatuses = ['purple', 'green', 'none'];

    hud.setMobileMode(true);
    hud.show(race, 'chase', false);
    hud.update(race);
    hud.setPaused(true);

    expect(getEl('[data-hud="m-lap-time"]').textContent).toBe('0:14.500');
    expect(getEl('[data-hud="m-best-lap"]').textContent).toBe('PB 1:07.500');
    expect(getEl('[data-hud="m-s1"]').className).toContain('purple');
    expect(getEl('[data-hud="m-s2"]').className).toContain('green');
    expect(getEl('[data-hud="m-bas"]').classList.contains('active')).toBe(true);
    expect(getEl('[data-hud="m-pen"]').classList.contains('hidden')).toBe(false);
    expect(getEl('[data-hud="m-pen"]').textContent).toBe('+3s');
    expect(getEl('[data-hud="bas-badge"]').textContent).toContain('BAS ACTIVE');
    expect(getEl('[data-hud="pause-cur-lap"]').textContent).toBe('0:14.500');
    expect(getEl('[data-hud="pause-last-lap"]').textContent).toBe('1:08.000');
    expect(getEl('[data-hud="pause-best-lap"]').textContent).toBe('1:07.500');
    expect(getEl('[data-hud-btn="pause-bas"]').textContent).toBe('🛑 BAS (Brake Assist): ON');

    // Track Reset pill & emoji camera icon removed; crisp SVG camera/pause buttons & glowing BOX pill active
    expect(root.innerHTML).not.toContain('data-touch="reset"');
    expect(root.innerHTML).not.toContain('📷');
    expect(getEl('[data-hud-btn="cam"]').innerHTML).toContain('hud-btn-icon');
    expect(getEl('[data-hud-btn="cam"]').innerHTML).toContain('CHASE');

    const pitBtn = getEl('[data-touch="pit"]');
    expect(pitBtn.classList.contains('active')).toBe(false);
    expect(pitBtn.textContent).toBe('BOX');

    pCar.pitRequested = true;
    hud.update(race);
    expect(pitBtn.classList.contains('active')).toBe(true);
    expect(pitBtn.textContent).toBe('BOX ●');
  });

  it('enforces Windows Chrome Inter/Segoe typography, CSS polish & clean World Tour title branding', async () => {
    const fs = await loadFs();
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf-8');
    const css = fs.readFileSync(new URL('../ui/styles.css', import.meta.url), 'utf-8');

    expect(html).toContain('family=Inter');
    expect(html).toContain('JetBrains+Mono');
    expect(html).not.toContain('Titillium+Web');
    expect(html).toContain('<title>F1 2026 World Tour</title>');

    expect(css).toContain("--font-display: 'Inter', 'Segoe UI'");
    expect(css).toContain('-webkit-font-smoothing: antialiased');
    expect(css).toContain('.touch-mini-pill.active');
    expect(css).toContain('.country-flag-icon');
  });

  it('keeps home topbar free of personal names and wires podium celebration audio in main.ts', async () => {
    const { menu, getHtml } = createMenuHarness();
    menu.screen = 'home';
    menu.show();
    const homeHtml = getHtml();

    const lockupStart = homeHtml.indexOf('<div class="brand-lockup">');
    const lockupSnippet = homeHtml.slice(lockupStart, lockupStart + 240);
    expect(lockupSnippet).toContain('F1 26');
    expect(lockupSnippet).toContain('2026 World Tour');
    expect(lockupSnippet).not.toContain('Yahia');
    expect(lockupSnippet).not.toContain('Mariam');
    menu.destroy();

    const fs = await loadFs();
    const mainSrc = fs.readFileSync(new URL('../main.ts', import.meta.url), 'utf-8');
    const hudSrc = fs.readFileSync(new URL('../ui/RaceHUD.ts', import.meta.url), 'utf-8');
    const podiumCalls = mainSrc.match(/audio\.playPodiumCelebration\(/g) ?? [];
    expect(podiumCalls.length).toBeGreaterThanOrEqual(2);
    expect(hudSrc).not.toContain('data-touch="reset"');
    expect(hudSrc).not.toContain('this.callbacks.onTouchReset');
  });

  it('launches Grand Prix (with Qualifying), Championship, and Time Trial with accurate RaceSettings', () => {
    const h = createMenuHarness();
    h.menu.screen = 'home';
    h.menu.show();

    const clickModeAndGoSetup = (mode: string) => {
      h.getActionEls().find((el) => el.dataset.action === 'go-mode' && el.dataset.mode === mode)?.click();
      h.findAction('next-setup')?.click();
    };

    // 1. Grand Prix with 1-Lap Qualifying + Silverstone + Pro + Hard
    clickModeAndGoSetup('grand-prix');
    h.getActionEls().find((el) => el.dataset.action === 'pick-circuit' && el.dataset.circuit === 'silverstone')?.click();
    h.findOpt('quali', 'true')?.click();
    h.findOpt('difficulty', 'pro')?.click();
    h.findOpt('tire', 'hard')?.click();
    h.findAction('start-race')?.click();

    expect(h.launchedSessions).toHaveLength(1);
    expect(h.launchedSessions[0].settings).toMatchObject({
      mode: 'grand-prix',
      circuitId: 'silverstone',
      qualifyingEnabled: true,
      difficulty: 'pro',
      startingTire: 'hard',
      assists: { steeringAssist: false, brakingAssist: true },
    });
    expect(h.launchedSessions[0].championship).toBeNull();

    // 2. Time Trial overrides laps=999, tire='soft', qualifying=false
    h.menu.screen = 'home';
    h.menu.show();
    clickModeAndGoSetup('time-trial');
    h.findAction('start-race')?.click();
    expect(h.launchedSessions).toHaveLength(2);
    expect(h.launchedSessions[1].settings).toMatchObject({
      mode: 'time-trial',
      laps: 999,
      startingTire: 'soft',
      qualifyingEnabled: false,
    });

    // 3. 4-Race World Tour Championship always opens at Round 1 ('red-bull-ring') with non-null ChampionshipState
    h.menu.screen = 'home';
    h.menu.show();
    clickModeAndGoSetup('championship');
    h.findAction('start-race')?.click();
    expect(h.launchedSessions).toHaveLength(3);
    expect(h.launchedSessions[2].settings.mode).toBe('championship');
    expect(h.launchedSessions[2].settings.circuitId).toBe('red-bull-ring');
    expect(h.launchedSessions[2].championship).not.toBeNull();

    h.menu.destroy();
  });

  it('renders clean Time Trial results & Full 3D Stage without champagne text and synchronizes header mute', () => {
    const h = createMenuHarness();
    h.menu.screen = 'home';
    h.menu.show();

    expect(h.getHtml()).toContain('🔊 Audio On');
    h.findAction('toggle-mute')?.click();
    expect(h.getMuted()).toBe(true);
    expect(h.getHtml()).toContain('🔇 Muted');

    const ttRace = new RaceManager({
      mode: 'time-trial',
      circuitId: 'monza',
      playerDriverId: 'yahia',
      yahiaTeamId: 'mercedes',
      laps: 999,
      difficulty: 'medium',
      startingTire: 'soft',
      qualifyingEnabled: false,
      assists: {
        gearbox: 'auto',
        tractionControl: 'full',
        abs: true,
        racingLine: 'full',
        steeringAssist: false,
        brakingAssist: true,
      },
    });
    const pCar = ttRace.getPlayerCar();
    pCar.completedLapTimesMs.push(69_200, 68_150);
    pCar.bestLapMs = 68_150;

    h.menu.showResults(ttRace.buildTimeTrialResults(), null, pCar.completedLapTimesMs, true);
    const ttHtml = h.getHtml();
    expect(ttHtml).toContain('TIME TRIAL SESSION COMPLETE');
    expect(ttHtml).toContain('1:08.150');
    expect(ttHtml).toContain('Full 3D Stage');
    expect(ttHtml).not.toContain('📊');
    expect(ttHtml).not.toContain('🎉');
    expect(ttHtml).not.toContain('🥂');
    expect(ttHtml).not.toContain('CHAMPAGNE');

    h.findAction('toggle-podium-cinema')?.click();
    expect(h.getHtml()).toContain('Official Classification');
    expect(h.getHtml()).not.toContain('CHAMPAGNE');

    h.menu.destroy();
  });
});
