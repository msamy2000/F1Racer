import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../engine/InputManager';

type ListenerMap = Record<string, Set<(e: unknown) => void>>;

function createMockWindow() {
  const listeners: ListenerMap = {};
  return {
    listeners,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners[type]) listeners[type] = new Set();
      listeners[type].add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners[type]?.delete(fn);
    },
    dispatch(type: string, event: unknown) {
      listeners[type]?.forEach((fn) => fn(event));
    },
  };
}

describe('InputManager — Keyboard Controls, Smoothing & Edge Triggers', () => {
  let prevWindow: unknown;
  let mockWin: ReturnType<typeof createMockWindow>;
  let input: InputManager;

  beforeEach(() => {
    prevWindow = (globalThis as { window?: unknown }).window;
    mockWin = createMockWindow();
    (globalThis as { window?: unknown }).window = mockWin;
    input = new InputManager();
    input.attach();
  });

  afterEach(() => {
    input.detach();
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  });

  const keyDown = (code: string) => {
    const preventDefault = vi.fn();
    mockWin.dispatch('keydown', { code, preventDefault });
    return preventDefault;
  };

  const keyUp = (code: string) => {
    mockWin.dispatch('keyup', { code });
  };

  it('starts neutral with all continuous and edge outputs at zero/false', () => {
    const s = input.sample(1 / 60, 0);
    expect(s.throttle).toBe(0);
    expect(s.brake).toBe(0);
    expect(s.steer).toBe(0);
    expect(s.boost).toBe(false);
    expect(s.shiftUpPressed).toBe(false);
    expect(s.shiftDownPressed).toBe(false);
    expect(s.cameraPressed).toBe(false);
    expect(s.pitPressed).toBe(false);
    expect(s.resetPressed).toBe(false);
    expect(s.pausePressed).toBe(false);
  });

  it('calls preventDefault on Arrow keys and Space to prevent browser scrolling', () => {
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
      const pd = keyDown(code);
      expect(pd).toHaveBeenCalledTimes(1);
      keyUp(code);
    }
    const pdW = keyDown('KeyW');
    expect(pdW).not.toHaveBeenCalled();
  });

  it('ramps throttle smoothly on KeyW and ArrowUp and decays on release', () => {
    keyDown('KeyW');
    const s1 = input.sample(0.05, 0);
    const s2 = input.sample(0.25, 0);
    expect(s1.throttle).toBeGreaterThan(0);
    expect(s1.throttle).toBeLessThan(1);
    expect(s2.throttle).toBeCloseTo(1, 5);

    keyUp('KeyW');
    const s3 = input.sample(0.05, 0);
    expect(s3.throttle).toBeLessThan(1);
    expect(s3.throttle).toBeGreaterThan(0);

    const s4 = input.sample(0.2, 0);
    expect(s4.throttle).toBe(0);
  });

  it('supports ArrowUp for throttle and KeyS / ArrowDown for braking', () => {
    keyDown('ArrowUp');
    expect(input.sample(0.3, 20).throttle).toBeCloseTo(1, 5);
    keyUp('ArrowUp');

    keyDown('KeyS');
    expect(input.sample(0.3, 20).brake).toBeCloseTo(1, 5);
    keyUp('KeyS');

    keyDown('ArrowDown');
    expect(input.sample(0.3, 20).brake).toBeCloseTo(1, 5);
  });

  it('maps KeyA/ArrowLeft to negative steer and KeyD/ArrowRight to positive steer', () => {
    keyDown('KeyA');
    expect(input.sample(0.3, 10).steer).toBeLessThan(-0.8);
    keyUp('KeyA');
    input.resetContinuous();

    keyDown('KeyD');
    expect(input.sample(0.3, 10).steer).toBeGreaterThan(0.8);
    keyUp('KeyD');
    input.resetContinuous();

    keyDown('ArrowLeft');
    expect(input.sample(0.3, 10).steer).toBeLessThan(-0.8);
    keyUp('ArrowLeft');
    input.resetContinuous();

    keyDown('ArrowRight');
    expect(input.sample(0.3, 10).steer).toBeGreaterThan(0.8);
  });

  it('attenuates maximum steering angle and ramp rate at high speed (330+ km/h)', () => {
    keyDown('KeyD');
    const slowSteer = input.sample(0.08, 10).steer;
    input.resetContinuous();
    const fastSteer = input.sample(0.08, 92).steer;
    expect(fastSteer).toBeLessThan(slowSteer);

    // Steady-state full lock at high speed is attenuated (~0.76)
    const steadyFast = input.sample(0.5, 92).steer;
    expect(steadyFast).toBeLessThan(0.8);
    expect(steadyFast).toBeGreaterThan(0.7);
  });

  it('returns steering smoothly to center when steering keys are released', () => {
    keyDown('KeyD');
    input.sample(0.4, 0);
    keyUp('KeyD');
    const mid = input.sample(0.04, 0).steer;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const done = input.sample(0.2, 0).steer;
    expect(done).toBe(0);
  });

  it('holds boost continuously while Space is pressed and releases on keyup', () => {
    keyDown('Space');
    expect(input.sample(1 / 60, 50).boost).toBe(true);
    expect(input.sample(1 / 60, 50).boost).toBe(true);
    keyUp('Space');
    expect(input.sample(1 / 60, 50).boost).toBe(false);
  });

  it('fires edge-triggered controls exactly once per press and ignores key-repeat', () => {
    keyDown('KeyE');
    keyDown('KeyE'); // repeat while held
    keyDown('KeyQ');
    keyDown('KeyC');
    keyDown('KeyP');
    keyDown('KeyR');
    keyDown('Escape');

    const first = input.sample(1 / 60, 30);
    expect(first.shiftUpPressed).toBe(true);
    expect(first.shiftDownPressed).toBe(true);
    expect(first.cameraPressed).toBe(true);
    expect(first.pitPressed).toBe(true);
    expect(first.resetPressed).toBe(true);
    expect(first.pausePressed).toBe(true);

    // Next sample while still held must NOT re-trigger
    keyDown('KeyC');
    const second = input.sample(1 / 60, 30);
    expect(second.shiftUpPressed).toBe(false);
    expect(second.shiftDownPressed).toBe(false);
    expect(second.cameraPressed).toBe(false);
    expect(second.pitPressed).toBe(false);
    expect(second.resetPressed).toBe(false);
    expect(second.pausePressed).toBe(false);

    // Release and press again triggers cleanly
    keyUp('KeyC');
    keyDown('KeyC');
    expect(input.sample(1 / 60, 30).cameraPressed).toBe(true);
  });

  it('clears all held keys on window blur so controls never stick', () => {
    keyDown('KeyW');
    keyDown('Space');
    expect(input.sample(0.3, 40).boost).toBe(true);

    mockWin.dispatch('blur', {});
    const afterBlur = input.sample(0.3, 40);
    expect(afterBlur.boost).toBe(false);
    expect(afterBlur.throttle).toBe(0);
  });

  it('resets smoothed axes immediately on resetContinuous()', () => {
    keyDown('KeyW');
    keyDown('KeyD');
    input.sample(0.4, 0);
    keyUp('KeyW');
    keyUp('KeyD');

    input.resetContinuous();
    const s = input.sample(0, 0);
    expect(s.throttle).toBe(0);
    expect(s.brake).toBe(0);
    expect(s.steer).toBe(0);
  });

  it('removes all listeners cleanly on detach()', () => {
    input.detach();
    expect(mockWin.listeners.keydown?.size ?? 0).toBe(0);
    expect(mockWin.listeners.keyup?.size ?? 0).toBe(0);
    expect(mockWin.listeners.blur?.size ?? 0).toBe(0);
  });

  it('supports Asphalt-style touch auto-accelerate, steering, boost, braking & edge actions', () => {
    input.autoAccelerate = true;
    const autoGas = input.sample(0.4, 30);
    expect(autoGas.throttle).toBeCloseTo(1, 5);
    expect(autoGas.brake).toBe(0);

    // Pressing touch brake overrides auto-accelerate cleanly
    input.setTouchBrake(true);
    const braking = input.sample(0.4, 30);
    expect(braking.brake).toBeCloseTo(1, 5);
    expect(braking.throttle).toBe(0);

    // Touch steer + boost + pit/reset edge triggers work simultaneously
    input.setTouchBrake(false);
    input.setTouchSteer(-1);
    input.setTouchBoost(true);
    input.triggerTouchEdge('pit');
    input.triggerTouchEdge('reset');
    const action = input.sample(0.3, 20);
    expect(action.steer).toBeLessThan(-0.7);
    expect(action.boost).toBe(true);
    expect(action.pitPressed).toBe(true);
    expect(action.resetPressed).toBe(true);

    // clearTouch() resets all touch holds
    input.clearTouch();
    const cleared = input.sample(0.4, 20);
    expect(cleared.boost).toBe(false);
    expect(cleared.steer).toBe(0);
  });

  it('preserves continuous proportional analog steering values from virtual steering wheel', () => {
    input.setTouchSteer(-0.45);
    const gentleLeft = input.sample(0.6, 25);
    expect(gentleLeft.steer).toBeLessThan(-0.3);
    expect(gentleLeft.steer).toBeGreaterThan(-0.6);

    input.resetContinuous();
    input.setTouchSteer(0.72);
    const mediumRight = input.sample(0.6, 25);
    expect(mediumRight.steer).toBeGreaterThan(0.5);
    expect(mediumRight.steer).toBeLessThan(0.85);

    // Clamps extreme analog inputs cleanly to [-1, +1]
    input.resetContinuous();
    input.setTouchSteer(-2.5);
    const maxLeft = input.sample(0.6, 10);
    expect(maxLeft.steer).toBeGreaterThanOrEqual(-1.0);
    expect(maxLeft.steer).toBeLessThan(-0.9);
  });
});
