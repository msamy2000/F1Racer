import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../data/circuits';
import {
  ALL_DRIVERS,
  getDriverPortraitPath,
  MARIAM_DRIVER,
  resolveDriverHelmet,
  resolveDriverTeam,
  TEAMS,
  YAHIA_DRIVER,
  type TeamId,
} from '../data/teamsAndDrivers';

const FLEX_TEAM_IDS: TeamId[] = ['mercedes', 'redbull', 'mclaren'];

interface NodeFsSubset {
  existsSync(path: URL): boolean;
  readFileSync(path: URL): Uint8Array;
  statSync(path: URL): { size: number };
}

const loadFs = async (): Promise<NodeFsSubset> => {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
};

describe('2026 F1 Data Integrity — Teams, Drivers, Circuits & Portrait Manifest', () => {
  it('defines all 6 teams with valid hex colors and realistic carPerf bounds', () => {
    const teamList = Object.values(TEAMS);
    expect(teamList.length).toBe(6);
    const hexRe = /^#[0-9A-Fa-f]{6}$/;

    for (const team of teamList) {
      expect(hexRe.test(team.primaryColor)).toBe(true);
      expect(hexRe.test(team.secondaryColor)).toBe(true);
      expect(hexRe.test(team.accentColor)).toBe(true);
      expect(hexRe.test(team.uiColor)).toBe(true);
      expect(team.carPerf).toBeGreaterThanOrEqual(0.92);
      expect(team.carPerf).toBeLessThanOrEqual(1.04);
      expect(team.name.length).toBeGreaterThan(3);
    }
  });

  it('defines 12 unique drivers with unique IDs, numbers, and 3-letter broadcast codes', () => {
    expect(ALL_DRIVERS.length).toBe(12);
    const ids = new Set(ALL_DRIVERS.map((d) => d.id));
    const numbers = new Set(ALL_DRIVERS.map((d) => d.number));
    const codes = new Set(ALL_DRIVERS.map((d) => d.code));

    expect(ids.size).toBe(12);
    expect(numbers.size).toBe(12);
    expect(codes.size).toBe(12);

    for (const d of ALL_DRIVERS) {
      expect(d.code.length).toBe(3);
      expect(d.pace).toBeGreaterThanOrEqual(75);
      expect(d.pace).toBeLessThanOrEqual(100);
      expect(d.name.length).toBeGreaterThan(3);
    }
  });

  it('configures Yahia Samy #17 (SAM) & Mariam Samy #19 (MAR) as Egypt flex stars across Mercedes, Red Bull & McLaren', () => {
    expect(YAHIA_DRIVER.id).toBe('yahia');
    expect(YAHIA_DRIVER.number).toBe(17);
    expect(YAHIA_DRIVER.code).toBe('SAM');
    expect(YAHIA_DRIVER.country).toBe('Egypt');

    expect(MARIAM_DRIVER.id).toBe('mariam');
    expect(MARIAM_DRIVER.number).toBe(19);
    expect(MARIAM_DRIVER.code).toBe('MAR');
    expect(MARIAM_DRIVER.country).toBe('Egypt');

    for (const star of [YAHIA_DRIVER, MARIAM_DRIVER]) {
      for (const tid of FLEX_TEAM_IDS) {
        const team = resolveDriverTeam(star, tid);
        expect(team.id).toBe(tid);
        const helmet = resolveDriverHelmet(star, tid);
        expect(helmet.shell.startsWith('#')).toBe(true);
        expect(helmet.stripe.startsWith('#')).toBe(true);
        expect(helmet.visor.startsWith('#')).toBe(true);
      }
    }
  });

  it('defines all 4 real-world 2026 circuits with valid dimensions, aero zones & pit lanes', () => {
    const circuitList = Object.values(CIRCUITS);
    expect(circuitList.length).toBe(4);
    expect(Object.keys(CIRCUITS).sort()).toEqual([
      'las-vegas',
      'monza',
      'red-bull-ring',
      'silverstone',
    ]);

    for (const c of circuitList) {
      expect(c.realLengthMeters).toBeGreaterThan(4000);
      expect(c.realLengthMeters).toBeLessThan(7000);
      expect(c.trackWidth).toBeGreaterThanOrEqual(12);
      expect(c.trackWidth).toBeLessThanOrEqual(18);
      expect(c.controlPoints.length).toBeGreaterThanOrEqual(64);
      expect(c.activeAeroZones.length).toBeGreaterThanOrEqual(2);
      expect(c.pitEntryS).toBeGreaterThanOrEqual(0);
      expect(c.pitEntryS).toBeLessThan(1);
      expect(c.pitExitS).toBeGreaterThanOrEqual(0);
      expect(c.pitExitS).toBeLessThan(1);
      expect([1, -1]).toContain(c.pitSide);
    }
  });

  it('resolves all 20 unique relative portrait paths cleanly for GitHub Pages base ./', () => {
    const portraitPaths = new Set<string>();
    for (const d of ALL_DRIVERS) {
      if (d.isFlexStar) {
        for (const tid of FLEX_TEAM_IDS) {
          portraitPaths.add(getDriverPortraitPath(d, tid, 'grid'));
        }
        portraitPaths.add(getDriverPortraitPath(d, 'mercedes', 'victory'));
        portraitPaths.add(getDriverPortraitPath(d, 'mercedes', 'podium'));
      } else {
        portraitPaths.add(getDriverPortraitPath(d));
      }
    }
    expect(portraitPaths.size).toBe(20);
    for (const rel of portraitPaths) {
      expect(rel.startsWith('./assets/drivers/')).toBe(true);
      expect(rel.endsWith('.png')).toBe(true);
    }
  });

  it('stores all 20 valid PNG portraits on disk with unified team-suit file sizes (>=250KB) for multi-driver teams', async () => {
    const fs = await loadFs();
    const expectedFiles = [
      'mariam-mercedes.png',
      'mariam-redbull.png',
      'mariam-mclaren.png',
      'mariam-podium.png',
      'mariam-victory.png',
      'yahia-mercedes.png',
      'yahia-redbull.png',
      'yahia-mclaren.png',
      'yahia-podium.png',
      'yahia-victory.png',
      'antonelli.png',
      'russell.png',
      'norris.png',
      'piastri.png',
      'verstappen.png',
      'hadjar.png',
      'hamilton.png',
      'leclerc.png',
      'lawson.png',
      'gasly.png',
    ];
    const multiDriverTeamFiles = new Set([
      'mariam-mercedes.png',
      'mariam-redbull.png',
      'mariam-mclaren.png',
      'yahia-mercedes.png',
      'yahia-redbull.png',
      'yahia-mclaren.png',
      'antonelli.png',
      'russell.png',
      'norris.png',
      'piastri.png',
      'verstappen.png',
      'hadjar.png',
      'hamilton.png',
      'leclerc.png',
    ]);

    for (const file of expectedFiles) {
      const fileUrl = new URL(`../../public/assets/drivers/${file}`, import.meta.url);
      expect(fs.existsSync(fileUrl)).toBe(true);
      const bytes = fs.readFileSync(fileUrl);
      // Verify PNG magic signature 89 50 4E 47 0D 0A 1A 0A
      expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      if (multiDriverTeamFiles.has(file)) {
        expect(fs.statSync(fileUrl).size).toBeGreaterThanOrEqual(250_000);
      }
    }
  });
});
