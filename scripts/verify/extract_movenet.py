"""
Offline verification helper (NOT part of the app).

Runs the exact bundled MoveNet model on a video file, mirroring the app's
frame pipeline (src/hooks/usePoseDetection.ts):

  1. VisionCamera Resizer: upright RGB, scaleMode 'contain' into a
     384x384 square (scaled to fit, centered, black bars), uint8.
  2. Smart crop (src/pose/crop.ts): square crop around the person from the
     previous processed frame, nearest-neighbour sampled to 192x192.
  3. MoveNet Lightning int8 -> (y, x, score) relative to the crop, mapped to
     square-normalized coordinates.

Writes JSON consumed by __tests__/realVideo.test.ts, which replays it through
the app's TypeScript decode + counting code and cross-checks the crop logic.

Usage:
  python3 -m venv .venv
  .venv/bin/pip install ai-edge-litert opencv-python-headless numpy
  .venv/bin/python scripts/verify/extract_movenet.py <video.mp4> <out.json> [--every N] [--no-crop]

--every N processes only every N-th frame (simulates slower on-device inference).
"""
import argparse
import json

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODEL = "assets/models/movenet_singlepose_lightning_int8_v4.tflite"
RESIZER = 384
MODEL_SIZE = 192
CROP_SCORE = 0.2


def resizer_contain(rgb: np.ndarray) -> np.ndarray:
    """Approximation of the GPU Resizer ('contain', bilinear sampling)."""
    h, w = rgb.shape[:2]
    scale = min(RESIZER / w, RESIZER / h)
    cw, ch = max(1, round(w * scale)), max(1, round(h * scale))
    resized = cv2.resize(rgb, (cw, ch), interpolation=cv2.INTER_LINEAR)
    out = np.zeros((RESIZER, RESIZER, 3), dtype=np.uint8)
    ox, oy = (RESIZER - cw) // 2, (RESIZER - ch) // 2
    out[oy : oy + ch, ox : ox + cw] = resized
    return out


def compute_crop_region(kp):
    """Mirror of computeCropRegion() in src/pose/crop.ts. kp: 17x3 (x, y, score), square-normalized."""
    s = kp[:, 2]
    torso_visible = (s[11] > CROP_SCORE or s[12] > CROP_SCORE) and (s[5] > CROP_SCORE or s[6] > CROP_SCORE)
    if not torso_visible:
        return (0.0, 0.0, 1.0)
    cx = (kp[11, 0] + kp[12, 0]) / 2
    cy = (kp[11, 1] + kp[12, 1]) / 2
    torso = max(max(abs(cx - kp[i, 0]), abs(cy - kp[i, 1])) for i in (5, 6, 11, 12))
    body = 0.0
    for i in range(17):
        if s[i] > CROP_SCORE:
            body = max(body, abs(cx - kp[i, 0]), abs(cy - kp[i, 1]))
    half = max(torso * 1.9, body * 1.2)
    half = min(half, max(cx, 1 - cx, cy, 1 - cy))
    if not half > 0 or half > 0.5:
        return (0.0, 0.0, 1.0)
    return (float(cx - half), float(cy - half), float(2 * half))


def sample_crop(src: np.ndarray, crop) -> np.ndarray:
    """Mirror of sampleCrop() in src/pose/crop.ts (nearest neighbour)."""
    n, size = MODEL_SIZE, src.shape[0]
    x0, y0, cs = crop
    idx = (np.arange(n) + 0.5) / n * cs
    xs = np.floor((x0 + idx) * size).astype(int)
    ys = np.floor((y0 + idx) * size).astype(int)
    out = src[np.clip(ys, 0, size - 1)][:, np.clip(xs, 0, size - 1)].copy()
    out[(ys < 0) | (ys >= size), :] = 0
    out[:, (xs < 0) | (xs >= size)] = 0
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--no-crop", action="store_true")
    ap.add_argument("--model", default=MODEL)
    args = ap.parse_args()

    it = Interpreter(model_path=args.model)
    it.allocate_tensors()
    inp = it.get_input_details()[0]
    outp = it.get_output_details()[0]
    assert list(inp["shape"]) == [1, MODEL_SIZE, MODEL_SIZE, 3] and inp["dtype"] == np.uint8, inp
    assert list(outp["shape"]) == [1, 1, 17, 3], outp

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    prev = None
    width = height = None
    i = -1
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        i += 1
        if i % args.every:
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        height, width = rgb.shape[:2]
        square = resizer_contain(rgb)
        crop = (0.0, 0.0, 1.0) if (prev is None or args.no_crop) else compute_crop_region(prev)
        it.set_tensor(inp["index"], sample_crop(square, crop)[None])
        it.invoke()
        out = it.get_tensor(outp["index"]).reshape(17, 3).astype(float)
        kp = np.stack([crop[0] + out[:, 1] * crop[2], crop[1] + out[:, 0] * crop[2], out[:, 2]], 1)
        frames.append(
            {
                "t": round(i * 1000.0 / fps, 2),
                "crop": [round(c, 6) for c in crop],
                "square": [round(float(v), 6) for v in kp.reshape(-1)],
            }
        )
        prev = kp

    with open(args.out, "w") as f:
        json.dump({"video": args.video, "width": width, "height": height, "fps": fps, "frames": frames}, f)
    low = sum(
        1
        for fr in frames
        if min(max(fr["square"][a * 3 + 2], fr["square"][b * 3 + 2]) for a, b in [(5, 6), (7, 8), (9, 10), (11, 12)]) < 0.3
    )
    print(f"{args.out}: {len(frames)} frames, {width}x{height} @ {fps:.1f} fps, frames with a low-score arm/torso pair: {low}")


if __name__ == "__main__":
    main()
