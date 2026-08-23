import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");

export async function POST(request: Request) {
  const body = await request.json();
  const { url } = body;

  if (!url) {
    return Response.json({ error: "No URL provided" }, { status: 400 });
  }

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR);
  }

  const outputTemplate = path.join(DOWNLOADS_DIR, "%(id)s.%(ext)s");

  return new Promise((resolve) => {
    const ytdlp = spawn("yt-dlp", ["-f", "mp4", "-o", outputTemplate, url]);

    let stderr = "";
    ytdlp.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ytdlp.on("close", (code) => {
      if (code !== 0) {
        console.error("yt-dlp failed:", stderr);
        resolve(
          Response.json({ error: "Download failed", details: stderr }, { status: 500 })
        );
        return;
      }
      console.log("Download complete for:", url);
      resolve(Response.json({ message: "Video downloaded successfully", url }));
    });
  });
}
