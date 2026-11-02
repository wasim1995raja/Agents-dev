import { describe, expect, it } from "vitest";

import { parsePlaywrightReport, parseReporterText } from "../src/qa-runner.js";

const report = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    config: {},
    suites: [
      {
        title: "home.spec.ts",
        specs: [
          {
            title: "renders the home page",
            ok: true,
            tests: [{ results: [{ status: "passed" }] }],
          },
        ],
        suites: [],
      },
    ],
    errors: [],
    stats: { startTime: "2026-01-01T00:00:00.000Z", duration: 1234, expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
    ...overrides,
  });

describe("parsePlaywrightReport", () => {
  it("parses a clean JSON report", () => {
    const parsed = parsePlaywrightReport(report());
    expect(parsed).not.toBeNull();
    expect(parsed?.total).toBe(1);
    expect(parsed?.passed).toBe(1);
    expect(parsed?.failed).toBe(0);
    expect(parsed?.durationMs).toBe(1234);
    expect(parsed?.failures).toEqual([]);
  });

  it("rounds fractional durations to whole milliseconds", () => {
    const parsed = parsePlaywrightReport(
      report({ stats: { duration: 1746.4480000000003, expected: 1, unexpected: 0, skipped: 0, flaky: 0 } }),
    );
    expect(parsed?.durationMs).toBe(1746);
    expect(Number.isInteger(parsed?.durationMs)).toBe(true);
  });

  it("tolerates prefix noise from a web server", () => {
    const parsed = parsePlaywrightReport(`[webServer] listening on 4173\n${report()}`);
    expect(parsed?.passed).toBe(1);
  });

  it("counts flaky tests as passing and skipped tests as skipped", () => {
    const parsed = parsePlaywrightReport(
      report({
        stats: { duration: 10, expected: 1, unexpected: 0, skipped: 2, flaky: 1 },
      }),
    );
    expect(parsed).toMatchObject({ total: 4, passed: 2, failed: 0, skipped: 2 });
  });

  it("extracts failure titles and messages", () => {
    const parsed = parsePlaywrightReport(
      JSON.stringify({
        suites: [
          {
            title: "checkout.spec.ts",
            specs: [
              {
                title: "pays with a card",
                tests: [
                  {
                    results: [
                      {
                        status: "failed",
                        error: { message: "Expected 200 but received 500" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        stats: { duration: 5, expected: 0, unexpected: 1, skipped: 0, flaky: 0 },
      }),
    );
    expect(parsed?.failed).toBe(1);
    expect(parsed?.failures[0]?.title).toBe("checkout.spec.ts › pays with a card");
    expect(parsed?.failures[0]?.message).toMatch(/Expected 200/);
  });

  it("returns null for output that is not a playwright report", () => {
    expect(parsePlaywrightReport("")).toBeNull();
    expect(parsePlaywrightReport("Error: cannot find module")).toBeNull();
    expect(parsePlaywrightReport('{"not":"a report"}')).toBeNull();
  });
});

describe("parseReporterText", () => {
  it("reads counts from the line reporter", () => {
    const parsed = parseReporterText(
      ["  1) checkout.spec.ts:4:1 › pays with a card", "  2 failed", "  3 passed", "  1 skipped"].join("\n"),
    );
    expect(parsed.failed).toBe(2);
    expect(parsed.passed).toBe(3);
    expect(parsed.skipped).toBe(1);
    expect(parsed.total).toBe(6);
    expect(parsed.failures[0]?.title).toMatch(/pays with a card/);
  });

  it("strips ANSI colour codes", () => {
    const parsed = parseReporterText("\u001b[32m2 passed\u001b[39m");
    expect(parsed.passed).toBe(2);
  });

  it("reports nothing collected as empty rather than passing", () => {
    expect(parseReporterText("no tests found")).toMatchObject({ total: 0, passed: 0, failed: 0 });
  });
});
