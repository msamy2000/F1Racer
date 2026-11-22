import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_DRIVERS } from '../data/teamsAndDrivers';
import { F1_POINTS_TABLE, RaceManager, type RaceSettings } from '../engine/RaceManager';
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

  const showroomCalls: Array<{ driverId: string; teamId: string }> = [];
  const menu = new MenuUI(root as unknown as HTMLElement, {
    onShowroomChanged(driverId, yahiaTeamId) {
      showroomCalls.push({ driverId, teamId: yahiaTeamId });
    },
    onStartSession() {},
    onToggleMute: () => false,
    isMuted: () => false,
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
    expect(sw).toContain('f1-2026-world-tour-v10');
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
    const { menu, findOpt, getHtml } = createMenuHarness();
    menu.screen = 'setup';
    menu.show();
    const setupHtml = getHtml();
    expect(setupHtml).toContain('Easy Drive (Steer) On');
    expect(setupHtml).toContain('Easy Drive Off');
    expect(setupHtml).toContain('BAS On');
    expect(setupHtml).toContain('BAS Off');

    // Decoupled toggle check: turning Easy Drive (steeringAssist) OFF leaves BAS (brakingAssist) ON, and vice versa
    expect(menu.assists.steeringAssist).toBe(true);
    expect(menu.assists.brakingAssist).toBe(true);
    findOpt('steerAssist', 'false')?.click();
    expect(menu.assists.steeringAssist).toBe(false);
    expect(menu.assists.brakingAssist).toBe(true);
    findOpt('brakeAssist', 'false')?.click();
    expect(menu.assists.steeringAssist).toBe(false);
    expect(menu.assists.brakingAssist).toBe(false);
    findOpt('brakeAssist', 'true')?.click();
    expect(menu.assists.steeringAssist).toBe(false);
    expect(menu.assists.brakingAssist).toBe(true);

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
  });
});
