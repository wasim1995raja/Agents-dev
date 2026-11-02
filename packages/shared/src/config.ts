import path from "node:path";

import { z } from "zod";

import { ENGINE_NAMES } from "./domain.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default("127.0.0.1"),
  CORS_ORIGIN: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  DATABASE_URL: z
    .string()
    .default("postgresql://autodev:autodev@127.0.0.1:5432/autodev"),
  WORKSPACES_ROOT: z.string().default("./workspaces"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  /** "auto" picks codex when OPENAI_API_KEY is present, otherwise scaffold. */
  AUTODEV_ENGINE: z.enum(["auto", ...ENGINE_NAMES]).default("auto"),
  AUTODEV_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),

  SANDBOX_IMAGE: z.string().default("autodev/workspace:latest"),
  SANDBOX_MEMORY_MB: z.coerce.number().int().min(256).max(16384).default(2048),
  SANDBOX_CPUS: z.coerce.number().min(0.5).max(8).default(2),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(64).max(4096).default(512),
  COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900000).default(300000),
  MAX_COMMANDS_PER_PROJECT: z.coerce.number().int().min(10).max(10000).default(500),
});

export type AppConfig = z.infer<typeof envSchema> & {
  workspacesRoot: string;
  hasOpenAIKey: boolean;
  resolvedEngine: (typeof ENGINE_NAMES)[number];
};

export function readConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const env = parsed.data;
  const hasOpenAIKey = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim().length > 0);
  const resolvedEngine =
    env.AUTODEV_ENGINE === "auto"
      ? hasOpenAIKey
        ? "codex"
        : "scaffold"
      : env.AUTODEV_ENGINE;

  return {
    ...env,
    workspacesRoot: path.resolve(env.WORKSPACES_ROOT),
    hasOpenAIKey,
    resolvedEngine,
  };
}
