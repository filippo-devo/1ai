import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EXERCISES } from '../analysis/exercises';
import { getLastResult, type SessionResult } from '../analysis/session';
import { colors, exerciseTint, radius, withAlpha } from '../ui/theme';
import { formatDuration } from '../utils/format';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const fmt = (v: number | null | undefined, digits = 0, unit = '') =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : `${v.toFixed(digits)}${unit}`;
const sec = (ms: number | null | undefined) => fmt(ms === null || ms === undefined ? null : ms / 1000, 1, ' s');

export default function SummaryScreen() {
  const params = useLocalSearchParams<{ durationMs?: string }>();
  const durationMs = Number(params.durationMs ?? 0);
  const r = getLastResult();

  if (!r) {
    return (
      <SafeAreaView style={styles.root}>
        <Text style={styles.empty}>Brak wyników treningu.</Text>
        <DoneButton />
      </SafeAreaView>
    );
  }
  const info = EXERCISES[r.exercise];
  const tint = exerciseTint[r.exercise];
  const variantLabel = info.variants.length > 1 ? info.variants.find((v) => v.id === r.variant)?.label : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.iconChip, { backgroundColor: withAlpha(tint, 0.16) }]}>
          <MaterialCommunityIcons name={info.icon as IconName} size={40} color={tint} />
        </View>
        <Text style={styles.exercise}>
          {info.name}
          {variantLabel ? ` · ${variantLabel}` : ''}
        </Text>
        <Hero r={r} tint={tint} />

        <Section title="Czas">
          <Row label="Czas treningu (bez pauz)" value={formatDuration(durationMs)} />
        </Section>

        {r.counts && <RepsSection r={r} />}
        {r.plank && <PlankSection r={r} />}
        {r.jump && <JumpSection r={r} />}

        <Section title="Jakość danych">
          <Row label="Klatki z wymaganymi punktami" value={fmt(r.coverage.share * 100, 0, '%')} />
          <Row label="Przerwy w śledzeniu" value={`${r.coverage.gaps} (łącznie ${sec(r.coverage.gapMs)})`} />
          <Row label="Najdłuższa przerwa" value={sec(r.coverage.longestGapMs)} />
          {r.calibration && (
            <Row label="Kalibracja: pozycja startowa / szum" value={`${fmt(r.calibration.rest)}° / ±${fmt(r.calibration.noise, 1)}°`} />
          )}
          {r.measuredRange && (
            <Row label="Zmierzony zakres (kalibracja, nie cel)" value={`${fmt(r.measuredRange.rest)}° → ${fmt(r.measuredRange.extreme)}°`} />
          )}
        </Section>

        <Section title="Nie można ocenić z tego ustawienia">
          {r.notAssessable.map((t) => (
            <Text key={t} style={styles.bullet}>
              • {t}
            </Text>
          ))}
        </Section>
        {r.unavailable.length > 0 && (
          <Section title="Niedostępne (brak modelu lub danych)">
            {r.unavailable.map((t) => (
              <Text key={t} style={styles.bullet}>
                • {t}
              </Text>
            ))}
          </Section>
        )}
        <Text style={styles.footer}>
          Detektor {r.detectorVersion} · {r.source === 'mediapipe' ? 'MediaPipe' : 'MoveNet'} · progi robocze, nie normy medyczne
        </Text>
      </ScrollView>
      <DoneButton />
    </SafeAreaView>
  );
}

function Hero({ r, tint }: { r: SessionResult; tint: string }) {
  let value = '0';
  let label = '';
  if (r.counts) {
    value = String(r.counts.targetReached);
    label = 'CYKLE Z OSIĄGNIĘTYM CELEM';
  } else if (r.plank) {
    value = formatDuration(r.plank.inToleranceMs);
    label = 'CZAS W TOLERANCJI';
  } else if (r.jump) {
    value = String(r.jump.jumps);
    label = 'PODSKOKI';
  }
  return (
    <View style={styles.hero}>
      <Text style={[styles.heroValue, { color: tint }]}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
    </View>
  );
}

function RepsSection({ r }: { r: SessionResult }) {
  const c = r.counts!;
  const s = r.cycleSummary;
  const info = EXERCISES[r.exercise];
  const sides = s ? Object.entries(s.sides).map(([k, n]) => `${k === 'left' ? 'lewa' : k === 'right' ? 'prawa' : 'obie'} ×${n}`) : [];
  return (
    <>
      <Section title="Cykle ruchu">
        <View style={styles.tiles}>
          <Tile icon="sync" label="Wykryte cykle" value={String(c.detected)} />
          <Tile icon="check-circle-outline" label="Cel osiągnięty" value={String(c.targetReached)} />
          <Tile icon="arrow-collapse-vertical" label="Cel nieosiągnięty" value={String(c.targetMissed)} />
          <Tile icon="help-circle-outline" label="Próby nieocenialne" value={String(c.unevaluable)} />
        </View>
        {r.target !== null && info.targetLabel && <Row label="Cel zakresu" value={info.targetLabel(r.target, r.variant)} />}
      </Section>
      {s && (
        <Section title="Zakres i tempo">
          <Row label="Najgłębszy / najpłytszy punkt końcowy" value={`${fmt(s.minExtreme)}° / ${fmt(s.maxExtreme)}°`} />
          <Row label="Średnia amplituda" value={fmt(s.meanAmplitude, 0, '°')} />
          <Row label={`Średni czas: ${info.phaseLabels.away.toLowerCase()} / ${info.phaseLabels.back.toLowerCase()}`} value={`${sec(s.meanAwayMs)} / ${sec(s.meanBackMs)}`} />
          <Row label="Strona pomiaru" value={sides.join(', ') || '–'} />
          {s.oneSided > 0 && <Row label="Cykle mierzone jednostronnie" value={String(s.oneSided)} />}
        </Section>
      )}
      {r.cycles.length > 0 && (
        <Section title="Kolejne cykle">
          {r.cycles.map((cy) => (
            <Text key={cy.index} style={styles.cycle}>
              {cy.index}. {cy.outcome === 'target_reached' ? '✓ cel' : cy.outcome === 'target_missed' ? '○ bez celu' : '? nieocenialny'} ·{' '}
              {fmt(cy.restValue)}°→{fmt(cy.extremeValue)}° · {sec(cy.endT - cy.startT)}
              {cy.oneSided ? ' · jednostronnie' : ''}
              {reasonText(cy.reasons, cy.flags)}
            </Text>
          ))}
        </Section>
      )}
    </>
  );
}

const REASONS: Record<string, string> = {
  range_target_not_reached: 'za mały zakres',
  shoulders_not_descending: 'barki nie zeszły w dół',
  shoulders_not_rising: 'barki nie uniosły się do dłoni',
  bar_not_descending: 'nadgarstki nie zeszły do barków',
  variant_knees_detected: 'wykryto wariant na kolanach',
  tracking_gap: 'przerwa w śledzeniu',
  posture: 'zmiana pozycji',
  too_long: 'zbyt długi cykl',
  body_line: 'linia ciała > 15°',
  swing: 'kołysanie',
};

function reasonText(reasons: string[], flags: string[]): string {
  const items = [...reasons, ...flags].map((k) => REASONS[k]).filter(Boolean);
  return items.length ? ` · ${[...new Set(items)].join(', ')}` : '';
}

function PlankSection({ r }: { r: SessionResult }) {
  const p = r.plank!;
  const names: Record<string, string> = { elbow: 'łokcie poza 80–100°', knee: 'zgięte kolana', hip: 'zgięte biodra', hipDev: 'biodra poza linią' };
  return (
    <Section title="Deska">
      <View style={styles.tiles}>
        <Tile icon="timer-outline" label="Czas całkowity" value={formatDuration(p.totalMs)} />
        <Tile icon="human" label="W pozycji" value={formatDuration(p.positionMs)} />
        <Tile icon="eye-check-outline" label="Ocenialny" value={formatDuration(p.evaluableMs)} />
        <Tile icon="check-circle-outline" label="W tolerancji" value={formatDuration(p.inToleranceMs)} />
      </View>
      <Row label="Najdłuższy ciągły odcinek w tolerancji" value={formatDuration(p.longestInToleranceMs)} />
      <Row label="Czas nieocenialny (brak danych)" value={formatDuration(p.unevaluableMs)} />
      {Object.entries(p.outOfToleranceMs)
        .filter(([, ms]) => ms > 0)
        .map(([k, ms]) => (
          <Row key={k} label={`Poza tolerancją: ${names[k]}`} value={formatDuration(ms)} />
        ))}
    </Section>
  );
}

function JumpSection({ r }: { r: SessionResult }) {
  const j = r.jump!;
  const ev =
    j.evaluation === 'full'
      ? 'pełna (stopy i palce widoczne)'
      : j.evaluation === 'limited_no_toes'
        ? 'ograniczona – palce stóp niewidoczne'
        : j.evaluation === 'limited_one_foot'
          ? 'ograniczona – widoczna jedna stopa'
          : 'niedostępna';
  return (
    <Section title="Podskoki">
      <View style={styles.tiles}>
        <Tile icon="speedometer" label="Rytm / min" value={fmt(j.perMinute)} />
        <Tile icon="timer-outline" label="Czas aktywny" value={formatDuration(j.activeMs)} />
        <Tile icon="pause-circle-outline" label="Przerwy" value={`${j.pauses}`} />
        <Tile icon="chart-bell-curve" label="Odstępy ±" value={fmt(j.intervalStdMs, 0, ' ms')} />
      </View>
      <Row label="Regularność (zmienność odstępów)" value={j.irregularity === null ? '–' : `${fmt(j.irregularity * 100)}%`} />
      <Row label="Wspięcia na palce (nieliczone)" value={String(j.toeRaises)} />
      <Row label="Status oceny" value={ev} />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Tile({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.muted} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function DoneButton() {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.replace('/')}
      style={({ pressed }) => [styles.doneButton, pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 }]}
    >
      <Text style={styles.doneText}>Gotowe</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  content: { alignItems: 'center', gap: 14, paddingBottom: 20 },
  empty: { color: colors.text, fontSize: 18, textAlign: 'center', marginTop: 40, flex: 1 },
  iconChip: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  exercise: { color: colors.text, fontSize: 26, fontWeight: '800' },
  hero: { alignItems: 'center', marginVertical: 4 },
  heroValue: { fontSize: 96, lineHeight: 104, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroLabel: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  section: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { color: colors.muted, fontSize: 14, flex: 1 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  cycle: { color: colors.text, fontSize: 13, opacity: 0.9 },
  bullet: { color: colors.muted, fontSize: 14 },
  footer: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  doneButton: {
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  doneText: { color: colors.onAccent, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
});
