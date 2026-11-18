"use client";

import { useState } from "react";

type Clip = {
  clipName: string;
  hookTitle: string;
  startTime: number;
  endTime: number;
};

function isValidYouTubeUrl(url: string) {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(url);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function Home() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    if (!isValidYouTubeUrl(url)) {
      setError("Please enter a valid YouTube URL.");
      return;
    }
    setError("");
    setClips([]);
    setStage("Starting...");
    setLoading(true);

    try {
      // Start the job; the server answers right away with an id
      const startResponse = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const startData = await startResponse.json();
      if (!startResponse.ok) {
        setError(startData.error || "Something went wrong.");
        return;
      }

      // Then check on it every 2 seconds. Clips show up here as soon as each one is ready.
      while (true) {
        await sleep(2000);
        const response = await fetch(`/api/jobs/${startData.jobId}`);
        const job = await response.json();
        if (!response.ok) {
          setError(job.error || "Lost track of the job.");
          break;
        }
        setStage(job.stage);
        setClips(job.clips);
        if (job.status === "failed") {
          setError(job.error || "Processing failed.");
          break;
        }
        if (job.status === "done") break;
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">Shorts Generator</h1>
      <p className="text-gray-500">
        Paste a YouTube link, or upload a video, to turn it into short clips.
      </p>

      <div className="flex w-full max-w-md gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Processing..." : "Generate"}
        </button>
      </div>
      {loading && <p className="text-sm text-gray-500">{stage}</p>}
      {error && <p className="max-w-md text-center text-sm text-red-500">{error}</p>}

      {clips.length > 0 && (
        <div className="mt-4 grid w-full max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {clips.map((clip, index) => (
            <div key={clip.clipName} className="flex flex-col items-center gap-3">
              <p className="text-center font-semibold">
                {index + 1}. {clip.hookTitle}
              </p>
              <video
                src={`/api/clips/${clip.clipName}`}
                controls
                preload="metadata"
                className="w-full max-w-xs rounded-md bg-black"
              />
              <p className="text-xs text-gray-400">
                {Math.round(clip.endTime - clip.startTime)} seconds
              </p>
              <a
                href={`/api/clips/${clip.clipName}?download=1`}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
              >
                Download MP4
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-sm text-gray-400">
        <div className="h-px w-16 bg-gray-200" />
        or
        <div className="h-px w-16 bg-gray-200" />
      </div>

      <label className="flex w-full max-w-md cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 px-3 py-6 text-sm text-gray-500 hover:border-gray-400">
        <span>Click to upload a video file</span>
        <input type="file" accept="video/*" className="hidden" />
      </label>
    </main>
  );
}
