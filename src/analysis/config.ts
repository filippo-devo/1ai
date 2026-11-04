/**
 * ALL detector parameters live here.
 *
 * IMPORTANT: these are WORKING PARAMETERS OF A DETECTOR, not medical norms and not a
 * validated technique standard. They are starting points to be tuned on labelled
 * recordings (see scripts/evaluate and README "Strojenie progów"). Any change of a
 * threshold or of how a metric is measured must bump DETECTOR_VERSION and be
 * re-validated on the test split of the recordings.
 */

export const DETECTOR_VERSION = 'v2.1-2026-11-04';

export type ExerciseId = 'squat' | 'plank' | 'pushup' | 'bench' | 'pullup' | 'abs' | 'jumprope';
export type VariantId = 'standard' | 'knees' | 'front' | 'crunch' | 'situp' | 'strict' | 'basic';

export const EXERCISE_IDS: ExerciseId[] = ['squat', 'plank', 'pushup', 'bench', 'pullup', 'abs', 'jumprope'];

/**
 * Minimum keypoint score for a point to be used. Scores of different models are not
 * comparable: MediaPipe reports "visibility" (0.7 is a common starting point),
 * MoveNet reports a heatmap confidence that is typically 0.3–0.8 for visible joints.
 * A threshold of 0.7 does NOT mean 70% angle accuracy.
 */
export const VISIBILITY: Record<'mediapipe' | 'movenet', number> = {
  mediapipe: 0.7,
  movenet: 0.3,
};

/**
 * Lower thresholds for the legs (hips, knees, ankles, heels, toes). MediaPipe reports
 * clearly lower "visibility" for legs than for the upper body (lower frame edge, the far
 * leg in profile, dark trousers) even when they are plainly in the picture; with 0.7 the
 * legs were dropped too often and the person was "acquired" slowly.
 */
export const LEG_VISIBILITY: Record<'mediapipe' | 'movenet', number> = {
  mediapipe: 0.5,
  movenet: 0.25,
};

/** Points closer than this (px) define no direction: angles become unavailable. */
export const MIN_SEGMENT_PX = 2;

export const FILTER = {
  /** One Euro filter for angles (deg), driven by real timestamps. */
  angle: { minCutoff: 1.5, beta: 0.02, dCutoff: 1.0 },
  /** One Euro filter for normalized positions (fractions of a body segment). */
  position: { minCutoff: 1.5, beta: 0.5, dCutoff: 1.0 },
};

export const HINTS = {
  /** A posture deviation must persist this long before a hint is shown (not used by rep detection). */
  postureMs: 700,
  /** A shown hint stays at least this long (avoid flicker). */
  minDisplayMs: 1500,
  /** Below this share of frames with all required points, ask to fix the phone setup first. */
  minCoverageForTechniqueHints: 0.6,
};

/**
 * Cyclic (repetition) detector parameters.
 * direction 'decrease': the driving angle is LARGE at rest (extension) and gets smaller
 * toward the target (squat/push-up/bench/pull-up). 'increase': small at rest, larger at
 * the target (abs: trunk elevation).
 */
export interface CyclicConfig {
  direction: 'decrease' | 'increase';
  /** 'absolute' thresholds or 'relative' to the calibrated rest value (crunch). */
  mode: 'absolute' | 'relative';
  /** Rest (start/top) entered when the angle passes restEnter… */
  restEnter: number;
  /** …and left when it passes restExit (hysteresis). */
  restExit: number;
  /** Default range target (user/trainer can change it, see targetOptions). */
  target: number;
  targetOptions: number[];
  /** Minimum excursion from rest for a movement to count as a cycle at all (deg). */
  minAmplitude: number;
  /** The amplitude must also exceed noiseFactor × calibrated angle noise (std). */
  noiseFactor: number;
  /** A movement back by this many degrees confirms the extreme (no pause needed). */
  reversal: number;
  /** Cycles faster than this are rejected as noise; slower than maxCycleMs are abandoned. */
  minCycleMs: number;
  maxCycleMs: number;
  /** A data gap longer than this inside a cycle makes the cycle non-evaluable. */
  maxGapMs: number;
  /** Required points missing this long => TRACKING_LOST. */
  lostAfterMs: number;
  /** Time at rest (with posture OK) before READY. */
  readyHoldMs: number;
  /** READY additionally requires the rest angle to be stable: std ≤ this (deg) during readyHoldMs. */
  readyMaxStd?: number;
  /** Calibration may lower restEnter to (measured extension − margin), not below minRestEnter. */
  calibMargin: number;
  minRestEnter: number;
  /** Calibration accepts the start position only beyond this value. */
  calibStart: number;
}

const strength = {
  noiseFactor: 4,
  reversal: 8,
  minCycleMs: 400,
  maxCycleMs: 20000,
  maxGapMs: 250,
  lostAfterMs: 500,
  readyHoldMs: 250,
  calibMargin: 8,
};

export const CYCLIC: Record<string, CyclicConfig> = {
  /** Squat: knee (hip–knee–ankle). Top ≥165° and hips back to standing; default target ≤100°. */
  'squat/standard': {
    ...strength,
    direction: 'decrease',
    mode: 'absolute',
    restEnter: 165,
    restExit: 155,
    target: 100,
    targetOptions: [110, 100, 90, 80, 70],
    minAmplitude: 25,
    minRestEnter: 150,
    calibStart: 150,
  },
  /** Push-up: elbow; target ≤100° supported by the shoulders descending. */
  'pushup/standard': {
    ...strength,
    direction: 'decrease',
    mode: 'absolute',
    restEnter: 165,
    restExit: 155,
    target: 100,
    targetOptions: [110, 100, 90, 80],
    minAmplitude: 25,
    minCycleMs: 350,
    minRestEnter: 150,
    calibStart: 145,
  },
  /**
   * Push-up seen FROM THE FRONT (phone on the floor in front of the head). The elbow angle
   * is foreshortened in this view, so the driving value is an EQUIVALENT elbow angle
   * computed from how far the shoulders are above the hands relative to the straight-arm
   * height measured at the top (see metrics.ts). Thresholds match the side view.
   */
  'pushup/front': {
    ...strength,
    direction: 'decrease',
    mode: 'absolute',
    restEnter: 160,
    restExit: 150,
    target: 100,
    targetOptions: [110, 100, 90, 80],
    minAmplitude: 25,
    minCycleMs: 350,
    minRestEnter: 145,
    calibStart: 140,
  },
  'pushup/knees': {
    ...strength,
    direction: 'decrease',
    mode: 'absolute',
    restEnter: 165,
    restExit: 155,
    target: 100,
    targetOptions: [110, 100, 90, 80],
    minAmplitude: 25,
    minCycleMs: 350,
    minRestEnter: 150,
    calibStart: 145,
  },
  /** Bench press: elbow; individual bottom (default ≤100°); READY only after a stable lockout. */
  'bench/standard': {
    ...strength,
    direction: 'decrease',
    mode: 'absolute',
    restEnter: 165,
    restExit: 155,
    target: 100,
    targetOptions: [110, 100, 90, 80, 70],
    minAmplitude: 25,
    minCycleMs: 500,
    readyHoldMs: 1000,
    readyMaxStd: 3,
    minRestEnter: 150,
    calibStart: 145,
  },
  /** Strict pull-up: elbow; bottom ≥160°, top ≤90° with the shoulders rising. */
  'pullup/strict': {
    ...strength,
    direction: 'decrease',
    mode: 'absolute',
    restEnter: 160,
    restExit: 150,
    target: 90,
    targetOptions: [100, 90, 80, 70],
    minAmplitude: 30,
    minCycleMs: 600,
    minRestEnter: 145,
    calibStart: 140,
  },
  /** Crunch: trunk (hip→shoulder) elevation relative to the calibrated rest; target +20°. */
  'abs/crunch': {
    ...strength,
    direction: 'increase',
    mode: 'relative',
    restEnter: 6,
    restExit: 10,
    target: 20,
    targetOptions: [15, 20, 25, 30],
    minAmplitude: 10,
    noiseFactor: 4,
    reversal: 4,
    minCycleMs: 400,
    minRestEnter: 6,
    calibStart: 0,
  },
  /** Sit-up: absolute trunk elevation vs the floor; top ≥60°. */
  'abs/situp': {
    ...strength,
    direction: 'increase',
    mode: 'absolute',
    restEnter: 25,
    restExit: 35,
    target: 60,
    targetOptions: [60, 70, 80],
    minAmplitude: 30,
    minCycleMs: 400,
    minRestEnter: 25,
    calibStart: 0,
  },
};

/** Extra per-exercise technique parameters (all monitored, never used to reject a cycle unless stated). */
export const TECHNIQUE = {
  squat: {
    /** "Hips back to standing" at the top: shoulder–hip–knee angle. */
    hipTopEnter: 150,
    hipTopExit: 140,
  },
  pushup: {
    /** Shoulders must descend toward the hands by this share of arm length for the target. */
    shoulderDropForTarget: 0.2,
    /** Body line (shoulder–hip–ankle or –knee) deviation from straight, deg. */
    maxBodyLineDeviation: 15,
    /** Knee angle below this with the knee near the floor => knee push-up. */
    kneelingKneeAngle: 135,
  },
  bench: {
    /** Bar/wrists must descend toward the shoulders by this share of arm length for the target. */
    wristDropForTarget: 0.2,
    /** A cycle must be mostly vertical: vertical wrist travel ≥ ratio × horizontal (racking is horizontal). */
    minVerticalToHorizontal: 1.0,
  },
  pullup: {
    /** Shoulders must rise toward the hands by this share of arm length for the target. */
    shoulderRiseForTarget: 0.3,
    /** Swing (side view only): horizontal hip travel per cycle as a share of torso length. */
    maxSwing: 0.35,
    /** Shoulder width / arm length above this => front/back view (swing not assessable). */
    frontViewShoulderRatio: 0.45,
  },
  plank: {
    elbowMin: 80,
    elbowMax: 100,
    kneeMin: 165,
    hipMin: 165,
    /** Signed hip deviation from the shoulder–ankle line ÷ body length (+ sagging, − raised). */
    maxHipDeviation: 0.05,
    /** Noise tolerance added to every criterion (deg / fraction) and exit hysteresis. */
    toleranceDeg: 5,
    toleranceDeviation: 0.01,
    hysteresisDeg: 3,
    /** Plank-like posture (to measure "time in position"). */
    maxInclination: 40,
    minElevation: 0.06,
    lostAfterMs: 400,
    /** dt larger than this between two good frames is not credited. */
    maxCreditGapMs: 200,
  },
};

/** Basic two-foot rope jumps. Heights are fractions of leg length (hip–knee–ankle). */
export interface JumpConfig {
  /** Both ankles above ground by ≥ this => feet lifted. */
  feetEnter: number;
  feetExit: number;
  /** Hips must rise too (whole body jump), fraction of leg length. */
  hipEnter: number;
  /** When toe points are visible: toes must leave the ground (else it is a toe raise). */
  toeEnter: number;
  minAirMs: number;
  maxAirMs: number;
  /** Re-count guard adapts to the rhythm: factor × median interval, clamped. */
  refractoryFactor: number;
  refractoryMinMs: number;
  refractoryMaxMs: number;
  groundWindowMs: number;
  groundPercentile: number;
  /** No jump for this long => a pause (excluded from active time). */
  pauseMs: number;
  lostAfterMs: number;
  /** Light smoothing time constant (ms), dt-based EMA; small to keep short flights. */
  smoothingMs: number;
}

export const JUMP: JumpConfig = {
  feetEnter: 0.02,
  feetExit: 0.008,
  hipEnter: 0.012,
  toeEnter: 0.015,
  minAirMs: 50,
  maxAirMs: 900,
  refractoryFactor: 0.45,
  refractoryMinMs: 150,
  refractoryMaxMs: 300,
  groundWindowMs: 1500,
  groundPercentile: 0.6,
  pauseMs: 1500,
  lostAfterMs: 300,
  smoothingMs: 15,
};

/**
 * MoveNet (native engine) jitters ~3–5× more than MediaPipe (measured on a real
 * recording while standing still: 1.4–4% vs 0.4–0.8% of leg length), so only clearly
 * visible jumps are counted with it.
 */
export const JUMP_MOVENET: Partial<JumpConfig> = {
  feetEnter: 0.06,
  feetExit: 0.025,
  hipEnter: 0.03,
  minAirMs: 70,
};

export const CALIBRATION = {
  /** Hold the start position this long… */
  holdMs: 1200,
  /** …with the driving value varying (std) at most this much. */
  maxStd: 6,
  /** Up to this many controlled movements are measured after the hold (optional). */
  maxRangeCycles: 3,
};
