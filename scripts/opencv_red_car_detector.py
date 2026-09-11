#!/usr/bin/env python3

import base64
import json
import sys

import cv2
import numpy as np


def main() -> int:
    request = json.load(sys.stdin)
    frame = request.get("input", {})
    if frame.get("kind") != "video_frame":
        raise SystemExit("expected video_frame input")

    width = int(frame["width"])
    height = int(frame["height"])
    stride = int(frame["stride"])
    pixel_format = frame["pixel_format"]
    data = base64.b64decode(frame["data_base64"])
    image = np.frombuffer(data, dtype=np.uint8).reshape((height, stride // 3, 3))[:, :width, :]
    if pixel_format == "bgr24":
        bgr = image
    else:
        bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

    red_mask = (
        (bgr[:, :, 2] >= 96)
        & (bgr[:, :, 2] >= 1.35 * bgr[:, :, 1])
        & (bgr[:, :, 2] >= 1.35 * bgr[:, :, 0])
    ).astype(np.uint8) * 255
    red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(red_mask, 8)

    predictions = []
    for component in range(1, count):
        x, y, w, h, area = stats[component]
        if area < 24:
            continue
        predictions.append(
            {
                "kind": "object",
                "label": "car",
                "score": 0.95,
                "region": {
                    "x": float(x),
                    "y": float(y),
                    "width": float(w),
                    "height": float(h),
                },
                "attributes": {"color": "red", "area": str(int(area))},
            }
        )

    json.dump({"predictions": predictions}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
