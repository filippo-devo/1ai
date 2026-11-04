import type { ExerciseId, VariantId } from './config';

export interface ExerciseInfo {
  id: ExerciseId;
  name: string;
  subtitle: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
  /** 'reps' = cycles, 'hold' = time in position, 'jumps' = rope jumps. */
  kind: 'reps' | 'hold' | 'jumps';
  variants: { id: VariantId; label: string }[];
  /** Labels of the rest (start) position and of the far end of the movement. */
  restLabel: string;
  extremeLabel: string;
  /** Phase names for 'away' (e.g. descent), 'extreme' (bottom) and 'back' (return). */
  phaseLabels: { away: string; extreme: string; back: string };
  /** Unit of the driving value shown next to the target selector. */
  targetLabel?: (v: number, variant: VariantId) => string;
  setup: {
    view: string;
    phone: string;
    distance: string;
    inFrame: string;
    tips: string[];
  };
  postureHint: string;
  /** Criteria that cannot be judged from a single phone camera in the recommended view. */
  notAssessable: string[];
  /** Criteria that would need a model/data the app does not have. */
  unavailable: string[];
  /** Variant-specific replacements (e.g. a different camera view). */
  variantOverrides?: Partial<Record<VariantId, Partial<Pick<ExerciseInfo, 'setup' | 'postureHint' | 'notAssessable' | 'targetLabel'>>>>;
}

/** Exercise info with the variant-specific texts applied. */
export function exerciseInfo(id: ExerciseId, variant: VariantId): ExerciseInfo {
  const base = EXERCISES[id];
  const o = base.variantOverrides?.[variant];
  return o ? { ...base, ...o } : base;
}

const COMMON_TIP = 'Telefon nieruchomo, bez skrajnej perspektywy (nie od dołu ani tuż przy ciele), potrzebne stawy przez cały czas w kadrze.';

export const EXERCISES: Record<ExerciseId, ExerciseInfo> = {
  squat: {
    id: 'squat',
    name: 'Przysiad',
    subtitle: 'Cykle i głębokość · widok z boku',
    icon: 'human-handsup',
    kind: 'reps',
    variants: [{ id: 'standard', label: 'Przysiad' }],
    restLabel: 'Stanie',
    extremeLabel: 'Dół',
    phaseLabels: { away: 'Zejście', extreme: 'Dół', back: 'Wstawanie' },
    targetLabel: (v) => `kolano ≤ ${v}°`,
    setup: {
      view: 'Widok z boku (profil) – tylko tak da się zmierzyć głębokość.',
      phone: 'Telefon pionowo, oparty na wysokości ok. bioder.',
      distance: 'Ok. 2–3 m od Ciebie.',
      inFrame: 'W kadrze: barki, biodra, kolana i kostki.',
      tips: [COMMON_TIP],
    },
    postureHint: 'Stań bokiem do kamery, cała sylwetka w kadrze.',
    notAssessable: ['Koślawienie kolan', 'Symetria lewa–prawa', 'Rozstaw stóp'],
    unavailable: [],
  },
  plank: {
    id: 'plank',
    name: 'Deska',
    subtitle: 'Na przedramionach · czas w pozycji',
    icon: 'timer-outline',
    kind: 'hold',
    variants: [{ id: 'standard', label: 'Na przedramionach' }],
    restLabel: 'Deska',
    extremeLabel: 'Deska',
    phaseLabels: { away: 'Deska', extreme: 'Deska', back: 'Deska' },
    setup: {
      view: 'Widok z boku (profil).',
      phone: 'Telefon poziomo, oparty stabilnie na podłodze.',
      distance: 'Ok. 1,5–2,5 m od Ciebie.',
      inFrame: 'W kadrze: barki, łokcie, nadgarstki, biodra, kolana i kostki.',
      tips: [COMMON_TIP],
    },
    postureHint: 'Przyjmij deskę: przedramiona na podłodze, łokcie pod barkami, ciało w jednej linii.',
    notAssessable: ['Neutralność kręgosłupa (prosty odcinek szkieletu jej nie dowodzi)', 'Symetria lewa–prawa'],
    unavailable: [],
  },
  pushup: {
    id: 'pushup',
    name: 'Pompka',
    subtitle: 'Cykle i zakres · z boku lub od przodu',
    icon: 'arm-flex',
    kind: 'reps',
    variants: [
      { id: 'standard', label: 'Klasyczna' },
      { id: 'knees', label: 'Na kolanach' },
    ],
    restLabel: 'Góra',
    extremeLabel: 'Dół',
    phaseLabels: { away: 'Opuszczanie', extreme: 'Dół', back: 'Wypychanie' },
    targetLabel: (v) => `łokieć ≤ ${v}° (z obniżenia barków)`,
    setup: {
      view: 'Z boku albo od przodu – liczy w obu ustawieniach.',
      phone: 'Telefon nieruchomo na podłodze: z boku – poziomo, od przodu – pionowo przed głową.',
      distance: 'Z boku ok. 1,5–2,5 m, od przodu ok. 1–1,5 m przed dłońmi.',
      inFrame: 'W kadrze: barki i dłonie przez cały czas (łokcie, biodra i stopy – jeśli się mieszczą).',
      tips: [
        'Naciśnij START, a w czasie odliczania przyjmij podpór na prostych rękach – liczenie rusza samo.',
        'Głębokość liczona jest z obniżenia barków względem dłoni, w porównaniu z Twoim wyprostem na górze.',
        COMMON_TIP,
      ],
    },
    postureHint: 'Przyjmij podpór, ręce proste, barki i dłonie w kadrze.',
    notAssessable: ['Rozstaw dłoni i łokci', 'Symetria lewa–prawa', 'Linia ciała – tylko w widoku z boku'],
    unavailable: [],
  },
  bench: {
    id: 'bench',
    name: 'Wyciskanie',
    subtitle: 'Sztanga na płaskiej ławce',
    icon: 'weight',
    kind: 'reps',
    variants: [{ id: 'standard', label: 'Płaska ławka' }],
    restLabel: 'Ręce wyprostowane',
    extremeLabel: 'Dół',
    phaseLabels: { away: 'Opuszczanie', extreme: 'Dół', back: 'Wyciskanie' },
    targetLabel: (v) => `łokieć ≤ ${v}°`,
    setup: {
      view: 'Ustaw telefon tak, by obserwowane ramię poruszało się możliwie w płaszczyźnie obrazu (zwykle z boku, na wysokości ławki).',
      phone: 'Telefon poziomo, nieruchomo; talerze nie mogą zasłaniać łokcia.',
      distance: 'Ok. 1,5–2,5 m od ławki.',
      inFrame: 'W kadrze: bark, łokieć, nadgarstek i biodro strony bliższej kamerze.',
      tips: [
        'Licznik startuje dopiero po zdjęciu sztangi i stabilnym zatrzymaniu na wyprostowanych rękach. Zdejmowanie i odkładanie nie jest liczone.',
        'Ćwicz z asekuracją – aplikacja tylko mierzy ruch.',
        COMMON_TIP,
      ],
    },
    postureHint: 'Połóż się na ławce, sztanga nad barkami na wyprostowanych rękach.',
    notAssessable: ['Rozstaw chwytu', 'Symetria lewa–prawa', 'Łuk w odcinku piersiowym (nie oceniany regułami deski)'],
    unavailable: [
      'Kontakt sztangi z klatką (nie da się go stwierdzić z samego kąta łokcia)',
      'Tor i prędkość sztangi (brak modelu śledzenia sztangi)',
    ],
  },
  pullup: {
    id: 'pullup',
    name: 'Podciąganie',
    subtitle: 'Ścisłe · cykle i zakres',
    icon: 'weight-lifter',
    kind: 'reps',
    variants: [{ id: 'strict', label: 'Ścisłe' }],
    restLabel: 'Zwis',
    extremeLabel: 'Góra',
    phaseLabels: { away: 'Podciąganie', extreme: 'Góra', back: 'Opuszczanie' },
    targetLabel: (v) => `łokieć ≤ ${v}°`,
    setup: {
      view: 'Ustaw telefon tak, by obserwowane ramię poruszało się możliwie w płaszczyźnie obrazu (zwykle przodem lub tyłem do kamery). Kołysanie da się ocenić tylko z boku.',
      phone: 'Telefon pionowo, skierowany lekko w górę, nieruchomo.',
      distance: 'Ok. 2–3 m od drążka.',
      inFrame: 'W kadrze: dłonie na drążku, łokcie i barki (najlepiej też biodra).',
      tips: [COMMON_TIP],
    },
    postureHint: 'Złap drążek i zawiśnij na prostych rękach (dłonie nad barkami).',
    notAssessable: ['Symetria lewa–prawa'],
    unavailable: ['Broda nad drążkiem (brak detekcji drążka i punktu brody) – pełny zakres niezweryfikowany'],
  },
  abs: {
    id: 'abs',
    name: 'Brzuszki',
    subtitle: 'Crunch lub sit-up · widok z boku',
    icon: 'human-male-board',
    kind: 'reps',
    variants: [
      { id: 'crunch', label: 'Crunch' },
      { id: 'situp', label: 'Sit-up' },
    ],
    restLabel: 'Leżenie',
    extremeLabel: 'Uniesienie',
    phaseLabels: { away: 'Unoszenie', extreme: 'Góra', back: 'Powrót' },
    targetLabel: (v, variant) => (variant === 'crunch' ? `tułów +${v}° od leżenia` : `tułów ≥ ${v}° od podłoża`),
    setup: {
      view: 'Widok z boku (profil).',
      phone: 'Telefon poziomo, oparty stabilnie na podłodze.',
      distance: 'Ok. 1,5–2,5 m od Ciebie.',
      inFrame: 'W kadrze: barki, biodra, kolana i kostki.',
      tips: ['Liczy się uniesienie tułowia (biodro–bark). Sam ruch głowy nie jest powtórzeniem.', COMMON_TIP],
    },
    postureHint: 'Połóż się na plecach bokiem do kamery, kolana zgięte, stopy na podłodze.',
    notAssessable: ['Zgięcie odcinka lędźwiowego (kąt biodro–bark go nie mierzy)', 'Symetria lewa–prawa'],
    unavailable: [],
  },
  jumprope: {
    id: 'jumprope',
    name: 'Skakanka',
    subtitle: 'Podskoki obunóż',
    icon: 'jump-rope',
    kind: 'jumps',
    variants: [{ id: 'basic', label: 'Obunóż' }],
    restLabel: 'Stanie',
    extremeLabel: 'Lot',
    phaseLabels: { away: 'Wybicie', extreme: 'Lot', back: 'Lądowanie' },
    setup: {
      view: 'Przodem lub bokiem – widoczna cała sylwetka i obie stopy.',
      phone: 'Telefon pionowo, oparty nieruchomo na wysokości ok. 0,5–1 m.',
      distance: 'Ok. 2,5–3,5 m od Ciebie, z zapasem miejsca pod stopami.',
      inFrame: 'W kadrze: biodra, kolana, kostki i stopy (palce).',
      tips: ['Liczone są podskoki (oderwanie obu stóp – lot – lądowanie), nie obroty skakanki.', COMMON_TIP],
    },
    postureHint: 'Stań prosto, cała sylwetka razem ze stopami w kadrze.',
    notAssessable: ['Symetria lewa–prawa przy widoku z boku'],
    unavailable: ['Obroty skakanki i double unders (linka nie jest śledzona)'],
  },
};

export const DEFAULT_VARIANT: Record<ExerciseId, VariantId> = {
  squat: 'standard',
  plank: 'standard',
  pushup: 'standard',
  bench: 'standard',
  pullup: 'strict',
  abs: 'crunch',
  jumprope: 'basic',
};
