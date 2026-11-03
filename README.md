# RepCounter — analiza ćwiczeń z kamery telefonu (prototyp)

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

1. **Wybór ćwiczenia**: przysiad, deska (na przedramionach), pompka, wyciskanie (płaska ławka),
   podciąganie (ścisłe), brzuszki (crunch / sit-up), skakanka (podskoki obunóż).
   Aplikacja **nie rozpoznaje sama, jakie to ćwiczenie** – wybiera je użytkownik.
2. **Ustawienie**: wariant (pompka klasyczna / na kolanach, crunch / sit-up), **cel zakresu**
   (np. kolano ≤ 100°, z przyciskami −/+), instrukcja ustawienia telefonu, lista widocznych punktów ciała.
3. **Kalibracja**: krótkie przytrzymanie pozycji startowej (~1,2 s) mierzy osobniczy wyprost,
   szum pomiaru i dostępność punktów. Opcjonalnie 2–3 spokojne ruchy mierzą **zakres** – zapisywany
   osobno i **nigdy** nieprzyjmowany automatycznie jako cel.
4. **Start** → 5 s odliczania → analiza.
5. **Trening**: duża liczba (cykle z osiągniętym celem / czas w tolerancji / podskoki), pod nią
   rozbicie (cykle, cel nieosiągnięty, nieocenialne), **jedna wskazówka naraz**, czas, pauza, koniec.
6. **Podsumowanie**: liczby rozdzielone na kategorie, pomiary zakresu i tempa, jakość danych,
   lista kryteriów „Nie można ocenić z tego ustawienia” i „Niedostępne”. Bez oceny techniki 0–100.

Przetwarzanie zatrzymuje się po opuszczeniu ekranu i w tle (trening się pauzuje). Nic nie jest nagrywane
ani zapisywane – wynik ostatniego treningu jest tylko w pamięci aplikacji.

---

## 4. Architektura analizy

```
kamera ─▶ adapter modelu (src/pose, src/camera)          MoveNet 17 pkt | MediaPipe 33 pkt (+pięty, palce)
           obrót, crop, letterbox, odbicie cofnięte → współrzędne obrazu x·szer., y·wys. (piksele)
        ─▶ geometria (src/analysis/geometry.ts)          kąty, odchylenie podpisane, nachylenia; brak punktu ⇒ null
        ─▶ metryki ćwiczenia (src/analysis/metrics.ts)   wymagane punkty, wybór strony, jakość, postawa
        ─▶ filtracja (src/analysis/filters.ts)           One Euro / EMA z rzeczywistego Δt (nie liczby klatek)
        ─▶ kalibracja (src/analysis/calibration.ts)      wyprost, szum, dostępność; zmierzony zakres osobno
        ─▶ detektory (src/analysis/detectors/*)          cykle | deska | podskoki
        ─▶ wskazówki i wyniki (hints.ts, session.ts)     jedna wskazówka; rekordy cykli i podsumowanie
        ─▶ prezentacja (src/app, src/components)
```

Cała logika od geometrii do wyników jest czysto obliczeniowa i testowana bez kamery
na zapisanych lub syntetycznych sekwencjach landmarków (`src/testing`, `__tests__`).

### Geometria i konwencje
- `angle(A,B,C)` – wierzchołek w B: `acos(clamp(dot(A−B,C−B)/(|A−B||C−B|), −1, 1))`, w stopniach;
  brakujący punkt lub odcinek krótszy niż 2 px ⇒ **niedostępne** (null), nigdy wartość zastępcza.
- 180° = wyprost. Kolano = biodro–kolano–kostka, łokieć = bark–łokieć–nadgarstek,
  biodro = bark–biodro–kolano, linia ciała = bark–biodro–kostka. Nachylenie tułowia do podłoża to osobna metryka.
- Współrzędne: znormalizowane wartości są przeliczane na piksele (x·szerokość, y·wysokość) obrazu po
  cofnięciu obrotu, cropa, letterboxingu i odbicia. Nie są mieszane ze współrzędnymi 3D (world) –
  aplikacja ich nie używa; zmiana sposobu pomiaru wymagałaby ponownej walidacji progów.
- Odchylenie bioder: podpisana odległość od linii bark–kostka ÷ długość tej linii;
  **+** = poniżej linii (opadanie), **−** = powyżej (uniesienie), niezależnie od kierunku, w którym stoi osoba.

### Wiarygodność
- Każda metryka ma wartość albo „niedostępne”, jakość (minimalna pewność użytych punktów) i stronę pomiaru.
- Oceniane są tylko punkty wymagane dla danej metryki. Próg widoczności zależy od modelu
  (MediaPipe 0,7 – „visibility”; MoveNet 0,3 – inna skala) i **nie oznacza dokładności kąta**.
- Widok boczny: jedna strona, **nigdy uśredniana** z zasłoniętą. Widok z przodu (podciąganie): obie strony
  uśredniane tylko, gdy obie są widoczne; inaczej pomiar jednostronny (oznaczony w wynikach).
- Strona jest **blokowana na czas powtórzenia**: jej utrata ⇒ brak danych (luka), a nie przeskok na drugą stronę.

### Detektor cykli (wszystkie ćwiczenia na powtórzenia)
Stany techniczne: `NOT_READY → READY → ACTIVE`, oraz `TRACKING_LOST`. Fazy cyklu: ruch od pozycji
startowej → strefa celu → powrót. Zasady:
- histereza progów (np. przysiad: wejście w „górę” ≥ 165°, wyjście < 155°),
- wymagane przejście przez kolejne fazy, minimalna amplituda = max(próg, 4 × zmierzony szum),
- **koniec ruchu potwierdzany zmianą kierunku** – zatrzymanie w dole nie jest potrzebne,
- osiągnięcie celu zapisywane **osobno** od wykrycia cyklu,
- osobny minimalny czas cyklu dla każdego ćwiczenia (skakanka ma własny, szybki detektor),
- luka w danych dłuższa niż 250 ms w trakcie cyklu ⇒ cykl **nieocenialny** i ponowna synchronizacja w pozycji
  startowej (punkty sprzed luki nie są używane).

### Reguły ćwiczeń (progi robocze w `src/analysis/config.ts`)
| Ćwiczenie | Liczenie | Cel zakresu (domyślny, zmienialny) | Monitorowane / uwagi |
|---|---|---|---|
| Przysiad | kolano: góra ≥ 165° **i** biodra wróciły do stania (bark–biodro–kolano ≥ 150°) | kolano ≤ 100° (opcje 110…70°) | nachylenie tułowia tylko informacyjnie; wyjście kolan przed palce nie jest karane |
| Deska | czas | łokieć 80–100°, kolano ≥ 165°, bark–biodro–kolano ≥ 165°, \|odchylenie bioder\| ≤ 0,05 (+ tolerancja szumu, histereza) | czas: całkowity, w pozycji, ocenialny, w tolerancji, najdłuższy ciągły, nieocenialny |
| Pompka | łokieć: góra ≥ 165° | łokieć ≤ 100° **i** barki w dół o ≥ 0,2 długości ręki | linia ciała (bark–biodro–kostka / –kolano) do 15° – wskazówka; wykrycie wariantu na kolanach |
| Wyciskanie | łokieć: góra ≥ 165°; licznik aktywny dopiero po **1 s stabilnego wyprostu** | łokieć ≤ 100° **i** nadgarstki w dół o ≥ 0,2 długości ręki | ruch głównie poziomy (zdejmowanie/odkładanie) nie jest liczony; kontakt z klatką, tor i prędkość sztangi **niedostępne** |
| Podciąganie (ścisłe) | łokieć: dół ≥ 160° | łokieć ≤ 90° **i** barki w górę o ≥ 0,3 długości ręki | broda nad drążkiem **niezweryfikowana** (brak detekcji drążka i brody); kołysanie tylko z widoku z boku |
| Crunch | nachylenie biodro–bark względem pozycji leżącej | +20° (opcje 15–30°) | sam ruch głowy nie jest liczony; to nie jest pomiar zgięcia lędźwiowego |
| Sit-up | nachylenie biodro–bark względem podłoża | ≥ 60° (opcje 60–80°) | jw. |
| Skakanka | podskok = wybicie (obie stopy i biodra nad poziomem podłogi) → lot → lądowanie | – | z palcami stóp (MediaPipe) odróżnia skok od wspięcia na palce; bez palców (MoveNet) status „ograniczona”; rytm, przerwy, regularność; to „podskoki”, nie obroty skakanki |

Wszystkie wartości to **robocze parametry detektora, a nie normy medyczne ani zwalidowany standard techniki**.
Każda zmiana progów lub sposobu pomiaru powinna podbić `DETECTOR_VERSION` i zostać sprawdzona na danych testowych.

### Wskazówki
Najwyżej jedna naraz. Problemy z kamerą i widocznością (`setup`) mają pierwszeństwo; wskazówki o technice
pokazują się dopiero po utrzymującym się odchyleniu (0,7 s – opóźnienie dotyczy tylko komunikatów, nie liczenia).
Przy słabym obrazie aplikacja najpierw prosi o poprawienie ustawienia telefonu.

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

- `__tests__/analysis.test.ts` – geometria; dla każdego ćwiczenia na powtórzenia: pełne i częściowe ruchy,
  stanie i drżenie detekcji, małe oscylacje, płynne powtórzenia bez pauzy, zatrzymanie w połowie ruchu,
  szybkie i bardzo wolne tempo, 10/30/60 fps, różne proporcje obrazu i sylwetki, utrata punktów w kluczowej
  fazie, powrót do kadru; zasłonięta strona i jednostronny pomiar; brak przeskoku strony w trakcie powtórzenia;
  cel ustawiony przez użytkownika; wariant na kolanach; zdejmowanie i odkładanie sztangi; podciąganie bez
  weryfikacji brody; sam ruch głowy; kalibracja (zakres nie staje się celem); wskazówki.
- `__tests__/plank.test.ts` – deska: prosta, opadające i uniesione biodra (oba kierunki ustawienia),
  brak danych, ukryty nadgarstek (kryterium nieocenialne), drżenie, wstanie, FPS i rozmiary sylwetki.
- `__tests__/jump.test.ts` – podskoki: różne wysokości i tempo, 15–60 fps, **wspięcia na palce**, stanie,
  odejście od kamery, brak punktów palców (MoveNet), jedna stopa, rytm/przerwy/regularność, wyjście z kadru.
- `__tests__/pose.test.ts` – adapter modelu (letterbox, orientacja, crop, MediaPipe → COCO, pięty/palce).
- `__tests__/evaluation.test.ts` – ewaluacja na nagraniach z ręcznie opisanymi powtórzeniami (sekcja 6).

Testy syntetyczne sprawdzają **logikę**, nie dokładność na prawdziwej kamerze.

## 6. Strojenie i ewaluacja na nagraniach

```bash
npm run verify:videos
```

```bash
npm run evaluate
```

`verify:videos` pobiera dwa publiczne nagrania demo i zapisuje z nich landmarki MoveNet (potok jak w aplikacji);
`scripts/verify/extract_mediapipe.py` robi to samo dla MediaPipe (silnik Expo Go). Pliki trafiają do `fixtures/`
(nieśledzone przez git – cudze nagrania).

Opisy powtórzeń są w `scripts/evaluate/manifest.json`: czas zakończenia każdego powtórzenia, ćwiczenie,
wariant i **podział `tune` / `test`**. Progi wolno stroić tylko na nagraniach `tune`; raport dokładności podaje się
tylko dla `test`. Raport zawiera: trafione, **nieocenialne**, pominięte, fałszywe powtórzenia, błąd liczby
i udział klatek bez danych.

Aktualny wynik (wersja `v2.0-2026-11-03`; wszystkie nagrania w `test`, brak danych `tune` – progi nie były
strojone pod te nagrania):

| Nagranie (test) | Opisane | Trafione | Nieocenialne | Pominięte | Fałszywe | Klatki bez danych |
|---|---|---|---|---|---|---|
| Pompki, MoveNet 30 fps | 4 | 4 | 0 | 0 | 0 | 9,1% |
| Pompki, MoveNet ~10 fps | 4 | 2 | 2 | 0 | 0 | 12,9% |
| Pompki, MediaPipe 30 fps | 4 | 4 | 0 | 0 | 0 | 0,0% |
| Przysiady, MoveNet 30 fps | 4 | 4 | 0 | 0 | 0 | 6,3% |
| Przysiady, MoveNet ~10 fps | 4 | 3 | 1 | 0 | 0 | 8,1% |
| Przysiady, MediaPipe 30 fps | 4 | 4 | 0 | 0 | 0 | 0,0% |

To **2 nagrania, 1 osoba, 1 ustawienie kamery** – za mało, by deklarować dokładność. Przy ~10 fps MoveNet gubi
punkty na dole ruchu dłużej niż 250 ms; detektor uczciwie oznacza wtedy próbę jako nieocenialną zamiast zgadywać.

Własne nagrania: dodaj pliki do `fixtures/` i wpisy do manifestu (`split: "tune"` dla strojenia, `"test"` dla oceny),
z różnymi sylwetkami i ustawieniami telefonu.

## 7. Co zostało przetestowane, a co wymaga weryfikacji

**Sprawdzone bez telefonu:** cała logika analizy (156 testów), ewaluacja na 2 prawdziwych nagraniach (pompki,
przysiady; MoveNet i MediaPipe), typecheck, lint, bundle JS iOS/Android, podgląd interfejsu w przeglądarce
z syntetycznym strumieniem.

**Wymaga sprawdzenia na telefonie i kamerze:**
- wszystkie ćwiczenia na prawdziwym ruchu – szczególnie **deska, wyciskanie, podciąganie, brzuszki i skakanka**
  (sprawdzone tylko syntetycznie),
- odróżnianie wspięcia na palce od skoku (zależy od tego, czy MediaPipe pewnie widzi palce stóp),
- wariant na kolanach, zdejmowanie sztangi, kołysanie w widoku z boku,
- płynność (fps) w Expo Go i w buildzie natywnym.

### Scenariusze na telefonie
Ustaw telefon zgodnie z instrukcją, włącz tryb debugowania (pokazuje stan, fazę, wartość, progi, stronę, jakość,
pokrycie i historię cykli z powodami).

| # | Scenariusz | Oczekiwane |
|---|---|---|
| 1 | Kalibracja, potem 2 spokojne płytkie ruchy | „Zmierzony zakres” w panelu; cel się nie zmienia |
| 2 | 5 pełnych powtórzeń | 5 cykli z osiągniętym celem |
| 3 | 3 pełne + 3 płytkie | 6 cykli: 3 z celem, 3 „cel nieosiągnięty” |
| 4 | Stanie bez ruchu 20 s | 0 cykli |
| 5 | Płynne powtórzenia bez zatrzymania na dole | wszystkie liczone |
| 6 | Zatrzymanie w połowie ruchu i powrót | 1 cykl „cel nieosiągnięty” |
| 7 | Wyjście z kadru w dolnej fazie | „Ustaw się w kadrze”, próba nieocenialna, potem ponowne ustawienie |
| 8 | Zasłonięcie jednej strony (podciąganie przodem) | liczy, cykle oznaczone jako jednostronne |
| 9 | Pompka na kolanach przy wariancie „Klasyczna” | wskazówka o wariancie, brak „celu osiągniętego” |
| 10 | Wyciskanie: zdjęcie sztangi, 3 powtórzenia, odłożenie | 3 cykle; zdjęcie i odłożenie nieliczone |
| 11 | Brzuszki: same ruchy głową | 0 cykli |
| 12 | Deska z opadającymi biodrami | wskazówka „Biodra opadają”, czas w tolerancji stoi |
| 13 | Skakanka: wspięcia na palce, potem podskoki | wspięcia nieliczone (z widocznymi palcami), podskoki liczone |
| 14 | Pauza w połowie ruchu → Wznów | brak dodatkowego cyklu |

---

## 8. Struktura

```
src/analysis/   config (progi, wersja), exercises (opisy, ustawienie), geometry, landmarks (punkty, strona),
                metrics, filters, calibration, detectors/{cyclic,plank,jump}, hints, session (wyniki)
src/evaluation/ ewaluacja na opisanych nagraniach
src/pose/       adaptery modeli (MoveNet, MediaPipe), crop, typy punktów
src/camera/     silniki kamery: natywny (VisionCamera + TFLite) i WebView (Expo Go)
src/app/        ekrany (Expo Router); src/components/ panel debugowania, szkielet
src/testing/    generator syntetycznych sekwencji, runner analizy
scripts/        weryfikacja modelu, ekstrakcja landmarków z nagrań, manifest ewaluacji
```

## 9. Ograniczenia
- Analiza 2D z jednej kamery; kąty zależą od ustawienia telefonu. Nie są oceniane: koślawienie kolan,
  symetria, rozstaw chwytu/dłoni i inne kryteria, których dany widok nie pokazuje („Nie można ocenić z tego ustawienia”).
- Brak modeli sztangi, drążka, linki i brody: kontakt sztangi z klatką, tor i prędkość sztangi, broda nad drążkiem,
  obroty skakanki i double unders są **niedostępne**, a nie symulowane.
- Jedna osoba w kadrze. Progi wymagają strojenia na większej liczbie nagrań.
- MoveNet (build natywny) ma większy szum niż MediaPipe – przy skakance wymaga wyższych skoków, przy niskim fps
  częściej oznacza próby jako nieocenialne.
