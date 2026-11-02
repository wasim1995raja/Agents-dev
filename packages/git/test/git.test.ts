import fs from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitError, GitRepo } from "../src/git.js";

const root = path.join("/tmp/opencode", `autodev-git-test-${process.pid}-${Date.now()}`);

let repoPath: string;
let repo: GitRepo;

beforeEach(async () => {
  repoPath = path.join(root, `repo-${Math.random().toString(16).slice(2)}`);
  await fs.mkdir(repoPath, { recursive: true });
  repo = new GitRepo({ repoPath });
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const write = async (relative: string, content: string) => {
  const target = path.join(repoPath, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
};

describe("GitRepo", () => {
  it("initialises a repository once and is idempotent", async () => {
    await repo.init();
    expect(await repo.isRepository()).toBe(true);

    // A second init must not fail or wipe state.
    await repo.init();
    expect(await repo.isRepository()).toBe(true);
    expect((await repo.status()).length).toBe(0);
  });

  it("commits tracked work and reports a clean tree afterwards", async () => {
    await repo.init();
    await write("README.md", "# Demo\n");

    const outcome = await repo.commitAll("feat: add readme");
    expect(outcome.committed).toBe(true);
    expect(outcome.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await repo.status()).toEqual([]);

    const again = await repo.commitAll("feat: nothing changed");
    expect(again.committed).toBe(false);
    expect(again.commit).toBeNull();
    expect(again.reason).toMatch(/clean/);
  });

  it("rejects empty commit messages and labels", async () => {
    await repo.init();
    await write("a.txt", "a");
    await expect(repo.commitAll("   ")).rejects.toThrow(/must not be empty/);
    await expect(repo.checkpoint(" ")).rejects.toThrow(/must not be empty/);
  });

  it("records checkpoints and lists them newest first", async () => {
    await repo.init();
    await write("a.txt", "one");
    const first = await repo.checkpoint("milestone one");
    await write("a.txt", "two");
    const second = await repo.checkpoint("milestone two");

    const log = await repo.log();
    expect(log).toHaveLength(2);
    expect(log[0]?.commit).toBe(second.commit);
    expect(log[0]?.subject).toBe("checkpoint: milestone two");
    expect(log[1]?.commit).toBe(first.commit);
    expect(log[0]?.createdAt).not.toBe("");
  });

  it("returns an empty log before the first commit", async () => {
    await repo.init();
    expect(await repo.log()).toEqual([]);
    expect(await repo.hasCommits()).toBe(false);
  });

  it("rolls back file content and optionally removes untracked files", async () => {
    await repo.init();
    await write("app.txt", "known good");
    await write("nested/deep.txt", "tracked");
    const good = await repo.checkpoint("known good");

    await write("app.txt", "broken");
    await write("scratch.tmp", "junk");
    expect(await repo.status()).not.toEqual([]);

    await repo.rollback(good.commit!, { clean: true });

    expect(await fs.readFile(path.join(repoPath, "app.txt"), "utf8")).toBe("known good");
    await expect(fs.readFile(path.join(repoPath, "scratch.tmp"), "utf8")).rejects.toThrow(/ENOENT/);
    expect(await repo.status()).toEqual([]);
  });

  it("reports diffstat and changed files between revisions", async () => {
    await repo.init();
    await write("one.txt", "one");
    const base = await repo.checkpoint("base");

    await write("one.txt", "one changed");
    await write("two.txt", "two");
    const next = await repo.checkpoint("next");

    const stat = await repo.diffStat(base.commit!, next.commit!);
    expect(stat).toMatch(/one\.txt/);
    expect(stat).toMatch(/two\.txt/);

    const files = await repo.changedFiles(base.commit!, next.commit!);
    expect(files.sort()).toEqual(["one.txt", "two.txt"]);
  });

  it("refuses unsafe revisions and flag-like input", async () => {
    await repo.init();
    await expect(repo.rollback("--hard")).rejects.toThrow(/unsafe git revision/);
    await expect(repo.rollback("main; rm -rf /")).rejects.toThrow(/unsafe git revision/);
    await expect(repo.diffStat("HEAD~1; ls")).rejects.toThrow(/unsafe git revision/);
  });

  it("accepts HEAD and short hashes as revisions", async () => {
    await repo.init();
    await write("a.txt", "a");
    const commit = await repo.checkpoint("first");

    await expect(repo.diffStat("HEAD")).resolves.toBeTypeOf("string");
    await expect(repo.rollback(commit.commit!.slice(0, 7))).resolves.toBeUndefined();
  });

  it("surfaces git failures with the command and stderr", async () => {
    await repo.init();
    const failure = repo.run(["rev-parse", "--verify", "does-not-exist"]);
    await expect(failure).rejects.toBeInstanceOf(GitError);
    await expect(failure).rejects.toThrow(/git rev-parse --verify does-not-exist failed/);
  });

  it("guards the log limit", async () => {
    await repo.init();
    await expect(repo.log(0)).rejects.toThrow(/between 1 and 500/);
    await expect(repo.log(10_000)).rejects.toThrow(/between 1 and 500/);
  });

  it("rejects empty argument lists", async () => {
    await repo.init();
    await expect(repo.run([])).rejects.toThrow(/at least one argument/);
  });
});
