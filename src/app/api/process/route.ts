import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr));
      } else {
        resolve();
      }
    });
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { url } = body;

  if (!url) {
    return Response.json({ error: "No URL provided" }, { status: 400 });
  }

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR);
  }

  const videoId = Date.now().toString();
  const videoPath = path.join(DOWNLOADS_DIR, `${videoId}.mp4`);
  const audioPath = path.join(DOWNLOADS_DIR, `${videoId}.wav`);

  try {
    console.log("Downloading video...");
    await runCommand("yt-dlp", [
      "-f", "bestvideo+bestaudio",
      "--merge-output-format", "mp4",
      "-o", videoPath,
      url,
    ]);

    console.log("Extracting audio...");
    await runCommand("ffmpeg", [
      "-i", videoPath,
      "-vn",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      audioPath,
    ]);

    console.log("Audio extraction complete:", audioPath);
    return Response.json({
      message: "Video downloaded and audio extracted successfully",
      videoPath,
      audioPath,
    });
  } catch (err) {
    console.error("Pipeline failed:", err);
    return Response.json(
      { error: "Processing failed", details: String(err) },
      { status: 500 }
    );
  }
}
