import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const anthropic = new Anthropic();

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
    headers: { authorization: ASSEMBLYAI_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: uploadUrl }),
  });
  const startData = await startResponse.json();
  const transcriptId = startData.id;

  const pollingUrl = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;
  while (true) {
    const pollResponse = await fetch(pollingUrl, { headers: { authorization: ASSEMBLYAI_API_KEY! } });
    const pollData = await pollResponse.json();
    if (pollData.status === "completed") return pollData;
    if (pollData.status === "error") throw new Error("Transcription failed: " + pollData.error);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function selectBestMoment(words: { text: string; start: number; end: number }[]) {
  const transcriptWithTimestamps = words
    .map((w) => `[${(w.start / 1000).toFixed(1)}s] ${w.text}`)
    .join(" ");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Here is a timestamped transcript of a video. Find the SINGLE most compelling, self-contained 20-60 second moment that would work as a standalone short-form video clip (like for TikTok/Shorts). It should have a clear hook and not require outside context to understand.

Respond ONLY with valid JSON in this exact format, no other text:
{"startTime": <seconds as number>, "endTime": <seconds as number>, "hookTitle": "<short catchy title, under 10 words>"}

Transcript:
${transcriptWithTimestamps}`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";
  return JSON.parse(raw);
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function generateCaptionsFile(
  words: { text: string; start: number; end: number }[],
  clipStartTime: number,
  clipEndTime: number,
  outputPath: string
) {
  const clipWords = words.filter(
    (w) => w.start / 1000 >= clipStartTime && w.start / 1000 <= clipEndTime
  );

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const CHUNK_SIZE = 3;
  let events = "";
  for (let i = 0; i < clipWords.length; i += CHUNK_SIZE) {
    const chunk = clipWords.slice(i, i + CHUNK_SIZE);
    const text = chunk.map((w) => w.text).join(" ");
    const start = chunk[0].start / 1000 - clipStartTime;
    const end = chunk[chunk.length - 1].end / 1000 - clipStartTime;
    events += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}\n`;
  }

  fs.writeFileSync(outputPath, header + events);
}

async function renderClip(
  videoPath: string,
  startTime: number,
  endTime: number,
  captionsPath: string,
  outputPath: string
) {
  const duration = endTime - startTime;
  await runCommand("ffmpeg", [
    "-ss", String(startTime),
    "-i", videoPath,
    "-t", String(duration),
    "-vf", `crop=ih*9/16:ih,scale=1080:1920,subtitles=${captionsPath}`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-c:a", "aac",
    "-y",
    outputPath,
  ]);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { url } = body;

  if (!url) return Response.json({ error: "No URL provided" }, { status: 400 });
  if (!ASSEMBLYAI_API_KEY) return Response.json({ error: "Missing ASSEMBLYAI_API_KEY in .env.local" }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Missing ANTHROPIC_API_KEY in .env.local" }, { status: 500 });

  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);

  const videoId = Date.now().toString();
  const videoPath = path.join(DOWNLOADS_DIR, `${videoId}.mp4`);
  const audioPath = path.join(DOWNLOADS_DIR, `${videoId}.wav`);
  const captionsPath = path.join(DOWNLOADS_DIR, `${videoId}.ass`);
  const clipPath = path.join(DOWNLOADS_DIR, `${videoId}_clip.mp4`);

  try {
    console.log("Downloading video...");
    await runCommand("yt-dlp", [
      "-f", "bestvideo+bestaudio", "--merge-output-format", "mp4", "-o", videoPath, url,
    ]);

    console.log("Extracting audio...");
    await runCommand("ffmpeg", [
      "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audioPath,
    ]);

    console.log("Uploading audio to AssemblyAI...");
    const uploadUrl = await uploadAudioToAssemblyAI(audioPath);

    console.log("Transcribing...");
    const transcript = await transcribeAudio(uploadUrl);

    console.log("Asking Claude to pick the best moment...");
    const moment = await selectBestMoment(transcript.words);
    console.log("Selected moment:", moment);

    console.log("Generating captions file...");
    generateCaptionsFile(transcript.words, moment.startTime, moment.endTime, captionsPath);

    console.log("Rendering vertical clip with captions...");
    await renderClip(videoPath, moment.startTime, moment.endTime, captionsPath, clipPath);
    console.log("Clip rendered:", clipPath);

    return Response.json({
      message: "Clip rendered successfully with captions",
      videoPath,
      clipPath,
      transcriptText: transcript.text,
      moment,
    });
  } catch (err) {
    console.error("Pipeline failed:", err);
    return Response.json({ error: "Processing failed", details: String(err) }, { status: 500 });
  }
}
