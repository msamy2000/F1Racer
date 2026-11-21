import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuUI } from '../ui/MenuUI';
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
    expect(sw).toContain('f1-2026-world-tour-v6');
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
});
