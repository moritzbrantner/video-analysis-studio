#!/usr/bin/env python3
import argparse
import json
import math
import sys

import numpy as np


PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
KRUMHANSL_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KRUMHANSL_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--window-seconds", type=float, default=30.0)
    parser.add_argument("--hop-seconds", type=float, default=15.0)
    parser.add_argument("--min-bpm", type=float, default=60.0)
    parser.add_argument("--max-bpm", type=float, default=200.0)
    args = parser.parse_args()

    try:
        import librosa
    except Exception as error:
        return fail(f"librosa is not available: {error}")

    try:
        y, sr = librosa.load(args.input, sr=22050, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))
        global_feature = analyze_slice(librosa, y, sr, 0.0, duration, args.min_bpm, args.max_bpm)
        segments = analyze_segments(librosa, y, sr, duration, args)
        print(
            json.dumps(
                {
                    "status": "completed",
                    "global": global_feature,
                    "segments": segments,
                    "message": None,
                }
            )
        )
        return 0
    except Exception as error:
        return fail(str(error))


def analyze_segments(librosa, y, sr, duration, args):
    if duration <= 0:
        return []
    segments = []
    start = 0.0
    index = 0
    while start < duration:
        end = min(start + args.window_seconds, duration)
        feature = analyze_slice(librosa, y, sr, start, end, args.min_bpm, args.max_bpm)
        segments.append(
            {
                "index": index,
                "start_seconds": start,
                "end_seconds": end,
                **feature,
            }
        )
        index += 1
        if end >= duration:
            break
        start += args.hop_seconds
    return segments


def analyze_slice(librosa, y, sr, start_seconds, end_seconds, min_bpm, max_bpm):
    start_sample = max(0, int(round(start_seconds * sr)))
    end_sample = min(len(y), int(round(end_seconds * sr)))
    segment = y[start_sample:end_sample]
    if len(segment) < sr * 12 or rms(segment) < 1e-4:
        return empty_feature()

    bpm, bpm_confidence = estimate_bpm(librosa, segment, sr, min_bpm, max_bpm)
    key, mode, key_confidence = estimate_key(librosa, segment, sr)
    return {
        "bpm": bpm,
        "bpm_confidence": bpm_confidence,
        "key": key,
        "mode": mode,
        "key_confidence": key_confidence,
    }


def estimate_bpm(librosa, y, sr, min_bpm, max_bpm):
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, aggregate=np.median)
    if not np.any(onset_env):
        return None, None
    tempo, beats = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr,
        trim=True,
        start_bpm=float((min_bpm + max_bpm) / 2.0),
    )
    if isinstance(tempo, np.ndarray):
        tempo = float(np.ravel(tempo)[0]) if tempo.size else 0.0
    tempo = normalize_bpm(float(tempo), min_bpm, max_bpm)
    if tempo <= 0:
        return None, None
    beat_count = len(beats) if hasattr(beats, "__len__") else 0
    confidence = min(1.0, beat_count / 16.0)
    return round(tempo, 3), round(confidence, 3)


def normalize_bpm(tempo, min_bpm, max_bpm):
    if not math.isfinite(tempo) or tempo <= 0:
        return 0.0
    while tempo < min_bpm:
        tempo *= 2.0
    while tempo > max_bpm:
        tempo /= 2.0
    if tempo < min_bpm or tempo > max_bpm:
        return 0.0
    return tempo


def estimate_key(librosa, y, sr):
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    if chroma.size == 0:
        return None, None, None
    vector = np.mean(chroma, axis=1)
    if not np.any(vector):
        return None, None, None

    scores = []
    for root in range(12):
        scores.append((corr(vector, np.roll(KRUMHANSL_MAJOR, root)), root, "major"))
        scores.append((corr(vector, np.roll(KRUMHANSL_MINOR, root)), root, "minor"))
    scores.sort(reverse=True, key=lambda item: item[0])
    best = scores[0]
    second = scores[1] if len(scores) > 1 else (0.0, 0, "major")
    confidence = max(0.0, min(1.0, (best[0] - second[0] + 1.0) / 2.0))
    return PITCH_CLASSES[best[1]], best[2], round(float(confidence), 3)


def corr(left, right):
    left = np.asarray(left, dtype=float)
    right = np.asarray(right, dtype=float)
    left = left - np.mean(left)
    right = right - np.mean(right)
    denom = np.linalg.norm(left) * np.linalg.norm(right)
    if denom == 0:
        return 0.0
    return float(np.dot(left, right) / denom)


def rms(y):
    if len(y) == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(y))))


def empty_feature():
    return {
        "bpm": None,
        "bpm_confidence": None,
        "key": None,
        "mode": None,
        "key_confidence": None,
    }


def fail(message):
    print(json.dumps({"status": "failed", "global": None, "segments": [], "message": message}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
