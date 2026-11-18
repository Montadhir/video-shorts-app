import { createJob, updateJob } from "@/lib/jobs";
import { runPipeline } from "@/lib/pipeline";

// Only plain YouTube links get through (this also stops anything odd reaching yt-dlp)
function isValidYouTubeUrl(url: string) {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w\-=&.%?]+$/.test(url);
}

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof url !== "string" || !isValidYouTubeUrl(url)) {
    return Response.json({ error: "Please enter a valid YouTube URL." }, { status: 400 });
  }
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return Response.json({ error: "Missing ASSEMBLYAI_API_KEY in .env.local" }, { status: 500 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Missing ANTHROPIC_API_KEY in .env.local" }, { status: 500 });
  }

  const job = createJob();

  // Start the work in the background and answer right away; the page checks progress via /api/jobs/<id>
   runPipeline(job.id, { url }).catch((err) => {
    console.error("Unexpected pipeline error:", err);
    updateJob(job.id, { status: "failed", stage: "Failed", error: "Something went wrong." });
  });

  return Response.json({ jobId: job.id });
}
