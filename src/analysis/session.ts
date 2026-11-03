import type { Pose, PoseSource } from '../pose/types';
import type { CalibrationResult, MeasuredRange } from './calibration';
import { DETECTOR_VERSION, HINTS, JUMP_MOVENET, TECHNIQUE, type ExerciseId, type VariantId } from './config';
import { CyclicDetector, type CyclicSnapshot } from './detectors/cyclic';
import { JumpDetector, type JumpEvaluation, type JumpSnapshot, type JumpStats } from './detectors/jump';
import { PlankDetector, type PlankSnapshot, type PlankStats } from './detectors/plank';
import { EXERCISES } from './exercises';
import { HintEngine } from './hints';
import { FrameView, PART_PL } from './landmarks';
import { MetricExtractor, type FrameMetrics, type MeasuredSide } from './metrics';
import type { CycleCounts, CyclePhase, CycleRecord, Hint, TechState } from './types';

export interface AnalysisSnapshot {
  state: TechState;
  phase: CyclePhase | null;
  /** Big number on screen: cycles with the target reached / time in tolerance / jumps. */
  main: { kind: 'count' | 'time'; value: number };
  counts: CycleCounts | null;
  cyclic: CyclicSnapshot | null;
  plank: PlankSnapshot | null;
  jump: JumpSnapshot | null;
  metrics: FrameMetrics;
  hint: Hint | null;
  /** Share of frames with the required points over the last 3 s. */
  coverage: number;
}

export interface SessionResult {
  exercise: ExerciseId;
  variant: VariantId;
  detectorVersion: string;
  source: PoseSource | null;
  calibration: CalibrationResult | null;
  measuredRange: MeasuredRange | null;
  /** Range target used (user/trainer setting or default), null for plank/jumps. */
  target: number | null;
  counts: CycleCounts | null;
  cycles: CycleRecord[];
  cycleSummary: {
    minExtreme: number | null;
    maxExtreme: number | null;
    meanAmplitude: number | null;
    meanAwayMs: number | null;
    meanBackMs: number | null;
    oneSided: number;
    sides: Partial<Record<MeasuredSide, number>>;
  } | null;
  coverage: { frames: number; validFrames: number; share: number; gaps: number; gapMs: number; longestGapMs: number };
  plank: PlankStats | null;
  jump: (JumpStats & { evaluation: JumpEvaluation }) | null;
  notAssessable: string[];
  unavailable: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Glue: model adapter output (Pose) → metrics → detector → hints → results.
 * Pure logic, no camera: can be driven by recorded landmark sequences (tests, evaluation).
 */
export class ExerciseAnalyzer {
  readonly extractor: MetricExtractor;
  readonly cyclic: CyclicDetector | null = null;
  readonly plank: PlankDetector | null = null;
  readonly jump: JumpDetector | null = null;
  private readonly hints = new HintEngine();
  private recent: { t: number; ok: boolean }[] = [];
  private frames = 0;
  private validFrames = 0;
  private gaps = 0;
  private gapMs = 0;
  private longestGapMs = 0;
  private gapStart: number | null = null;
  private lastT: number | null = null;
  private source: PoseSource | null = null;
  private infoHint: { hint: Hint; until: number } | null = null;

  constructor(
    readonly exercise: ExerciseId,
    readonly variant: VariantId,
    readonly options: {
      calibration?: CalibrationResult | null;
      measuredRange?: MeasuredRange | null;
      target?: number | null;
      source?: PoseSource;
    } = {},
  ) {
    this.extractor = new MetricExtractor(exercise, variant);
    if (exercise === 'plank') this.plank = new PlankDetector({ calibration: options.calibration });
    else if (exercise === 'jumprope') this.jump = new JumpDetector({ config: options.source === 'movenet' ? JUMP_MOVENET : undefined });
    else {
      this.cyclic = new CyclicDetector(exercise, variant, { calibration: options.calibration, target: options.target });
      this.cyclic.onEvent((e) => {
        if (e.type !== 'cycle') return;
        const c = e.cycle;
        const text =
          c.outcome === 'unevaluable'
            ? 'Próba nieocenialna – przerwa w śledzeniu'
            : c.outcome === 'target_missed'
              ? c.reasons.includes('variant_knees_detected')
                ? 'Wykryto pompkę na kolanach – zmień wariant'
                : 'Cel zakresu nieosiągnięty'
              : c.flags.includes('swing')
                ? 'Ogranicz kołysanie'
                : null;
        if (text) this.infoHint = { hint: { id: `cycle_${c.outcome}_${text}`, text, kind: 'info' }, until: c.endT + 2000 };
      });
    }
  }

  /** After a pause / camera switch: re-synchronise in the start position. */
  resync(): void {
    this.cyclic?.resync();
    this.plank?.resync();
    this.jump?.resync();
    this.extractor.sides.reset();
    this.hints.reset();
  }

  update(pose: Pose): AnalysisSnapshot {
    const view = new FrameView(pose);
    this.source = view.source;
    this.extractor.lock(this.cyclic?.inCycle ?? false);
    const m = this.extractor.extract(view);
    const t = m.t;
    this.trackCoverage(t, m.primary !== null);

    let cyc: CyclicSnapshot | null = null;
    let pl: PlankSnapshot | null = null;
    let jp: JumpSnapshot | null = null;
    if (this.cyclic) cyc = this.cyclic.update(m);
    if (this.plank) pl = this.plank.update(m);
    if (this.jump) jp = this.jump.update(view, m);

    const coverage = this.recent.length ? this.recent.filter((r) => r.ok).length / this.recent.length : 0;
    const hint = this.hints.update(t, this.hintCandidates(m, coverage, pl, jp, t));
    const state = cyc?.state ?? pl?.state ?? jp?.state ?? 'NOT_READY';
    return {
      state,
      phase: cyc?.phase ?? (jp?.airborne ? 'extreme' : null),
      main: pl
        ? { kind: 'time', value: pl.stats.inToleranceMs }
        : jp
          ? { kind: 'count', value: jp.stats.jumps }
          : { kind: 'count', value: cyc?.counts.targetReached ?? 0 },
      counts: cyc?.counts ?? null,
      cyclic: cyc,
      plank: pl,
      jump: jp,
      metrics: m,
      hint,
      coverage,
    };
  }

  private trackCoverage(t: number, ok: boolean): void {
    this.frames++;
    if (ok) this.validFrames++;
    this.recent.push({ t, ok });
    while (this.recent.length && this.recent[0].t < t - 3000) this.recent.shift();
    if (!ok && this.gapStart === null) this.gapStart = this.lastT ?? t;
    if (ok && this.gapStart !== null) {
      const g = t - this.gapStart;
      if (g >= 100) {
        this.gaps++;
        this.gapMs += g;
        this.longestGapMs = Math.max(this.longestGapMs, g);
      }
      this.gapStart = null;
    }
    this.lastT = t;
  }

  private hintCandidates(m: FrameMetrics, coverage: number, pl: PlankSnapshot | null, jp: JumpSnapshot | null, t: number): Hint[] {
    const info = EXERCISES[this.exercise];
    const out: Hint[] = [];
    if (m.primary === null) {
      const missing = m.missing.map((p) => PART_PL[p]).join(', ');
      out.push({ id: 'frame', kind: 'setup', text: `Ustaw się w kadrze${missing ? ` · nie widać: ${missing}` : ''}` });
    } else if (coverage < HINTS.minCoverageForTechniqueHints) {
      out.push({ id: 'coverage', kind: 'setup', text: 'Słaby obraz – ustaw telefon stabilnie, popraw światło lub odległość' });
    }
    if (jp && jp.evaluation === 'limited_one_foot') out.push({ id: 'feet', kind: 'setup', text: 'Pokaż obie stopy w kadrze' });
    if (m.posture === false) out.push({ id: 'posture', kind: 'technique', text: info.postureHint });

    // Technique hints only with a good enough picture.
    if (m.primary !== null && coverage >= HINTS.minCoverageForTechniqueHints) {
      if (this.exercise === 'pushup') {
        const dev = m.values.bodyLineDev;
        if (dev !== null && dev !== undefined && dev > TECHNIQUE.pushup.maxBodyLineDeviation) {
          out.push({ id: 'pushup_line', kind: 'technique', text: 'Utrzymaj ciało w jednej linii' });
        }
        if (this.variant === 'standard' && m.values.kneeOnFloor === 1) {
          out.push({ id: 'pushup_knees', kind: 'technique', text: 'Wykryto pompkę na kolanach – zmień wariant' });
        }
      }
      if (pl && pl.evaluable) {
        if (pl.failing.includes('hipDev') && (pl.hipDev ?? 0) > 0) out.push({ id: 'plank_sag', kind: 'technique', text: 'Biodra opadają – unieś je lekko' });
        if (pl.failing.includes('hipDev') && (pl.hipDev ?? 0) < 0) out.push({ id: 'plank_pike', kind: 'technique', text: 'Biodra za wysoko – obniż je' });
        if (pl.failing.includes('knee')) out.push({ id: 'plank_knee', kind: 'technique', text: 'Wyprostuj kolana' });
        if (pl.failing.includes('hip') && !pl.failing.includes('hipDev')) out.push({ id: 'plank_hip', kind: 'technique', text: 'Wyprostuj biodra' });
        if (pl.failing.includes('elbow')) out.push({ id: 'plank_elbow', kind: 'technique', text: 'Ustaw łokcie pod barkami' });
      }
    }
    if (this.infoHint && t <= this.infoHint.until) out.push(this.infoHint.hint);
    return out;
  }

  result(): SessionResult {
    const info = EXERCISES[this.exercise];
    const cycles = this.cyclic?.records ?? [];
    const done = cycles.filter((c) => c.outcome !== 'unevaluable');
    const sides: Partial<Record<MeasuredSide, number>> = {};
    for (const c of done) if (c.side) sides[c.side] = (sides[c.side] ?? 0) + 1;
    const flags = new Set(cycles.flatMap((c) => c.flags));
    const notAssessable = [...info.notAssessable];
    if (this.exercise === 'pullup' && (flags.has('swing_not_assessable') || !cycles.length)) {
      notAssessable.push('Kołysanie (wymaga widoku z boku)');
    }
    if (this.exercise === 'jumprope' && this.jump) {
      const ev = this.jump.snapshot().evaluation;
      if (ev !== 'full') notAssessable.push('Odróżnienie skoku od wspięcia na palce (palce stóp niewidoczne)');
    }
    const extremes = done.map((c) => c.extremeValue);
    return {
      exercise: this.exercise,
      variant: this.variant,
      detectorVersion: DETECTOR_VERSION,
      source: this.source,
      calibration: this.options.calibration ?? null,
      measuredRange: this.options.measuredRange ?? null,
      target: this.cyclic ? this.cyclic.thresholds.target : null,
      counts: this.cyclic ? this.cyclic.snapshot().counts : null,
      cycles,
      cycleSummary: this.cyclic
        ? {
            minExtreme: extremes.length ? Math.min(...extremes) : null,
            maxExtreme: extremes.length ? Math.max(...extremes) : null,
            meanAmplitude: mean(done.map((c) => c.amplitude)),
            meanAwayMs: mean(done.map((c) => c.phaseMs.away)),
            meanBackMs: mean(done.map((c) => c.phaseMs.back)),
            oneSided: done.filter((c) => c.oneSided).length,
            sides,
          }
        : null,
      coverage: {
        frames: this.frames,
        validFrames: this.validFrames,
        share: this.frames ? this.validFrames / this.frames : 0,
        gaps: this.gaps,
        gapMs: this.gapMs,
        longestGapMs: this.longestGapMs,
      },
      plank: this.plank ? this.plank.snapshot().stats : null,
      jump: this.jump ? { ...this.jump.stats(), evaluation: this.jump.snapshot().evaluation } : null,
      notAssessable,
      unavailable: [...info.unavailable],
    };
  }
}

/** Last finished session (in memory only; nothing is written to disk). */
let lastResult: SessionResult | null = null;
export function setLastResult(r: SessionResult): void {
  lastResult = r;
}
export function getLastResult(): SessionResult | null {
  return lastResult;
}
