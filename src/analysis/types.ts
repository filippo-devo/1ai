import type { MeasuredSide } from './metrics';

/** Technical state shared by all detectors. */
export type TechState = 'NOT_READY' | 'READY' | 'ACTIVE' | 'TRACKING_LOST';

/** Phases of one cycle: away from rest (e.g. descent), far end (bottom), returning. */
export type CyclePhase = 'away' | 'extreme' | 'back';

export type CycleOutcome = 'target_reached' | 'target_missed' | 'unevaluable';

export interface CycleRecord {
  index: number;
  startT: number;
  endT: number;
  outcome: CycleOutcome;
  /** Why the target was missed / the cycle is not evaluable (machine-readable). */
  reasons: string[];
  /** Driving value at rest and at the far end of the movement (deg). */
  restValue: number;
  extremeValue: number;
  minValue: number;
  maxValue: number;
  amplitude: number;
  /** away: start → far end; extreme: time inside the target zone; back: far end → rest. */
  phaseMs: { away: number; extreme: number; back: number };
  side: MeasuredSide | null;
  oneSided: boolean;
  /** Share of the cycle time covered by frames with the driving metric available. */
  coverage: number;
  gaps: number;
  gapMs: number;
  /** Assessable technique measurements of this cycle (null = not assessable). */
  checks: Record<string, number | null>;
  /** Informational flags, e.g. 'chin_over_bar_unverified', 'swing_not_assessable'. */
  flags: string[];
}

export interface CycleCounts {
  /** Every completed movement cycle (target reached or not) + non-evaluable attempts. */
  detected: number;
  targetReached: number;
  targetMissed: number;
  unevaluable: number;
}

export type DetectorEvent =
  | { type: 'cycle'; cycle: CycleRecord }
  | { type: 'ignored'; t: number; reason: 'small_amplitude' | 'too_fast' | 'rack_motion' }
  | { type: 'state'; t: number; state: TechState };

export interface Hint {
  id: string;
  text: string;
  /** 'setup' (camera/visibility) hints always win over 'technique' hints. */
  kind: 'setup' | 'technique' | 'info';
}
