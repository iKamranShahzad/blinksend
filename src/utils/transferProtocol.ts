export const PROTOCOL_VERSION = 2;
export const CHUNK_SIZE = 16 * 1024;
export const MAX_RECEIVE_BYTES = 256 * 1024 * 1024;
const HEADER_SIZE = 44;
const MAGIC = 0x42534632; // BSF2: transfer identity travels with every binary payload.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function encodeChunk(
  id: string,
  index: number,
  bytes: Uint8Array,
): ArrayBuffer {
  if (
    !UUID.test(id) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 0xffffffff ||
    bytes.length > CHUNK_SIZE
  )
    throw new Error("Invalid file chunk");
  const frame = new ArrayBuffer(HEADER_SIZE + bytes.length);
  const view = new DataView(frame);
  view.setUint32(0, MAGIC);
  new Uint8Array(frame, 4, 36).set(new TextEncoder().encode(id));
  view.setUint32(40, index);
  new Uint8Array(frame, HEADER_SIZE).set(bytes);
  return frame;
}

export function decodeChunk(frame: ArrayBuffer) {
  if (
    frame.byteLength < HEADER_SIZE ||
    frame.byteLength > HEADER_SIZE + CHUNK_SIZE ||
    new DataView(frame).getUint32(0) !== MAGIC
  )
    throw new Error("Invalid file frame");
  const id = new TextDecoder().decode(new Uint8Array(frame, 4, 36));
  if (!UUID.test(id)) throw new Error("Invalid transfer identity");
  return {
    id,
    index: new DataView(frame).getUint32(40),
    bytes: new Uint8Array(frame, HEADER_SIZE),
  };
}

export function safeFileName(name: string): string {
  return (
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 255) || "download"
  );
}

export class TransferCancelledError extends Error {
  constructor(message = "Transfer cancelled") {
    super(message);
    this.name = "TransferCancelledError";
  }
}

/** Every network wait settles on progress, cancellation, closure, or a deadline. */
export function waitForCondition(
  condition: () => boolean,
  events: EventTarget,
  signal: AbortSignal,
  timeoutMs: number,
  message: string,
  resetOnProgress = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      events.removeEventListener("change", check);
      signal.removeEventListener("abort", abort);
    };
    const finish = (error?: unknown) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const deadline = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error(message)), timeoutMs);
    };
    const abort = () => finish(signal.reason || new TransferCancelledError());
    const check = () => {
      if (signal.aborted) abort();
      else if (condition()) finish();
      else if (resetOnProgress) deadline();
    };
    events.addEventListener("change", check);
    signal.addEventListener("abort", abort, { once: true });
    deadline();
    check();
  });
}
