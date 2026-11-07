import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useIsFocused } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EXERCISE_IDS, type ExerciseId } from '../analysis/config';
import { EXERCISES } from '../analysis/exercises';
import { POSE_ENGINE } from '../camera/PoseCamera';
import { PrefetchPoseAssets } from '../camera/PrefetchPoseAssets';
import { colors, exerciseTint, radius, withAlpha } from '../ui/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export default function ExerciseSelectScreen() {
  const [voice, setVoice] = useState(true);
  const focused = useIsFocused();

  const open = (id: ExerciseId) =>
    router.push({ pathname: '/workout', params: { exercise: id, voice: voice ? '1' : '0' } });

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      {POSE_ENGINE === 'web' && focused && <PrefetchPoseAssets />}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {EXERCISE_IDS.map((id) => {
          const ex = EXERCISES[id];
          const tint = exerciseTint[id];
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={ex.name}
              onPress={() => open(id)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={[styles.iconChip, { backgroundColor: withAlpha(tint, 0.16) }]}>
                <MaterialCommunityIcons name={ex.icon as IconName} size={30} color={tint} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{ex.name}</Text>
                <Text style={styles.cardSubtitle}>{ex.subtitle}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={28} color={colors.muted} />
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.settings}>
        <SettingRow icon="volume-high" label="Odczyt głosowy" value={voice} onChange={setVoice} />
      </View>
    </SafeAreaView>
  );
}

function SettingRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <MaterialCommunityIcons name={icon} size={22} color={colors.muted} />
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surface2, true: colors.accent }}
        thumbColor={value ? colors.onAccent : colors.muted}
        ios_backgroundColor={colors.surface2}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 16, paddingTop: 20, gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  cardPressed: { transform: [{ scale: 0.98 }], backgroundColor: colors.surface2 },
  iconChip: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  cardSubtitle: { color: colors.muted, fontSize: 14, marginTop: 2 },
  settings: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  settingLabel: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
