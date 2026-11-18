import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { addClip, updateJob } from "@/lib/jobs";
import { renderClipWithLayout } from "@/lib/reframe";
import { cleanMoments, formatTranscript, parseMoments, type Moment, type Word } from "@/lib/moments";

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else resolve();
    });
  });
}

async function uploadAudioToAssemblyAI(audioPath: string): Promise<string> {
  const response = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: process.env.ASSEMBLYAI_API_KEY! },
    body: fs.readFileSync(audioPath),
  });
  const data = await response.json();
  if (!response.ok || !data.upload_url) {
    throw new Error("AssemblyAI upload failed: " + JSON.stringify(data));
  }
  return data.upload_url;
}

async function transcribeAudio(uploadUrl: string): Promise<{ words: Word[] }> {
  const headers = {
    authorization: process.env.ASSEMBLYAI_API_KEY!,
    "content-type": "application/json",
  };
  const startResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers,
    body: JSON.stringify({ audio_url: uploadUrl }),
  });
  const startData = await startResponse.json();
  if (!startResponse.ok || !startData.id) {
    throw new Error("AssemblyAI could not start the transcript: " + JSON.stringify(startData));
  }

  const pollingUrl = `https://api.assemblyai.com/v2/transcript/${startData.id}`;
  // Check every 3 seconds, for up to 30 minutes
  for (let attempt = 0; attempt < 600; attempt++) {
    const pollResponse = await fetch(pollingUrl, { headers });
    const pollData = await pollResponse.json();
    if (pollData.status === "completed") return pollData;
    if (pollData.status === "error") throw new Error("Transcription failed: " + pollData.error);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Transcription took too long.");
}

async function selectMoments(words: Word[]): Promise<Moment[]> {
  const anthropic = new Anthropic();
  const prompt = `Here is a timestamped transcript of a video. Each line starts with the time in seconds.

Find the 5 most compelling, self-contained moments that would each work as a standalone short-form video (TikTok, Reels, YouTube Shorts). Rules:
- Each moment is 30-75 seconds long.
- Each must make sense on its own. Include the setup or event that a reaction or punchline is about, usually starting 5-15 seconds before the key moment, instead of starting right at the reaction.
- Start at the beginning of a sentence and end at the end of a sentence.
- Moments must not overlap each other.
- List them best first.

Respond ONLY with a JSON array and nothing else, in exactly this format:
[{"startTime": <seconds as a number>, "endTime": <seconds as a number>, "hookTitle": "<catchy title, under 10 words>"}]

Transcript:
${formatTranscript(words)}`;

  // Try twice, in case the reply isn't usable the first time
  for (let attempt = 1; attempt <= 2; attempt++) {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content.find((b) => b.type === "text");
    const text = block && "text" in block && typeof block.text === "string" ? block.text : "";
    const parsed = parseMoments(text);
    const moments = cleanMoments(parsed, words, 5);
    if (moments.length > 0) return moments;
    console.error(
      `Claude's reply had no usable moments (attempt ${attempt}). ` +
        `stop_reason=${message.stop_reason}, parsed=${parsed.length}, reply starts: ${text.slice(0, 500)}`
    );
  }
  throw new Error("The AI could not find usable moments in this video.");
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function generateCaptionsFile(
  words: Word[],
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
    // Curly braces and backslashes mean something special in subtitle files, so drop them
    const text = chunk.map((w) => w.text).join(" ").replace(/[{}\\]/g, "");
    const start = chunk[0].start / 1000 - clipStartTime;
    const end = chunk[chunk.length - 1].end / 1000 - clipStartTime;
    events += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}\n`;
  }

  fs.writeFileSync(outputPath, header + events);
}

// The whole job: download -> audio -> transcript -> pick moments -> render each clip.
// Progress is written to the job as it goes, so the page can show it.
export async function runPipeline(jobId: string, url: string): Promise<void> {
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);

  const videoId = Date.now().toString();
  const videoPath = path.join(DOWNLOADS_DIR, `${videoId}.mp4`);
  const audioPath = path.join(DOWNLOADS_DIR, `${videoId}.wav`);

  try {
    updateJob(jobId, { stage: "Downloading the video..." });
    await runCommand("yt-dlp", [
      "-f", "bestvideo+bestaudio",
      "--merge-output-format", "mp4",
      "-o", videoPath,
      url,
    ]);

    updateJob(jobId, { stage: "Extracting the audio..." });
    await runCommand("ffmpeg", [
      "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audioPath,
    ]);

    updateJob(jobId, { stage: "Transcribing (this can take a minute or two)..." });
    const uploadUrl = await uploadAudioToAssemblyAI(audioPath);
    const transcript = await transcribeAudio(uploadUrl);
    const words = transcript.words ?? [];
    if (words.length === 0) throw new Error("No speech was found in this video.");

    updateJob(jobId, { stage: "Finding the best moments..." });
    const moments = await selectMoments(words);
    console.log("Selected moments:", moments);

    let rendered = 0;
    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      updateJob(jobId, { stage: `Rendering clip ${i + 1} of ${moments.length}...` });

      const clipName = `${videoId}_clip${i + 1}.mp4`;
      const captionsPath = path.join(DOWNLOADS_DIR, `${videoId}_${i + 1}.ass`);
      try {
        generateCaptionsFile(words, moment.startTime, moment.endTime, captionsPath);
        await renderClipWithLayout(
          videoPath,
          moment.startTime,
          moment.endTime,
          captionsPath,
          path.join(DOWNLOADS_DIR, clipName)
        );
        addClip(jobId, {
          clipName,
          hookTitle: moment.hookTitle,
          startTime: moment.startTime,
          endTime: moment.endTime,
        });
        rendered++;
      } catch (err) {
        // One bad clip shouldn't lose the others
        console.error(`Clip ${i + 1} failed:`, err);
      }
    }
    if (rendered === 0) throw new Error("None of the clips could be rendered.");

    updateJob(jobId, { status: "done", stage: "Done" });
  } catch (err) {
    console.error("Pipeline failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", stage: "Failed", error: message.slice(-300) });
  }
}
