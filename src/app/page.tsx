export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-3xl font-bold">Shorts Generator</h1>
      <p className="text-gray-500">
        Paste a YouTube link to turn it into short clips.
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
    </main>
  );
}
