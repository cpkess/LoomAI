import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Self-update support: check the deployed commit against GitHub and, when the
// operator requests it, drop an update marker + exit so the container's
// entrypoint pulls the latest source, rebuilds, migrates, and restarts.
//
// Everything here is best-effort and guarded: self-update is OFF unless
// LOOMAI_SELF_UPDATE=1, and version/remote lookups degrade gracefully when git
// or the network is unavailable (e.g. a fresh image before the first update).

export function selfUpdateEnabled(): boolean {
  return process.env.LOOMAI_SELF_UPDATE === "1";
}

export function repoUrl(): string {
  return process.env.LOOMAI_REPO_URL || "https://github.com/cpkess/loomai.git";
}

export function updateRef(): string {
  return process.env.LOOMAI_UPDATE_REF || "main";
}

function dataDir(): string {
  return process.env.LOOMAI_DATA_DIR || "/data";
}

export function updateMarkerPath(): string {
  return `${dataDir()}/loomai-update-requested`;
}

async function git(args: string[], timeout = 15000): Promise<string> {
  const { stdout } = await run("git", args, { timeout, cwd: process.cwd() });
  return stdout.trim();
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  date: string | null;
}

/** The running deployment's commit — from the local checkout, else the baked build arg. */
export async function localCommit(): Promise<CommitInfo | null> {
  try {
    const line = await git(["show", "-s", "--format=%H%x1f%s%x1f%cI", "HEAD"]);
    const [sha, subject, date] = line.split("\x1f");
    if (sha) return { sha, shortSha: sha.slice(0, 7), subject: subject ?? "", date: date ?? null };
  } catch {
    // No git checkout yet (fresh image before first update).
  }
  const baked = process.env.LOOMAI_BUILD_COMMIT;
  if (baked) return { sha: baked, shortSha: baked.slice(0, 7), subject: "(build)", date: null };
  return null;
}

/** The latest commit on the update ref at the remote, via `git ls-remote`. */
export async function remoteCommit(): Promise<string | null> {
  try {
    const out = await git(["ls-remote", repoUrl(), updateRef()], 20000);
    const sha = out.split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export interface UpdateStatus {
  enabled: boolean;
  ref: string;
  repoUrl: string;
  current: CommitInfo | null;
  remoteSha: string | null;
  updateAvailable: boolean;
}

export async function checkStatus(): Promise<UpdateStatus> {
  const [current, remoteSha] = await Promise.all([localCommit(), remoteCommit()]);
  const updateAvailable = Boolean(current && remoteSha && current.sha !== remoteSha);
  return { enabled: selfUpdateEnabled(), ref: updateRef(), repoUrl: repoUrl(), current, remoteSha, updateAvailable };
}

/** Drop the marker the container entrypoint looks for on its next start. */
export async function requestUpdate(): Promise<void> {
  const path = updateMarkerPath();
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  await writeFile(path, new Date().toISOString(), "utf8");
}
