import fs from "fs";
import path from "path";
import { createJob, updateJob } from "@/lib/jobs";
import { runPipeline } from "@/lib/pipeline";

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");
const ALLOWED_EXTENSIONS = ["mp4", "mov", "webm", "mkv", "m4v"];
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No video file was sent." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json({ error: "The video must be under 1 GB." }, { status: 400 });
  }

  // Only trust a known extension; the original file name is never used on disk
  const extension = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return Response.json(
      { error: "Please upload an MP4, MOV, WebM, MKV or M4V video." },
      { status: 400 }
    );
  }

  if (!process.env.ASSEMBLYAI_API_KEY) {
    return Response.json({ error: "Missing ASSEMBLYAI_API_KEY in .env.local" }, { status: 500 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Missing ANTHROPIC_API_KEY in .env.local" }, { status: 500 });
  }

  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);
  const job = createJob();
  const filePath = path.join(DOWNLOADS_DIR, `upload_${job.id}.${extension}`);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));

  runPipeline(job.id, { filePath }).catch((err) => {
    console.error("Unexpected pipeline error:", err);
    updateJob(job.id, { status: "failed", stage: "Failed", error: "Something went wrong." });
  });

  return Response.json({ jobId: job.id });
}