#!/usr/bin/env bash
# Downloads two public exercise demo videos (Ultralytics assets), runs the bundled
# MoveNet model on them exactly like the app does (scripts/verify/extract_movenet.py)
# and replays the results through the app's analysis code (npm run evaluate, scripts/evaluate/manifest.json).
#
# Requirements: python3 (venv), curl, node/npm. Videos and derived data stay in
# fixtures/ (gitignored) — they are third-party material, used only for local testing.
set -euo pipefail
cd "$(dirname "$0")/../.."

mkdir -p fixtures/videos fixtures/real
BASE="https://github.com/ultralytics/assets/releases/download/v0.0.0"
for name in pushups squats; do
  if [ ! -s "fixtures/videos/$name.mp4" ]; then
    echo "Downloading $name demo video..."
    curl -sSL -o "fixtures/videos/$name.mp4" "$BASE/$name.demo.video.mp4"
  fi
done

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q ai-edge-litert opencv-python-headless numpy mediapipe
fi
MP_MODEL=fixtures/pose_landmarker_full.task
if [ ! -s "$MP_MODEL" ]; then
  curl -sSL -o "$MP_MODEL" https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
fi

for name in pushups squats; do
  .venv/bin/python scripts/verify/extract_movenet.py "fixtures/videos/$name.mp4" "fixtures/real/$name.json"
  .venv/bin/python scripts/verify/extract_movenet.py "fixtures/videos/$name.mp4" "fixtures/real/${name}_every3.json" --every 3
  # MediaPipe (Expo Go engine); needs libEGL on Linux.
  .venv/bin/python scripts/verify/extract_mediapipe.py "fixtures/videos/$name.mp4" "fixtures/real/mp_${name}_full.json" "$MP_MODEL" || echo "MediaPipe extraction skipped"
done

# Your own recordings: extract them the same way and add entries (with labelled
# completion times and split "tune"/"test") to scripts/evaluate/manifest.json.

npm run evaluate
