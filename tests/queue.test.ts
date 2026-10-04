import { describe, expect, it } from "vitest";
import { TransferQueue } from "../src/utils/transferQueue";
import type { FileTransfer } from "../src/types/types";
import { TransferCancelledError } from "../src/utils/transferProtocol";

const peer = { id: "peer", name: "Peer", type: "Browser", online: true };
const file = () => new File(["test"], "file.txt");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("outgoing queue", () => {
  it("serializes overlapping selections and continues after one file fails", async () => {
    const calls: string[] = [];
    const updates: FileTransfer[] = [];
    let finish: (() => void) | undefined;
    const queue = new TransferQueue(
      async (job) => {
        calls.push(job.transfer.id);
        if (calls.length === 1)
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        else if (calls.length === 2) throw new Error("Network lost");
      },
      () => true,
      (transfer) => updates.push(transfer),
    );
    queue.enqueue([file(), file()], peer);
    queue.enqueue([file()], peer);
    expect(calls).toHaveLength(1);
    finish!();
    await tick();
    expect(calls).toHaveLength(3);
    expect(
      updates.filter((entry) => entry.status === "completed"),
    ).toHaveLength(2);
    expect(updates.filter((entry) => entry.status === "error")[0].error).toBe(
      "Network lost",
    );
    queue.dispose();
  });
  it("cancels queued and active files, and retries the same UI row", async () => {
    const updates: FileTransfer[] = [];
    let ready = false;
    let attempts = 0;
    const queue = new TransferQueue(
      async (_job, signal) => {
        if (++attempts === 1)
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
      },
      () => ready,
      (transfer) => updates.push(transfer),
    );
    queue.enqueue([file()], peer);
    const id = updates[0].id;
    queue.cancel(id);
    expect(updates.at(-1)?.status).toBe("cancelled");
    ready = true;
    queue.retry(id);
    expect(attempts).toBe(1);
    queue.cancel(id);
    await tick();
    expect(updates.at(-1)?.status).toBe("cancelled");
    queue.retry(id);
    await tick();
    expect(updates.at(-1)?.status).toBe("completed");
    expect(new Set(updates.map((entry) => entry.id))).toEqual(new Set([id]));
    queue.dispose();
  });
  it("waits for reconnect and prevents cleared jobs from reappearing after leaving", async () => {
    const updates: FileTransfer[] = [];
    let ready = false;
    const queue = new TransferQueue(
      async (_job, signal) => {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new TransferCancelledError()),
            { once: true },
          ),
        );
      },
      () => ready,
      (transfer) => updates.push(transfer),
    );
    queue.enqueue([file()], peer);
    expect(updates.at(-1)?.status).toBe("queued");
    ready = true;
    queue.wake();
    expect(updates.at(-1)?.status).toBe("pending");
    const count = updates.length;
    queue.clear();
    await tick();
    expect(updates).toHaveLength(count);
    queue.dispose();
  });
});
