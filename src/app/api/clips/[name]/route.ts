import fs from "fs";
import path from "path";
import { Readable } from "stream";

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  // Only allow plain clip filenames like 1234567890_clip.mp4 (blocks path tricks)
  if (!/^\d+_clip\.mp4$/.test(name)) {
    return Response.json({ error: "Invalid clip name" }, { status: 400 });
  }

  const filePath = path.join(DOWNLOADS_DIR, name);
  if (!fs.existsSync(filePath)) {
    return Response.json({ error: "Clip not found" }, { status: 404 });
  }

  const { size } = fs.statSync(filePath);
  const range = request.headers.get("range");
  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
  };
  if (download) baseHeaders["Content-Disposition"] = `attachment; filename="${name}"`;

  // Browsers need range support to play and scrub video
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : size - 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
