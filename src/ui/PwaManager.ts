export interface PwaState {
  isStandalone: boolean;
  isFullscreen: boolean;
  canRequestFullscreen: boolean;
  canToggleFullscreen: boolean;
  canInstallPrompt: boolean;
  isIosSafari: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** Returns true when launched as an installed PWA (standalone or fullscreen display-mode). */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { standalone?: boolean })
    : undefined;
  if (nav?.standalone === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

/** Returns true when the browser's Fullscreen API is currently active. */
export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDoc;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** Returns true if the browser exposes Fullscreen API on documentElement. */
export function canRequestFullscreen(): boolean {
  if (typeof document === 'undefined' || !document.documentElement) return false;
  const el = document.documentElement as FullscreenEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

/** Returns true for non-installed iOS mobile browsers (where Safari A2HS enables fullscreen PWA). */
export function isIosMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isStandalonePwa()) return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return ua.includes('Macintosh') && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * Requests browser fullscreen with hidden navigation UI and attempts to lock
 * screen orientation to landscape. Safe on unsupported browsers (e.g., iOS Safari).
 */
export async function requestFullscreenAndLandscape(): Promise<boolean> {
  if (typeof document === 'undefined' || !document.documentElement) return false;
  const el = document.documentElement as FullscreenEl;

  let entered = isFullscreenActive();
  if (!entered) {
    try {
      if (typeof el.requestFullscreen === 'function') {
        try {
          await el.requestFullscreen({ navigationUI: 'hide' });
        } catch (err) {
          if (err instanceof TypeError) {
            await el.requestFullscreen();
          } else {
            throw err;
          }
        }
        entered = true;
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        await Promise.resolve(el.webkitRequestFullscreen());
        entered = true;
      }
    } catch {
      entered = isFullscreenActive();
    }
  }

  if (entered && typeof screen !== 'undefined') {
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (orientation: string) => Promise<void> })
      | undefined;
    if (orientation && typeof orientation.lock === 'function') {
      try {
        await orientation.lock('landscape');
      } catch {
        // Orientation lock may be restricted when not installed or unsupported
      }
    }
  }

  return entered || isFullscreenActive();
}

/** Safely exits browser fullscreen and unlocks orientation if permitted. */
export async function exitFullscreenSafe(): Promise<void> {
  if (typeof document === 'undefined') return;
  const doc = document as FullscreenDoc;
  try {
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
    } else if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === 'function') {
      await Promise.resolve(doc.webkitExitFullscreen());
    }
  } catch {
    // Ignore exit failures if already unmounted/exited
  }

  if (typeof screen !== 'undefined') {
    try {
      screen.orientation?.unlock?.();
    } catch {
      // Ignore unsupported unlock
    }
  }
}

export class PwaManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private readonly listeners = new Set<(state: PwaState) => void>();
  private readonly iosGuideEl: HTMLElement | null = null;
  private readonly displayStandaloneMq: MediaQueryList | null = null;
  private readonly displayFullscreenMq: MediaQueryList | null = null;

  private readonly onBeforeInstallPrompt = (e: Event): void => {
    e.preventDefault();
    this.deferredPrompt = e as BeforeInstallPromptEvent;
    this.notify();
  };

  private readonly onAppInstalled = (): void => {
    this.deferredPrompt = null;
    this.hideIosGuide();
    this.notify();
  };

  private readonly onEnvironmentChange = (): void => {
    this.notify();
  };

  constructor(uiRoot: HTMLElement | null) {
    if (uiRoot && typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.className = 'ios-install-overlay hidden';
      el.innerHTML = `
        <div class="ios-install-card interactive" role="dialog" aria-modal="true" aria-label="Install F1 2026 Fullscreen App">
          <div class="ios-install-badge">INSTALL FULLSCREEN APP</div>
          <div class="ios-install-title">Add F1 2026 to Home Screen</div>
          <ol class="ios-install-steps">
            <li>Tap Safari's <strong>Share</strong> button (<strong>&uarr;</strong>) in the toolbar.</li>
            <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
            <li>Open <strong>F1 2026</strong> from your Home Screen for true full-screen mode!</li>
          </ol>
          <button class="btn-primary" data-action="dismiss-ios-guide">Got It</button>
        </div>
      `;
      el.querySelector('[data-action="dismiss-ios-guide"]')?.addEventListener('click', () => {
        this.hideIosGuide();
      });
      el.addEventListener('click', (ev) => {
        if (ev.target === el) {
          this.hideIosGuide();
        }
      });
      uiRoot.appendChild(el);
      this.iosGuideEl = el;
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
      window.addEventListener('appinstalled', this.onAppInstalled);
      if (typeof window.matchMedia === 'function') {
        this.displayStandaloneMq = window.matchMedia('(display-mode: standalone)');
        this.displayFullscreenMq = window.matchMedia('(display-mode: fullscreen)');
        this.displayStandaloneMq.addEventListener?.('change', this.onEnvironmentChange);
        this.displayFullscreenMq.addEventListener?.('change', this.onEnvironmentChange);
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', this.onEnvironmentChange);
      document.addEventListener('webkitfullscreenchange', this.onEnvironmentChange);
    }

    this.syncBodyClasses(this.getState());
  }

  getState(): PwaState {
    const isStandalone = isStandalonePwa();
    const isFullscreen = isFullscreenActive();
    const canReq = canRequestFullscreen();
    return {
      isStandalone,
      isFullscreen,
      canRequestFullscreen: canReq,
      canToggleFullscreen: canReq && !isStandalone,
      canInstallPrompt: this.deferredPrompt !== null && !isStandalone,
      isIosSafari: isIosMobileBrowser(),
    };
  }

  subscribe(cb: (state: PwaState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
    if (!('serviceWorker' in navigator)) return null;
    const proto = window.location?.protocol;
    if (proto !== 'http:' && proto !== 'https:') return null;
    try {
      return await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch {
      return null;
    }
  }

  async enterMobileFullscreen(): Promise<boolean> {
    const state = this.getState();
    if (state.isStandalone || state.isFullscreen) return true;
    const ok = await requestFullscreenAndLandscape();
    this.notify();
    return ok;
  }

  async toggleFullscreen(): Promise<boolean> {
    if (isFullscreenActive()) {
      await exitFullscreenSafe();
      this.notify();
      return false;
    }
    const ok = await requestFullscreenAndLandscape();
    this.notify();
    return ok;
  }

  async promptInstall(): Promise<'accepted' | 'dismissed' | 'ios-guide' | 'unavailable'> {
    if (this.deferredPrompt) {
      const promptEvent = this.deferredPrompt;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        this.deferredPrompt = null;
        this.notify();
        return choice.outcome;
      } catch {
        this.deferredPrompt = null;
        this.notify();
        return 'unavailable';
      }
    }

    if (isIosMobileBrowser()) {
      this.showIosGuide();
      return 'ios-guide';
    }

    return 'unavailable';
  }

  showIosGuide(): void {
    this.iosGuideEl?.classList.remove('hidden');
  }

  hideIosGuide(): void {
    this.iosGuideEl?.classList.add('hidden');
  }

  private syncBodyClasses(state: PwaState): void {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('is-standalone-pwa', state.isStandalone);
    document.body.classList.toggle('is-fullscreen', state.isFullscreen);
  }

  private notify(): void {
    const state = this.getState();
    this.syncBodyClasses(state);
    for (const cb of this.listeners) {
      cb(state);
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', this.onAppInstalled);
      this.displayStandaloneMq?.removeEventListener?.('change', this.onEnvironmentChange);
      this.displayFullscreenMq?.removeEventListener?.('change', this.onEnvironmentChange);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', this.onEnvironmentChange);
      document.removeEventListener('webkitfullscreenchange', this.onEnvironmentChange);
    }
    this.listeners.clear();
    this.iosGuideEl?.remove();
  }
}
