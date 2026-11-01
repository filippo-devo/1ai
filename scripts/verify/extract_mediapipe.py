"""
Offline verification helper for the Expo Go path (NOT part of the app).

Runs MediaPipe Pose Landmarker (same .task model as src/pose/web/poseHtml.ts) on a
video in VIDEO mode, frame by frame, and writes the 33 landmarks per frame in the
same format the WebView posts to React Native ({t, w, h, lm: [x, y, visibility]*33}).
__tests__/realVideo.test.ts replays them through mediapipeToCoco() + the counter.

Usage:
  .venv/bin/pip install mediapipe opencv-python-headless
  curl -o fixtures/pose_landmarker_full.task \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
  .venv/bin/python scripts/verify/extract_mediapipe.py <video.mp4> <out.json> fixtures/pose_landmarker_full.task [--every N]
"""
import argparse
import json

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("model")
    ap.add_argument("--every", type=int, default=1)
    args = ap.parse_args()

    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=args.model),
        running_mode=RunningMode.VIDEO,
        num_poses=1,
    )
    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    with PoseLandmarker.create_from_options(options) as landmarker:
        i = -1
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            i += 1
            if i % args.every:
                continue
            h, w = bgr.shape[:2]
            t = int(round(i * 1000.0 / fps))
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            res = landmarker.detect_for_video(image, t)
            lm = None
            if res.pose_landmarks:
                lm = []
                for p in res.pose_landmarks[0]:
                    lm += [round(p.x, 4), round(p.y, 4), round(p.visibility or 0.0, 3)]
            frames.append({"type": "pose", "t": t, "w": w, "h": h, "lm": lm})
    with open(args.out, "w") as f:
        json.dump(frames, f)
    print(f"{args.out}: {len(frames)} frames, with pose: {sum(1 for f in frames if f['lm'])}")


if __name__ == "__main__":
    main()
