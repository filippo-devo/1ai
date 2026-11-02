/**
 * ALL tunable thresholds live in this file.
 *
 * Conventions (identical for all three exercises):
 * - The primary signal is a joint angle in degrees that is LARGE in the start
 *   position (arms / legs extended) and SMALL at the target (flexed):
 *     push-up: elbow angle, squat: knee angle, pull-up: elbow angle.
 * - The secondary ("aux") signal is a body-part displacement measured relative
 *   to the start position of the current repetition and normalized by a body
 *   segment length, so it is independent of camera distance and body size:
 *     push-up: shoulders descending toward the hands   (÷ arm length)
 *     squat:   hips descending                          (÷ thigh length)
 *     pull-up: shoulders rising toward the hands       (÷ arm length)
 *   A repetition needs BOTH the angle and the displacement to reach the target.
 * - Every threshold has a separate ENTER and EXIT value (hysteresis), so noise
 *   around a single threshold can never toggle the phase.
 */

/** Exercises counted in repetitions (state machine in repCounter.ts). */
export type RepExerciseId = 'pushup' | 'squat' | 'pullup' | 'situp' | 'bench';
/** All exercises; 'plank' is timed (plankTimer.ts), 'jumprope' counts jumps (jumpCounter.ts). */
export type ExerciseId = RepExerciseId | 'jumprope' | 'plank';

export const EXERCISE_IDS: ExerciseId[] = ['pushup', 'squat', 'pullup', 'situp', 'bench', 'jumprope', 'plank'];
export const REP_EXERCISE_IDS: RepExerciseId[] = ['pushup', 'squat', 'pullup', 'situp', 'bench'];

export function isRepExercise(id: ExerciseId): id is RepExerciseId {
  return (REP_EXERCISE_IDS as string[]).includes(id);
}

export interface ExerciseThresholds {
  /** Angle >= this => start position (extended). */
  startEnterDeg: number;
  /** While in start, angle must drop below this to leave it. Must be < startEnterDeg. */
  startExitDeg: number;
  /** Angle <= this (and aux displacement OK) => target reached. */
  targetEnterDeg: number;
  /** While at target, angle must rise above this to leave it. Must be > targetEnterDeg. */
  targetExitDeg: number;
  /** Normalized displacement needed to accept the target. */
  auxTargetEnter: number;
  /** Displacement below which the target is left (hysteresis). */
  auxTargetExit: number;
  /** Minimum duration of a full repetition (leave start -> back in start). Faster = rejected as jitter. */
  minRepMs: number;
  /** A phase change must be confirmed by this many consecutive frames. */
  dwellFrames: number;
  /**
   * Calibration adapts the start threshold to the user's measured start angle:
   * startEnter = clamp(measured - calibStartMarginDeg, minStartEnterDeg, startEnterDeg).
   * This handles people who cannot (or the 2D projection does not) show a fully straight joint.
   */
  calibStartMarginDeg: number;
  minStartEnterDeg: number;
  /** Calibration accepts the start position only if the angle is at least this. */
  calibMinAngleDeg: number;
}

export interface TrackingConfig {
  /** Keypoint score below which a keypoint counts as not visible (MoveNet scores are 0..1). */
  minKeypointScore: number;
  /** Required keypoints missing for longer than this => "Ustaw się w kadrze", counting paused, phase reset. */
  lostAfterMs: number;
  /** Bad posture for this many consecutive frames => phase reset (no counting). */
  postureResetFrames: number;
  /** One Euro filter for the joint angle (degrees). */
  angleFilter: { minCutoff: number; beta: number; dCutoff: number };
  /** One Euro filter for the normalized displacement signals (pixels). */
  positionFilter: { minCutoff: number; beta: number; dCutoff: number };
  /** Reference (start position) update rate while the user holds the start position. */
  referenceEma: number;
  /** Calibration: start position must be held this long ... */
  calibrationHoldMs: number;
  /** ... with the angle standard deviation not exceeding this. */
  calibrationMaxStdDeg: number;
}

export const TRACKING: TrackingConfig = {
  minKeypointScore: 0.3,
  lostAfterMs: 400,
  postureResetFrames: 6,
  angleFilter: { minCutoff: 1.5, beta: 0.02, dCutoff: 1.0 },
  positionFilter: { minCutoff: 1.5, beta: 0.01, dCutoff: 1.0 },
  referenceEma: 0.2,
  calibrationHoldMs: 1200,
  calibrationMaxStdDeg: 6,
};

export const THRESHOLDS: Record<RepExerciseId, ExerciseThresholds> = {
  pushup: {
    startEnterDeg: 150,
    startExitDeg: 138,
    targetEnterDeg: 100,
    targetExitDeg: 112,
    auxTargetEnter: 0.2,
    auxTargetExit: 0.14,
    minRepMs: 300,
    dwellFrames: 2,
    calibStartMarginDeg: 10,
    minStartEnterDeg: 135,
    calibMinAngleDeg: 140,
  },
  squat: {
    startEnterDeg: 155,
    startExitDeg: 143,
    // "Ustalona głębokość": knee angle <= 100° (roughly thighs ~parallel in side view).
    targetEnterDeg: 100,
    targetExitDeg: 112,
    auxTargetEnter: 0.3,
    auxTargetExit: 0.22,
    minRepMs: 350,
    dwellFrames: 2,
    calibStartMarginDeg: 10,
    minStartEnterDeg: 140,
    calibMinAngleDeg: 150,
  },
  pullup: {
    startEnterDeg: 145,
    startExitDeg: 133,
    targetEnterDeg: 95,
    targetExitDeg: 107,
    auxTargetEnter: 0.3,
    auxTargetExit: 0.22,
    minRepMs: 450,
    dwellFrames: 2,
    calibStartMarginDeg: 10,
    minStartEnterDeg: 130,
    calibMinAngleDeg: 135,
  },
  /**
   * Sit-ups, side view, lying on the back with bent knees. Primary angle: hip
   * (shoulder–hip–knee), ~135° lying, ~45° sitting up. Aux: shoulders rising
   * above the hips ÷ torso length.
   */
  situp: {
    startEnterDeg: 120,
    startExitDeg: 110,
    targetEnterDeg: 80,
    targetExitDeg: 92,
    auxTargetEnter: 0.5,
    auxTargetExit: 0.4,
    minRepMs: 500,
    dwellFrames: 2,
    calibStartMarginDeg: 10,
    minStartEnterDeg: 105,
    calibMinAngleDeg: 110,
  },
  /**
   * Bench press, side view, lying on the bench. Primary angle: elbow (large =
   * arms locked out). Aux: wrists (bar) descending toward the shoulders ÷ arm length.
   */
  bench: {
    startEnterDeg: 150,
    startExitDeg: 138,
    targetEnterDeg: 95,
    targetExitDeg: 107,
    auxTargetEnter: 0.3,
    auxTargetExit: 0.22,
    minRepMs: 500,
    dwellFrames: 2,
    calibStartMarginDeg: 10,
    minStartEnterDeg: 135,
    calibMinAngleDeg: 140,
  },
};

/**
 * Jump rope: a jump = hips and feet rising above the ground level and landing
 * again. Heights are normalized by leg length (hip–knee–ankle), so they do not
 * depend on body size or camera distance.
 */
export interface JumpConfig {
  /** Height above ground (÷ leg length) to count as airborne. */
  airborneEnter: number;
  /** Below this height the person has landed (hysteresis). */
  airborneExit: number;
  /** Shorter "flights" are keypoint noise (a single-frame spike), not jumps. */
  minAirMs: number;
  /** Minimum time between two counted jumps (faster = noise). */
  minIntervalMs: number;
  /** Longer "flights" are not jumps (e.g. stepping back) — reset without counting. */
  maxAirMs: number;
  /** Ground level = this percentile of the vertical position over the window. */
  groundWindowMs: number;
  groundPercentile: number;
  /** EMA factor for the vertical position (1 = no smoothing: smoothing flattens short jumps). */
  smoothing: number;
  calibMinAngleDeg: number;
}

export const JUMP: JumpConfig = {
  airborneEnter: 0.02,
  airborneExit: 0.008,
  minAirMs: 50,
  minIntervalMs: 220,
  maxAirMs: 900,
  groundWindowMs: 1500,
  groundPercentile: 0.6,
  smoothing: 1,
  calibMinAngleDeg: 150,
};

/**
 * Plank: time is counted only while the body line (shoulder–hip–ankle) is
 * straight enough and the body is supported horizontally (see features.ts).
 */
export interface PlankConfig {
  /** Body line angle >= this (and posture OK) => in position. */
  bodyEnterDeg: number;
  /** While in position, below this => out of position. */
  bodyExitDeg: number;
  /** A change in/out of position must last this long (debounce). */
  enterMs: number;
  exitMs: number;
  /** Calibration: start position accepted from this body angle. */
  calibMinAngleDeg: number;
  /** Calibration may lower bodyEnterDeg to (measured - margin), not below minBodyEnterDeg. */
  calibMarginDeg: number;
  minBodyEnterDeg: number;
}

export const PLANK: PlankConfig = {
  bodyEnterDeg: 160,
  bodyExitDeg: 148,
  enterMs: 400,
  exitMs: 400,
  calibMinAngleDeg: 150,
  calibMarginDeg: 8,
  minBodyEnterDeg: 152,
};

/**
 * The native engine (MoveNet Lightning) jitters much more than MediaPipe: measured on a
 * real video while standing still, the hip/feet height std was 1.4–4% of leg length
 * (MediaPipe: 0.4–0.8%). With MoveNet only clearly visible jumps (~5 cm+) are counted.
 */
export const JUMP_MOVENET: Partial<JumpConfig> = {
  airborneEnter: 0.06,
  airborneExit: 0.025,
  minAirMs: 70,
};

export interface ExerciseInfo {
  id: ExerciseId;
  name: string;
  /** 'reps' = counted repetitions, 'hold' = time in position (plank). */
  kind: 'reps' | 'hold';
  /** Short subtitle on the exercise list. */
  subtitle: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
  /** Labels for the start and target phases shown in the UI. */
  startLabel: string;
  targetLabel: string;
  primaryLabel: string;
  auxLabel: string;
  setup: {
    phoneOrientation: string;
    distance: string;
    angle: string;
    bodyParts: string;
    tips: string[];
  };
  postureHint: string;
}

export const EXERCISES: Record<ExerciseId, ExerciseInfo> = {
  pushup: {
    id: 'pushup',
    kind: 'reps',
    subtitle: 'Powtórzenia · widok z boku',
    icon: 'arm-flex',
    name: 'Pompki',
    startLabel: 'Góra (ręce proste)',
    targetLabel: 'Dół',
    primaryLabel: 'Kąt łokcia',
    auxLabel: 'Zejście barków ku dłoniom',
    setup: {
      phoneOrientation: 'Telefon poziomo (landscape), oparty stabilnie na podłodze lub niskim stołku.',
      distance: 'Ok. 1,5–2,5 m od Ciebie.',
      angle: 'Kamera z boku (prostopadle do ciała), obiektyw na wysokości ok. 10–40 cm nad podłogą.',
      bodyParts: 'W kadrze: barki, łokcie, nadgarstki i biodra (najlepiej całe ciało od głowy do stóp).',
      tips: [
        'Ustaw się bokiem do kamery, aby łokieć bliższy kamerze był dobrze widoczny.',
        'Kalibracja: przyjmij pozycję podporu na prostych rękach i wytrzymaj ok. 1–2 s.',
      ],
    },
    postureHint: 'Przyjmij podpór: ciało poziomo, dłonie pod barkami, ręce proste.',
  },
  squat: {
    id: 'squat',
    kind: 'reps',
    subtitle: 'Powtórzenia · widok z boku lub 45°',
    icon: 'human-handsup',
    name: 'Przysiady',
    startLabel: 'Stanie',
    targetLabel: 'Przysiad',
    primaryLabel: 'Kąt kolana',
    auxLabel: 'Obniżenie bioder',
    setup: {
      phoneOrientation: 'Telefon pionowo (portrait), oparty stabilnie na wysokości ok. 0,8–1,2 m.',
      distance: 'Ok. 2–3 m od Ciebie – cała sylwetka od głowy do stóp z zapasem.',
      angle: 'Najlepiej bokiem do kamery (profil) lub pod kątem ok. 45°. Przodem kąt kolana jest mniej wiarygodny.',
      bodyParts: 'W kadrze: barki, biodra, kolana i kostki.',
      tips: [
        'Domyślna głębokość zaliczenia: kąt kolana ≤ 100° i wyraźne obniżenie bioder.',
        'Kalibracja: stań prosto w miejscu ćwiczenia i wytrzymaj ok. 1–2 s.',
      ],
    },
    postureHint: 'Stań prosto, cała sylwetka w kadrze.',
  },
  pullup: {
    id: 'pullup',
    kind: 'reps',
    subtitle: 'Powtórzenia · widok z przodu',
    icon: 'weight-lifter',
    name: 'Podciągnięcia',
    startLabel: 'Zwis (ręce proste)',
    targetLabel: 'Góra',
    primaryLabel: 'Kąt łokcia',
    auxLabel: 'Uniesienie barków ku dłoniom',
    setup: {
      phoneOrientation: 'Telefon pionowo (portrait), oparty stabilnie na podłodze lub półce.',
      distance: 'Ok. 2–3 m od drążka.',
      angle: 'Przodem lub tyłem do kamery, obiektyw skierowany lekko w górę tak, aby dłonie na drążku były w kadrze.',
      bodyParts: 'W kadrze: dłonie (na drążku), łokcie i barki – najlepiej także biodra.',
      tips: [
        'Aplikacja nie rozpoznaje drążka – nie sprawdza, czy broda jest nad drążkiem. Zalicza ruch: proste ręce → zgięte łokcie i barki uniesione ku dłoniom → proste ręce.',
        'Kalibracja: zawiśnij na prostych rękach i wytrzymaj ok. 1–2 s.',
      ],
    },
    postureHint: 'Złap drążek i zawiśnij na prostych rękach (dłonie nad barkami).',
  },
  situp: {
    id: 'situp',
    kind: 'reps',
    subtitle: 'Powtórzenia · widok z boku',
    icon: 'human-male-board',
    name: 'Brzuszki',
    startLabel: 'Leżenie',
    targetLabel: 'Siad',
    primaryLabel: 'Kąt bioder',
    auxLabel: 'Uniesienie barków',
    setup: {
      phoneOrientation: 'Telefon poziomo (landscape), oparty stabilnie na podłodze.',
      distance: 'Ok. 1,5–2,5 m od Ciebie.',
      angle: 'Kamera z boku (prostopadle do ciała), nisko nad podłogą.',
      bodyParts: 'W kadrze: barki, biodra, kolana i kostki.',
      tips: [
        'Leż na plecach, kolana zgięte, stopy na podłodze. Zaliczany jest pełny siad: tułów wysoko uniesiony, potem powrót do leżenia.',
        'Kalibracja: połóż się w pozycji startowej i wytrzymaj ok. 1–2 s.',
      ],
    },
    postureHint: 'Połóż się na plecach bokiem do kamery, kolana zgięte, stopy na podłodze.',
  },
  bench: {
    id: 'bench',
    kind: 'reps',
    subtitle: 'Sztanga na ławce · widok z boku',
    icon: 'weight',
    name: 'Wyciskanie',
    startLabel: 'Ręce proste',
    targetLabel: 'Sztanga przy klatce',
    primaryLabel: 'Kąt łokcia',
    auxLabel: 'Opuszczenie sztangi',
    setup: {
      phoneOrientation: 'Telefon poziomo (landscape), oparty stabilnie na wysokości ławki.',
      distance: 'Ok. 1,5–2,5 m od ławki.',
      angle: 'Kamera z boku (prostopadle do ławki), tak by talerze sztangi nie zasłaniały łokcia.',
      bodyParts: 'W kadrze: barki, łokcie, nadgarstki i biodra.',
      tips: [
        'Zaliczany jest pełny ruch: sztanga opuszczona do klatki (łokcie zgięte), potem wyprostowane ręce.',
        'Kalibracja: połóż się z wyprostowanymi rękami nad sobą i wytrzymaj ok. 1–2 s.',
        'Ćwicz z asekuracją – aplikacja tylko liczy powtórzenia.',
      ],
    },
    postureHint: 'Połóż się na ławce bokiem do kamery, ręce wyprostowane nad barkami.',
  },
  jumprope: {
    id: 'jumprope',
    kind: 'reps',
    subtitle: 'Skoki · widok z przodu lub z boku',
    icon: 'jump-rope',
    name: 'Skakanka',
    startLabel: 'Stanie',
    targetLabel: 'Skok',
    primaryLabel: 'Kąt kolana',
    auxLabel: 'Wysokość skoku',
    setup: {
      phoneOrientation: 'Telefon pionowo (portrait), oparty stabilnie na wysokości ok. 0,5–1 m.',
      distance: 'Ok. 2,5–3,5 m od Ciebie – cała sylwetka ze stopami i zapasem pod stopami.',
      angle: 'Przodem lub bokiem do kamery, telefon nieruchomo (nie trzymaj go w ręce).',
      bodyParts: 'W kadrze: barki, biodra, kolana i kostki.',
      tips: [
        'Każde odbicie i lądowanie to jeden skok. Najlepiej działa przy dobrym świetle i płynnym obrazie.',
        'Kalibracja: stań prosto w miejscu skakania i wytrzymaj ok. 1–2 s.',
      ],
    },
    postureHint: 'Stań prosto, cała sylwetka razem ze stopami w kadrze.',
  },
  plank: {
    id: 'plank',
    kind: 'hold',
    subtitle: 'Czas w pozycji · widok z boku',
    icon: 'timer-outline',
    name: 'Deska',
    startLabel: 'Deska',
    targetLabel: 'Deska',
    primaryLabel: 'Linia ciała',
    auxLabel: '–',
    setup: {
      phoneOrientation: 'Telefon poziomo (landscape), oparty stabilnie na podłodze.',
      distance: 'Ok. 1,5–2,5 m od Ciebie.',
      angle: 'Kamera z boku (prostopadle do ciała), nisko nad podłogą.',
      bodyParts: 'W kadrze: barki, łokcie, biodra i kostki.',
      tips: [
        'Czas liczy się tylko wtedy, gdy ciało tworzy prostą linię (bez opadających lub uniesionych bioder).',
        'Kalibracja: przyjmij pozycję deski i wytrzymaj ok. 1–2 s.',
      ],
    },
    postureHint: 'Przyjmij deskę: przedramiona pod barkami, ciało w jednej linii.',
  },
};
