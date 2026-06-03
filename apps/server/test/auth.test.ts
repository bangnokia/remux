import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeAuth } from "../src/auth.js";
import { MetadataStore } from "../src/metadata.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("initializeAuth", () => {
  it("stores and verifies a configured token", () => {
    const store = createStore();
    const auth = initializeAuth(store, "secret-token");

    expect(auth.generatedToken).toBeNull();
    expect(auth.verifyToken("secret-token")).toBe(true);
    expect(auth.verifyToken("wrong")).toBe(false);
  });

  it("disables auth when no token is configured", () => {
    const store = createStore();
    const auth = initializeAuth(store, "");

    expect(auth.authRequired).toBe(false);
    expect(auth.generatedToken).toBeNull();
    expect(auth.verifyToken(null)).toBe(true);
  });

  it("clears a stored token hash when auth is disabled", () => {
    const store = createStore();
    initializeAuth(store, "secret-token");

    const auth = initializeAuth(store, "");

    expect(auth.authRequired).toBe(false);
    expect(store.getString("auth.tokenHash")).toBeNull();
    expect(auth.verifyToken(null)).toBe(true);
  });
});

function createStore(): MetadataStore {
  const dir = mkdtempSync(join(tmpdir(), "telemux-auth-test-"));
  tempDirs.push(dir);
  return new MetadataStore(join(dir, "telemux.db"));
}
