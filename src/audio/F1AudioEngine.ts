import type { CarState } from '../engine/CarPhysics';

type SampleKey = 'onLow' | 'onHigh' | 'offLow' | 'offHigh' | 'gearbox' | 'limiter';

interface SampleLayer {
  source: AudioBufferSourceNode;
  gain: GainNode;
  baseRpm: number;
}

const SAMPLE_URLS: Record<SampleKey, { url: string; baseRpm: number }> = {
  onLow: { url: './assets/audio/engine_on_low.wav', baseRpm: 5300 },
  onHigh: { url: './assets/audio/engine_on_high.wav', baseRpm: 7700 },
  offLow: { url: './assets/audio/engine_off_low.wav', baseRpm: 6900 },
  offHigh: { url: './assets/audio/engine_off_high.wav', baseRpm: 7900 },
  gearbox: { url: './assets/audio/gearbox_whine.wav', baseRpm: 6000 },
  limiter: { url: './assets/audio/rev_limiter.wav', baseRpm: 8800 },
};

export type RadioTone = 'info' | 'alert' | 'celebrate';

export type RadioClipKey =
  | 'grid_start'
  | 'time_trial'
  | 'qualifying_start'
  | 'lights_out'
  | 'track_warning'
  | 'black_white_flag'
  | 'track_penalty'
  | 'box_this_lap'
  | 'final_lap'
  | 'overtake_armed'
  | 'purple_sector'
  | 'personal_best'
  | 'qualifying_done'
  | 'penalty_classified';

/**
 * Maps F1 Race Engineer HUD messages to pre-generated British neural walkie-talkie audio clips.
 * Dynamic numerical callouts (like individual lap times) return null so only the pit-wall chirp plays.
 */
export function resolveRadioClipKey(text?: string): RadioClipKey | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('Lights sequence starting')) return 'grid_start';
  if (trimmed.startsWith('Time Trial live')) return 'time_trial';
  if (trimmed.includes('Qualifying Shootout')) return 'qualifying_start';
  if (trimmed.includes('LIGHTS OUT')) return 'lights_out';
  if (trimmed.startsWith('Track limits exceeded')) return 'track_penalty';
  if (trimmed.includes('Black & White Flag')) return 'black_white_flag';
  if (trimmed.startsWith('Track limits (')) return 'track_warning';
  if (trimmed.includes('Rear tires dropping off')) return 'box_this_lap';
  if (trimmed.startsWith('Final lap!')) return 'final_lap';
  if (trimmed.includes('Overtake Mode ARMED')) return 'overtake_armed';
  if (trimmed.startsWith('Purple Sector')) return 'purple_sector';
  if (trimmed.startsWith('NEW PERSONAL BEST')) return 'personal_best';
  if (trimmed.startsWith('Qualifying complete')) return 'qualifying_done';
  if (trimmed.includes('time penalty applied')) return 'penalty_classified';
  return null;
}

export class F1AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineToneFilter: BiquadFilterNode | null = null;

  // Real sampled multi-RPM racing engine layers (zero sawtooth buzz!)
  private rawBuffers = new Map<SampleKey, ArrayBuffer>();
  private preloadPromise: Promise<void> | null = null;
  private layers: Partial<Record<SampleKey, SampleLayer>> = {};
  private samplesReady = false;
  private decodingSamples = false;

  // Subtle 2026 350kW MGU-K electric whine
  private oscMguk: OscillatorNode | null = null;
  private mgukGain: GainNode | null = null;

  // Tire scrub / off-track gravel & aero wind rush
  private tireGain: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private sharedNoiseBuf: AudioBuffer | null = null;

  private smoothedLoad = 0;
  private prevThrottle = 0;
  private shiftDipUntil = 0;

  // Looping Google Flow Music menu soundtrack (plays across Main Menu, Driver Select & Setup until race starts)
  private menuAudio: HTMLAudioElement | null = null;
  private menuMusicWanted = false;
  private menuFadeTimer: ReturnType<typeof setInterval> | null = null;

  // Pre-generated neural F1 Walkie-Talkie Race Engineer comms state
  private radioDuckActive = false;
  private radioBufferCache = new Map<RadioClipKey, AudioBuffer>();
  private radioLoadInFlight = new Map<RadioClipKey, Promise<AudioBuffer | null>>();
  private activeRadioSource: AudioBufferSourceNode | null = null;
  private activeRadioGain: GainNode | null = null;
  private radioPlaySeq = 0;

  muted = false;
  private initialized = false;
  private active = false;

  private clearMenuFade(): void {
    if (this.menuFadeTimer !== null) {
      globalThis.clearInterval(this.menuFadeTimer);
      this.menuFadeTimer = null;
    }
  }

  private pauseMenuElement(): void {
    this.clearMenuFade();
    const el = this.menuAudio;
    if (!el) return;
    el.muted = true;
    try {
      el.volume = 0;
    } catch {
      // Ignore read-only volume on mobile browsers (e.g. iOS Safari)
    }
    el.pause();
  }

  private ensureMenuAudio(): HTMLAudioElement | null {
    if (this.menuAudio) return this.menuAudio;
    if (typeof Audio === 'undefined') return null;
    const el = new Audio('./assets/audio/menu-theme.mp3');
    el.loop = true;
    el.preload = 'auto';
    try {
      el.volume = 0;
    } catch {
      // Ignore read-only volume
    }
    el.addEventListener?.('playing', () => {
      if (!this.menuMusicWanted || this.muted) {
        this.pauseMenuElement();
      }
    });
    this.menuAudio = el;
    return el;
  }

  private fadeMenuAudioIn(targetVol: number): void {
    const el = this.menuAudio;
    if (!el) return;
    this.clearMenuFade();
    const totalSteps = 8;
    let step = 0;
    this.menuFadeTimer = globalThis.setInterval(() => {
      if (!this.menuMusicWanted || this.muted) {
        this.pauseMenuElement();
        return;
      }
      step += 1;
      const t = Math.min(1, step / totalSteps);
      try {
        el.volume = targetVol * t;
      } catch {
        // Ignore read-only volume on mobile browsers
      }
      if (step >= totalSteps) {
        this.clearMenuFade();
      }
    }, 30);
  }

  /** Play or immediately stop the looping menu soundtrack across all menu screens. */
  setMenuMusicActive(active: boolean): void {
    this.menuMusicWanted = active;
    if (!active || this.muted) {
      this.pauseMenuElement();
      return;
    }

    const el = this.ensureMenuAudio();
    if (!el) return;
    this.clearMenuFade();
    el.muted = false;
    if (el.paused) {
      try {
        el.volume = 0;
      } catch {
        // Ignore read-only volume
      }
    }

    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        if (!this.menuMusicWanted || this.muted) {
          this.pauseMenuElement();
        } else {
          this.fadeMenuAudioIn(0.36);
        }
      }).catch(() => {
        // Browser autoplay policy blocked before first user gesture; unlock() will start it when menuMusicWanted is still true.
      });
    } else if (this.menuMusicWanted && !this.muted) {
      this.fadeMenuAudioIn(0.36);
    } else {
      this.pauseMenuElement();
    }
  }

  /** Begin fetching the real recorded engine WAV loops immediately at app boot. */
  preloadRawSamples(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise;
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return Promise.resolve();
    }

    const entries = Object.entries(SAMPLE_URLS) as [SampleKey, { url: string; baseRpm: number }][];
    this.preloadPromise = Promise.all(
      entries.map(async ([key, cfg]) => {
        try {
          const resp = await fetch(cfg.url);
          if (!resp.ok) return;
          const buf = await resp.arrayBuffer();
          this.rawBuffers.set(key, buf);
        } catch {
          // Graceful no-op if offline/test
        }
      }),
    ).then(() => {
      if (this.ctx && !this.samplesReady && !this.decodingSamples) {
        void this.decodeAndStartLayers();
      }
    });

    return this.preloadPromise;
  }

  unlock(): void {
    void this.preloadRawSamples();
    if (this.menuMusicWanted && !this.muted) {
      this.setMenuMusicActive(true);
    }

    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      if (!this.samplesReady && !this.decodingSamples) {
        void this.decodeAndStartLayers();
      }
      return;
    }

    if (typeof window === 'undefined') return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Gentle master dynamics compressor keeps full-throttle acceleration rich & punchy
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.07;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.44;
    master.connect(comp);
    this.masterGain = master;

    const engGain = ctx.createGain();
    engGain.gain.value = this.active ? 1 : 0;
    engGain.connect(master);
    this.engineGain = engGain;

    // Warm dynamic lowpass tone filter that opens wide under throttle load
    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 6500;
    toneFilter.Q.value = 0.8;
    toneFilter.connect(engGain);
    this.engineToneFilter = toneFilter;

    // Subtle 2026 Electric MGU-K whine (supports ERS boost & braking regen without overpowering engine)
    const oscMguk = ctx.createOscillator();
    oscMguk.type = 'sine';
    oscMguk.frequency.value = 480;
    const mgukGain = ctx.createGain();
    mgukGain.gain.value = 0;
    oscMguk.connect(mgukGain).connect(engGain);
    oscMguk.start();
    this.oscMguk = oscMguk;
    this.mgukGain = mgukGain;

    // Shared white noise buffer for tire scrub, gravel crunch, wind rush & crowd
    const bufLen = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.sharedNoiseBuf = noiseBuf;

    // Tire scrub / off-track gravel crunch
    const tireSrc = ctx.createBufferSource();
    tireSrc.buffer = noiseBuf;
    tireSrc.loop = true;
    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 1150;
    tireFilter.Q.value = 3.0;
    const tireGain = ctx.createGain();
    tireGain.gain.value = 0;
    tireSrc.connect(tireFilter).connect(tireGain).connect(engGain);
    tireSrc.start();
    this.tireFilter = tireFilter;
    this.tireGain = tireGain;

    // High-speed aerodynamic wind rush
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 460;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(engGain);
    windSrc.start();
    this.windGain = windGain;

    this.initialized = true;
    void this.decodeAndStartLayers();
  }

  private async decodeAndStartLayers(): Promise<void> {
    if (!this.ctx || !this.engineToneFilter || this.samplesReady || this.decodingSamples) return;
    this.decodingSamples = true;

    try {
      await this.preloadRawSamples();
      const entries = Object.entries(SAMPLE_URLS) as [SampleKey, { url: string; baseRpm: number }][];
      await Promise.all(
        entries.map(async ([key, cfg]) => {
          const raw = this.rawBuffers.get(key);
          if (!raw || !this.ctx || !this.engineToneFilter) return;
          // Clone slice so decodeAudioData never detaches cached ArrayBuffer
          const decoded = await this.ctx.decodeAudioData(raw.slice(0));
          const source = this.ctx.createBufferSource();
          source.buffer = decoded;
          source.loop = true;
          source.playbackRate.value = 0.7;

          const gain = this.ctx.createGain();
          gain.gain.value = 0;
          source.connect(gain).connect(this.engineToneFilter);
          source.start();

          this.layers[key] = { source, gain, baseRpm: cfg.baseRpm };
        }),
      );
      this.samplesReady = true;
    } finally {
      this.decodingSamples = false;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopActiveRadio();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.44, this.ctx.currentTime, 0.04);
    }
    if (this.menuAudio) {
      if (muted) {
        this.pauseMenuElement();
      } else if (this.menuMusicWanted) {
        this.setMenuMusicActive(true);
      }
    }
  }

  setEngineActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.setMenuMusicActive(false);
    } else {
      this.stopActiveRadio();
    }
    if (this.engineGain && this.ctx) {
      const targetEngineGain = active ? (this.radioDuckActive ? 0.58 : 1) : 0;
      this.engineGain.gain.setTargetAtTime(targetEngineGain, this.ctx.currentTime, 0.08);
    }
  }

  updateFromCar(car: CarState): void {
    if (!this.initialized || !this.ctx || !this.active) return;
    const now = this.ctx.currentTime;

    const rpmNorm = Math.max(0, Math.min(1.12, (car.rpm - 3800) / 9200));
    const speedRatio = Math.min(1, car.speed / 95);

    // Smooth throttle load (~35ms response) so stomping/lifting feels organic & muscular
    const targetLoad = car.throttleApplied;
    this.smoothedLoad += (targetLoad - this.smoothedLoad) * 0.24;
    const load = this.smoothedLoad;

    // Map 2026 F1 RPM (4,000 -> 13,000) into the high-revving screamer sweet spot (3,300 -> 11,200)
    const effectiveRpm = 3300 + rpmNorm * 7900;

    // Equal-power crossfade between low-RPM throat and high-RPM F1 scream
    const rpmCross = Math.max(0, Math.min(1, (effectiveRpm - 4700) / 3600));
    const lowW = Math.cos(rpmCross * Math.PI * 0.5);
    const highW = Math.sin(rpmCross * Math.PI * 0.5);

    // Equal-power crossfade between ON-throttle load and OFF-throttle overrun
    const onW = Math.sin(load * Math.PI * 0.5);
    const offW = Math.cos(load * Math.PI * 0.5);

    // 40ms seamless-shift ignition cut dip on gear changes
    const shiftCut = now < this.shiftDipUntil ? 0.38 : 1.0;

    // Dynamic presence: slightly brighter & louder when pushing hard / boosting
    const presence = (0.72 + load * 0.34 + rpmNorm * 0.14 + (car.boostActive ? 0.08 : 0)) * shiftCut;

    if (this.samplesReady) {
      const updateLayer = (key: SampleKey, targetGain: number, rateOverride?: number) => {
        const layer = this.layers[key];
        if (!layer) return;
        const rate = rateOverride ?? Math.max(0.42, Math.min(2.35, effectiveRpm / layer.baseRpm));
        layer.source.playbackRate.setTargetAtTime(rate, now, 0.014);
        layer.gain.gain.setTargetAtTime(targetGain, now, 0.022);
      };

      updateLayer('onLow', onW * lowW * 0.62 * presence);
      updateLayer('onHigh', onW * highW * 0.72 * presence);
      updateLayer('offLow', offW * lowW * 0.44 * presence);
      updateLayer('offHigh', offW * highW * 0.52 * presence);

      // Straight-cut sequential racing gearbox whine tracks wheel speed
      const gbRate = 0.55 + speedRatio * 1.45;
      const gbVol = speedRatio > 0.08 ? (0.04 + speedRatio * 0.14) * (0.6 + load * 0.4) : 0;
      updateLayer('gearbox', gbVol, gbRate);

      // Real rev limiter stutter when right at redline
      const limiterVol = rpmNorm > 0.96 && load > 0.5 ? 0.36 : 0;
      updateLayer('limiter', limiterVol, 1.05);
    }

    // Tone filter opens dramatically from muffled off-throttle to raw screaming full-throttle exhaust
    const cutoff = 2400 + load * 8200 + rpmNorm * 3800;
    this.engineToneFilter?.frequency.setTargetAtTime(cutoff, now, 0.025);

    // Subtle lift-off exhaust overrun crackle when snapping off high-RPM throttle
    if (this.prevThrottle > 0.75 && targetLoad < 0.18 && car.rpm > 9200 && car.speed > 25) {
      this.playOverrunCrackle();
    }
    this.prevThrottle = targetLoad;

    // Subtle 2026 MGU-K electric motor whine (noticeable on ERS Boost & braking regen)
    const mgukFreq = 460 + speedRatio * 1850 + (car.boostActive ? 420 : 0);
    const isRegen = car.brakeApplied > 0.35 && car.speed > 20;
    const mgukVol = car.boostActive ? 0.055 : isRegen ? 0.032 : speedRatio * 0.012;
    this.oscMguk?.frequency.setTargetAtTime(mgukFreq, now, 0.03);
    this.mgukGain?.gain.setTargetAtTime(mgukVol, now, 0.04);

    // Tire scrub / off-track gravel crunch
    const slipAmt = Math.min(1, Math.abs(car.lateralSpeed) / 3.6 + (car.offTrack ? 0.58 : 0));
    this.tireFilter?.frequency.setTargetAtTime(car.offTrack ? 460 : 1220, now, 0.04);
    this.tireGain?.gain.setTargetAtTime(
      car.speed > 8 ? slipAmt * (car.offTrack ? 0.22 : 0.12) : 0,
      now,
      0.04,
    );

    // High-speed aerodynamic wind & slipstream rush
    const windVol = speedRatio * speedRatio * 0.075 + car.slipstreamStrength * 0.05;
    this.windGain?.gain.setTargetAtTime(windVol, now, 0.05);
  }

  private playOverrunCrackle(): void {
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuf || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.055;
      const src = this.ctx.createBufferSource();
      src.buffer = this.sharedNoiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 340 + i * 110;
      bp.Q.value = 2.0;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.085, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      src.connect(bp).connect(g).connect(this.masterGain);
      src.start(t, Math.random() * 1.2, 0.05);
    }
  }

  playGearShift(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Brief 40ms seamless-shift ignition cut dip for crisp F1 shift snap
    this.shiftDipUntil = now + 0.042;

    if (this.sharedNoiseBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.sharedNoiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 220;
      bp.Q.value = 1.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      src.connect(bp).connect(g).connect(this.masterGain);
      src.start(now, Math.random() * 1.0, 0.055);
    }
  }

  playKerbThud(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.08);
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  playStartLightBeep(isGo: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);
    const dur = isGo ? 0.32 : 0.14;
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private async loadRadioBuffer(key: RadioClipKey): Promise<AudioBuffer | null> {
    const cached = this.radioBufferCache.get(key);
    if (cached) return cached;
    const inflight = this.radioLoadInFlight.get(key);
    if (inflight) return inflight;
    if (!this.ctx || typeof fetch !== 'function') return null;

    const ctx = this.ctx;
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(`./assets/audio/radio/${key}.mp3`);
        if (!res.ok) return null;
        const raw = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(raw);
        this.radioBufferCache.set(key, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.radioLoadInFlight.delete(key);
      }
    })();

    this.radioLoadInFlight.set(key, promise);
    return promise;
  }

  private restoreRadioEngineDuck(): void {
    if (!this.radioDuckActive) return;
    this.radioDuckActive = false;
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(this.active ? 1 : 0, this.ctx.currentTime, 0.09);
    }
  }

  private stopActiveRadio(): void {
    this.radioPlaySeq += 1;
    if (this.activeRadioSource) {
      const src = this.activeRadioSource;
      this.activeRadioSource = null;
      src.onended = null;
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped source nodes
      }
    }
    if (this.activeRadioGain) {
      try {
        this.activeRadioGain.disconnect();
      } catch {
        // Ignore disconnected gain nodes
      }
      this.activeRadioGain = null;
    }
    this.restoreRadioEngineDuck();
  }

  private playTwoToneChirp(tone: RadioTone): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const chirpOsc = ctx.createOscillator();
    const chirpFilter = ctx.createBiquadFilter();
    const chirpGain = ctx.createGain();
    chirpOsc.type = 'square';
    const f1 = tone === 'alert' ? 1460 : tone === 'celebrate' ? 1360 : 1280;
    const f2 = tone === 'alert' ? 1960 : tone === 'celebrate' ? 1820 : 1720;
    chirpOsc.frequency.setValueAtTime(f1, now);
    chirpOsc.frequency.setValueAtTime(f2, now + 0.045);
    chirpFilter.type = 'bandpass';
    chirpFilter.frequency.setValueAtTime(1600, now);
    chirpFilter.Q.setValueAtTime(2.2, now);
    chirpGain.gain.setValueAtTime(0.064, now);
    chirpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.105);
    chirpOsc.connect(chirpFilter).connect(chirpGain).connect(this.masterGain);
    chirpOsc.start(now);
    chirpOsc.stop(now + 0.11);

    if (this.sharedNoiseBuf) {
      const pttClick = ctx.createBufferSource();
      pttClick.buffer = this.sharedNoiseBuf;
      const pttBp = ctx.createBiquadFilter();
      pttBp.type = 'bandpass';
      pttBp.frequency.setValueAtTime(1750, now);
      pttBp.Q.setValueAtTime(2.4, now);
      const pttGain = ctx.createGain();
      pttGain.gain.setValueAtTime(0.075, now);
      pttGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      pttClick.connect(pttBp).connect(pttGain).connect(this.masterGain);
      pttClick.start(now);
      pttClick.stop(now + 0.06);
    }
  }

  private startDecodedRadioBuffer(buffer: AudioBuffer, seq: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) {
      this.restoreRadioEngineDuck();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.96, this.ctx.currentTime);
    src.connect(gain).connect(this.masterGain);
    this.activeRadioSource = src;
    this.activeRadioGain = gain;
    src.onended = () => {
      if (this.activeRadioSource === src) {
        this.activeRadioSource = null;
        this.activeRadioGain = null;
      }
      if (seq === this.radioPlaySeq) {
        this.restoreRadioEngineDuck();
      }
    };
    src.start();
  }

  /**
   * Plays pre-generated neural walkie-talkie pit-wall radio audio for fixed engineer
   * callouts, or falls back to a crisp F1 pit-wall two-tone telemetry chirp for dynamic
   * lap/split updates (never browser/OS robotic speech synthesis).
   */
  playRadioChirp(text?: string, tone: RadioTone = 'info'): void {
    if (this.muted) return;
    this.stopActiveRadio();

    const seq = this.radioPlaySeq;
    const clipKey = resolveRadioClipKey(text);
    if (clipKey && this.initialized && this.ctx && this.masterGain && typeof fetch !== 'undefined') {
      if (this.engineGain && this.active) {
        this.radioDuckActive = true;
        this.engineGain.gain.setTargetAtTime(0.58, this.ctx.currentTime, 0.05);
      }
      const cached = this.radioBufferCache.get(clipKey);
      if (cached) {
        this.startDecodedRadioBuffer(cached, seq);
        return;
      }
      void this.loadRadioBuffer(clipKey).then((buffer) => {
        if (seq !== this.radioPlaySeq || this.muted || !this.initialized || !this.ctx || !this.masterGain) {
          if (seq === this.radioPlaySeq) {
            this.restoreRadioEngineDuck();
          }
          return;
        }
        if (!buffer) {
          this.restoreRadioEngineDuck();
          this.playTwoToneChirp(tone);
          return;
        }
        this.startDecodedRadioBuffer(buffer, seq);
      });
      return;
    }

    this.playTwoToneChirp(tone);
  }

  /** Triumphant F1 Podium Fanfare + Stadium Crowd Swell + Looping Stage Celebration Soundtrack. */
  playPodiumCelebration(isWinner: boolean): void {
    if (this.muted) return;
    this.setMenuMusicActive(true);
    if (!this.initialized || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    // 1. Roaring stadium crowd swell
    if (this.sharedNoiseBuf) {
      const crowdSrc = this.ctx.createBufferSource();
      crowdSrc.buffer = this.sharedNoiseBuf;
      crowdSrc.loop = true;
      const crowdFilter = this.ctx.createBiquadFilter();
      crowdFilter.type = 'bandpass';
      crowdFilter.frequency.value = 880;
      crowdFilter.Q.value = 0.65;
      const crowdGain = this.ctx.createGain();
      crowdGain.gain.setValueAtTime(0.001, now);
      crowdGain.gain.linearRampToValueAtTime(0.18, now + 0.45);
      crowdGain.gain.exponentialRampToValueAtTime(0.001, now + 3.6);
      crowdSrc.connect(crowdFilter).connect(crowdGain).connect(this.masterGain);
      crowdSrc.start(now);
      crowdSrc.stop(now + 3.7);
    }

    // 2. Triumphant F1 Brass-Style Victory Fanfare Arpeggio & Chord
    const notes = isWinner
      ? [
          { f: 261.63, t: 0.0, d: 0.22 },
          { f: 329.63, t: 0.16, d: 0.22 },
          { f: 392.0, t: 0.32, d: 0.24 },
          { f: 523.25, t: 0.52, d: 1.55 },
          { f: 659.25, t: 0.52, d: 1.55 },
          { f: 783.99, t: 0.52, d: 1.55 },
        ]
      : [
          { f: 261.63, t: 0.0, d: 0.22 },
          { f: 329.63, t: 0.18, d: 0.22 },
          { f: 392.0, t: 0.36, d: 1.25 },
          { f: 523.25, t: 0.36, d: 1.25 },
        ];

    for (const n of notes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.f, now + n.t);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1600, now + n.t);
      lp.frequency.exponentialRampToValueAtTime(850, now + n.t + n.d);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, now + n.t);
      g.gain.linearRampToValueAtTime(0.09, now + n.t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.d);
      osc.connect(lp).connect(g).connect(this.masterGain);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.04);
    }
  }
}
