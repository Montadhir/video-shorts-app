import { randomUUID } from "crypto";

// A tiny in-memory job tracker. The page asks "how is my job going?" every couple of seconds.
// (Jobs disappear if the server restarts. That's fine for now; a real queue comes later.)

export type JobClip = {
  clipName: string;
  hookTitle: string;
  startTime: number;
  endTime: number;
};

export type Job = {
  id: string;
  status: "running" | "done" | "failed";
  stage: string; // what it's doing right now, in plain words
  clips: JobClip[]; // finished clips, added one by one as they render
  error?: string;
  createdAt: number;
};

// Kept on globalThis so the dev server's hot reloading doesn't wipe running jobs
const globalForJobs = globalThis as unknown as { __jobs?: Map<string, Job> };
const jobs = globalForJobs.__jobs ?? new Map<string, Job>();
globalForJobs.__jobs = jobs;

const MAX_JOBS = 50;

export function createJob(): Job {
  const job: Job = {
    id: randomUUID(),
    status: "running",
    stage: "Starting...",
    clips: [],
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Forget the oldest jobs so memory doesn't grow forever
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Omit<Job, "id" | "createdAt">>): void {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch);
}

export function addClip(id: string, clip: JobClip): void {
  const job = jobs.get(id);
  if (job) job.clips.push(clip);
}
