import { afterEach, describe, expect, it, vi } from 'vitest';
import { RaceManager, type RaceSettings } from '../engine/RaceManager';
import { RaceHUD } from '../ui/RaceHUD';

interface MockElement {
  className: string;
  textContent: string;
  innerHTML: string;
  style: Record<string, string>;
  classList: {
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    toggle: (token: string, force?: boolean) => void;
    contains: (token: string) => boolean;
  };
  addEventListener: (event: string, fn: (e?: unknown) => void) => void;
  dispatch: (event: string, payload?: unknown) => void;
  click: () => void;
  setPointerCapture: (id: number) => void;
  getBoundingClientRect: () => { left: number; right: number; width: number };
  setRect: (rect: { left: number; right: number; width: number }) => void;
  getContext: () => Record<string, unknown>;
}

function createRaceHudHarness(options: { initialBas?: boolean; initialEasy?: boolean } = {}) {
  const elements = new Map<string, MockElement>();
  const makeEl = (): MockElement => {
    const classes = new Set<string>();
    const listeners = new Map<string, Array<(e?: unknown) => void>>();
    let rect = { left: 0, right: 100, width: 100 };

    return {
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      classList: {
        add: (...tokens) => tokens.forEach((t) => classes.add(t)),
        remove: (...tokens) => tokens.forEach((t) => classes.delete(t)),
        toggle: (token, force) => {
          if (force === undefined) {
            if (classes.has(token)) classes.delete(token);
            else classes.add(token);
          } else if (force) {
            classes.add(token);
          } else {
            classes.delete(token);
          }
        },
        contains: (token) => classes.has(token),
      },
      addEventListener: (event, fn) => {
        const arr = listeners.get(event) ?? [];
        arr.push(fn);
        listeners.set(event, arr);
      },
      dispatch: (event, payload) => {
        for (const fn of listeners.get(event) ?? []) {
          fn(payload);
        }
      },
      click: () => {
        for (const fn of listeners.get('click') ?? []) {
          fn({ preventDefault: () => {} });
        }
      },
      setPointerCapture: () => {},
      getBoundingClientRect: () => rect,
      setRect: (next) => {
        rect = next;
      },
      getContext: () => ({
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        arc: () => {},
        fill: () => {},
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
      }),
    };
  };

  const getEl = (selector: string): MockElement => {
    let existing = elements.get(selector);
    if (!existing) {
      existing = makeEl();
      elements.set(selector, existing);
    }
    return existing;
  };

  const lights = Array.from({ length: 5 }, () => makeEl());
  const rpmLeds = Array.from({ length: 15 }, () => makeEl());
  const root = {
    innerHTML: '',
    classList: makeEl().classList,
    querySelector: (selector: string) => getEl(selector),
    querySelectorAll: (selector: string) => {
      if (selector === '[data-light]') return lights;
      if (selector === '.rpm-led') return rpmLeds;
      return [];
    },
  };

  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });

  let basEnabled = options.initialBas ?? true;
  let easyEnabled = options.initialEasy ?? false;
  const steerLog: number[] = [];
  const brakeLog: boolean[] = [];
  const throttleLog: boolean[] = [];
  const boostLog: boolean[] = [];
  const autoGasLog: boolean[] = [];
  let pitClicks = 0;
  let finishTtClicks = 0;
  let cycleCamClicks = 0;
  let toggleEasyClicks = 0;
  let toggleBasClicks = 0;

  const hud = new RaceHUD(root as unknown as HTMLElement, {
    onTogglePause: () => {},
    onCycleCamera: () => {
      cycleCamClicks += 1;
    },
    onToggleMute: () => false,
    onQuitToMenu: () => {},
    onRestartRace: () => {},
    onTouchSteer: (v) => steerLog.push(v),
    onTouchThrottle: (v) => throttleLog.push(v),
    onTouchBrake: (v) => brakeLog.push(v),
    onTouchBoost: (v) => boostLog.push(v),
    onTouchPit: () => {
      pitClicks += 1;
    },
    onSetAutoGas: (v) => autoGasLog.push(v),
    isEasyAssistsEnabled: () => easyEnabled,
    onToggleEasyAssists: () => {
      toggleEasyClicks += 1;
      easyEnabled = !easyEnabled;
      return easyEnabled;
    },
    isBasEnabled: () => basEnabled,
    onToggleBas: () => {
      toggleBasClicks += 1;
      basEnabled = !basEnabled;
      return basEnabled;
    },
    onFinishTimeTrial: () => {
      finishTtClicks += 1;
    },
  });

  const makeRace = (mode: RaceSettings['mode'] = 'grand-prix') =>
    new RaceManager({
      mode,
      circuitId: 'red-bull-ring',
      playerDriverId: 'yahia',
      yahiaTeamId: 'mercedes',
      laps: mode === 'time-trial' ? 999 : 5,
      difficulty: 'medium',
      startingTire: 'soft',
      qualifyingEnabled: false,
      assists: {
        gearbox: 'auto',
        tractionControl: 'full',
        abs: true,
        racingLine: 'full',
        steeringAssist: easyEnabled,
        brakingAssist: basEnabled,
      },
    });

  return {
    hud,
    root,
    lights,
    storage,
    steerLog,
    brakeLog,
    throttleLog,
    boostLog,
    autoGasLog,
    getPitClicks: () => pitClicks,
    getFinishTtClicks: () => finishTtClicks,
    getCycleCamClicks: () => cycleCamClicks,
    getToggleEasyClicks: () => toggleEasyClicks,
    getToggleBasClicks: () => toggleBasClicks,
    getBasEnabled: () => basEnabled,
    getEasyEnabled: () => easyEnabled,
    getEl,
    makeRace,
  };
}

describe('RaceHUD — Controls, Monochrome Icons, BOX Illumination & Pause Matrix', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lights up the BOX button across pitRequested -> inPitLane -> clear and handles clicks', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');
    race.phase = 'racing';
    const pCar = race.getPlayerCar();

    h.hud.setMobileMode(true);
    h.hud.show(race, 'tv-pod', false);
    h.hud.update(race);
    const pitBtn = h.getEl('[data-touch="pit"]');

    expect(pitBtn.classList.contains('active')).toBe(false);
    expect(pitBtn.textContent).toBe('BOX');

    pCar.pitRequested = true;
    h.hud.update(race);
    expect(pitBtn.classList.contains('active')).toBe(true);
    expect(pitBtn.textContent).toBe('BOX ●');

    pCar.inPitLane = true;
    h.hud.update(race);
    expect(pitBtn.classList.contains('active')).toBe(true);
    expect(pitBtn.textContent).toBe('IN PIT');

    pCar.inPitLane = false;
    pCar.pitRequested = false;
    h.hud.update(race);
    expect(pitBtn.classList.contains('active')).toBe(false);
    expect(pitBtn.textContent).toBe('BOX');

    pitBtn.click();
    expect(h.getPitClicks()).toBe(1);
  });

  it('never renders a mobile Track Reset button anywhere in the HUD template', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');
    h.hud.setMobileMode(true);
    h.hud.show(race, 'chase', false);

    expect(h.root.innerHTML).not.toContain('data-touch="reset"');
    expect(h.root.innerHTML).not.toContain('Track Reset');
  });

  it('uses monochrome inline SVG icons for camera/pause and adapts labels for desktop vs mobile', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');

    // Desktop labels: TV POD / CHASE / COCKPIT + Esc hint
    h.hud.setMobileMode(false);
    h.hud.show(race, 'tv-pod', false);
    const camBtn = h.getEl('[data-hud-btn="cam"]');
    const pauseBtn = h.getEl('[data-hud-btn="pause"]');

    expect(h.root.innerHTML).not.toContain('📷');
    expect(h.root.innerHTML).not.toContain('⏸');
    expect(camBtn.innerHTML).toContain('<svg class="hud-btn-icon"');
    expect(camBtn.innerHTML).toContain('TV POD');
    expect(pauseBtn.innerHTML).toContain('<svg class="hud-btn-icon"');
    expect(pauseBtn.innerHTML).toContain('Esc');

    h.hud.setCameraLabel('cockpit');
    expect(camBtn.innerHTML).toContain('COCKPIT');

    // Mobile short labels: T-CAM / CHASE / HALO without Esc span
    h.hud.setMobileMode(true);
    expect(camBtn.innerHTML).toContain('HALO');
    expect(pauseBtn.innerHTML).toContain('<svg class="hud-btn-icon"');
    expect(pauseBtn.innerHTML).not.toContain('Esc');

    camBtn.click();
    expect(h.getCycleCamClicks()).toBe(1);
  });

  it('keeps Easy Drive and BAS toggles completely decoupled inside the Pause menu', () => {
    const h = createRaceHudHarness({ initialEasy: false, initialBas: true });
    const race = h.makeRace('grand-prix');
    h.hud.show(race, 'tv-pod', false);
    h.hud.setPaused(true);

    const easyBtn = h.getEl('[data-hud-btn="pause-assists"]');
    const basBtn = h.getEl('[data-hud-btn="pause-bas"]');

    expect(easyBtn.textContent).toBe('🧭 Easy Drive Assists: OFF');
    expect(basBtn.textContent).toBe('🛑 BAS (Brake Assist): ON');

    easyBtn.click();
    expect(h.getToggleEasyClicks()).toBe(1);
    expect(h.getToggleBasClicks()).toBe(0);
    expect(h.getEasyEnabled()).toBe(true);
    expect(h.getBasEnabled()).toBe(true);
    expect(easyBtn.textContent).toBe('🧭 Easy Drive Assists: ON');
    expect(basBtn.textContent).toBe('🛑 BAS (Brake Assist): ON');

    basBtn.click();
    expect(h.getToggleBasClicks()).toBe(1);
    expect(h.getEasyEnabled()).toBe(true);
    expect(h.getBasEnabled()).toBe(false);
    expect(basBtn.textContent).toBe('🛑 BAS (Brake Assist): OFF');
  });

  it('shows the Finish Time Trial button only during Time Trial sessions', () => {
    const h = createRaceHudHarness();
    const gpRace = h.makeRace('grand-prix');
    h.hud.show(gpRace, 'tv-pod', false);
    h.hud.setPaused(true);
    expect(h.getEl('[data-hud-btn="finish-tt"]').classList.contains('hidden')).toBe(true);

    const ttRace = h.makeRace('time-trial');
    h.hud.show(ttRace, 'tv-pod', false);
    h.hud.setPaused(true);
    const finishBtn = h.getEl('[data-hud-btn="finish-tt"]');
    expect(finishBtn.classList.contains('hidden')).toBe(false);

    finishBtn.click();
    expect(h.getFinishTtClicks()).toBe(1);
  });

  it('switches mobile steer mode between buttons and analog wheel and persists to localStorage', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');
    h.hud.setMobileMode(true);
    h.hud.show(race, 'tv-pod', false);
    h.hud.setPaused(true);

    const btnPad = h.getEl('[data-touch="steer-buttons"]');
    const wheelPad = h.getEl('[data-touch="steer-wheel"]');
    const modeBtn = h.getEl('[data-hud-btn="pause-steer-mode"]');

    expect(btnPad.classList.contains('hidden')).toBe(false);
    expect(wheelPad.classList.contains('hidden')).toBe(true);

    modeBtn.click();
    expect(h.storage.get('f1_2026_mobile_steer_mode')).toBe('wheel');
    expect(btnPad.classList.contains('hidden')).toBe(true);
    expect(wheelPad.classList.contains('hidden')).toBe(false);

    modeBtn.click();
    expect(h.storage.get('f1_2026_mobile_steer_mode')).toBe('buttons');
    expect(btnPad.classList.contains('hidden')).toBe(false);
    expect(wheelPad.classList.contains('hidden')).toBe(true);
  });

  it('tracks touch steering, brake, and boost hold controls and clears all held inputs on touch disable', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');
    h.hud.setMobileMode(true);
    h.hud.show(race, 'tv-pod', false);

    const steerPad = h.getEl('[data-touch="steer-buttons"]');
    const leftBtn = h.getEl('[data-touch="steer-left"]');
    const rightBtn = h.getEl('[data-touch="steer-right"]');
    const brakeBtn = h.getEl('[data-touch="brake"]');
    const boostBtn = h.getEl('[data-touch="boost"]');

    leftBtn.setRect({ left: 10, right: 80, width: 70 });
    rightBtn.setRect({ left: 95, right: 165, width: 70 });

    steerPad.dispatch('pointerdown', { pointerId: 1, clientX: 40, preventDefault: () => {} });
    expect(leftBtn.classList.contains('pressed')).toBe(true);
    expect(h.steerLog.at(-1)).toBe(-1);

    steerPad.dispatch('pointermove', { pointerId: 1, clientX: 130, preventDefault: () => {} });
    expect(leftBtn.classList.contains('pressed')).toBe(false);
    expect(rightBtn.classList.contains('pressed')).toBe(true);
    expect(h.steerLog.at(-1)).toBe(1);

    steerPad.dispatch('pointerup', { pointerId: 1, clientX: 130, preventDefault: () => {} });
    expect(rightBtn.classList.contains('pressed')).toBe(false);
    expect(h.steerLog.at(-1)).toBe(0);

    brakeBtn.dispatch('pointerdown', { pointerId: 2, preventDefault: () => {} });
    boostBtn.dispatch('pointerdown', { pointerId: 3, preventDefault: () => {} });
    expect(brakeBtn.classList.contains('pressed')).toBe(true);
    expect(boostBtn.classList.contains('pressed')).toBe(true);
    expect(h.brakeLog.at(-1)).toBe(true);
    expect(h.boostLog.at(-1)).toBe(true);

    // Toggling Touch Off clears every held input so nothing sticks
    h.getEl('[data-hud-btn="touch"]').click();
    expect(h.steerLog.at(-1)).toBe(0);
    expect(h.brakeLog.at(-1)).toBe(false);
    expect(h.throttleLog.at(-1)).toBe(false);
    expect(h.boostLog.at(-1)).toBe(false);
    expect(h.autoGasLog.at(-1)).toBe(false);
  });

  it('lights 0..5 start pods during countdown and hides overlay once racing begins', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');
    h.hud.show(race, 'tv-pod', false);

    race.phase = 'countdown';
    race.lightsLit = 3;
    h.hud.update(race);
    expect(h.getEl('[data-hud="start-lights"]').classList.contains('hidden')).toBe(false);
    expect(h.lights.map((l) => l.classList.contains('lit'))).toEqual([true, true, true, false, false]);

    race.lightsLit = 5;
    h.hud.update(race);
    expect(h.lights.every((l) => l.classList.contains('lit'))).toBe(true);

    race.phase = 'racing';
    h.hud.update(race);
    expect(h.getEl('[data-hud="start-lights"]').classList.contains('hidden')).toBe(true);
  });

  it('displays Race Engineer radio toast for 4.2s and hides it cleanly afterwards', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');
    h.hud.show(race, 'tv-pod', false);

    race.phase = 'racing';
    race.raceClockMs = 5000;
    race.emitRadio('LIGHTS OUT AND AWAY WE GO!', 'celebrate');
    h.hud.update(race);

    const toast = h.getEl('[data-hud="radio-toast"]');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.className).toBe('radio-toast celebrate');
    expect(toast.textContent).toBe('📻 ENGINEER: LIGHTS OUT AND AWAY WE GO!');

    race.raceClockMs = 9250;
    h.hud.update(race);
    expect(toast.classList.contains('hidden')).toBe(true);
  });

  it('updates reverse gear, active ERS boost pill, and live timing tower PIT/+3s badges', () => {
    const h = createRaceHudHarness();
    const race = h.makeRace('grand-prix');
    h.hud.setMobileMode(true);
    h.hud.show(race, 'tv-pod', false);

    race.phase = 'racing';
    const pCar = race.getPlayerCar();
    pCar.gear = -1;
    pCar.boostActive = true;
    pCar.ersBattery = 0.85;
    pCar.inPitLane = true;
    pCar.penaltySeconds = 3;

    h.hud.update(race);

    expect(h.getEl('[data-hud="gear"]').textContent).toBe('R');
    expect(h.getEl('[data-hud="m-gear"]').textContent).toBe('R');
    expect(h.getEl('[data-touch="boost-pct"]').textContent).toBe('ACTIVE');
    expect(h.getEl('[data-touch="boost"]').classList.contains('boosting')).toBe(true);
    expect(h.getEl('[data-hud="tower-rows"]').innerHTML).toContain('PIT');
    expect(h.getEl('[data-hud="tower-rows"]').innerHTML).toContain('+3s');
  });
});
