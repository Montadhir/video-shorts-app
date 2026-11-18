import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile

import cv2

MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "models", "face_detection_yunet_2023mar.onnx",
)


def main():
    parser = argparse.ArgumentParser(description="Find faces in a section of a video.")
    parser.add_argument("video")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--debug-dir", default=None)
    args = parser.parse_args()

    if not os.path.exists(MODEL_PATH):
        print(f"Face model not found at {MODEL_PATH}", file=sys.stderr)
        sys.exit(1)

    detector = cv2.FaceDetectorYN.create(MODEL_PATH, "", (320, 320), 0.7, 0.3, 5000)

    if args.debug_dir:
        os.makedirs(args.debug_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        # ffmpeg pulls the sample frames, since it can decode every format we download
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-ss", str(args.start),
                "-t", str(args.duration),
                "-i", args.video,
                "-vf", f"fps={args.fps},scale=640:-2",
                os.path.join(tmp, "f_%04d.jpg"),
            ],
            check=True,
        )

        paths = sorted(glob.glob(os.path.join(tmp, "f_*.jpg")))
        results = []
        frames_with_faces = 0

        for i, path in enumerate(paths):
            img = cv2.imread(path)
            height, width = img.shape[:2]
            detector.setInputSize((width, height))
            _, found = detector.detect(img)

            faces = []
            if found is not None:
                for f in found:
                    x0 = max(0.0, float(f[0]))
                    y0 = max(0.0, float(f[1]))
                    x1 = min(float(width), float(f[0] + f[2]))
                    y1 = min(float(height), float(f[1] + f[3]))
                    score = float(f[14])
                    # Positions are saved as fractions of the frame (0 to 1)
                    faces.append({
                        "x": round(x0 / width, 4),
                        "y": round(y0 / height, 4),
                        "w": round((x1 - x0) / width, 4),
                        "h": round((y1 - y0) / height, 4),
                        "score": round(score, 3),
                    })
                    if args.debug_dir:
                        cv2.rectangle(img, (int(x0), int(y0)), (int(x1), int(y1)), (0, 255, 0), 2)
                        cv2.putText(img, f"{score:.2f}", (int(x0), max(12, int(y0) - 6)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

            if faces:
                frames_with_faces += 1
            results.append({"t": round(i / args.fps, 2), "faces": faces})

            if args.debug_dir:
                cv2.imwrite(os.path.join(args.debug_dir, os.path.basename(path)), img)

    print(json.dumps(results))
    print(f"Sampled {len(results)} frames; faces found in {frames_with_faces}.", file=sys.stderr)


if __name__ == "__main__":
    main()
