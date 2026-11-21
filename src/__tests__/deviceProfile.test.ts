import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectIsMobileUI, isPortraitMobile } from '../ui/DeviceProfile';

describe('DeviceProfile — Adaptive Laptop vs. Mobile Screen & Orientation Detection', () => {
  const setEnv = (opts: {
    width: number;
    height: number;
    ua?: string;
    coarse?: boolean;
    maxTouchPoints?: number;
  }) => {
    vi.stubGlobal('window', {
      innerWidth: opts.width,
      innerHeight: opts.height,
      matchMedia: (q: string) => ({
        matches: q === '(pointer: coarse)' ? Boolean(opts.coarse) : false,
      }),
    });
    vi.stubGlobal('navigator', {
      userAgent: opts.ua ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: opts.maxTouchPoints ?? 0,
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects standard Laptop/Desktop viewport as Laptop UI (false)', () => {
    setEnv({ width: 1440, height: 900, coarse: false, maxTouchPoints: 0 });
    expect(detectIsMobileUI()).toBe(false);
    expect(isPortraitMobile()).toBe(false);
  });

  it('detects Android/iPhone User-Agent in landscape and portrait as Mobile UI', () => {
    setEnv({
      width: 844,
      height: 390,
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      coarse: true,
      maxTouchPoints: 5,
    });
    expect(detectIsMobileUI()).toBe(true);
    expect(isPortraitMobile()).toBe(false);

    setEnv({
      width: 390,
      height: 844,
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      coarse: true,
      maxTouchPoints: 5,
    });
    expect(detectIsMobileUI()).toBe(true);
    expect(isPortraitMobile()).toBe(true);
  });

  it('detects coarse-pointer tablet/phone viewports and narrow windows cleanly', () => {
    setEnv({ width: 932, height: 430, coarse: true, maxTouchPoints: 5 });
    expect(detectIsMobileUI()).toBe(true);

    setEnv({ width: 780, height: 600, coarse: false, maxTouchPoints: 0 });
    expect(detectIsMobileUI()).toBe(true);
    expect(isPortraitMobile()).toBe(false);
  });
});
