export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-3xl font-bold">Shorts Generator</h1>
      <p className="text-gray-500">
        Paste a YouTube link, or upload a video, to turn it into short clips.
      </p>

      <div className="flex w-full max-w-md gap-2">
        <input
          type="text"
          placeholder="https://youtube.com/watch?v=..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white">
          Generate
        </button>
      </div>

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
