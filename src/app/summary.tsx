import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EXERCISES, EXERCISE_IDS, type ExerciseId } from '../counting/config';
import { colors, exerciseTint, radius, withAlpha } from '../ui/theme';
import { formatDuration } from '../utils/format';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export default function SummaryScreen() {
  const params = useLocalSearchParams<{
    exercise: string;
    reps: string;
    partials: string;
    heldMs: string;
    bestMs: string;
    durationMs: string;
  }>();
  const exercise: ExerciseId = (EXERCISE_IDS as string[]).includes(params.exercise)
    ? (params.exercise as ExerciseId)
    : 'pushup';
  const info = EXERCISES[exercise];
  const tint = exerciseTint[exercise];
  const isHold = info.kind === 'hold';
  const reps = Number(params.reps ?? 0);
  const partials = Number(params.partials ?? 0);
  const heldMs = Number(params.heldMs ?? 0);
  const bestMs = Number(params.bestMs ?? 0);
  const durationMs = Number(params.durationMs ?? 0);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.content}>
        <View style={[styles.iconChip, { backgroundColor: withAlpha(tint, 0.16) }]}>
          <MaterialCommunityIcons name={info.icon as IconName} size={40} color={tint} />
        </View>
        <Text style={styles.exercise}>{info.name}</Text>

        <View style={styles.hero}>
          <Text style={[styles.heroValue, { color: tint }]}>{isHold ? formatDuration(heldMs) : reps}</Text>
          <Text style={styles.heroLabel}>{isHold ? 'CZAS W DESCE' : 'POWTÓRZENIA'}</Text>
        </View>

        <View style={styles.stats}>
          <Stat icon="timer-outline" label="Czas treningu" value={formatDuration(durationMs)} />
          {isHold ? (
            <Stat icon="trophy-outline" label="Najdłużej bez przerwy" value={formatDuration(bestMs)} />
          ) : (
            <Stat icon="alert-circle-outline" label="Niepełne powtórzenia" value={String(partials)} />
          )}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/')}
        style={({ pressed }) => [styles.doneButton, pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 }]}
      >
        <Text style={styles.doneText}>Gotowe</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <MaterialCommunityIcons name={icon} size={22} color={colors.muted} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  iconChip: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  exercise: { color: colors.text, fontSize: 26, fontWeight: '800' },
  hero: { alignItems: 'center', marginVertical: 12 },
  heroValue: { fontSize: 112, lineHeight: 120, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroLabel: { color: colors.muted, fontSize: 14, fontWeight: '700', letterSpacing: 2 },
  stats: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  statValue: { color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  doneButton: {
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { color: colors.onAccent, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
});
