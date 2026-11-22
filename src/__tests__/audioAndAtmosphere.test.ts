import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { F1AudioEngine, resolveRadioClipKey, type RadioClipKey } from '../audio/F1AudioEngine';
import {
  compressHdrTextureRadiance,
  HDRI_FILES,
  resolveHdriFilename,
} from '../rendering/SceneManager';

interface NodeFsSubset {
  existsSync(path: URL): boolean;
  readFileSync(path: URL, encoding: 'utf-8'): string;
  statSync(path: URL): { size: number };
}

const loadFs = async (): Promise<NodeFsSubset> => {
  const modId = 'node:fs';
  return (await import(/* @vite-ignore */ modId)) as NodeFsSubset;
};

interface MockAudioRecord {
  paused: boolean;
  muted: boolean;
  loop: boolean;
  preload: string;
  playCalls: number;
  pauseCalls: number;
  emitPlaying: () => void;
  resolvePlay: () => Promise<void>;
}

function installMockAudio(options: { readOnlyVolume?: boolean; deferPlay?: boolean } = {}) {
  let latest: MockAudioRecord | null = null;
  let pendingResolve: (() => void) | null = null;

  class MockAudio {
    paused = true;
    muted = false;
    loop = false;
    preload = '';
    playCalls = 0;
    pauseCalls = 0;
    private listeners = new Map<string, Array<() => void>>();

    constructor(_src?: string) {
      if (options.readOnlyVolume) {
        Object.defineProperty(this, 'volume', {
          get: () => 1.0,
          set: () => {
            // Simulate iOS Safari ignoring JS volume writes (always remains 1.0)
          },
          configurable: true,
        });
      } else {
        let vol = 1.0;
        Object.defineProperty(this, 'volume', {
          get: () => vol,
          set: (v: number) => {
            vol = v;
          },
          configurable: true,
        });
      }

      latest = {
        get paused() {
          return self.paused;
        },
        get muted() {
          return self.muted;
        },
        get loop() {
          return self.loop;
        },
        get preload() {
          return self.preload;
        },
        get playCalls() {
          return self.playCalls;
        },
        get pauseCalls() {
          return self.pauseCalls;
        },
        emitPlaying: () => {
          for (const cb of self.listeners.get('playing') ?? []) cb();
        },
        resolvePlay: async () => {
          if (pendingResolve) {
            const fn = pendingResolve;
            pendingResolve = null;
            fn();
            await Promise.resolve();
          }
        },
      };
      const self = this;
    }

    addEventListener(evt: string, cb: () => void): void {
      const list = this.listeners.get(evt) ?? [];
      list.push(cb);
      this.listeners.set(evt, list);
    }

    play(): Promise<void> {
      this.playCalls += 1;
      this.paused = false;
      if (options.deferPlay) {
        return new Promise<void>((res) => {
          pendingResolve = res;
        });
      }
      return Promise.resolve();
    }

    pause(): void {
      this.pauseCalls += 1;
      this.paused = true;
    }
  }

  vi.stubGlobal('Audio', MockAudio);
  return () => latest!;
}

describe('F1AudioEngine & SceneManager Atmosphere Calibration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stops menu music immediately on race start even when Audio.volume is read-only (iOS Safari)', async () => {
    const getAudio = installMockAudio({ readOnlyVolume: true });
    const engine = new F1AudioEngine();

    engine.setMenuMusicActive(true);
    await Promise.resolve();

    const el = getAudio();
    expect(el.paused).toBe(false);
    expect(el.muted).toBe(false);

    // Stopping music during race must pause and mute immediately without polling .volume
    engine.setMenuMusicActive(false);
    expect(el.paused).toBe(true);
    expect(el.muted).toBe(true);
    expect(el.pauseCalls).toBeGreaterThanOrEqual(1);
  });

  it('aborts an in-flight async play() resolution if race already started', async () => {
    const getAudio = installMockAudio({ readOnlyVolume: true, deferPlay: true });
    const engine = new F1AudioEngine();

    engine.setMenuMusicActive(true);
    const el = getAudio();
    expect(el.playCalls).toBe(1);

    // User taps Start Race while play() promise is still pending
    engine.setMenuMusicActive(false);
    expect(el.paused).toBe(true);

    // When the earlier play() resolves afterwards, engine must immediately re-pause & keep muted
    await el.resolvePlay();
    expect(el.paused).toBe(true);
    expect(el.muted).toBe(true);

    // And if a deferred 'playing' event still fires, the defensive listener pauses it too
    el.emitPlaying();
    expect(el.paused).toBe(true);
  });

  it('never restarts menu music from unlock() during a race, and setEngineActive(true) forces music off', async () => {
    vi.stubGlobal('window', {});
    const getAudio = installMockAudio();
    const engine = new F1AudioEngine();

    engine.setMenuMusicActive(true);
    await Promise.resolve();
    const el = getAudio();

    // Correct startSession order: disable menu music first, then unlock()
    engine.setMenuMusicActive(false);
    const callsAtRaceStart = el.playCalls;
    engine.unlock();
    expect(el.playCalls).toBe(callsAtRaceStart);
    expect(el.paused).toBe(true);

    // Even if somehow playing again, setEngineActive(true) kills menu music
    engine.setMenuMusicActive(true);
    await Promise.resolve();
    expect(el.paused).toBe(false);
    engine.setEngineActive(true);
    expect(el.paused).toBe(true);
    expect(el.muted).toBe(true);

    // Unmuting during an active race keeps menu music paused; unmuting on menu resumes it
    engine.setMuted(true);
    engine.setMuted(false);
    expect(el.paused).toBe(true);

    engine.setMenuMusicActive(true);
    await Promise.resolve();
    expect(el.paused).toBe(false);
  });

  it('compresses extreme HDRI sun spikes in Float32 and HalfFloat textures while preserving sky midtones', () => {
    // 1. Float32 HDR texture (3 pixels: normal sky, Monza peak ~24.5, Alpine peak ~60449.8)
    const fData = new Float32Array([
      0.25, 0.45, 0.72, 1.0,
      24.5, 19.0, 14.0, 1.0,
      60449.8, 52000.0, 41000.0, 1.0,
    ]);
    const floatTex = new THREE.DataTexture(fData, 3, 1, THREE.RGBAFormat, THREE.FloatType);

    compressHdrTextureRadiance(floatTex, 2.0);

    // Sky midtone below knee (0.9) remains untouched
    expect(fData[0]).toBeCloseTo(0.25, 5);
    expect(fData[1]).toBeCloseTo(0.45, 5);
    expect(fData[2]).toBeCloseTo(0.72, 5);

    // Extreme peaks compressed strictly below maxChannel (2.0) while preserving warm hue ratio
    expect(fData[4]).toBeLessThanOrEqual(2.0);
    expect(fData[4]).toBeGreaterThan(fData[6]);
    expect(fData[8]).toBeLessThanOrEqual(2.0);

    // 2. HalfFloat (Uint16Array) HDR texture
    const hData = new Uint16Array([
      THREE.DataUtils.toHalfFloat(0.4),
      THREE.DataUtils.toHalfFloat(0.6),
      THREE.DataUtils.toHalfFloat(0.8),
      THREE.DataUtils.toHalfFloat(1.0),
      THREE.DataUtils.toHalfFloat(450.0),
      THREE.DataUtils.toHalfFloat(300.0),
      THREE.DataUtils.toHalfFloat(180.0),
      THREE.DataUtils.toHalfFloat(1.0),
    ]);
    const halfTex = new THREE.DataTexture(hData, 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);

    compressHdrTextureRadiance(halfTex, 2.0);

    expect(THREE.DataUtils.fromHalfFloat(hData[2])).toBeCloseTo(0.8, 2);
    expect(THREE.DataUtils.fromHalfFloat(hData[4])).toBeLessThanOrEqual(2.0);
    expect(THREE.DataUtils.fromHalfFloat(hData[4])).toBeGreaterThan(
      THREE.DataUtils.fromHalfFloat(hData[6]),
    );
  });

  it('maps british-day cleanly to british-overcast.hdr and verifies all 5 HDRI assets exist on disk', async () => {
    expect(resolveHdriFilename('british-day')).toBe('british-overcast.hdr');
    expect(resolveHdriFilename('golden-park')).toBe('golden-park.hdr');
    expect(resolveHdriFilename('alpine-day')).toBe('alpine-day.hdr');
    expect(resolveHdriFilename('vegas-night')).toBe('vegas-night.hdr');
    expect(resolveHdriFilename('showroom')).toBe('showroom.hdr');

    const fs = await loadFs();
    for (const filename of Object.values(HDRI_FILES)) {
      const hdrUrl = new URL(`../../public/assets/hdri/${filename}`, import.meta.url);
      expect(fs.existsSync(hdrUrl)).toBe(true);
    }
  });

  it('maps all 14 race engineer cues to pre-generated neural walkie-talkie MP3s and skips dynamic lap readouts', async () => {
    const cases: Array<[string, RadioClipKey]> = [
      ['Lights sequence starting — hold throttle cleanly!', 'grid_start'],
      ['Time Trial live — push your lines!', 'time_trial'],
      ['Qualifying Shootout — set a banker lap!', 'qualifying_start'],
      ['LIGHTS OUT AND AWAY WE GO!', 'lights_out'],
      ['Track limits (all 4 wheels off) — Warning 1/3.', 'track_warning'],
      ['Black & White Flag (3/3)! Next full 4-wheel cut = +3s penalty.', 'black_white_flag'],
      ['Track limits exceeded — +3s penalty.', 'track_penalty'],
      ['Rear tires dropping off — pit window open.', 'box_this_lap'],
      ['Final lap! Push everything with Boost on the straights!', 'final_lap'],
      ['Overtake Mode ARMED! +0.5 MJ reserve & full high-speed pull unlocked!', 'overtake_armed'],
      ['Purple Sector 1!', 'purple_sector'],
      ['NEW PERSONAL BEST 1:07.850!', 'personal_best'],
      ['Qualifying complete — P3!', 'qualifying_done'],
      ['+3s time penalty applied — classified P2 (down from P1).', 'penalty_classified'],
    ];

    const keys = cases.map(([msg, expected]) => {
      expect(resolveRadioClipKey(msg)).toBe(expected);
      return expected;
    });
    expect(new Set(keys).size).toBe(14);

    // Dynamic numerical banners play crisp pit-wall telemetry chirp instead of robotic TTS
    expect(resolveRadioClipKey('Lap 1: 1:08.420 • Best: 1:07.910')).toBeNull();
    expect(resolveRadioClipKey('')).toBeNull();
    expect(resolveRadioClipKey(undefined)).toBeNull();

    const fs = await loadFs();
    for (const key of keys) {
      const mp3Url = new URL(`../../public/assets/audio/radio/${key}.mp3`, import.meta.url);
      expect(fs.existsSync(mp3Url)).toBe(true);
      expect(fs.statSync(mp3Url).size).toBeGreaterThan(4000);
    }
  });

  it('never calls browser speechSynthesis for engineer calls and loops celebration soundtrack on podium finish', async () => {
    const getAudio = installMockAudio();
    const synthSpeakSpy = vi.fn();
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [],
      speak: synthSpeakSpy,
      cancel: vi.fn(),
    });

    const engine = new F1AudioEngine();
    engine.playRadioChirp('Track limits (all 4 wheels off) — Warning 1/3.', 'alert');
    engine.playRadioChirp('Lap 1: 1:08.420 • Best: 1:07.910', 'info');
    expect(synthSpeakSpy).not.toHaveBeenCalled();

    // Muted podium finish stays silent and never starts background music
    engine.setMuted(true);
    engine.playPodiumCelebration(true);
    expect(getAudio()).toBeNull();

    // Unmuted podium ceremony starts looping stage celebration soundtrack
    engine.setMuted(false);
    engine.playPodiumCelebration(true);
    await Promise.resolve();
    const audio = getAudio();
    expect(audio).not.toBeNull();
    expect(audio.loop).toBe(true);
    expect(audio.paused).toBe(false);
    expect(audio.playCalls).toBeGreaterThanOrEqual(1);
    expect(synthSpeakSpy).not.toHaveBeenCalled();
  });

  it('matches every fixed RaceManager.emitRadio() template cleanly via resolveRadioClipKey', () => {
    const fixedTemplates: Array<[string, RadioClipKey]> = [
      ['Lights sequence starting at Red Bull Ring. Watch the 5 red lights!', 'grid_start'],
      ['Time Trial live at Autodromo Nazionale Monza. Push for Purple sectors!', 'time_trial'],
      ['1-Lap Qualifying Shootout! Set your fastest lap to earn Pole Position!', 'qualifying_start'],
      ['LIGHTS OUT AND AWAY WE GO!', 'lights_out'],
      ['Track limits (all 4 wheels off) — Warning 1/3.', 'track_warning'],
      ['Track limits (all 4 wheels off) — Warning 2/3.', 'track_warning'],
      ['Black & White Flag (3/3)! Next full 4-wheel cut = +3s penalty.', 'black_white_flag'],
      ['Track limits exceeded (all 4 wheels off) — +3s penalty applied!', 'track_penalty'],
      ['Track limits exceeded (all 4 wheels off) — stay on track!', 'track_penalty'],
      ['Rear tires dropping off — press P to Box this lap!', 'box_this_lap'],
      ['Final lap! Push everything with Boost on the straights!', 'final_lap'],
      ['Overtake Mode ARMED! +0.5 MJ reserve & full high-speed pull unlocked!', 'overtake_armed'],
      ['Purple Sector 2! Fastest on track!', 'purple_sector'],
      ['NEW PERSONAL BEST: 1:07.850! Ghost saved!', 'personal_best'],
      ['Qualifying complete: P1 (1:05.980)! Ready for lights out!', 'qualifying_done'],
      ['+3s time penalty applied — classified P2 (down from P1).', 'penalty_classified'],
    ];

    for (const [msg, key] of fixedTemplates) {
      expect(resolveRadioClipKey(msg)).toBe(key);
    }
    expect(resolveRadioClipKey('Lap 2: 1:09.120 • Best: 1:08.420')).toBeNull();
  });

  it('fetches & caches neural radio MP3s, ducks engine gain, supersedes stale plays, and falls back to chirp on fetch errors', async () => {
    const engineTargetCalls: Array<[number, number, number]> = [];
    const startedSources: Array<{
      started: boolean;
      stopped: boolean;
      onended: (() => void) | null;
      buffer: unknown;
    }> = [];
    const createdOscTypes: Array<{ type: string; freqs: number[] }> = [];

    class MockAudioContext {
      currentTime = 1.0;
      sampleRate = 48000;
      state: 'running' | 'suspended' = 'running';
      destination = {};

      resume = vi.fn().mockResolvedValue(undefined);

      private makeGainNode(isEngine = false) {
        let gainValue = 1;
        return {
          gain: {
            get value() {
              return gainValue;
            },
            set value(v: number) {
              gainValue = v;
            },
            setValueAtTime: vi.fn((v: number) => {
              gainValue = v;
            }),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
            setTargetAtTime: (target: number, startTime: number, tc: number) => {
              if (isEngine) {
                engineTargetCalls.push([target, startTime, tc]);
              }
            },
          },
          connect(dest: unknown) {
            return dest;
          },
          disconnect: vi.fn(),
        };
      }

      private gainCount = 0;

      createGain() {
        this.gainCount += 1;
        // Gain order in F1AudioEngine.unlock(): 1 = masterGain, 2 = engineGain
        return this.makeGainNode(this.gainCount === 2);
      }

      createDynamicsCompressor() {
        return {
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
          connect: (d: unknown) => d,
        };
      }

      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          Q: { value: 0, setValueAtTime: vi.fn() },
          connect: (d: unknown) => d,
        };
      }

      createOscillator() {
        const oscRecord = { type: 'sine', freqs: [] as number[] };
        createdOscTypes.push(oscRecord);
        return {
          get type() {
            return oscRecord.type;
          },
          set type(t: string) {
            oscRecord.type = t;
          },
          frequency: {
            value: 0,
            setValueAtTime: (f: number) => oscRecord.freqs.push(f),
            exponentialRampToValueAtTime: (f: number) => oscRecord.freqs.push(f),
          },
          connect: (d: unknown) => d,
          start: vi.fn(),
          stop: vi.fn(),
        };
      }

      createBuffer(_channels: number, length: number) {
        return {
          getChannelData: () => new Float32Array(length),
        };
      }

      createBufferSource() {
        const rec = {
          buffer: null as unknown,
          loop: false,
          started: false,
          stopped: false,
          onended: null as (() => void) | null,
          connect: (d: unknown) => d,
          disconnect: vi.fn(),
          start: () => {
            rec.started = true;
            startedSources.push(rec);
          },
          stop: () => {
            rec.stopped = true;
          },
        };
        return rec;
      }

      decodeAudioData = vi.fn(async (raw: ArrayBuffer) => ({ byteLength: raw.byteLength }));
    }

    vi.stubGlobal('window', { AudioContext: MockAudioContext });

    const deferredFetch: {
      resolve: ((res: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void) | null;
    } = { resolve: null };
    let deferNextFetch = false;
    const fetchedUrls: string[] = [];

    vi.stubGlobal('fetch', (url: string) => {
      fetchedUrls.push(url);
      if (url.includes('rev_limiter') || url.includes('engine_') || url.includes('gearbox')) {
        return Promise.resolve({ ok: false });
      }
      if (url.includes('box_this_lap')) {
        return Promise.resolve({ ok: false });
      }
      if (deferNextFetch) {
        deferNextFetch = false;
        return new Promise((resolve) => {
          deferredFetch.resolve = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(128),
      });
    });

    const engine = new F1AudioEngine();
    engine.unlock();
    engine.setEngineActive(true);
    engineTargetCalls.length = 0;

    // 1. Fixed callout fetches once, ducks engineGain to 0.58, plays decoded buffer, restores on onended
    engine.playRadioChirp('LIGHTS OUT AND AWAY WE GO!', 'celebrate');
    await vi.waitFor(() =>
      expect(
        startedSources.some((s) => Boolean((s.buffer as { byteLength?: number })?.byteLength)),
      ).toBe(true),
    );

    expect(fetchedUrls.filter((u) => u.includes('radio/lights_out.mp3'))).toHaveLength(1);
    expect(engineTargetCalls.some(([target]) => Math.abs(target - 0.58) < 0.001)).toBe(true);

    const decodedSource = startedSources.find((s) =>
      Boolean((s.buffer as { byteLength?: number })?.byteLength),
    )!;
    decodedSource.onended?.();
    expect(engineTargetCalls.at(-1)?.[0]).toBe(1);

    // 2. Second play of the same cue hits memory cache without re-fetching
    engine.playRadioChirp('LIGHTS OUT AND AWAY WE GO!', 'celebrate');
    expect(fetchedUrls.filter((u) => u.includes('radio/lights_out.mp3'))).toHaveLength(1);

    // 3. Mute interrupts active decoded buffer source cleanly
    const activeSource = startedSources.at(-1)!;
    engine.setMuted(true);
    expect(activeSource.stopped).toBe(true);

    // 4. Mid-flight async superseding prevents stale first clip from playing
    engine.setMuted(false);
    deferNextFetch = true;
    engine.playRadioChirp('Purple Sector 1!', 'celebrate');
    engine.playRadioChirp('Final lap! Push everything with Boost on the straights!', 'celebrate');
    await vi.waitFor(() =>
      expect(fetchedUrls.some((u) => u.includes('radio/final_lap.mp3'))).toBe(true),
    );
    const sourcesBeforeLateResolve = startedSources.length;
    deferredFetch.resolve?.({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(startedSources.length).toBe(sourcesBeforeLateResolve);

    // 5. Failed MP3 fetch falls back cleanly to square-wave telemetry chirp
    createdOscTypes.length = 0;
    engine.playRadioChirp('Rear tires dropping off — press P to Box this lap!', 'alert');
    await vi.waitFor(() =>
      expect(createdOscTypes.some((o) => o.type === 'square' && o.freqs.includes(1460))).toBe(true),
    );
  });

  it('plays brass victory fanfare + stadium crowd without any champagne cork-pop oscillator', () => {
    installMockAudio();
    const oscLog: Array<{ type: string; freqs: number[] }> = [];

    class MockCtx {
      currentTime = 0;
      sampleRate = 48000;
      state = 'running';
      destination = {};
      createGain = () => ({
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: (d: unknown) => d,
        disconnect: vi.fn(),
      });
      createDynamicsCompressor = () => ({
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect: (d: unknown) => d,
      });
      createBiquadFilter = () => ({
        type: 'lowpass',
        frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        Q: { value: 0 },
        connect: (d: unknown) => d,
      });
      createOscillator = () => {
        const rec = { type: 'sine', freqs: [] as number[] };
        oscLog.push(rec);
        return {
          get type() {
            return rec.type;
          },
          set type(t: string) {
            rec.type = t;
          },
          frequency: {
            value: 0,
            setValueAtTime: (f: number) => rec.freqs.push(f),
            exponentialRampToValueAtTime: (f: number) => rec.freqs.push(f),
          },
          connect: (d: unknown) => d,
          start: vi.fn(),
          stop: vi.fn(),
        };
      };
      createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
      createBufferSource = () => ({
        buffer: null,
        loop: false,
        connect: (d: unknown) => d,
        start: vi.fn(),
        stop: vi.fn(),
      });
    }

    vi.stubGlobal('window', { AudioContext: MockCtx });
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }));

    const engine = new F1AudioEngine();
    engine.unlock();
    oscLog.length = 0; // ignore initial MGU-K sine oscillator from unlock()

    engine.playPodiumCelebration(true);
    const fanfareOscs = oscLog.filter((o) => o.type === 'sawtooth');
    const popOscs = oscLog.filter(
      (o) => o.type === 'sine' && (o.freqs.includes(240) || o.freqs.includes(680)),
    );
    expect(fanfareOscs).toHaveLength(6);
    expect(popOscs).toHaveLength(0);
  });

  it('guarantees zero speechSynthesis usage in F1AudioEngine source and verifies all engine/music files on disk', async () => {
    const fs = await loadFs();
    const audioSrc = fs.readFileSync(new URL('../audio/F1AudioEngine.ts', import.meta.url), 'utf-8');
    expect(audioSrc).not.toContain('speechSynthesis');
    expect(audioSrc).not.toContain('SpeechSynthesisUtterance');

    const baseAudioFiles = [
      'engine_on_low.wav',
      'engine_on_high.wav',
      'engine_off_low.wav',
      'engine_off_high.wav',
      'gearbox_whine.wav',
      'rev_limiter.wav',
      'menu-theme.mp3',
    ];
    for (const filename of baseAudioFiles) {
      const url = new URL(`../../public/assets/audio/${filename}`, import.meta.url);
      expect(fs.existsSync(url)).toBe(true);
      expect(fs.statSync(url).size).toBeGreaterThan(10_000);
    }
  });
});
