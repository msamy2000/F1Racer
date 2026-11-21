import * as THREE from 'three';
import type { CircuitConfig } from '../data/circuits';

export interface TrackSample {
  index: number;
  s: number; // normalized [0, 1)
  distance: number; // meters from start/finish
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  curvature: number; // signed rad/m in XZ plane (+ = right turn, - = left turn)
  pitch: number; // radians (+ = uphill, - = downhill)
  verticalCurvature: number; // signed rad/m (+ = compression valley, - = crest)
  camber: number; // signed radians (+ = banked toward right apex)
  recommendedSpeed: number; // m/s cornering envelope
  activeAeroZone: boolean;
  sector: 1 | 2 | 3;
  hasLeftKerb: boolean;
  hasRightKerb: boolean;
}

export interface BrakingBoard {
  distanceMeters: 150 | 100 | 50;
  position: THREE.Vector3;
  right: THREE.Vector3;
  tangent: THREE.Vector3;
  side: -1 | 1;
}

export interface TrackProjection {
  sampleIndex: number;
  s: number; // normalized [0, 1)
  distance: number; // meters
  lateralOffset: number; // meters (+ = right of center, - = left)
  headingError: number; // radians
  sample: TrackSample;
}

export const SAMPLE_COUNT = 720;

export function isSInZone(s: number, startS: number, endS: number): boolean {
  const norm = ((s % 1) + 1) % 1;
  if (startS <= endS) {
    return norm >= startS && norm <= endS;
  }
  return norm >= startS || norm <= endS;
}

export class TrackSpline {
  readonly config: CircuitConfig;
  readonly samples: TrackSample[] = [];
  readonly totalLength: number;
  readonly brakingBoards: BrakingBoard[] = [];
  readonly boundsMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  readonly boundsMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  constructor(config: CircuitConfig) {
    this.config = config;

    const rawPoints = config.controlPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const rawCurve = new THREE.CatmullRomCurve3(rawPoints, true, 'catmullrom', 0.45);
    const rawLength = rawCurve.getLength();
    const scaleFactor = config.realLengthMeters / rawLength;

    const scaledPoints = rawPoints.map((p) =>
      new THREE.Vector3(p.x * scaleFactor, p.y * scaleFactor, p.z * scaleFactor),
    );
    const curve = new THREE.CatmullRomCurve3(scaledPoints, true, 'catmullrom', 0.45);
    this.totalLength = curve.getLength();

    const worldUp = new THREE.Vector3(0, 1, 0);
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const u = i / SAMPLE_COUNT;
      const pos = curve.getPointAt(u);
      positions.push(pos);
      this.boundsMin.min(pos);
      this.boundsMax.max(pos);
    }

    const ds = this.totalLength / SAMPLE_COUNT;

    // Build up-stabilized Frenet frames, XZ horizontal curvature, pitch & vertical curvature
    const rawVertCurv: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const prev = positions[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
      const curr = positions[i];
      const next = positions[(i + 1) % SAMPLE_COUNT];

      const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, worldUp);
      if (right.lengthSq() < 1e-6) {
        right.set(1, 0, 0);
      } else {
        right.normalize();
      }
      right.y = 0;
      const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

      // Signed curvature strictly in XZ plane: positive = turning right, negative = turning left
      const pDx = curr.x - prev.x;
      const pDz = curr.z - prev.z;
      const pLenXZ = Math.hypot(pDx, pDz) || 1;
      const tPrevX = pDx / pLenXZ;
      const tPrevZ = pDz / pLenXZ;

      const nDx = next.x - curr.x;
      const nDz = next.z - curr.z;
      const nLenXZ = Math.hypot(nDx, nDz) || 1;
      const tNextX = nDx / nLenXZ;
      const tNextZ = nDz / nLenXZ;

      const crossY = tPrevX * tNextZ - tPrevZ * tNextX;
      const curvature = Math.atan2(crossY, tPrevX * tNextX + tPrevZ * tNextZ) / ds;

      // 3D slope pitch & vertical curvature (+ = compression valley, - = crest)
      const pitch = Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z));
      const pitchPrev = Math.atan2(curr.y - prev.y, pLenXZ);
      const pitchNext = Math.atan2(next.y - curr.y, nLenXZ);
      const vertCurv = (pitchNext - pitchPrev) / ds;
      rawVertCurv.push(vertCurv);

      const s = i / SAMPLE_COUNT;
      const distance = s * this.totalLength;
      const activeAeroZone = config.activeAeroZones.some((z) => isSInZone(s, z.startS, z.endS));
      const sector: 1 | 2 | 3 = s < config.sector1End ? 1 : s < config.sector2End ? 2 : 3;

      this.samples.push({
        index: i,
        s,
        distance,
        position: curr,
        tangent,
        right,
        up,
        curvature,
        pitch,
        verticalCurvature: vertCurv,
        camber: 0,
        recommendedSpeed: 97.5,
        activeAeroZone,
        sector,
        hasLeftKerb: false,
        hasRightKerb: false,
      });
    }

    // Smooth horizontal & vertical curvature with 5-tap circular box filter
    const rawCurv = this.samples.map((smp) => smp.curvature);
    const baseLatGrip = 26.8;
    const aeroLatCoeff = 0.0028; // a_lat(v) = 26.8 + 0.0028 * v^2
    const maxTopSpeed = 97.5; // ~351 km/h

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      let avgCurv = 0;
      let avgVertCurv = 0;
      for (let k = -2; k <= 2; k++) {
        const idx = (i + k + SAMPLE_COUNT) % SAMPLE_COUNT;
        avgCurv += rawCurv[idx];
        avgVertCurv += rawVertCurv[idx];
      }
      avgCurv /= 5;
      avgVertCurv /= 5;
      this.samples[i].curvature = avgCurv;
      this.samples[i].verticalCurvature = avgVertCurv;
      this.samples[i].camber = THREE.MathUtils.clamp(avgCurv * 1.35, -0.055, 0.055);

      const absK = Math.abs(avgCurv);
      const effectiveK = absK - aeroLatCoeff;
      const cornerSpeed = effectiveK > 1e-4 ? Math.sqrt(baseLatGrip / effectiveK) : maxTopSpeed;
      this.samples[i].recommendedSpeed = Math.min(maxTopSpeed, Math.max(19.0, cornerSpeed));
    }

    // Circular backwards braking envelope pass + forward acceleration smoothing
    const maxBrakeDecel = 31.8;
    const maxAccel = 13.5;

    for (let pass = 0; pass < 3; pass++) {
      for (let i = SAMPLE_COUNT - 1; i >= 0; i--) {
        const nextIdx = (i + 1) % SAMPLE_COUNT;
        const vNext = this.samples[nextIdx].recommendedSpeed;
        const slopeDecel = Math.max(20, maxBrakeDecel + 9.81 * Math.sin(this.samples[i].pitch));
        const vAllowed = Math.sqrt(vNext * vNext + 2 * slopeDecel * ds);
        if (vAllowed < this.samples[i].recommendedSpeed) {
          this.samples[i].recommendedSpeed = vAllowed;
        }
      }
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const prevIdx = (i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT;
        const vPrev = this.samples[prevIdx].recommendedSpeed;
        const slopeAccel = Math.max(8, maxAccel - 9.81 * Math.sin(this.samples[i].pitch));
        const vAllowed = Math.sqrt(vPrev * vPrev + 2 * slopeAccel * ds);
        if (vAllowed < this.samples[i].recommendedSpeed) {
          this.samples[i].recommendedSpeed = vAllowed;
        }
      }
    }

    // Determine kerb placement along apex inside + corner exit outside
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const k = this.samples[i].curvature;
      if (Math.abs(k) > 0.009) {
        // Right turn (+k) -> right inside kerb, left exit kerb slightly ahead
        if (k > 0) {
          this.samples[i].hasRightKerb = true;
          this.samples[(i + 6) % SAMPLE_COUNT].hasLeftKerb = true;
        } else {
          this.samples[i].hasLeftKerb = true;
          this.samples[(i + 6) % SAMPLE_COUNT].hasRightKerb = true;
        }
      }
    }

    // Generate 150m / 100m / 50m braking boards ahead of significant braking zones
    this.buildBrakingBoards(ds);
  }

  private buildBrakingBoards(ds: number): void {
    const minDropSamples = Math.round(90 / ds);
    const cooldownSamples = Math.round(240 / ds);
    let lastCornerSample = -cooldownSamples;

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const curr = this.samples[i];
      const prev = this.samples[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
      const next = this.samples[(i + 1) % SAMPLE_COUNT];

      const isSpeedMinimum =
        curr.recommendedSpeed < 56 &&
        curr.recommendedSpeed <= prev.recommendedSpeed &&
        curr.recommendedSpeed <= next.recommendedSpeed;

      if (!isSpeedMinimum) continue;
      if (i - lastCornerSample < cooldownSamples) continue;

      const entryIdx = (i - minDropSamples + SAMPLE_COUNT) % SAMPLE_COUNT;
      const speedDrop = this.samples[entryIdx].recommendedSpeed - curr.recommendedSpeed;
      if (speedDrop < 19) continue;

      lastCornerSample = i;
      const apexIndex = i;
      // Place boards on outside of corner approach
      const boardSide: -1 | 1 = curr.curvature >= 0 ? -1 : 1;

      const distances: (150 | 100 | 50)[] = [150, 100, 50];
      for (const distMeters of distances) {
        const offsetSamples = Math.round((distMeters + 35) / ds);
        const boardIdx = (apexIndex - offsetSamples + SAMPLE_COUNT) % SAMPLE_COUNT;
        const bSample = this.samples[boardIdx];
        const latOffset = boardSide * (this.config.trackWidth * 0.5 + 2.4);
        const pos = bSample.position
          .clone()
          .addScaledVector(bSample.right, latOffset);

        this.brakingBoards.push({
          distanceMeters: distMeters,
          position: pos,
          right: bSample.right.clone(),
          tangent: bSample.tangent.clone(),
          side: boardSide,
        });
      }
    }
  }

  sampleAtIndex(idx: number): TrackSample {
    const wrapped = ((idx % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT;
    return this.samples[wrapped];
  }

  sampleAtS(s: number): TrackSample {
    const norm = ((s % 1) + 1) % 1;
    const fIdx = norm * SAMPLE_COUNT;
    const i0 = Math.floor(fIdx) % SAMPLE_COUNT;
    const i1 = (i0 + 1) % SAMPLE_COUNT;
    const alpha = fIdx - Math.floor(fIdx);

    const a = this.samples[i0];
    const b = this.samples[i1];

    const right = new THREE.Vector3().lerpVectors(a.right, b.right, alpha);
    right.y = 0;
    if (right.lengthSq() < 1e-6) {
      right.set(1, 0, 0);
    } else {
      right.normalize();
    }

    return {
      index: i0,
      s: norm,
      distance: norm * this.totalLength,
      position: new THREE.Vector3().lerpVectors(a.position, b.position, alpha),
      tangent: new THREE.Vector3().lerpVectors(a.tangent, b.tangent, alpha).normalize(),
      right,
      up: new THREE.Vector3().lerpVectors(a.up, b.up, alpha).normalize(),
      curvature: THREE.MathUtils.lerp(a.curvature, b.curvature, alpha),
      pitch: THREE.MathUtils.lerp(a.pitch, b.pitch, alpha),
      verticalCurvature: THREE.MathUtils.lerp(a.verticalCurvature, b.verticalCurvature, alpha),
      camber: THREE.MathUtils.lerp(a.camber, b.camber, alpha),
      recommendedSpeed: THREE.MathUtils.lerp(a.recommendedSpeed, b.recommendedSpeed, alpha),
      activeAeroZone: alpha < 0.5 ? a.activeAeroZone : b.activeAeroZone,
      sector: alpha < 0.5 ? a.sector : b.sector,
      hasLeftKerb: a.hasLeftKerb || b.hasLeftKerb,
      hasRightKerb: a.hasRightKerb || b.hasRightKerb,
    };
  }

  /**
   * Projects world XZ coordinates onto the track spline.
   * Uses a local window around hintIndex when provided, falling back to full scan.
   */
  projectToTrack(x: number, z: number, headingRad: number, hintIndex?: number): TrackProjection {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIndex !== undefined) {
      const windowRadius = 28;
      for (let offset = -windowRadius; offset <= windowRadius; offset++) {
        const idx = (hintIndex + offset + SAMPLE_COUNT) % SAMPLE_COUNT;
        const p = this.samples[idx].position;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
      // Fallback to full scan if car jumped far away from hint
      if (bestDistSq > 1600) {
        bestDistSq = Infinity;
      }
    }

    if (bestDistSq === Infinity) {
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const p = this.samples[i].position;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }

    // Sub-sample refinement along local tangent for smooth s & lateralOffset
    const base = this.samples[bestIdx];
    const relX = x - base.position.x;
    const relZ = z - base.position.z;
    const along = relX * base.tangent.x + relZ * base.tangent.z;
    const dsMeters = this.totalLength / SAMPLE_COUNT;
    const refinedS = (((bestIdx + along / dsMeters) / SAMPLE_COUNT) % 1 + 1) % 1;
    const sample = this.sampleAtS(refinedS);

    const dx = x - sample.position.x;
    const dz = z - sample.position.z;
    const lateralOffset = dx * sample.right.x + dz * sample.right.z;

    const trackHeading = Math.atan2(sample.tangent.x, sample.tangent.z);
    let headingError = headingRad - trackHeading;
    while (headingError > Math.PI) headingError -= Math.PI * 2;
    while (headingError < -Math.PI) headingError += Math.PI * 2;

    return {
      sampleIndex: bestIdx,
      s: refinedS,
      distance: refinedS * this.totalLength,
      lateralOffset,
      headingError,
      sample,
    };
  }

  /**
   * Computes pit-lane world position and lateral offset target for a given s in pit window.
   */
  getPitLaneLateralOffset(s: number): number {
    const normS = ((s % 1) + 1) % 1;
    const entry = this.config.pitEntryS;
    const exit = this.config.pitExitS;
    const side = this.config.pitSide;
    const pitOffset = side * (this.config.trackWidth * 0.5 + 8.5);

    if (!isSInZone(normS, entry, exit)) {
      return 0;
    }

    // Distance into pit zone [0, 1]
    const span = entry <= exit ? exit - entry : 1 - entry + exit;
    const prog =
      normS >= entry
        ? (normS - entry) / span
        : (1 - entry + normS) / span;

    // Smooth entry/exit S-curve
    if (prog < 0.16) {
      const t = prog / 0.16;
      return pitOffset * (t * t * (3 - 2 * t));
    }
    if (prog > 0.84) {
      const t = (1 - prog) / 0.16;
      return pitOffset * (t * t * (3 - 2 * t));
    }
    return pitOffset;
  }

  /**
   * Utility for checking minimum spatial separation between non-adjacent track segments.
   */
  computeMinNonAdjacentSeparationXZ(): number {
    const minIndexGap = Math.round(SAMPLE_COUNT * 0.08);
    let minSep = Infinity;

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const a = this.samples[i].position;
      for (let j = i + minIndexGap; j < SAMPLE_COUNT; j++) {
        const wrapGap = SAMPLE_COUNT - (j - i);
        if (wrapGap < minIndexGap) continue;
        const b = this.samples[j].position;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < minSep) {
          minSep = d;
        }
      }
    }
    return minSep;
  }
}
