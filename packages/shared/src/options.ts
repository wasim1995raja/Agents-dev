/**
 * Dependency-free option lists shared by the API and the dashboard.
 *
 * Kept separate from `contracts.ts` so the browser bundle can import the
 * options without pulling in zod or the `.js`-specifier modules that
 * Turbopack cannot resolve in workspace TypeScript sources.
 */

export const TECH_STACK_OPTIONS = [
  "nextjs",
  "react",
  "typescript",
  "nodejs",
  "postgresql",
  "tailwind",
  "prisma",
  "drizzle",
  "docker",
  "playwright",
] as const;
export type TechStackOption = (typeof TECH_STACK_OPTIONS)[number];
