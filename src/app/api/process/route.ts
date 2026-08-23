import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else resolve();
    });
  });
}

async function uploadAudioToAssemblyAI(audioPath: string): Promise<string> {
  const audioData = fs.readFileSync(audioPath);
  const response = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: ASSEMBLYAI_API_KEY! },
    body: audioData,
  });
  const data = await response.json();
  return data.upload_url;
}

async function transcribeAudio(uploadUrl: string) {
  const startResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: ASSEMBLYAI_API_KEY!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ audio_url: uploadUrl }),
  });
  const startData = await startResponse.json();
  const transcriptId = startData.id;

  const pollingUrl = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;
  while (true) {
    const pollResponse = await fetch(pollingUrl, {
      headers: { authorization: ASSEMBLYAI_API_KEY! },
    });
    const pollData = await pollResponse.json();

    if (pollData.status === "completed") return pollData;
    if (pollData.status === "error") throw new Error("Transcription failed: " + pollData.error);

    await new Promise((r) => setTimeout(r, 3000));
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { url } = body;

  if (!url) return Response.json({ error: "No URL provided" }, { status: 400 });
  if (!ASSEMBLYAI_API_KEY) {
    return Response.json({ error: "Missing ASSEMBLYAI_API_KEY in .env.local" }, { status: 500 });
  }

  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);

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
      "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audioPath,
    ]);

    console.log("Uploading audio to AssemblyAI...");
    const uploadUrl = await uploadAudioToAssemblyAI(audioPath);

    console.log("Transcribing (this can take 30-90 seconds)...");
    const transcript = await transcribeAudio(uploadUrl);

    console.log("Transcription complete:", transcript.text?.slice(0, 100));

    return Response.json({
      message: "Video downloaded, audio extracted, and transcribed successfully",
      videoPath,
      audioPath,
      transcriptText: transcript.text,
      words: transcript.words,
    });
  } catch (err) {
    console.error("Pipeline failed:", err);
    return Response.json({ error: "Processing failed", details: String(err) }, { status: 500 });
  }
}
