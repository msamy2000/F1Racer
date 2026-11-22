import { describe, expect, it } from 'vitest';
import { CIRCUIT_ORDER, CIRCUITS } from '../data/circuits';
import { ALL_DRIVERS } from '../data/teamsAndDrivers';
import { drawFlagOnCanvas, type FlagIso, renderFlagSvg, resolveFlagIso } from '../ui/flagIcons';

interface NodeFsSubset {
  readFileSync(path: URL, encoding: 'utf-8'): string;
}

const loadFs = async (): Promise<NodeFsSubset> => {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
};

const ALL_FLAG_CASES: Array<[string, FlagIso]> = [
  ['🇪🇬', 'EG'],
  ['🇮🇹', 'IT'],
  ['🇳🇱', 'NL'],
  ['🇬🇧', 'GB'],
  ['🇦🇺', 'AU'],
  ['🇫🇷', 'FR'],
  ['🇲🇨', 'MC'],
  ['🇳🇿', 'NZ'],
  ['🇦🇹', 'AT'],
  ['🇺🇸', 'US'],
];

const REGIONAL_INDICATOR_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/u;

describe('Country Flag Cross-Platform Rendering (Windows Chrome SVG & Canvas)', () => {
  it('resolves all 10 regional-indicator emoji flags and normalized ISO codes', () => {
    for (const [emoji, expected] of ALL_FLAG_CASES) {
      expect(resolveFlagIso(emoji)).toBe(expected);
      expect(resolveFlagIso(`  ${emoji}  `)).toBe(expected);
      expect(resolveFlagIso(expected)).toBe(expected);
      expect(resolveFlagIso(expected.toLowerCase())).toBe(expected);
      expect(resolveFlagIso(` ${expected.toLowerCase()} `)).toBe(expected);
    }

    expect(resolveFlagIso('')).toBeNull();
    expect(resolveFlagIso('XX')).toBeNull();
    expect(resolveFlagIso('🏁')).toBeNull();
  });

  it('renders crisp inline SVG icons for every driver and circuit without raw Unicode flags', () => {
    for (const driver of ALL_DRIVERS) {
      const svg = renderFlagSvg(driver.flag);
      const iso = resolveFlagIso(driver.flag);
      expect(iso).not.toBeNull();
      expect(svg).toContain(`<svg class="country-flag-icon" data-flag="${iso}"`);
      expect(svg).toContain('role="img"');
      expect(svg).toContain(`aria-label="${iso} flag"`);
      expect(svg).not.toMatch(REGIONAL_INDICATOR_RE);
    }

    for (const cid of CIRCUIT_ORDER) {
      const circuit = CIRCUITS[cid];
      const svg = renderFlagSvg(circuit.flag);
      const iso = resolveFlagIso(circuit.flag);
      expect(iso).not.toBeNull();
      expect(svg).toContain(`<svg class="country-flag-icon" data-flag="${iso}"`);
      expect(svg).not.toMatch(REGIONAL_INDICATOR_RE);
    }
  });

  it('preserves unrecognized flag inputs unchanged when no ISO icon matches', () => {
    expect(renderFlagSvg('ZZ')).toBe('ZZ');
    expect(renderFlagSvg('CUSTOM')).toBe('CUSTOM');
  });

  it('draws all 10 country flags safely onto a headless 2D canvas', () => {
    for (const [, iso] of ALL_FLAG_CASES) {
      let fillRectCalls = 0;
      let strokeRectCalls = 0;
      let arcCalls = 0;
      const ctx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        fillRect: () => {
          fillRectCalls += 1;
        },
        strokeRect: () => {
          strokeRectCalls += 1;
        },
        beginPath: () => {},
        arc: () => {
          arcCalls += 1;
        },
        fill: () => {},
      } as unknown as CanvasRenderingContext2D;

      drawFlagOnCanvas(ctx, iso, 10, 20, 48, 32);
      expect(fillRectCalls).toBeGreaterThanOrEqual(2);
      expect(strokeRectCalls).toBe(1);
      if (iso === 'AU' || iso === 'NZ') {
        expect(arcCalls).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('no-ops gracefully on 2D canvas when given an unknown flag code', () => {
    let drawCalls = 0;
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      fillRect: () => {
        drawCalls += 1;
      },
      strokeRect: () => {
        drawCalls += 1;
      },
      beginPath: () => {
        drawCalls += 1;
      },
      arc: () => {
        drawCalls += 1;
      },
      fill: () => {
        drawCalls += 1;
      },
    } as unknown as CanvasRenderingContext2D;

    drawFlagOnCanvas(ctx, 'XX', 0, 0, 24, 16);
    expect(drawCalls).toBe(0);
  });

  it('ensures MenuUI.ts and RaceHUD.ts never emit bare Windows-broken Unicode flag emojis', async () => {
    const fs = await loadFs();
    const menuSrc = fs.readFileSync(new URL('../ui/MenuUI.ts', import.meta.url), 'utf-8');
    const hudSrc = fs.readFileSync(new URL('../ui/RaceHUD.ts', import.meta.url), 'utf-8');
    expect(menuSrc).not.toMatch(REGIONAL_INDICATOR_RE);
    expect(hudSrc).not.toMatch(REGIONAL_INDICATOR_RE);
  });
});
