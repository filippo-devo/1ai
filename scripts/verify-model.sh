#!/usr/bin/env bash
# Verifies that the bundled MoveNet file is byte-identical to Google's official
# release (MoveNet SinglePose Lightning, TFLite int8, version 4, Apache-2.0).
#
# The bundled copy was obtained from a GitHub mirror because TF Hub / Kaggle were
# not reachable from the environment the prototype was built in. Run this once
# on a machine with normal internet access.
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLED="assets/models/movenet_singlepose_lightning_int8_v4.tflite"
EXPECTED_SHA256="cd7cc22fa946e5d146a7b98d496853e1923e22828d3972d579973f27f91bb105"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

actual=$(sha256sum "$BUNDLED" | cut -d' ' -f1)
echo "bundled  sha256: $actual"
[ "$actual" = "$EXPECTED_SHA256" ] || { echo "Bundled file changed!"; exit 1; }

# TF Hub URL (redirects to Kaggle Models).
URL="https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/int8/4?lite-format=tflite"
echo "Downloading official model from $URL ..."
curl -fsSL -o "$TMP" "$URL"
official=$(sha256sum "$TMP" | cut -d' ' -f1)
echo "official sha256: $official"
if [ "$official" = "$actual" ]; then
  echo "OK: bundled model is identical to the official release."
else
  echo "MISMATCH: replace $BUNDLED with the official file and re-run the tests."
  exit 1
fi
