/**
 * Idempotent SMS bootstrap data.
 *
 * Seeds the default role set and a single SUPER_ADMIN user so a fresh database
 * can be explored without hand-inserting rows. Existing rows are never
 * overwritten: re-running this script is safe.
 *
 * The bootstrap password is intentionally weak and local-only. Set
 * `SMS_ADMIN_PASSWORD` (or change the password through the API) before any
 * deployment that is reachable outside the machine.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import {
  type DatabaseHandle,
  createDatabase,
  resolveDatabaseUrl,
  smsRoles,
  smsUsers,
} from "@autodev/db";

import { hashPassword } from "./password.js";

export const SMS_DEFAULT_ROLES = [
  { name: "SUPER_ADMIN", description: "Unrestricted SMS administrator" },
  { name: "ADMIN", description: "Administrative user" },
  { name: "ADMISSION_MAKER", description: "Prepares admission changes" },
  { name: "ADMISSION_CHECKER", description: "Approves admission changes" },
  { name: "ACADEMIC_MAKER", description: "Prepares academic changes" },
  { name: "ACADEMIC_CHECKER", description: "Approves academic changes" },
  { name: "FEE_MAKER", description: "Prepares fee changes" },
  { name: "FEE_CHECKER", description: "Approves fee changes" },
  { name: "VIEWER", description: "Read-only user" },
] as const;

export const SMS_BOOTSTRAP_USERNAME = "superadmin";
export const SMS_BOOTSTRAP_EMAIL = "superadmin@sms.local";
export const SMS_BOOTSTRAP_PASSWORD = "ChangeMe123!";

export interface SmsSeedResult {
  rolesCreated: number;
  adminCreated: boolean;
}

export async function seedSmsDefaults(
  handle: DatabaseHandle,
  options: { adminPassword?: string } = {},
): Promise<SmsSeedResult> {
  let rolesCreated = 0;

  for (const role of SMS_DEFAULT_ROLES) {
    const [row] = await handle.db
      .insert(smsRoles)
      .values({ name: role.name, description: role.description })
      .onConflictDoNothing()
      .returning({ id: smsRoles.id });
    if (row) rolesCreated += 1;
  }

  const [superAdmin] = await handle.db
    .select()
    .from(smsRoles)
    .where(eq(smsRoles.name, "SUPER_ADMIN"))
    .limit(1);
  if (!superAdmin) {
    throw new Error("SUPER_ADMIN role could not be created");
  }

  const [existing] = await handle.db
    .select({ id: smsUsers.id })
    .from(smsUsers)
    .where(eq(smsUsers.username, SMS_BOOTSTRAP_USERNAME))
    .limit(1);
  if (existing) {
    return { rolesCreated, adminCreated: false };
  }

  await handle.db.insert(smsUsers).values({
    username: SMS_BOOTSTRAP_USERNAME,
    fullName: "SMS Super Admin",
    email: SMS_BOOTSTRAP_EMAIL,
    passwordHash: hashPassword(options.adminPassword ?? SMS_BOOTSTRAP_PASSWORD),
    roleId: superAdmin.id,
    status: "active",
  });

  return { rolesCreated, adminCreated: true };
}

async function main(): Promise<void> {
  const handle = createDatabase(resolveDatabaseUrl(), { max: 2 });
  try {
    const result = await seedSmsDefaults(handle, {
      adminPassword: process.env.SMS_ADMIN_PASSWORD?.trim() || undefined,
    });
    console.log(
      `[sms:seed] roles created: ${result.rolesCreated}; super admin created: ${result.adminCreated}`,
    );
    if (result.adminCreated) {
      console.log(
        `[sms:seed] bootstrap login ${SMS_BOOTSTRAP_USERNAME} uses SMS_ADMIN_PASSWORD or the local default — change it before exposing the API.`,
      );
    }
  } finally {
    await handle.close();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("[sms:seed] failed:", error);
    process.exitCode = 1;
  });
}
