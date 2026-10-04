import { describe, expect, it } from "vitest";
import { acquireBrowserSession } from "../src/utils/browserSession";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  clone() {
    const copy = new MemoryStorage();
    copy.values = new Map(this.values);
    return copy;
  }
}

function originLocks() {
  const held = new Set<string>();
  const request = async (
    name: string,
    _options: unknown,
    callback: (lock: Lock | null) => Promise<unknown>,
  ) => {
    await Promise.resolve();
    if (held.has(name)) return callback(null);
    held.add(name);
    try {
      return await callback({ name, mode: "exclusive" } as Lock);
    } finally {
      held.delete(name);
    }
  };
  return { held, locks: { request } as Pick<LockManager, "request"> };
}

describe("tab identity", () => {
  it("reuses the authenticated identity after a tab releases its previous page", async () => {
    const storage = new MemoryStorage();
    const { locks, held } = originLocks();
    const first = (await acquireBrowserSession({ storage, locks }))!;
    first.save("authenticated-token");
    await first.release();
    expect(held.size).toBe(0);
    const refreshed = (await acquireBrowserSession({ storage, locks }))!;
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.resumeToken).toBe("authenticated-token");
    await refreshed.release();
  });

  it("gives a duplicated tab a separate identity while keeping the original intact", async () => {
    const storage = new MemoryStorage();
    const { locks, held } = originLocks();
    const original = (await acquireBrowserSession({ storage, locks }))!;
    original.save("original-token");
    const copy = storage.clone();
    const duplicate = (await acquireBrowserSession({ storage: copy, locks }))!;
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.resumeToken).toBeUndefined();
    duplicate.save("duplicate-token");
    await duplicate.release();
    await original.release();
    const refreshed = (await acquireBrowserSession({ storage, locks }))!;
    expect(refreshed.id).toBe(original.id);
    expect(refreshed.resumeToken).toBe("original-token");
    await refreshed.release();
    expect(held.size).toBe(0);
  });

  it("starts safely with malformed or unavailable storage", async () => {
    const storage = new MemoryStorage();
    storage.setItem("blinksend-session-v2", "{broken");
    const fresh = (await acquireBrowserSession({ storage, locks: null }))!;
    expect(fresh.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh.resumeToken).toBeUndefined();
    await fresh.release();
    const blocked = {
      getItem: () => {
        throw new Error("Storage blocked");
      },
      setItem: () => {
        throw new Error("Storage blocked");
      },
    };
    const ephemeral = (await acquireBrowserSession({
      storage: blocked,
      locks: null,
    }))!;
    expect(() => ephemeral.save("token")).not.toThrow();
    await ephemeral.release();
  });

  it("does not overwrite a session when an effect is cancelled before lock acquisition", async () => {
    const storage = new MemoryStorage();
    const { locks, held } = originLocks();
    const abort = new AbortController();
    const abandoned = acquireBrowserSession({
      storage,
      locks,
      signal: abort.signal,
    });
    abort.abort();
    expect(await abandoned).toBeNull();
    expect(storage.values.size).toBe(0);
    expect(held.size).toBe(0);
  });
});
