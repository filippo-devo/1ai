# RepCounter — prototyp licznika pompek, przysiadów i podciągnięć

Aplikacja mobilna (Expo / React Native), która liczy powtórzenia na żywo na podstawie
estymacji pozy z kamery telefonu. Obraz jest przetwarzany **wyłącznie na urządzeniu**:
nic nie jest nagrywane, zapisywane ani wysyłane. Każda klatka trafia do modelu i jest
od razu zwalniana (`frame.dispose()`).

Priorytetem prototypu jest poprawne liczenie, nie wygląd.

---

## 1. Stack (wersje sprawdzone w npm 2026-11-01)

| Element | Wersja | Rola |
|---|---|---|
| Expo SDK | 58 (`expo ~58.0.22`, React Native 0.88.1) | projekt, Expo Router, config pluginy |
| `react-native-vision-camera` | 5.2.4 | kamera, wyjście klatek (Frame Output) |
| `react-native-vision-camera-worklets` + `react-native-worklets` | 5.2.4 / 0.13.0 | kod JS (worklet) na wątku kamery |
| `react-native-vision-camera-resizer` | 5.2.4 | obrót + konwersja YUV→RGB + skalowanie na GPU (Metal / Vulkan) |
| `react-native-fast-tflite` | 3.0.1 | inferencja TensorFlow Lite (LiteRT) na urządzeniu |
| Model | **MoveNet SinglePose Lightning, int8, v4** (Google, Apache-2.0) | 17 punktów ciała |
| `expo-speech`, `expo-keep-awake` | SDK 58 | odczyt liczby powtórzeń, ekran nie gaśnie |

Silnik natywny (VisionCamera, Nitro Modules, resizer, TFLite) wymaga buildu EAS — Expo Go go nie zawiera;
w Expo Go aplikacja automatycznie używa silnika WebView + MediaPipe (sekcja 1a). Projekt ma zainstalowany
`expo-dev-client` i profil `development` w `eas.json`.

Dlaczego tak:
- VisionCamera v5 to aktualna, utrzymywana linia (v4 nie jest rozwijana od 11.2025).
  Pakiety resizer/worklets to oficjalna ścieżka ML w v5 (opisana w dokumentacji „Resizing/Converting Frames”).
- MoveNet jest modelem jednoetapowym (obraz → 17 punktów + pewność), co daje prosty,
  w pełni weryfikowalny potok bez własnego kodu natywnego.

Model w `assets/models/` ma sygnaturę sprawdzoną interpreterem LiteRT:
wejście `uint8 [1,192,192,3]`, wyjście `float32 [1,1,17,3]` (y, x, score).
Plik pochodzi z mirrora na GitHubie (TF Hub/Kaggle były niedostępne w środowisku,
w którym powstał prototyp). **Uruchom raz `bash scripts/verify-model.sh`** — pobierze oficjalny
plik i porówna SHA-256.

---

## 1a. Dwa silniki wykrywania pozy (wybierane automatycznie)

| Gdzie działa aplikacja | Silnik | Szczegóły |
|---|---|---|
| **Expo Go** (iPhone/Android, bez własnego buildu) | MediaPipe Pose Landmarker w WebView | kamera przez `getUserMedia`, model `pose_landmarker_full` (Google), WebAssembly/WebGL na telefonie; biblioteka `@mediapipe/tasks-vision@1.1.1` i model pobierane przy pierwszym uruchomieniu (~10 MB), obraz nie opuszcza telefonu |
| **Build EAS** (development / preview) | MoveNet Lightning (TFLite) przez VisionCamera | natywnie, szybciej, bez pobierania modelu |

Wybór robi `src/camera/PoseCamera.tsx`: jeśli w aplikacji jest natywny moduł Nitro → silnik natywny,
w przeciwnym razie (Expo Go) → WebView. Moduły natywne są ładowane tylko wtedy, gdy istnieją,
dlatego Expo Go nie zgłasza już błędu „NitroModules could not be found”.
Logika liczenia (maszyna stanów, progi, kalibracja) jest wspólna dla obu silników.

### Expo Go (najprostszy sposób, także na iPhonie)
Każdy push na `main` publikuje aktualizację na kanał **`expo-go`** (z `runtimeVersion` `exposdk:58.0.0`).
W Expo Go zaloguj się na konto `filiocha` → **Projects → repcounter → expo-go** → otwórz najnowszą aktualizację.
Przy pierwszym uruchomieniu zezwól Expo Go na dostęp do kamery.

## 2. Uruchomienie na fizycznym telefonie

Wymagania: Node 20+ (testowane na 22), fizyczny telefon (symulator/emulator nie ma sensownej
kamery), Android 8.0+ (API 26, wymagane przez resizer; GPU z Vulkanem) lub iPhone.

```bash
npm install
```

### Android (lokalnie, Android Studio + SDK + NDK)
Włącz w telefonie „Debugowanie USB”, podłącz kablem, potem:

```bash
npx expo run:android --device
```

### iOS (macOS + Xcode)
```bash
npx expo run:ios --device
```

`run:*` wykonuje `expo prebuild` (generuje `android/` i `ios/` z `app.json` — tych katalogów
nie edytuje się ręcznie), buduje development build i instaluje go na telefonie.
Kolejne zmiany w JS: wystarczy `npm start` (Metro z dev-clientem).

### Alternatywa bez lokalnego SDK: EAS Build
```bash
npx eas-cli@latest build --profile development --platform android
```
Zainstaluj otrzymany APK na telefonie, potem `npm start` i zeskanuj kod QR w aplikacji.

### Projekt na expo.dev, buildy i aktualizacje przez GitHub Actions
Projekt EAS: https://expo.dev/accounts/filiocha/projects/repcounter (sekret repozytorium `EXPO_TOKEN`).

- W Expo Go aplikacja działa z silnikiem WebView + MediaPipe (kanał `expo-go`, sekcja 1a); build EAS używa silnika natywnego.
- **Actions → „EAS build (Android)” → Run workflow**:
  - `preview` – samodzielna aplikacja z wbudowanym kodem JS (nie wymaga komputera), odbiera aktualizacje z kanału `preview`;
  - `development` – development client (kod JS z `npm start` na komputerze).
- **Każdy push na `main`** uruchamia „EAS Update”: typecheck + testy, potem publikacja aktualizacji na kanał `preview`.
  Zainstalowana aplikacja `preview` pobiera ją przy uruchomieniu (zmiana widoczna po ponownym otwarciu aplikacji).
- `runtimeVersion` = odcisk natywnej części projektu (`fingerprint`): aktualizacja trafia tylko do zgodnych buildów.
  Po dodaniu/zmianie natywnej biblioteki trzeba zrobić nowy build.

### Wydajność
Build debug jest wolniejszy. Do oceny płynności liczenia użyj wersji release:

```bash
npx expo run:android --device --variant release
```

```bash
npx expo run:ios --device --configuration Release
```

W trybie debugowania aplikacji (przełącznik „Debug”) widać fps i czas „inferencja+crop” na klatkę.

---

## 3. Przebieg treningu

1. **Wybór ćwiczenia** (+ przełączniki: odczyt głosowy, tryb debugowania).
2. **Ustawienie**: podgląd kamery (pokazywany cały kadr analizowany przez model — `resizeMode="contain"`),
   przycisk przedniej/tylnej kamery, instrukcja ustawienia telefonu dla ćwiczenia (orientacja,
   odległość, kąt, wymagane części ciała), lista widoczności: ✓/✗ barki, łokcie, nadgarstki, biodra…
3. **Kalibracja** (automatyczna): przyjmij pozycję startową i nie ruszaj się ~1,2 s
   (pompki: podpór na prostych rękach, przysiady: stanie, podciągnięcia: zwis na prostych rękach).
   Mierzy kąt startowy i dopasowuje do niego próg pozycji startowej.
4. **Start** (aktywny po kalibracji) → **5 s odliczania** → automatyczne liczenie.
5. **Trening**: duży licznik, czas (bez pauz), komunikat fazy, przyciski **Pauza/Wznów** i **Zakończ**.
   Gdy sylwetka zniknie: czerwony komunikat **„Ustaw się w kadrze”** (+ czego nie widać), liczenie wstrzymane.
6. **Podsumowanie**: ćwiczenie, liczba powtórzeń, czas (+ liczba niepełnych powtórzeń).

Przetwarzanie zatrzymuje się, gdy ekran treningu nie jest aktywny (nawigacja, aplikacja w tle —
wtedy trening automatycznie się pauzuje); po opuszczeniu ekranu kamera jest zwalniana.
Odmowa uprawnień: ekran z prośbą o dostęp, a po trwałej odmowie — przycisk do ustawień systemu.

---

## 4. Jak działa wykrywanie

```
Frame (YUV, VGA 4:3)
  └─ Resizer GPU: obrót do pionu, YUV→RGB, 'contain' do 384×384 (czarne pasy)
       └─ smart crop: kwadrat wokół osoby z poprzedniej klatki → 192×192 (src/pose/crop.ts)
            └─ MoveNet Lightning (TFLite, CPU) → 17 punktów (y, x, pewność)
                 └─ mapowanie: crop → kwadrat → obraz pionowy (src/pose/movenet.ts)
                      └─ wątek JS: cechy ćwiczenia → kalibracja / maszyna stanów
```

**Smart crop** to algorytm kadrowania zalecany przez autorów MoveNet. Bez niego na dole pompki
(sylwetka zajmuje kilkadziesiąt pikseli w wejściu 192 px) model gubił ręce — na prawdziwym
nagraniu pompek liczba zaliczonych powtórzeń wynosiła **0/4 bez cropa i 4/4 z cropem** (sekcja 6).

### Sygnały na ćwiczenie (`src/counting/features.ts`)

**Deska** jest liczona w czasie, nie w powtórzeniach (`src/counting/plankTimer.ts`): czas rośnie tylko wtedy, gdy
pozycja jest poprawna przez co najmniej 0,4 s (histereza kąta 160°/148°, kalibracja może obniżyć próg do 152°).
Opadające biodra, wstanie, położenie się lub wyjście z kadru zatrzymują zegar; czas, gdy osoby nie widać, nigdy nie jest doliczany.
Odczyt głosowy co 10 s. Testy: `__tests__/plank.test.ts`. Brzuszki i deska są sprawdzone tylko na danych syntetycznych.

| Ćwiczenie | Kąt główny (duży = start) | Sygnał pomocniczy (względem pozycji startowej, ÷ długość segmentu) | Kontrola postawy |
|---|---|---|---|
| Pompki | łokieć (bark–łokieć–nadgarstek) | opuszczenie barków w kierunku dłoni ÷ długość ręki | tułów (bark–biodro) ≤ 50° od poziomu, barki nad dłońmi |
| Przysiady | kolano (biodro–kolano–kostka) | obniżenie bioder ÷ długość uda | tułów ≥ 25° od poziomu, barki nad biodrami nad kostkami |
| Podciągnięcia | łokieć | uniesienie barków w kierunku dłoni ÷ długość ręki | dłonie nad barkami (zwis) |
| Brzuszki | biodro (bark–biodro–kolano), ~135° leżenie → ≤80° siad | uniesienie barków nad biodra ÷ długość tułowia | biodra i stopy na podłodze, kolana zgięte |
| Deska (czas) | linia ciała (bark–biodro–kostka) ≥160° | – | ciało poziomo, barki uniesione nad podłogą, łokcie pod barkami |

Strona ciała: pompki — strona z wyższą pewnością (druga ręka jest zasłonięta przy widoku z boku);
przysiady i podciągnięcia — średnia obu stron, gdy obie są widoczne.

**Podciągnięcia:** model nie rozpoznaje drążka, więc aplikacja **nie sprawdza, czy broda jest
nad drążkiem**. Zalicza ruch: proste ręce → zgięte łokcie i barki uniesione ku dłoniom → proste ręce.

### Maszyna stanów (`src/counting/repCounter.ts`)

```
unknown ──(pozycja startowa)──▶ start ──▶ down ──▶ target ──▶ up ──▶ start  ⇒ +1
                                  ▲          │                 │
                                  └──────────┘ (powrót bez osiągnięcia celu ⇒ „niepełne”, bez liczenia)
```

- Powtórzenie liczy się **dopiero po powrocie do pozycji startowej** po osiągnięciu celu: jeden pełny cykl = 1.
- Cel wymaga **jednocześnie** kąta ≤ próg i przemieszczenia ≥ próg.
- **Histereza**: osobne progi wejścia i wyjścia (np. start ≥150°, wyjście <138°), więc szum przy progu nie przełącza fazy.
- **Wygładzanie**: filtr One Euro (adaptacyjny — mocno wygładza drgania w bezruchu, mało opóźnia szybki ruch, więc działa przy różnym tempie).
- **Potwierdzenie fazy**: zmiana fazy wymaga 2 kolejnych klatek (pojedyncze „skoki” punktów są ignorowane).
- **Minimalny czas powtórzenia** (300–450 ms): szybsze „cykle” traktowane jako drgania.
- **Proporcje ciała**: przemieszczenia są dzielone przez długości segmentów mierzone na żywo,
  a punkt odniesienia jest pobierany w pozycji startowej każdego powtórzenia — niezależne od wzrostu i odległości od kamery.
- **Utrata sylwetki**: brak wymaganego punktu (pewność < 0,3) przez < 400 ms — faza zamrożona;
  dłużej — stan `lost`, komunikat „Ustaw się w kadrze”, **faza resetowana do `unknown`**.
  Przerwane powtórzenie przepada, a po powrocie trzeba najpierw ponownie przyjąć pozycję startową —
  **ponowne wykrycie sylwetki nigdy samo nie dodaje powtórzenia**. To samo po pauzie i zmianie kamery.
- **Zła postawa** (np. wstanie w trakcie pompek, puszczenie drążka) przez 6 klatek — reset fazy.

### Strojenie progów
Wszystkie progi są w jednym pliku: **`src/counting/config.ts`** (opisane komentarzami).
Najważniejsze:
- `targetEnterDeg` / `auxTargetEnter` — wymagana głębokość (np. przysiad: kolano ≤ 100°, biodra ≥ 0,30 długości uda w dół),
- `startEnterDeg` / `startExitDeg` — pozycja startowa (kalibracja może go obniżyć do `minStartEnterDeg`),
- `minRepMs`, `dwellFrames`, `TRACKING.lostAfterMs`, `TRACKING.minKeypointScore`, parametry filtrów.

Tryb debugowania pokazuje: szkielet (zielone = punkty pewne, czerwone = niepewne, duże = używane przez ćwiczenie),
kąty surowe i wygładzone, przemieszczenie, pewność, stronę ciała, fazę, aktualne progi, fps
i **historię zdarzeń z uzasadnieniem** (np. `#3 ZALICZONE, min kąt 72°, przem. 0.55, 1.4 s`
albo `niepełne (za płytko)`), więc widać, dlaczego powtórzenie zostało (nie)zaliczone.

---

## 5. Testy

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

- `__tests__/counting.test.ts` — logika zliczania na zsyntetyzowanych sekwencjach pozy
  (kinematyka 2D, deterministyczny szum) dla **każdego z trzech ćwiczeń**: pełne powtórzenia,
  niepełne (zgłaszane jako „niepełne”, nie liczone), drgania w pozycji startowej, drżenie ±12°,
  „sprężynowanie” na dole, pojedyncze skoki punktów, tempo szybkie/wolne, 10/30/60 fps,
  różne proporcje ciała i odległości, utrata sylwetki w trakcie powtórzenia, wielokrotne
  znikanie i pojawianie się, zniknięcie na dole i powrót na górze, krótki zanik (2 klatki),
  kalibracja i jej warunki, bramki postawy, spójność progów.
- `__tests__/pose.test.ts` — dekodowanie MoveNet, letterbox, orientacja klatek, crop, próbkowanie.
- `__tests__/realVideo.test.ts` — odtwarza wyniki **prawdziwego modelu** na **prawdziwych nagraniach**
  przez kod aplikacji (sekcja 6). Bez danych testy są pomijane.

## 6. Weryfikacja na prawdziwych nagraniach (bez telefonu)

```bash
npm run verify:videos
```

Skrypt pobiera dwa publiczne nagrania demo (Ultralytics), uruchamia **ten sam plik modelu** w LiteRT,
emulując potok aplikacji (resizer 'contain' 384 → smart crop → 192), i przepuszcza wyniki przez
kod TS aplikacji. Test krzyżowy potwierdza, że TS i Python liczą identyczne regiony cropa w każdej klatce.
Nagrania i dane pochodne trafiają do `fixtures/` (ignorowane przez git).

| Nagranie | Prawda (policzone ręcznie) | 30 fps | co 3. klatka (~10 fps) | bez smart crop |
|---|---|---|---|---|
| Pompki, widok z boku, 1920×1080 | 4 | **4** | **4** | 0 (gubienie rąk na dole) |
| Przysiady, widok ~45°, 1920×1080 | 4 | **4** | **4** | 4 |
| Podciągnięcia | — | brak publicznego nagrania dostępnego w środowisku | | |

Dodatkowo na prawdziwych danych pompek zasymulowano zasłonięcie osoby w trakcie 3. powtórzenia:
licznik pokazuje 3 (przepada tylko przerwane powtórzenie, powrót sylwetki niczego nie dolicza).

Silnik Expo Go (MediaPipe Pose Landmarker, `scripts/verify/extract_mediapipe.py`, ten sam model co w WebView),
przez `mediapipeToCoco()` i ten sam licznik: **pompki 4/4, przysiady 4/4** — modele full i lite, 30 i ~10 kl./s.
Strona WebView została dodatkowo uruchomiona w headless Chromium z wirtualną kamerą odtwarzającą nagranie pompek:
kamera, model i nakładka szkieletu działają.

Własne nagranie podciągnięć: zapisz jako `fixtures/videos/pullups.mp4` (4 pełne powtórzenia) i uruchom skrypt ponownie.

---

## 7. Co zostało przetestowane, a co wymaga jeszcze weryfikacji

**Przetestowane w tym środowisku (bez telefonu):**
- logika zliczania, kalibracja, histereza, wygładzanie, utrata sylwetki — testy jednostkowe (wszystkie 3 ćwiczenia);
- sygnatura modelu i jego działanie na prawdziwych nagraniach pompek i przysiadów (liczba powtórzeń zgodna z ręcznym liczeniem, również przy ~10 fps);
- zgodność implementacji cropa TS ↔ Python, mapowanie współrzędnych (letterbox, orientacja — zgodnie z kodem shadera resizera);
- typecheck, lint, zbudowanie bundli JS dla Androida i iOS (`expo export`) — worklety poprawnie transformowane, model dołączony jako asset;
- `expo prebuild`: uprawnienie kamery, `minSdkVersion 26`, opis uprawnienia na iOS, obrót ekranu;
- `expo-doctor`: 18/20 (2 testy wymagają API Expo, niedostępnego w środowisku).

**Wymaga weryfikacji na prawdziwym telefonie i kamerze:**
- natywna kompilacja (Android SDK/NDK i Xcode nie były dostępne) — pierwsze `npx expo run:android|ios`;
- działanie potoku kamery na urządzeniu: resizer GPU, `runSync` TFLite w workletcie, fps;
  cel: ≥ 15 fps (czas „inferencja+crop” widać w trybie debug; próbkowanie cropa w JS to ~4 ms/klatkę bez JIT na serwerze, na telefonie może być wolniej);
- poprawność nakładki szkieletu względem podglądu (konwersja Frame → Camera → View, w tym lustrzane odbicie przedniej kamery i orientacja pozioma);
- **podciągnięcia na prawdziwym ruchu** (zweryfikowane tylko syntetycznie);
- pompki w innych wariantach niż na nagraniu (klasyczne z podłogi, inna odległość/oświetlenie), przysiady dokładnie z boku i przodem;
- odczyt głosowy (`pl-PL` musi być dostępny w syntezatorze systemu);
- ewentualne dostrojenie progów w `config.ts` na podstawie trybu debug.

### Scenariusze ręcznego sprawdzenia (każdy dla pompek, przysiadów i podciągnięć)

Ustaw telefon zgodnie z instrukcją na ekranie, włącz „Debug”.

| # | Scenariusz | Oczekiwany wynik |
|---|---|---|
| 1 | Kalibracja: stań/podeprzyj się/zawiśnij w pozycji startowej | ✓ przy wszystkich częściach ciała, „Kalibracja OK (kąt …°)”, Start aktywny |
| 2 | 5 pełnych powtórzeń w normalnym tempie | licznik 5, każde zdarzenie „ZALICZONE” w debug |
| 3 | 3 pełne + 3 płytkie (do połowy zakresu) | licznik 3, w debug 3× „niepełne (za płytko)” |
| 4 | 15 s bez ruchu w pozycji startowej, potem lekkie kołysanie | licznik bez zmian |
| 5 | Szybkie powtórzenia (ok. 1 s) i bardzo wolne (4–5 s) | każde policzone dokładnie raz |
| 6 | W trakcie powtórzenia wyjdź z kadru, wróć w pozycji startowej | „Ustaw się w kadrze”, to powtórzenie nie jest liczone, następne pełne już tak |
| 7 | Wyjdź z kadru w pozycji startowej i wróć kilka razy | licznik bez zmian |
| 8 | Pauza w połowie ruchu → Wznów | brak dodatkowego powtórzenia; liczenie od nowej pozycji startowej |
| 9 | Przełącz kamerę przód/tył | podgląd się zmienia, szkielet pokrywa się z sylwetką (także lustrzanie na przedniej) |
| 10 | Telefon poziomo (pompki) | interfejs i szkielet obracają się poprawnie, liczenie działa |
| 11 | Wyjdź do ekranu głównego telefonu w trakcie treningu | trening się pauzuje, kamera wyłącza się |
| 12 | Odmów uprawnienia kamery, potem nadaj je w ustawieniach | komunikat + przycisk ustawień; po nadaniu podgląd działa |
| 13 | Zakończ | podsumowanie: ćwiczenie, liczba powtórzeń, czas bez pauz |
| 14 | Pompki: zginaj ręce stojąc (bez podporu) | brak liczenia (bramka postawy) |
| 15 | Podciągnięcia: puść drążek w połowie ruchu | reset, powtórzenie nie jest liczone |

---

## 8. Struktura

```
src/app/                  ekrany (Expo Router): index (wybór), workout (trening), summary
src/hooks/usePoseDetection.ts   potok kamera → resizer → crop → MoveNet (worklet)
src/pose/                 dekodowanie MoveNet, smart crop, typy punktów
src/counting/             config (progi), features, filters (One Euro), calibration, repCounter
src/components/           nakładka szkieletu, panel debug
src/testing/              generator syntetycznych sekwencji pozy, helpery testów
__tests__/                testy jednostkowe i odtwarzanie prawdziwych nagrań
scripts/verify/           weryfikacja modelu na nagraniach (Python, LiteRT)
scripts/verify-model.sh   porównanie modelu z oficjalnym wydaniem
```

## 9. Ograniczenia
- Analiza 2D z jednej kamery: kąty zależą od ustawienia telefonu — stąd instrukcje ustawienia i kalibracja.
- Jedna osoba w kadrze (MoveNet SinglePose).
- Podciągnięcia: brak wykrywania drążka i pozycji brody.
- Wymagany GPU z Vulkanem na Androidzie (resizer); przy jego braku aplikacja pokazuje komunikat.
- Czas klatek mierzony `Date.now()` w workletcie (czas przetworzenia, nie naświetlenia — różnica jest stała i nie wpływa na liczenie).
