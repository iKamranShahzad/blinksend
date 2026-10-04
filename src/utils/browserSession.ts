import { generateId } from "./transferProtocol";

const STORAGE_KEY = "blinksend-session-v2";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SessionStorage = Pick<Storage, "getItem" | "setItem">;
type SessionRecord = { id: string; resumeToken?: string };

export interface BrowserSession extends SessionRecord {
  save: (resumeToken: string) => void;
  release: () => Promise<void>;
}

/** Keep a tab's identity across reloads without letting copied tabs share it. */
export async function acquireBrowserSession(
  options: {
    storage?: SessionStorage | null;
    locks?: Pick<LockManager, "request"> | null;
    signal?: AbortSignal;
  } = {},
): Promise<BrowserSession | null> {
  let storage = options.storage;
  if (storage === undefined) {
    try {
      storage = typeof window !== "undefined" ? window.sessionStorage : null;
    } catch {
      storage = null;
    }
  }
  const locks =
    options.locks === undefined
      ? typeof navigator !== "undefined"
        ? navigator.locks
        : undefined
      : options.locks;
  let record: SessionRecord = { id: generateId() };
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (
      saved &&
      typeof saved.id === "string" &&
      UUID.test(saved.id) &&
      (saved.resumeToken === undefined ||
        (typeof saved.resumeToken === "string" &&
          saved.resumeToken.length > 0 &&
          saved.resumeToken.length <= 256))
    )
      record = { id: saved.id, resumeToken: saved.resumeToken };
  } catch {
    // Storage can be blocked, or a previous record can be malformed.
  }
  const persist = () => {
    if (options.signal?.aborted) return;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      // A usable in-memory session still works when browser storage is blocked.
    }
  };
  const create = (releaseLock: () => Promise<void>): BrowserSession => {
    let released = false;
    persist();
    return {
      ...record,
      save: (resumeToken) => {
        if (released || options.signal?.aborted) return;
        record.resumeToken = resumeToken;
        persist();
      },
      release: () => {
        released = true;
        return releaseLock();
      },
    };
  };
  if (options.signal?.aborted) return null;
  if (!locks) return create(async () => {});

  for (let attempt = 0; attempt < 2; attempt++) {
    let ready!: (session: BrowserSession | null) => void;
    const acquired = new Promise<BrowserSession | null>((resolve) => {
      ready = resolve;
    });
    let unlock!: () => void;
    const held = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    try {
      const finished = locks.request(
        `blinksend-session:${record.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock || options.signal?.aborted) {
            ready(null);
            return;
          }
          ready(
            create(async () => {
              unlock();
              await finished;
            }),
          );
          await held;
        },
      );
      void finished.catch(() => ready(null));
      const session = await acquired;
      if (session || options.signal?.aborted) return session;
    } catch {
      // A restricted browser can reject Web Locks; use a fresh identity below.
      break;
    }
    // sessionStorage may have been copied by "Duplicate tab" or window.open.
    record = { id: generateId() };
  }
  if (options.signal?.aborted) return null;
  record = { id: generateId() };
  return create(async () => {});
}
