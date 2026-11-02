import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { safeJoin } from "@autodev/coding";

/** Directories that never belong in a generated-file index or a code review. */
export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  ".turbo",
  ".cache",
  ".autodev",
]);

/**
 * Dotfiles that are safe and useful to show in the file explorer. Everything
 * else starting with a dot is skipped — most importantly `.env` and its
 * variants, which must never be indexed or sent to a review prompt.
 */
const VISIBLE_DOTFILES = new Set([
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".nvmrc",
  ".env.example",
]);

/**
 * Defence in depth for file reading. Indexing already skips dotfiles, but a
 * caller can request an explicit path, so both the indexer and the HTTP layer
 * check this list before content is returned.
 */
export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const base = segments[segments.length - 1] ?? normalized;

  if (segments.some((segment) => segment === ".git" || segment === "node_modules")) {
    return true;
  }
  if (base === ".env.example") return false;
  if (/^\.env(\..+)?$/i.test(base)) return true;
  if (/\.(pem|key|p12|pfx|crt)$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519|id_ecdsa|\.npmrc|\.netrc|\.pgpass|\.htpasswd)$/i.test(base)) {
    return true;
  }
  return false;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sql": "sql",
  ".sh": "shell",
  ".env": "dotenv",
  ".txt": "text",
};

export interface WorkspaceFileRecord {
  path: string;
  sha256: string;
  sizeBytes: number;
  language: string | null;
}

export interface ListWorkspaceOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  ignoredDirectories?: Set<string>;
}

/** Absolute directory reserved for one project. */
export function resolveWorkspacePath(workspacesRoot: string, projectId: string): string {
  if (!projectId.trim()) throw new Error("projectId is required to resolve a workspace");
  const root = path.resolve(workspacesRoot);
  const target = path.resolve(root, projectId);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length === 0) {
    throw new Error(`project workspace escapes the workspaces root: ${projectId}`);
  }
  return target;
}

export async function ensureWorkspace(workspacePath: string): Promise<string> {
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

export function languageFor(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Walks the workspace and returns a content-addressed file index. VCS folders,
 * dependency trees and test artefacts are skipped so the dashboard's file
 * explorer and the DB index reflect what the project actually owns.
 */
export async function listWorkspaceFiles(
  workspacePath: string,
  options: ListWorkspaceOptions = {},
): Promise<WorkspaceFileRecord[]> {
  const maxFiles = options.maxFiles ?? 2_000;
  const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
  const ignored = options.ignoredDirectories ?? IGNORED_DIRECTORIES;
  const files: WorkspaceFileRecord[] = [];

  async function walk(directory: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const relative = path.relative(workspacePath, path.join(directory, entry.name)).split(path.sep).join("/");
      if (isSensitivePath(relative)) continue;
      if (entry.name.startsWith(".")) {
        if (entry.isDirectory()) continue;
        if (!VISIBLE_DOTFILES.has(entry.name)) continue;
      }
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        await walk(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;

      const absolute = path.join(directory, entry.name);
      const stat = await fs.stat(absolute);
      if (stat.size > maxFileBytes) continue;

      const content = await fs.readFile(absolute);
      files.push({
        path: relative,
        sha256: sha256(content),
        sizeBytes: stat.size,
        language: languageFor(relative),
      });
    }
  }

  await walk(workspacePath);
  return files;
}

export interface SourceFile {
  path: string;
  content: string;
}

/**
 * Loads a bounded set of text files for LLM review. Binary-ish extensions and
 * oversized files are skipped so a review prompt cannot blow up the context.
 */
export async function collectSourceFiles(
  workspacePath: string,
  options: { maxFiles?: number; maxBytesPerFile?: number } = {},
): Promise<SourceFile[]> {
  const maxFiles = options.maxFiles ?? 40;
  const maxBytesPerFile = options.maxBytesPerFile ?? 20_000;
  const index = await listWorkspaceFiles(workspacePath, { maxFiles: maxFiles * 4 });

  const preferred = index.filter((file) => {
    if (!file.language) return false;
    if (file.language === "json" && file.sizeBytes > maxBytesPerFile) return false;
    return file.path !== "package-lock.json" && file.path !== "pnpm-lock.yaml";
  });

  preferred.sort((a, b) => {
    const score = (file: WorkspaceFileRecord): number => {
      if (file.path.startsWith("src/")) return 0;
      if (file.path.startsWith("tests/")) return 1;
      if (file.path.startsWith("public/")) return 2;
      if (file.path === "server.mjs") return 0;
      return 3;
    };
    return score(a) - score(b) || a.path.localeCompare(b.path);
  });

  const files: SourceFile[] = [];
  for (const file of preferred.slice(0, maxFiles)) {
    const absolute = safeJoin(workspacePath, file.path);
    const content = await fs.readFile(absolute, "utf8");
    files.push({
      path: file.path,
      content: content.length > maxBytesPerFile ? `${content.slice(0, maxBytesPerFile)}\n…truncated…` : content,
    });
  }
  return files;
}

export interface WrittenFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  language: string | null;
}

/** Writes a file inside the workspace, creating parent directories. */
export async function writeWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  content: string,
): Promise<WrittenFile> {
  const absolute = safeJoin(workspacePath, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
  const buffer = Buffer.from(content, "utf8");
  return {
    path: relativePath.split(path.sep).join("/"),
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    language: languageFor(relativePath),
  };
}

export async function readWorkspaceText(
  workspacePath: string,
  relativePath: string,
): Promise<string | null> {
  const absolute = safeJoin(workspacePath, relativePath);
  try {
    return await fs.readFile(absolute, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** JSON artefacts persist planning output so a run can resume after a restart. */
export const ARTIFACTS_DIR = ".autodev/artifacts";

/**
 * Normalises an artifact name into a safe file stem. Collapsing runs of
 * separators and trimming edges keeps `"Review Result!"` and `"review-result"`
 * pointing at the same file, which matters for resuming a run.
 */
function artifactFileName(name: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safe) throw new Error(`artifact name must contain alphanumerics: "${name}"`);
  return safe;
}

export async function saveArtifact(
  workspacePath: string,
  name: string,
  value: unknown,
): Promise<void> {
  const safeName = artifactFileName(name);
  await writeWorkspaceFile(
    workspacePath,
    `${ARTIFACTS_DIR}/${safeName}.json`,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export async function loadArtifact<T>(
  workspacePath: string,
  name: string,
  parse: (value: unknown) => T,
): Promise<T | null> {
  const safeName = artifactFileName(name);
  const raw = await readWorkspaceText(workspacePath, `${ARTIFACTS_DIR}/${safeName}.json`);
  if (raw === null) return null;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
