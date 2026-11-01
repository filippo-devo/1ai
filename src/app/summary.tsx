import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EXERCISES, EXERCISE_IDS, type ExerciseId } from '../counting/config';
import { formatDuration } from '../utils/format';

export default function SummaryScreen() {
  const params = useLocalSearchParams<{ exercise: string; reps: string; partials: string; durationMs: string }>();
  const exercise = (EXERCISE_IDS as string[]).includes(params.exercise) ? (params.exercise as ExerciseId) : null;
  const reps = Number(params.reps ?? 0);
  const partials = Number(params.partials ?? 0);
  const durationMs = Number(params.durationMs ?? 0);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Ćwiczenie</Text>
      <Text style={styles.value}>{exercise ? EXERCISES[exercise].name : '–'}</Text>
      <Text style={styles.label}>Powtórzenia</Text>
      <Text style={styles.big}>{reps}</Text>
      <Text style={styles.label}>Czas treningu (bez pauz)</Text>
      <Text style={styles.value}>{formatDuration(durationMs)}</Text>
      {partials > 0 && <Text style={styles.note}>Niezaliczone (niepełne) powtórzenia: {partials}</Text>}
      <Pressable style={styles.button} onPress={() => router.replace('/')}>
        <Text style={styles.buttonText}>Nowy trening</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 6 },
  label: { fontSize: 15, color: '#555', marginTop: 10 },
  value: { fontSize: 26, fontWeight: '600' },
  big: { fontSize: 72, fontWeight: '700' },
  note: { fontSize: 14, color: '#555', marginTop: 12 },
  button: { marginTop: 30, backgroundColor: '#2563eb', padding: 18, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 20, fontWeight: '600' },
});
