export interface DeviceProfileState {
  isMobile: boolean;
  isPortrait: boolean;
}

/**
 * Detects whether the current viewport / requestor device should receive the
 * Asphalt-inspired minimalist Mobile UI or the full Laptop/Desktop broadcast UI.
 */
export function detectIsMobileUI(): boolean {
  if (typeof window === 'undefined') return false;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;

  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    return true;
  }

  // iPadOS Safari reports Macintosh UA with multi-touch
  if (ua.includes('Macintosh') && maxTouchPoints > 1) {
    return true;
  }

  // Honor primary pointer: coarse only (do not classify Windows touchscreen laptops as mobile)
  const primaryCoarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (primaryCoarse && Math.min(window.innerWidth, window.innerHeight) <= 960) {
    return true;
  }

  return window.innerWidth <= 860;
}

/** Returns true when running in mobile UI mode while held in portrait orientation. */
export function isPortraitMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return detectIsMobileUI() && window.innerHeight > window.innerWidth;
}

export class DeviceProfileManager {
  isMobile = false;
  isPortrait = false;

  private readonly overlayEl: HTMLElement | null = null;
  private readonly listeners = new Set<(state: DeviceProfileState) => void>();
  private portraitDismissed = false;

  private readonly onViewportChange = (): void => {
    this.evaluate(false);
  };

  constructor(uiRoot: HTMLElement | null) {
    if (uiRoot && typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.className = 'rotate-landscape-overlay hidden';
      el.innerHTML = `
        <div class="rotate-card interactive">
          <div class="rotate-phone-icon" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <rect x="20" y="10" width="24" height="44" rx="4" />
              <circle cx="32" cy="47" r="1.5" fill="currentColor" />
              <path d="M10 30c0-10 8-18 18-18" stroke="#00e5ff" />
              <polyline points="14 27 10 31 6 27" stroke="#00e5ff" />
            </svg>
          </div>
          <div class="rotate-title">ROTATE TO LANDSCAPE FOR BEST RACING VIEW</div>
          <p class="rotate-sub">Flip your phone sideways for full-width track visibility &amp; Asphalt thumb controls.</p>
          <button class="btn-secondary" data-action="dismiss-portrait">Continue in Portrait</button>
        </div>
      `;
      const btn = el.querySelector<HTMLButtonElement>('[data-action="dismiss-portrait"]');
      btn?.addEventListener('click', () => {
        this.portraitDismissed = true;
        this.syncOverlay();
      });
      uiRoot.appendChild(el);
      this.overlayEl = el;
    }

    this.evaluate(true);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onViewportChange);
      window.addEventListener('orientationchange', this.onViewportChange);
    }
  }

  subscribe(cb: (state: DeviceProfileState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private syncBodyFlags(): void {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('is-mobile-ui', this.isMobile);
    document.body.dataset.uiMode = this.isMobile ? 'mobile' : 'laptop';
  }

  private syncOverlay(): void {
    if (!this.overlayEl) return;
    const show = this.isMobile && this.isPortrait && !this.portraitDismissed;
    this.overlayEl.classList.toggle('hidden', !show);
  }

  evaluate(forceNotify: boolean): void {
    const nextMobile = detectIsMobileUI();
    const nextPortrait = nextMobile && typeof window !== 'undefined' && window.innerHeight > window.innerWidth;

    if (!nextPortrait) {
      // Reset dismissal once user rotates back to landscape so next portrait warns cleanly
      this.portraitDismissed = false;
    }

    const changed = nextMobile !== this.isMobile || nextPortrait !== this.isPortrait;
    this.isMobile = nextMobile;
    this.isPortrait = nextPortrait;

    this.syncBodyFlags();
    this.syncOverlay();

    if (changed || forceNotify) {
      const snapshot: DeviceProfileState = { isMobile: this.isMobile, isPortrait: this.isPortrait };
      for (const cb of this.listeners) {
        cb(snapshot);
      }
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onViewportChange);
      window.removeEventListener('orientationchange', this.onViewportChange);
    }
    this.listeners.clear();
    this.overlayEl?.remove();
  }
}
