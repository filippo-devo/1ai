import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { EXERCISE_IDS, EXERCISES } from '../counting/config';

export default function ExerciseSelectScreen() {
  const [voice, setVoice] = useState(true);
  const [debug, setDebug] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Wybierz ćwiczenie</Text>
      {EXERCISE_IDS.map((id) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={() =>
            router.push({ pathname: '/workout', params: { exercise: id, voice: voice ? '1' : '0', debug: debug ? '1' : '0' } })
          }
        >
          <Text style={styles.buttonText}>{EXERCISES[id].name}</Text>
        </Pressable>
      ))}
      <View style={styles.row}>
        <Text style={styles.label}>Odczytuj powtórzenia głosowo</Text>
        <Switch value={voice} onValueChange={setVoice} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Tryb debugowania (szkielet, kąty, faza)</Text>
        <Switch value={debug} onValueChange={setDebug} />
      </View>
      <Text style={styles.note}>
        Obraz z kamery jest analizowany wyłącznie na telefonie. Nic nie jest nagrywane, zapisywane ani wysyłane.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 6 },
  button: { backgroundColor: '#2563eb', paddingVertical: 22, borderRadius: 12, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  buttonText: { color: 'white', fontSize: 22, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 16, flex: 1, marginRight: 10 },
  note: { fontSize: 13, color: '#555', marginTop: 8 },
});
