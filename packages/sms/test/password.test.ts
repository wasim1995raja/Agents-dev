import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../src/password.js";

describe("password hashing", () => {
  it("produces a salted scrypt hash, never the raw password", () => {
    const hash = hashPassword("correct-horse-battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("correct-horse-battery");
  });

  it("salts every hash so identical passwords differ", () => {
    const first = hashPassword("same-password");
    const second = hashPassword("same-password");
    expect(first).not.toBe(second);
  });

  it("verifies the correct password", () => {
    const hash = hashPassword("s3cret-value");
    expect(verifyPassword("s3cret-value", hash)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const hash = hashPassword("s3cret-value");
    expect(verifyPassword("s3cret-VALUE", hash)).toBe(false);
  });

  it("rejects malformed stored values without throwing", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$onlysalt")).toBe(false);
    expect(verifyPassword("x", "scrypt$salt$zz")).toBe(false);
  });
});
