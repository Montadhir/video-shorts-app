"use client";

import { useState } from "react";

function isValidYouTubeUrl(url: string) {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(url);
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    if (!isValidYouTubeUrl(url)) {
      setError("Please enter a valid YouTube URL.");
      setResult("");
      setTranscript("");
      return;
    }
    setError("");
    setResult("");
    setTranscript("");
    setLoading(true);

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Something went wrong.");
      } else {
        setResult(data.message);
        setTranscript(data.transcriptText || "");
      }
    } catch (err) {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-12">
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
      {error && <p className="text-sm text-red-500">{error}</p>}
      {result && <p className="text-sm text-green-600">{result}</p>}
      {transcript && (
        <div className="w-full max-w-md rounded-md border border-gray-200 p-3 text-sm text-gray-700 max-h-64 overflow-y-auto">
          {transcript}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-gray-400">
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
