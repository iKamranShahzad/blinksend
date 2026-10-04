import type { Device, FileTransfer } from "../types/types";
import { generateId, TransferCancelledError } from "./transferProtocol";

export interface TransferJob {
  file: File;
  transfer: FileTransfer;
  controller?: AbortController;
}

/** One queue owns all picker invocations. Retries keep their UI ID but use a new wire attempt. */
export class TransferQueue {
  private jobs = new Map<string, TransferJob>();
  private running = false;
  private stopped = false;
  private revision = 0;
  constructor(
    private send: (job: TransferJob, signal: AbortSignal) => Promise<void>,
    private ready: (peerId: string) => boolean,
    private onUpdate: (transfer: FileTransfer) => void,
  ) {}

  report(transfer: FileTransfer) {
    const job = this.jobs.get(transfer.id);
    if (job) job.transfer = { ...job.transfer, ...transfer };
    if (!this.stopped) this.onUpdate(job?.transfer || transfer);
  }
  enqueue(files: File[], peer: Device) {
    for (const file of files) {
      const transfer: FileTransfer = {
        id: generateId(),
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        status: "queued",
        direction: "send",
        peerId: peer.id,
        peerName: peer.name,
        transferredBytes: 0,
      };
      this.jobs.set(transfer.id, { file, transfer });
      this.report(transfer);
    }
    this.wake();
  }
  wake() {
    void this.pump();
  }
  private async pump() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      let job: TransferJob | undefined;
      while (
        !this.stopped &&
        (job = [...this.jobs.values()].find(
          (entry) =>
            entry.transfer.status === "queued" &&
            this.ready(entry.transfer.peerId!),
        ))
      ) {
        const active = job;
        const revision = this.revision;
        active.controller = new AbortController();
        this.report({
          ...active.transfer,
          status: "pending",
          error: undefined,
        });
        try {
          await this.send(active, active.controller.signal);
          if (revision !== this.revision) continue;
          this.report({
            ...active.transfer,
            status: "completed",
            progress: 100,
            transferredBytes: active.file.size,
            remainingSeconds: 0,
          });
          this.jobs.delete(active.transfer.id); // Release File references on success.
        } catch (error) {
          if (revision !== this.revision) continue;
          this.report({
            ...active.transfer,
            status:
              error instanceof TransferCancelledError ? "cancelled" : "error",
            error:
              error instanceof Error
                ? error.message
                : "Transfer failed. Try again.",
          });
        } finally {
          active.controller = undefined;
        }
      }
    } finally {
      this.running = false;
    }
  }
  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.controller) job.controller.abort(new TransferCancelledError());
    else
      this.report({ ...job.transfer, status: "cancelled", error: undefined });
  }
  retry(id: string) {
    const job = this.jobs.get(id);
    if (
      !job ||
      job.controller ||
      !["error", "cancelled"].includes(job.transfer.status)
    )
      return;
    this.report({
      ...job.transfer,
      status: "queued",
      progress: 0,
      transferredBytes: 0,
      bytesPerSecond: undefined,
      remainingSeconds: undefined,
      error: undefined,
    });
    this.wake();
  }
  remove(id: string) {
    if (!this.jobs.get(id)?.controller) this.jobs.delete(id);
  }
  invalidatePeers(peers: Device[]) {
    const ids = new Set(peers.map((peer) => peer.id));
    for (const job of this.jobs.values()) {
      if (
        !ids.has(job.transfer.peerId!) &&
        ["queued", "pending"].includes(job.transfer.status)
      ) {
        if (job.controller)
          job.controller.abort(new Error("Recipient left the room"));
        else
          this.report({
            ...job.transfer,
            status: "error",
            error: "Recipient left the room",
          });
      }
    }
    this.wake();
  }
  clear() {
    this.revision++;
    for (const job of this.jobs.values())
      job.controller?.abort(new TransferCancelledError("Room closed"));
    this.jobs.clear();
  }
  dispose() {
    this.stopped = true;
    this.clear();
  }
}
