import { spawn } from "child_process";
import path from "path";

const OUT_W = 1080;
const OUT_H = 1920;
const TOP_H = 720; // height of the facecam panel in the split layout
const BOTTOM_H = OUT_H - TOP_H; // height of the main-content panel

type Face = { x: number; y: number; w: number; h: number; score: number };
export type Frame = { t: number; faces: Face[] };

type Track = {
  lastX: number;
  lastY: number;
  cx: number[];
  cy: number[];
  w: number[];
  h: number[];
};

type TrackSummary = {
  presence: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
};

export type ReframePlan =
  | { layout: "single"; mainCx: number }
  | {
      layout: "split";
      mainCx: number;
      facecam: { cx: number; cy: number; w: number; h: number };
    };

function runCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else resolve(stdout);
    });
  });
}

async function getVideoSize(videoPath: string) {
  const out = await runCapture("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    videoPath,
  ]);
  const [width, height] = out.trim().split(",").map(Number);
  if (!width || !height) throw new Error("Could not read video size: " + out);
  return { width, height };
}

async function detectFaces(
  videoPath: string,
  startTime: number,
  duration: number
): Promise<Frame[]> {
  const python = path.join(process.cwd(), ".venv", "bin", "python");
  const script = path.join(process.cwd(), "scripts", "detect_faces.py");
  const out = await runCapture(python, [
    script,
    videoPath,
    "--start", String(startTime),
    "--duration", String(duration),
    "--fps", "2",
  ]);
  return JSON.parse(out) as Frame[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Groups the detected faces into "tracks": one track per person, followed across frames.
function summarizeTracks(frames: Frame[]): TrackSummary[] {
  const tracks: Track[] = [];
  const MATCH_DISTANCE = 0.12;

  for (const frame of frames) {
    const used = new Set<Track>();
    // Biggest faces first, so a big face claims a track before a small one can
    const faces = [...frame.faces].sort((a, b) => b.w * b.h - a.w * a.h);

    for (const face of faces) {
      const cx = face.x + face.w / 2;
      const cy = face.y + face.h / 2;

      let best: Track | null = null;
      let bestDist = MATCH_DISTANCE;
      for (const track of tracks) {
        if (used.has(track)) continue;
        const dist = Math.hypot(track.lastX - cx, track.lastY - cy);
        if (dist < bestDist) {
          best = track;
          bestDist = dist;
        }
      }
      if (!best) {
        best = { lastX: cx, lastY: cy, cx: [], cy: [], w: [], h: [] };
        tracks.push(best);
      }

      best.lastX = cx;
      best.lastY = cy;
      best.cx.push(cx);
      best.cy.push(cy);
      best.w.push(face.w);
      best.h.push(face.h);
      used.add(best);
    }
  }

  const total = Math.max(frames.length, 1);
  return tracks
    .map((t) => ({
      presence: t.cx.length / total,
      cx: median(t.cx),
      cy: median(t.cy),
      w: median(t.w),
      h: median(t.h),
    }))
    // Ignore faces that only flicker in a few frames (usually false alarms)
    .filter((t) => t.presence >= 0.3);
}

// Decides the layout: a plain crop on the main person, or facecam-on-top (split).
export function planReframe(frames: Frame[]): ReframePlan {
  const tracks = summarizeTracks(frames);
  if (tracks.length === 0) return { layout: "single", mainCx: 0.5 };

  const area = (t: TrackSummary) => t.w * t.h;
  const isCorner = (t: TrackSummary) =>
    (t.cx < 0.3 || t.cx > 0.7) && (t.cy < 0.35 || t.cy > 0.65) && t.w < 0.2;

  const largest = tracks.reduce((a, b) => (area(b) > area(a) ? b : a));

  // A facecam is a face sitting in a corner that is clearly smaller than the main person
  // (or the only face in the video, if it sits in a corner)
  const facecam = tracks
    .filter(
      (t) => isCorner(t) && (tracks.length === 1 || area(t) < 0.55 * area(largest))
    )
    .sort((a, b) => area(b) - area(a))[0];

  const main = tracks
    .filter((t) => t !== facecam)
    .sort((a, b) => area(b) - area(a))[0];
  const mainCx = main ? main.cx : 0.5;

  if (facecam) {
    return {
      layout: "split",
      mainCx,
      facecam: { cx: facecam.cx, cy: facecam.cy, w: facecam.w, h: facecam.h },
    };
  }
  return { layout: "single", mainCx };
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// Turns the plan into the ffmpeg filter arguments (including the captions).
export function buildFilterArgs(
  plan: ReframePlan,
  width: number,
  height: number,
  captionsPath: string
): string[] {
  if (plan.layout === "single") {
    const cropH = even(Math.min(height, (width * 16) / 9));
    const cropW = even((cropH * 9) / 16);
    const x = Math.round(clamp(plan.mainCx * width - cropW / 2, 0, width - cropW));
    const y = Math.round((height - cropH) / 2);
    return [
      "-vf",
      `crop=${cropW}:${cropH}:${x}:${y},scale=${OUT_W}:${OUT_H},setsar=1,subtitles=${captionsPath}`,
    ];
  }

  // Facecam panel (top): a window around the facecam face, in the panel's shape
  let rectW = plan.facecam.w * width * 3.6;
  let rectH = (rectW * TOP_H) / OUT_W;
  if (rectH > height) {
    rectH = height;
    rectW = (rectH * OUT_W) / TOP_H;
  }
  if (rectW > width) {
    rectW = width;
    rectH = (rectW * TOP_H) / OUT_W;
  }
  rectW = even(rectW);
  rectH = even(rectH);
  const rx = Math.round(clamp(plan.facecam.cx * width - rectW / 2, 0, width - rectW));
  // Aim a little below the face center so the shoulders are included
  const ry = Math.round(
    clamp(plan.facecam.cy * height + rectH * 0.1 - rectH / 2, 0, height - rectH)
  );

  // Main panel (bottom): a window following the main person, in the panel's shape
  let mainH = height;
  let mainW = (mainH * OUT_W) / BOTTOM_H;
  if (mainW > width) {
    mainW = width;
    mainH = (mainW * BOTTOM_H) / OUT_W;
  }
  mainW = even(mainW);
  mainH = even(mainH);
  let mx = Math.round(clamp(plan.mainCx * width - mainW / 2, 0, width - mainW));
  const my = Math.round((height - mainH) / 2);

  // If the facecam overlay would show up in the main panel too, slide the window away from it,
  // but only when the main person still sits comfortably inside the window
  if (rx + rectW > mx && rx < mx + mainW) {
    const facecamOnLeft = rx + rectW / 2 < width / 2;
    const gap = Math.round(width * 0.01); // a little margin, since the overlay edge is a guess
    const shifted = Math.round(
      clamp(facecamOnLeft ? rx + rectW + gap : rx - mainW - gap, 0, width - mainW)
    );
    const personPos = (plan.mainCx * width - shifted) / mainW;
    if (personPos > 0.2 && personPos < 0.8) mx = shifted;
  }

  const graph =
    `[0:v]split=2[a][b];` +
    `[a]crop=${rectW}:${rectH}:${rx}:${ry},scale=${OUT_W}:${TOP_H},setsar=1[top];` +
    `[b]crop=${mainW}:${mainH}:${mx}:${my},scale=${OUT_W}:${BOTTOM_H},setsar=1[bottom];` +
    `[top][bottom]vstack=inputs=2,subtitles=${captionsPath}[v]`;
  return ["-filter_complex", graph, "-map", "[v]", "-map", "0:a:0?"];
}

export async function renderClipWithLayout(
  videoPath: string,
  startTime: number,
  endTime: number,
  captionsPath: string,
  outputPath: string
): Promise<void> {
  const duration = endTime - startTime;
  const { width, height } = await getVideoSize(videoPath);

  // If face detection fails for any reason, fall back to a plain centered crop
  let plan: ReframePlan = { layout: "single", mainCx: 0.5 };
  try {
    const frames = await detectFaces(videoPath, startTime, duration);
    plan = planReframe(frames);
  } catch (err) {
    console.error("Face detection failed, using a centered crop:", err);
  }
  console.log("Reframe plan:", JSON.stringify(plan));

  const filterArgs = buildFilterArgs(plan, width, height, captionsPath);
  await runCapture("ffmpeg", [
    "-y",
    "-ss", String(startTime),
    "-i", videoPath,
    "-t", String(duration),
    ...filterArgs,
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outputPath,
  ]);
}
