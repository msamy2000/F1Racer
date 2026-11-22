import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { F1AudioEngine, formatRadioTextForSpeech } from '../audio/F1AudioEngine';
import {
  compressHdrTextureRadiance,
  HDRI_FILES,
  resolveHdriFilename,
} from '../rendering/SceneManager';

interface NodeFsSubset {
  existsSync(path: URL): boolean;
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

  it('normalizes race engineer radio messages into natural F1 pit-wall walkie-talkie speech', () => {
    expect(formatRadioTextForSpeech('Lap 1: 1:08.420 • Best: 1:07.910')).toBe(
      'Lap 1: 1, 08.42 , Best: 1, 07.91',
    );
    expect(
      formatRadioTextForSpeech('Black & White Flag (3/3)! Next full 4-wheel cut = +3s penalty.'),
    ).toBe('Black and White Flag (3 of 3)! Next full 4-wheel cut means plus 3 seconds penalty.');
    expect(
      formatRadioTextForSpeech(
        'Overtake Mode ARMED! +0.5 MJ reserve & full high-speed pull unlocked!',
      ),
    ).toBe('Overtake Mode ARMED! plus 0.5 megajoules reserve and full high-speed pull unlocked!');
    expect(
      formatRadioTextForSpeech('+3s time penalty applied — classified P2 (down from P1).'),
    ).toBe('plus 3 seconds time penalty applied , classified P 2 (down from P 1).');
  });

  it('speaks engineer messages in a walkie-talkie prosody and cancels speech on mute or engine stop', () => {
    vi.useFakeTimers();

    const spokenUtterances: Array<{
      text: string;
      rate: number;
      pitch: number;
      lang: string;
      onend: (() => void) | null;
    }> = [];
    let cancelCalls = 0;

    class MockUtterance {
      text: string;
      lang = 'en-US';
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [{ name: 'Daniel', lang: 'en-GB' }],
      speak: (u: MockUtterance) => {
        spokenUtterances.push(u);
      },
      cancel: () => {
        cancelCalls += 1;
      },
    });

    const engine = new F1AudioEngine();
    engine.playRadioChirp('Track limits (all 4 wheels off) — Warning 1/3.', 'alert');

    // Speech keys 85ms after the opening PTT dual-tone chirp
    vi.advanceTimersByTime(100);
    expect(spokenUtterances).toHaveLength(1);
    expect(spokenUtterances[0].text).toBe('Track limits (all 4 wheels off) , Warning 1 of 3.');
    expect(spokenUtterances[0].lang).toBe('en-GB');
    expect(spokenUtterances[0].rate).toBeCloseTo(1.18, 2);
    expect(spokenUtterances[0].pitch).toBeCloseTo(0.96, 2);

    // Muting immediately cancels active walkie-talkie speech and blocks new speech
    const cancelsBeforeMute = cancelCalls;
    engine.setMuted(true);
    expect(cancelCalls).toBeGreaterThan(cancelsBeforeMute);

    engine.playRadioChirp('Final lap! Push everything with Boost on the straights!', 'info');
    vi.advanceTimersByTime(150);
    expect(spokenUtterances).toHaveLength(1);

    // Unmuting and stopping engine also cancels active transmission
    engine.setMuted(false);
    engine.playRadioChirp('LIGHTS OUT AND AWAY WE GO!', 'celebrate');
    vi.advanceTimersByTime(100);
    expect(spokenUtterances).toHaveLength(2);
    expect(spokenUtterances[1].rate).toBeCloseTo(1.15, 2);

    const cancelsBeforeStop = cancelCalls;
    engine.setEngineActive(false);
    expect(cancelCalls).toBeGreaterThan(cancelsBeforeStop);
  });
});
