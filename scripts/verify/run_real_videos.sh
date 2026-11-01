#!/usr/bin/env bash
# Downloads two public exercise demo videos (Ultralytics assets), runs the bundled
# MoveNet model on them exactly like the app does (scripts/verify/extract_movenet.py)
# and replays the results through the app's counting code (__tests__/realVideo.test.ts).
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
  .venv/bin/pip install -q ai-edge-litert opencv-python-headless numpy
fi

for name in pushups squats; do
  .venv/bin/python scripts/verify/extract_movenet.py "fixtures/videos/$name.mp4" "fixtures/real/$name.json"
  .venv/bin/python scripts/verify/extract_movenet.py "fixtures/videos/$name.mp4" "fixtures/real/${name}_every3.json" --every 3
done

# Optional: your own pull-up recording (4 full reps expected by the test):
if [ -s fixtures/videos/pullups.mp4 ]; then
  .venv/bin/python scripts/verify/extract_movenet.py fixtures/videos/pullups.mp4 fixtures/real/pullups.json
  .venv/bin/python scripts/verify/extract_movenet.py fixtures/videos/pullups.mp4 fixtures/real/pullups_every3.json --every 3
fi

npx jest __tests__/realVideo.test.ts --verbose
