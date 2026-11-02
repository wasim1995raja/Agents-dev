/**
 * Password hashing for SMS users.
 *
 * Format: `scrypt$<salt-hex>$<digest-hex>`. Salts are random per hash, so the
 * same password never produces the same stored value. Verification uses a
 * constant-time comparison to avoid timing leaks.
 *
 * Auth (JWT/session lifecycle) will reuse these helpers; storing raw passwords
 * is never acceptable, even in the MVP.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const digest = scryptSync(password, salt, KEY_BYTES).toString("hex");
  return `${ALGORITHM}$${salt}$${digest}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algorithm, salt, digest] = parts;
  if (algorithm !== ALGORITHM || !salt || !digest) return false;

  const expected = Buffer.from(digest, "hex");
  if (expected.length !== KEY_BYTES) return false;

  const actual = scryptSync(password, salt, KEY_BYTES);
  return timingSafeEqual(actual, expected);
}
