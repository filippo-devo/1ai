import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SKELETON_EDGES, type Point } from '../pose/types';

interface Props {
  /** 17 keypoints in view coordinates (null = not available). */
  points: (Point | null)[];
  scores: number[];
  minScore: number;
  /** Keypoint indices used by the current exercise (highlighted). */
  highlight?: number[];
}

/** Debug skeleton drawn with plain Views (no extra native dependency). */
export function SkeletonOverlay({ points, scores, minScore, highlight = [] }: Props) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {SKELETON_EDGES.map(([a, b]) => {
        const p = points[a];
        const q = points[b];
        if (!p || !q) return null;
        const ok = scores[a] >= minScore && scores[b] >= minScore;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) return null;
        const angle = Math.atan2(dy, dx);
        return (
          <View
            key={`${a}-${b}`}
            style={{
              position: 'absolute',
              left: (p.x + q.x) / 2 - len / 2,
              top: (p.y + q.y) / 2 - 1.5,
              width: len,
              height: 3,
              backgroundColor: ok ? '#22c55e' : 'rgba(249,115,22,0.6)',
              transform: [{ rotate: `${angle}rad` }],
            }}
          />
        );
      })}
      {points.map((p, i) => {
        if (!p) return null;
        const ok = scores[i] >= minScore;
        const big = highlight.includes(i);
        const r = big ? 7 : 4;
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
              backgroundColor: ok ? (big ? '#2563eb' : '#60a5fa') : '#ef4444',
              borderWidth: big ? 2 : 0,
              borderColor: 'white',
            }}
          />
        );
      })}
    </View>
  );
}
