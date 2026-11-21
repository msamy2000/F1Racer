import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isIosMobileBrowser,
  isStandalonePwa,
  requestFullscreenAndLandscape,
} from '../ui/PwaManager';

interface NodeFsSubset {
  existsSync(path: URL): boolean;
  readFileSync(path: URL): Uint8Array;
  readFileSync(path: URL, encoding: 'utf-8'): string;
}

const loadFs = async (): Promise<NodeFsSubset> => {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
};

describe('PwaManager — Fullscreen & Standalone PWA Detection + Manifest Integrity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects standalone and fullscreen PWA display modes cleanly', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({
        matches: q === '(display-mode: standalone)',
      }),
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    expect(isStandalonePwa()).toBe(true);

    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({
        matches: q === '(display-mode: fullscreen)',
      }),
    });
    expect(isStandalonePwa()).toBe(true);

    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0', standalone: true });
    expect(isStandalonePwa()).toBe(true);

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0', standalone: false });
    expect(isStandalonePwa()).toBe(false);
  });

  it('identifies iOS mobile browsers when non-standalone and excludes Android / macOS / standalone', () => {
    const setNav = (ua: string, maxTouchPoints = 0, standalone = false) => {
      vi.stubGlobal('window', {
        matchMedia: () => ({ matches: false }),
      });
      vi.stubGlobal('navigator', {
        userAgent: ua,
        maxTouchPoints,
        standalone,
      });
    };

    setNav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)', 5, false);
    expect(isIosMobileBrowser()).toBe(true);

    setNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5, false);
    expect(isIosMobileBrowser()).toBe(true);

    setNav('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36', 5, false);
    expect(isIosMobileBrowser()).toBe(false);

    setNav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 0, false);
    expect(isIosMobileBrowser()).toBe(false);

    setNav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)', 5, true);
    expect(isIosMobileBrowser()).toBe(false);
  });

  it('requests fullscreen with hidden nav UI and locks landscape orientation gracefully', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const lock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('document', {
      fullscreenElement: null,
      documentElement: { requestFullscreen },
    });
    vi.stubGlobal('screen', {
      orientation: { lock },
    });

    const ok = await requestFullscreenAndLandscape();
    expect(ok).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(lock).toHaveBeenCalledWith('landscape');

    // Remains true even if orientation.lock is disallowed
    const rejectedLock = vi.fn().mockRejectedValue(new Error('NotSupportedError'));
    vi.stubGlobal('screen', {
      orientation: { lock: rejectedLock },
    });
    const okWithoutLock = await requestFullscreenAndLandscape();
    expect(okWithoutLock).toBe(true);

    // Returns false when requestFullscreen rejects
    vi.stubGlobal('document', {
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      },
    });
    const denied = await requestFullscreenAndLandscape();
    expect(denied).toBe(false);
  });

  it('ships a valid subpath-safe fullscreen manifest.webmanifest and PNG icon suite', async () => {
    const fs = await loadFs();
    const manifestUrl = new URL('../../public/manifest.webmanifest', import.meta.url);
    expect(fs.existsSync(manifestUrl)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestUrl, 'utf-8')) as {
      id: string;
      start_url: string;
      scope: string;
      display: string;
      display_override: string[];
      orientation: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };

    expect(manifest.id).toBe('./');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.display_override).toContain('fullscreen');
    expect(manifest.orientation).toBe('landscape');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('./assets/icons/')).toBe(true);
      expect(['any', 'maskable']).toContain(icon.purpose);
      const iconUrl = new URL(`../../public/${icon.src.replace(/^\.\//, '')}`, import.meta.url);
      expect(fs.existsSync(iconUrl)).toBe(true);
      const bytes = fs.readFileSync(iconUrl);
      expect(Array.from(bytes.subarray(0, 8))).toEqual(pngMagic);
    }

    const appleIconUrl = new URL('../../public/assets/icons/apple-touch-icon-180.png', import.meta.url);
    expect(fs.existsSync(appleIconUrl)).toBe(true);
    expect(Array.from(fs.readFileSync(appleIconUrl).subarray(0, 8))).toEqual(pngMagic);
  });

  it('ships a valid service worker skipping range requests and using versioned cache', async () => {
    const fs = await loadFs();
    const swUrl = new URL('../../public/sw.js', import.meta.url);
    expect(fs.existsSync(swUrl)).toBe(true);
    const sw = fs.readFileSync(swUrl, 'utf-8');
    expect(sw).toContain('CACHE_NAME');
    expect(sw).toContain("request.headers.has('range')");
    expect(sw).toContain('caches.match');
    expect(sw).toContain("'./index.html'");
  });
});
