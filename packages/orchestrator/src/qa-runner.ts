import type { SandboxManager } from "@autodev/sandbox";

export interface TestFailure {
  title: string;
  message: string;
}

export interface TestRunSummary {
  status: "passed" | "failed" | "error";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: TestFailure[];
  exitCode: number | null;
  timedOut: boolean;
  /** Trimmed console output used for repair prompts and the terminal panel. */
  output: string;
}

export interface ParsedReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: TestFailure[];
}

const PREINSTALLED_CLI = "/opt/autodev/node_modules/@playwright/test/cli.js";
const LOCAL_CLI = "node_modules/@playwright/test/cli.js";

interface PlaywrightJsonReport {
  suites?: unknown;
  stats?: {
    duration?: number;
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
  };
}

/**
 * Parses the Playwright JSON reporter. The reporter writes one JSON document to
 * stdout, but web-server logs can precede it, so the parser also tries the
 * substring starting at the first `{`.
 */
export function parsePlaywrightReport(stdout: string): ParsedReport | null {
  const candidates = jsonCandidates(stdout);
  for (const candidate of candidates) {
    let parsed: PlaywrightJsonReport;
    try {
      parsed = JSON.parse(candidate) as PlaywrightJsonReport;
    } catch {
      continue;
    }
    if (!parsed.stats || typeof parsed.stats !== "object") continue;

    const stats = parsed.stats;
    const expected = numberOrZero(stats.expected);
    const unexpected = numberOrZero(stats.unexpected);
    const skipped = numberOrZero(stats.skipped);
    const flaky = numberOrZero(stats.flaky);

    return {
      total: expected + unexpected + skipped + flaky,
      passed: expected + flaky,
      failed: unexpected,
      skipped,
      // Playwright reports fractional milliseconds; round here so every
      // consumer (events, integer DB column, dashboard) sees one value.
      durationMs: Math.round(numberOrZero(stats.duration)),
      failures: collectFailures(parsed.suites, []),
    };
  }
  return null;
}

function jsonCandidates(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace > 0) candidates.push(trimmed.slice(firstBrace));

  // The reporter's document is the last balanced object in the stream.
  const lastBrace = trimmed.lastIndexOf("}");
  if (lastBrace > firstBrace && firstBrace >= 0) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  return candidates;
}

function collectFailures(suites: unknown, prefixes: string[]): TestFailure[] {
  if (!Array.isArray(suites)) return [];
  const failures: TestFailure[] = [];

  for (const suite of suites) {
    if (!suite || typeof suite !== "object") continue;
    const record = suite as { title?: unknown; suites?: unknown; specs?: unknown };
    const title = typeof record.title === "string" ? record.title : "";
    const nextPrefixes = title ? [...prefixes, title] : prefixes;

    if (Array.isArray(record.specs)) {
      for (const spec of record.specs) {
        if (!spec || typeof spec !== "object") continue;
        const specRecord = spec as { title?: unknown; tests?: unknown };
        const specTitle = typeof specRecord.title === "string" ? specRecord.title : "(untitled)";
        if (!Array.isArray(specRecord.tests)) continue;

        for (const test of specRecord.tests) {
          if (!test || typeof test !== "object") continue;
          const testRecord = test as { results?: unknown };
          if (!Array.isArray(testRecord.results)) continue;

          for (const result of testRecord.results) {
            if (!result || typeof result !== "object") continue;
            const resultRecord = result as {
              status?: unknown;
              error?: { message?: unknown };
              errors?: Array<{ message?: unknown }>;
            };
            const failedStatus =
              resultRecord.status === "failed" ||
              resultRecord.status === "timedOut" ||
              resultRecord.status === "interrupted";
            if (!failedStatus) continue;

            const message =
              firstString(resultRecord.error?.message) ??
              firstString(resultRecord.errors?.[0]?.message) ??
              "test failed without an error message";

            failures.push({
              title: [...nextPrefixes, specTitle].filter(Boolean).join(" › "),
              message: stripAnsi(message).slice(0, 1_500),
            });
          }
        }
      }
    }

    failures.push(...collectFailures(record.suites, nextPrefixes));
  }

  return failures;
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Fallback parser for humans (list/line reporter) when JSON is unavailable. */
export function parseReporterText(output: string): ParsedReport {
  const clean = stripAnsi(output);
  const count = (pattern: RegExp): number => {
    const match = pattern.exec(clean);
    return match?.[1] ? Number.parseInt(match[1], 10) : 0;
  };

  const passed = count(/(\d+)\s+passed/);
  const failed = count(/(\d+)\s+failed/);
  const skipped = count(/(\d+)\s+skipped/);
  const didNotRun = count(/(\d+)\s+did not run/);
  const flaky = count(/(\d+)\s+flaky/);

  const failures: TestFailure[] = [];
  const failurePattern = /^\s+\d+\)\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = failurePattern.exec(clean)) !== null && failures.length < 10) {
    failures.push({ title: match[1]?.trim() ?? "(unknown)", message: "" });
  }

  return {
    total: passed + failed + skipped + didNotRun + flaky,
    passed: passed + flaky,
    failed: failed + didNotRun,
    skipped,
    durationMs: 0,
    failures,
  };
}

export interface RunPlaywrightOptions {
  sandbox: SandboxManager;
  containerId: string;
  projectId: string;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
}

/**
 * Executes the generated Playwright suite inside the project's container and
 * reports what actually happened. A run with zero collected tests is an error,
 * never a pass.
 */
export async function runPlaywrightTests(options: RunPlaywrightOptions): Promise<TestRunSummary> {
  const { sandbox, containerId, projectId } = options;
  const timeoutMs = options.timeoutMs ?? 300_000;

  const localProbe = await sandbox.exec({
    containerId,
    projectId,
    command: `test -f ${LOCAL_CLI} && echo local || echo preinstalled`,
    timeoutMs: 10_000,
  });
  const cli = localProbe.stdout.includes("local") ? LOCAL_CLI : PREINSTALLED_CLI;
  const command = `node ${cli} test --reporter=json`;

  const result = await sandbox.exec(
    { containerId, projectId, command, timeoutMs },
    {
      onChunk: (chunk) => options.onOutput?.(chunk.chunk),
    },
  );

  const combined = `${result.stdout}\n${result.stderr}`;
  const parsed = parsePlaywrightReport(result.stdout) ?? parseReporterText(combined);

  const noTests = parsed.total === 0;
  const status: TestRunSummary["status"] = noTests
    ? "error"
    : result.timedOut || parsed.failed > 0
      ? "failed"
      : "passed";

  return {
    status,
    total: parsed.total,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    // Playwright's JSON stats are fractional; round once so every consumer
    // (events, DB integer column, dashboard) sees the same value.
    durationMs: Math.round(parsed.durationMs || result.durationMs),
    failures: parsed.failures,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    output: trimOutput(combined),
  };
}

function trimOutput(value: string): string {
  const clean = stripAnsi(value).trim();
  return clean.length > 8_000 ? clean.slice(clean.length - 8_000) : clean;
}
