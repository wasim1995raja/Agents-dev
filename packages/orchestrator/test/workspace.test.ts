import fs from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  collectSourceFiles,
  ensureWorkspace,
  listWorkspaceFiles,
  loadArtifact,
  readWorkspaceText,
  resolveWorkspacePath,
  saveArtifact,
  writeWorkspaceFile,
} from "../src/workspace.js";

const root = path.join("/tmp/opencode", `autodev-workspace-test-${process.pid}-${Date.now()}`);
let workspace: string;

beforeAll(async () => {
  workspace = path.join(root, "project-1");
  await ensureWorkspace(workspace);
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "node_modules", "dep"), { recursive: true });
  await fs.mkdir(path.join(workspace, ".git"), { recursive: true });
  await fs.mkdir(path.join(workspace, "public"), { recursive: true });

  await fs.writeFile(path.join(workspace, "src", "index.ts"), "export const answer = 42;\n");
  await fs.writeFile(path.join(workspace, "public", "index.html"), "<h1>hi</h1>\n");
  await fs.writeFile(path.join(workspace, "node_modules", "dep", "index.js"), "noise");
  await fs.writeFile(path.join(workspace, ".git", "config"), "noise");
  await fs.writeFile(path.join(workspace, ".env"), "SECRET=1\n");
  await fs.writeFile(path.join(workspace, ".env.local"), "SECRET=2\n");
  await fs.writeFile(path.join(workspace, ".env.production"), "SECRET=3\n");
  await fs.writeFile(path.join(workspace, ".gitignore"), "node_modules/\n");
  await fs.writeFile(path.join(workspace, ".env.example"), "PORT=4173\n");
  await fs.writeFile(path.join(workspace, "package-lock.json"), "{}");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("resolveWorkspacePath", () => {
  it("resolves a project workspace under the root", () => {
    expect(resolveWorkspacePath("/tmp/opencode/ws", "abc")).toBe("/tmp/opencode/ws/abc");
  });

  it("rejects ids that escape or target the root", () => {
    expect(() => resolveWorkspacePath("/tmp/opencode/ws", "../etc")).toThrow(/escapes/);
    expect(() => resolveWorkspacePath("/tmp/opencode/ws", "/etc")).toThrow(/escapes|outside/);
    expect(() => resolveWorkspacePath("/tmp/opencode/ws", "")).toThrow(/required/);
  });
});

describe("listWorkspaceFiles", () => {
  it("indexes project files and skips VCS, dependencies and dotfiles", async () => {
    const files = await listWorkspaceFiles(workspace);
    const paths = files.map((file) => file.path);

    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("public/index.html");
    expect(paths).toContain("package-lock.json");
    expect(paths.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((file) => file.startsWith(".git/"))).toBe(false);
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain(".env.local");
    expect(paths).not.toContain(".env.production");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain(".env.example");

    const source = files.find((file) => file.path === "src/index.ts");
    expect(source?.language).toBe("typescript");
    expect(source?.sizeBytes).toBeGreaterThan(0);
    expect(source?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and returns identical output on repeat runs", async () => {
    const first = await listWorkspaceFiles(workspace);
    const second = await listWorkspaceFiles(workspace);
    expect(second).toEqual(first);
  });

  it("honours the maxFiles bound", async () => {
    const files = await listWorkspaceFiles(workspace, { maxFiles: 1 });
    expect(files).toHaveLength(1);
  });
});

describe("writeWorkspaceFile", () => {
  it("creates parent directories and hashes the content", async () => {
    const written = await writeWorkspaceFile(workspace, "src/deep/nested/file.ts", "export {};\n");
    expect(written.path).toBe("src/deep/nested/file.ts");
    expect(written.language).toBe("typescript");
    expect(written.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readWorkspaceText(workspace, "src/deep/nested/file.ts")).toBe("export {};\n");
  });

  it("refuses to write outside the workspace", async () => {
    await expect(writeWorkspaceFile(workspace, "../escape.txt", "nope")).rejects.toThrow();
  });

  it("returns null for a missing file", async () => {
    expect(await readWorkspaceText(workspace, "src/missing.ts")).toBeNull();
  });
});

describe("collectSourceFiles", () => {
  it("prefers source and test files over config noise", async () => {
    const files = await collectSourceFiles(workspace, { maxFiles: 5, maxBytesPerFile: 1_000 });
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]?.path).toBe("src/deep/nested/file.ts");
    expect(files.some((file) => file.path === "package-lock.json")).toBe(false);
    expect(files.every((file) => file.path !== "node_modules/dep/index.js")).toBe(true);
  });

  it("truncates oversized files instead of dropping them", async () => {
    await writeWorkspaceFile(workspace, "src/big.ts", "x".repeat(500));
    const files = await collectSourceFiles(workspace, { maxFiles: 10, maxBytesPerFile: 100 });
    const big = files.find((file) => file.path === "src/big.ts");
    expect(big?.content).toMatch(/truncated/);
  });
});

describe("artifacts", () => {
  it("round-trips a JSON artifact", async () => {
    await saveArtifact(workspace, "Review Result!", { verdict: "approved" });
    const loaded = await loadArtifact<{ verdict: string }>(
      workspace,
      "review-result",
      (value) => value as { verdict: string },
    );
    expect(loaded).toEqual({ verdict: "approved" });
    expect(
      await readWorkspaceText(workspace, ".autodev/artifacts/review-result.json"),
    ).not.toBeNull();
  });

  it("returns null when an artifact is missing or corrupt", async () => {
    expect(await loadArtifact(workspace, "missing", (value) => value)).toBeNull();
    await writeWorkspaceFile(workspace, ".autodev/artifacts/corrupt.json", "{not json");
    expect(await loadArtifact(workspace, "corrupt", (value) => value)).toBeNull();
  });
});
