import React from 'react';
import { StyleSheet, View } from 'react-native';
import { KP, SKELETON_EDGES, type Point } from '../pose/types';
import { colors } from '../ui/theme';

interface Props {
  /** 17 keypoints in view coordinates (null = not available). */
  points: (Point | null)[];
  scores: number[];
  /** Minimum score to draw a point: upper body / legs (hips, knees, ankles). */
  minScore: number;
  legMinScore: number;
  /** Keypoint indices used by the current exercise (drawn larger). */
  highlight?: number[];
}

const isLeg = (i: number) => i >= KP.leftHip;
/** Face points other than the nose are not drawn (clean body skeleton). */
const FACE = new Set<number>([KP.leftEye, KP.rightEye, KP.leftEar, KP.rightEar]);

/**
 * Body skeleton drawn with plain Views (no extra native dependency). Only confidently
 * detected points are drawn; leg bones are thicker so the legs stand out.
 */
export function SkeletonOverlay({ points, scores, minScore, legMinScore, highlight = [] }: Props) {
  const shown = (i: number) => !!points[i] && scores[i] >= (isLeg(i) ? legMinScore : minScore);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {SKELETON_EDGES.map(([a, b]) => {
        const p = points[a];
        const q = points[b];
        if (!p || !q || !shown(a) || !shown(b) || FACE.has(a) || FACE.has(b)) return null;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) return null;
        const w = isLeg(a) && isLeg(b) ? 6 : 4;
        return (
          <View
            key={`${a}-${b}`}
            style={{
              position: 'absolute',
              left: (p.x + q.x) / 2 - len / 2,
              top: (p.y + q.y) / 2 - w / 2,
              width: len,
              height: w,
              borderRadius: w / 2,
              backgroundColor: 'rgba(198,255,61,0.9)',
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            }}
          />
        );
      })}
      {points.map((p, i) => {
        if (!p || !shown(i) || FACE.has(i)) return null;
        const r = highlight.includes(i) ? 7 : 4.5;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: p.x - r,
              top: p.y - r,
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              backgroundColor: 'white',
              borderWidth: highlight.includes(i) ? 3 : 2,
              borderColor: colors.accent,
            }}
          />
        );
      })}
    </View>
  );
}
