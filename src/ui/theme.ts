import type { ExerciseId } from '../analysis/config';

export const colors = {
  bg: '#0B0D10',
  surface: '#15181D',
  surface2: '#1F232A',
  border: '#2A2F38',
  text: '#F4F6F8',
  muted: '#9AA3AF',
  accent: '#C6FF3D',
  onAccent: '#0B0D10',
  danger: '#FF5A5F',
  ok: '#3DDC84',
  warn: '#FFB020',
  overlay: 'rgba(11,13,16,0.72)',
};

/** Tint per exercise (icon chips, highlights). */
export const exerciseTint: Record<ExerciseId, string> = {
  squat: '#5AC8FA',
  plank: '#FF6B9A',
  pushup: '#C6FF3D',
  bench: '#FFD166',
  pullup: '#FF9F43',
  abs: '#B388FF',
  jumprope: '#4DD0E1',
};

export const radius = { sm: 10, md: 16, lg: 24, xl: 32 };

/** Hex color with alpha (0..1), e.g. tint backgrounds. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
