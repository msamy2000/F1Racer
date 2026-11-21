export interface ControlInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. +1 (right)
  boost: boolean;
  shiftUpPressed: boolean;
  shiftDownPressed: boolean;
  cameraPressed: boolean;
  pitPressed: boolean;
  resetPressed: boolean;
  pausePressed: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private queuedEdge = {
    shiftUp: false,
    shiftDown: false,
    camera: false,
    pit: false,
    reset: false,
    pause: false,
  };

  private steerSmoothed = 0;
  private throttleSmoothed = 0;
  private brakeSmoothed = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
      ].includes(code)
    ) {
      e.preventDefault();
    }

    if (!this.keys.has(code)) {
      if (code === 'KeyE') this.queuedEdge.shiftUp = true;
      if (code === 'KeyQ') this.queuedEdge.shiftDown = true;
      if (code === 'KeyC') this.queuedEdge.camera = true;
      if (code === 'KeyP') this.queuedEdge.pit = true;
      if (code === 'KeyR') this.queuedEdge.reset = true;
      if (code === 'Escape') this.queuedEdge.pause = true;
    }

    this.keys.add(code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  resetContinuous(): void {
    this.steerSmoothed = 0;
    this.throttleSmoothed = 0;
    this.brakeSmoothed = 0;
  }

  /**
   * Samples smoothed keyboard controls tuned for crisp, progressive F1 driving.
   */
  sample(dt: number, speedMps: number): ControlInput {
    const rawThrottle =
      this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const rawBrake =
      this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;
    const rawSteer = right - left;

    // Speed-sensitive steering ramp: brisk in tight hairpins, smooth at 330+ km/h
    const speedRatio = Math.min(1, speedMps / 92);
    const steerInRate = 7.5 - speedRatio * 3.0;
    const steerReturnRate = 11.5;

    if (rawSteer !== 0) {
      const target = rawSteer * (1.0 - speedRatio * 0.24);
      const diff = target - this.steerSmoothed;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), steerInRate * dt);
      this.steerSmoothed += step;
    } else {
      const step = Math.min(Math.abs(this.steerSmoothed), steerReturnRate * dt);
      this.steerSmoothed -= Math.sign(this.steerSmoothed) * step;
    }

    // Progressive throttle & brake modulation so launches and trail-braking feel natural on keys
    const throttleRate = rawThrottle > this.throttleSmoothed ? 6.8 : 11.0;
    this.throttleSmoothed +=
      Math.sign(rawThrottle - this.throttleSmoothed) *
      Math.min(Math.abs(rawThrottle - this.throttleSmoothed), throttleRate * dt);

    const brakeRate = rawBrake > this.brakeSmoothed ? 9.5 : 14.0;
    this.brakeSmoothed +=
      Math.sign(rawBrake - this.brakeSmoothed) *
      Math.min(Math.abs(rawBrake - this.brakeSmoothed), brakeRate * dt);

    const out: ControlInput = {
      throttle: this.throttleSmoothed,
      brake: this.brakeSmoothed,
      steer: this.steerSmoothed,
      boost: this.keys.has('Space'),
      shiftUpPressed: this.queuedEdge.shiftUp,
      shiftDownPressed: this.queuedEdge.shiftDown,
      cameraPressed: this.queuedEdge.camera,
      pitPressed: this.queuedEdge.pit,
      resetPressed: this.queuedEdge.reset,
      pausePressed: this.queuedEdge.pause,
    };

    this.queuedEdge.shiftUp = false;
    this.queuedEdge.shiftDown = false;
    this.queuedEdge.camera = false;
    this.queuedEdge.pit = false;
    this.queuedEdge.reset = false;
    this.queuedEdge.pause = false;

    return out;
  }
}
