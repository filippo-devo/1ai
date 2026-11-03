import { HINTS } from './config';
import type { Hint } from './types';

const PRIORITY: Record<Hint['kind'], number> = { setup: 0, technique: 1, info: 2 };

/**
 * Shows at most ONE hint at a time.
 * - 'setup' hints (camera/visibility) always win and need only a short persistence;
 * - 'technique' hints need the deviation to persist (HINTS.postureMs) — this delay is
 *   only for messages, never for the repetition detector;
 * - a shown hint stays at least HINTS.minDisplayMs to avoid flicker.
 */
export class HintEngine {
  private since = new Map<string, number>();
  private shown: { hint: Hint; at: number } | null = null;

  constructor(
    private readonly postureMs = HINTS.postureMs,
    private readonly minDisplayMs = HINTS.minDisplayMs,
    private readonly setupMs = 300,
  ) {}

  reset(): void {
    this.since.clear();
    this.shown = null;
  }

  /** @param active hints whose condition holds in this frame */
  update(t: number, active: Hint[]): Hint | null {
    const ids = new Set(active.map((h) => h.id));
    for (const id of [...this.since.keys()]) if (!ids.has(id)) this.since.delete(id);
    for (const h of active) if (!this.since.has(h.id)) this.since.set(h.id, t);

    const eligible = active
      .filter((h) => {
        const need = h.kind === 'setup' ? this.setupMs : h.kind === 'technique' ? this.postureMs : 0;
        return t - (this.since.get(h.id) ?? t) >= need;
      })
      .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
    const best = eligible[0] ?? null;

    if (this.shown) {
      const stillActive = ids.has(this.shown.hint.id);
      const minElapsed = t - this.shown.at >= this.minDisplayMs;
      const outranked = best && PRIORITY[best.kind] < PRIORITY[this.shown.hint.kind];
      if (!minElapsed && !outranked) return this.shown.hint;
      if (stillActive && !outranked && (!best || best.id === this.shown.hint.id)) return this.shown.hint;
    }
    this.shown = best ? { hint: best, at: this.shown?.hint.id === best.id ? this.shown.at : t } : null;
    return best;
  }
}
