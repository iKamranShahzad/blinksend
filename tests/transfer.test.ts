import { afterEach, describe, expect, it } from "vitest";
import { WebRTCHandler, getIceConfiguration } from "../src/utils/webRTCHandler";
import type { SignalTransport } from "../src/utils/signalingClient";
import type { FileTransfer, SignalMessage } from "../src/types/types";
import {
  CHUNK_SIZE,
  encodeChunk,
  generateId,
  TransferCancelledError,
  waitForCondition,
} from "../src/utils/transferProtocol";

type Payload = string | ArrayBuffer;
class Channel {
  label = "blinksend-v2";
  readyState = "connecting";
  binaryType = "arraybuffer";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  remote!: Channel;
  onmessage: ((event: { data: Payload }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onbufferedamountlow: (() => void) | null = null;
  constructor(
    private network: Network,
    readonly owner: string,
  ) {}
  send(raw: Payload) {
    if (this.readyState !== "open") throw new Error("Channel closed");
    const data = typeof raw === "string" ? raw : raw.slice(0);
    if (this.network.drop?.(data, this.owner)) return;
    const size = typeof data === "string" ? data.length : data.byteLength;
    this.bufferedAmount += size;
    queueMicrotask(() => {
      this.bufferedAmount -= size;
      if (this.remote.readyState === "open")
        this.remote.onmessage?.({
          data: this.network.mutate?.(data, this.owner) || data,
        });
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold)
        this.onbufferedamountlow?.();
    });
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    const remoteOpen = this.remote.readyState !== "closed";
    this.remote.readyState = "closed";
    this.onclose?.();
    if (remoteOpen) this.remote.onclose?.();
  }
}
class PeerConnection {
  connectionState = "new";
  signalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: Channel }) => void) | null = null;
  channels: Channel[] = [];
  candidates: RTCIceCandidateInit[] = [];
  constructor(
    private network: Network,
    readonly owner: string,
    readonly target: string,
  ) {
    network.pcs.set(owner + ":" + target, this);
    const pending = network.pending.get(owner + ":" + target);
    if (pending) {
      network.pending.delete(owner + ":" + target);
      this.channels.push(pending);
      queueMicrotask(() => this.ondatachannel?.({ channel: pending }));
    }
  }
  createDataChannel() {
    const left = new Channel(this.network, this.owner);
    const right = new Channel(this.network, this.target);
    left.remote = right;
    right.remote = left;
    this.channels.push(left);
    const other = this.network.pcs.get(this.target + ":" + this.owner);
    if (other) {
      other.channels.push(right);
      queueMicrotask(() => other.ondatachannel?.({ channel: right }));
    } else this.network.pending.set(this.target + ":" + this.owner, right);
    queueMicrotask(() => this.onnegotiationneeded?.());
    return left;
  }
  async setLocalDescription() {
    const answer = this.signalingState === "have-remote-offer";
    this.localDescription = {
      type: answer ? "answer" : "offer",
      sdp: "a=ice-ufrag:test",
    };
    this.signalingState = answer ? "stable" : "have-local-offer";
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    this.signalingState =
      description.type === "offer" ? "have-remote-offer" : "stable";
    if (description.type === "answer") {
      const other = this.network.pcs.get(this.target + ":" + this.owner)!;
      this.connectionState = other.connectionState = "connected";
      this.onconnectionstatechange?.();
      other.onconnectionstatechange?.();
      for (const channel of this.channels) {
        channel.open();
        channel.remote.open();
      }
    }
  }
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescription) throw new Error("Remote description missing");
    this.candidates.push(candidate);
  }
  restartIce() {
    queueMicrotask(() => this.onnegotiationneeded?.());
  }
  close() {
    this.connectionState = "closed";
    for (const channel of this.channels) channel.close();
  }
}
class Signal implements SignalTransport {
  connected = true;
  listeners = new Set<(message: SignalMessage) => void>();
  constructor(
    private network: Network,
    readonly id: string,
  ) {}
  subscribe(listener: (message: SignalMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  send(message: SignalMessage) {
    queueMicrotask(() => {
      for (const listener of this.network.signals.get(message.to!)!.listeners)
        listener({ ...message, from: this.id });
    });
  }
}
class Network {
  pcs = new Map<string, PeerConnection>();
  pending = new Map<string, Channel>();
  signals = new Map<string, Signal>();
  handlers: WebRTCHandler[] = [];
  drop?: (raw: Payload, owner: string) => boolean;
  mutate?: (raw: Payload, owner: string) => Payload;
  endpoint(id: string, peers: string[], timeoutMs = 200) {
    const signal = new Signal(this, id);
    this.signals.set(id, signal);
    const updates: FileTransfer[] = [];
    const files: Blob[] = [];
    const handler = new WebRTCHandler(
      signal,
      {
        onTransferProgress: (transfer) => updates.push(transfer),
        onFileReceived: (_name, blob) => files.push(blob),
      },
      {
        peerFactory: (_config, target) =>
          new PeerConnection(this, id, target) as unknown as RTCPeerConnection,
        timeoutMs,
      },
    );
    handler.setPeers(
      peers.map((peer) => ({
        id: peer,
        name: peer,
        type: "Browser",
        online: true,
      })),
    );
    this.handlers.push(handler);
    return { handler, signal, updates, files };
  }
  close() {
    for (const handler of this.handlers) handler.cleanup();
  }
}
const fixtures: Network[] = [];
const fixture = () => {
  const network = new Network();
  fixtures.push(network);
  return network;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => {
  for (const network of fixtures.splice(0)) network.close();
});

describe("transfer protocol", () => {
  it("automatically receives empty and multi-chunk files with exact bytes and MIME", async () => {
    const network = fixture();
    const a = network.endpoint("a", ["b"]);
    const b = network.endpoint("b", ["a"]);
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array(CHUNK_SIZE * 3 + 7).fill(91),
    ]) {
      const file = new File([bytes], "bytes.txt", { type: "text/plain" });
      await a.handler.sendFile(file, "b");
      const received = b.files.at(-1)!;
      expect(received.type).toBe("text/plain");
      expect(new Uint8Array(await received.arrayBuffer())).toEqual(bytes);
      expect(b.updates.at(-1)?.status).toBe("completed");
    }
  });
  it("supports simultaneous sends in opposite directions without mixing identities", async () => {
    const network = fixture();
    const a = network.endpoint("a", ["b"]);
    const b = network.endpoint("b", ["a"]);
    await Promise.all([
      a.handler.sendFile(new File(["from-a"], "a.txt"), "b"),
      b.handler.sendFile(new File(["from-b"], "b.txt"), "a"),
    ]);
    expect(await a.files[0].text()).toBe("from-b");
    expect(await b.files[0].text()).toBe("from-a");
  });
  it("buffers early ICE candidates until the remote description is set", async () => {
    const network = fixture();
    const a = network.endpoint("a", ["b"]);
    network.endpoint("b", ["a"]);
    a.signal.send({
      type: "rtc-candidate",
      to: "b",
      candidate: { candidate: "candidate", usernameFragment: "test" },
    });
    await tick();
    expect(network.pcs.get("b:a")!.candidates).toHaveLength(0);
    a.signal.send({ type: "rtc-offer", to: "b", sdp: "a=ice-ufrag:test" });
    await tick();
    expect(network.pcs.get("b:a")!.candidates).toHaveLength(1);
  });
  it("rejects corrupted bytes and duplicate/out-of-order chunks instead of confirming completion", async () => {
    for (const corruption of ["bytes", "index"]) {
      const network = fixture();
      const a = network.endpoint("a", ["b"]);
      const b = network.endpoint("b", ["a"]);
      network.mutate = (raw, owner) => {
        if (owner === "a" && raw instanceof ArrayBuffer) {
          if (corruption === "bytes") new Uint8Array(raw)[44] ^= 1;
          else new DataView(raw).setUint32(40, 5);
        }
        return raw;
      };
      await expect(
        a.handler.sendFile(new File(["data"], "data.txt"), "b"),
      ).rejects.toThrow();
      expect(b.files).toHaveLength(0);
      expect(b.updates.at(-1)?.status).toBe("error");
    }
  });
  it("settles a missing completion acknowledgment by a deadline and can retry on the same channel", async () => {
    const network = fixture();
    const a = network.endpoint("a", ["b"], 50);
    const b = network.endpoint("b", ["a"]);
    network.drop = (raw) =>
      typeof raw === "string" && JSON.parse(raw).type === "file-complete";
    const file = new File(["data"], "data.txt");
    await expect(a.handler.sendFile(file, "b", "same-ui-row")).rejects.toThrow(
      "did not confirm",
    );
    expect(b.files).toHaveLength(1);
    network.drop = undefined;
    await a.handler.sendFile(file, "b", "same-ui-row");
    expect(b.files).toHaveLength(2);
  });
  it("pauses/resumes sending and cancels a stalled transfer on both sides", async () => {
    const network = fixture();
    const a = network.endpoint("a", ["b"]);
    const b = network.endpoint("b", ["a"]);
    network.drop = (raw) =>
      typeof raw === "string" && JSON.parse(raw).type === "file-ready";
    const pending = a.handler.sendFile(
      new File(["data"], "data.txt"),
      "b",
      "cancel-id",
    );
    const cancelled = expect(pending).rejects.toBeInstanceOf(
      TransferCancelledError,
    );
    await tick();
    a.handler.cancelTransfer("cancel-id");
    await cancelled;
    await tick();
    expect(b.updates.at(-1)?.status).toBe("cancelled");
    expect(b.files).toHaveLength(0);
    network.drop = undefined;
    const progress = a.updates;
    const originalPush = progress.push.bind(progress);
    progress.push = (...updates) => {
      for (const update of updates)
        if (update.status === "transferring" && update.progress === 0)
          a.handler.pauseTransfer("pause-id", true);
      return originalPush(...updates);
    };
    const transfer = a.handler.sendFile(
      new File(["next"], "next.txt"),
      "b",
      "pause-id",
    );
    await tick();
    expect(b.updates.at(-1)?.status).toBe("paused");
    expect(b.files).toHaveLength(0);
    progress.push = originalPush;
    a.handler.pauseTransfer("pause-id", false);
    await transfer;
    expect(await b.files[0].text()).toBe("next");
  });
  it("a departed peer fails only its own transfers", async () => {
    const network = fixture();
    const a = network.endpoint("a", ["b", "c"]);
    network.endpoint("b", ["a"]);
    const c = network.endpoint("c", ["a"]);
    network.drop = (raw, owner) =>
      owner === "b" &&
      typeof raw === "string" &&
      JSON.parse(raw).type === "file-ready";
    const stalled = a.handler.sendFile(new File(["b"], "b.txt"), "b");
    const failed = expect(stalled).rejects.toThrow("left the room");
    const healthy = a.handler.sendFile(new File(["c"], "c.txt"), "c");
    await tick();
    a.handler.setPeers([{ id: "c", name: "c", type: "Browser" }]);
    await failed;
    await healthy;
    expect(await c.files[0].text()).toBe("c");
  });
  it("backpressure waits settle when aborted and malformed frames cannot allocate receive state", async () => {
    const controller = new AbortController();
    const waiting = waitForCondition(
      () => false,
      new EventTarget(),
      controller.signal,
      1000,
      "stalled",
    );
    const failed = expect(waiting).rejects.toBeInstanceOf(
      TransferCancelledError,
    );
    controller.abort(new TransferCancelledError());
    await failed;
    expect(() => encodeChunk(generateId(), -1, new Uint8Array(1))).toThrow();
    expect(
      getIceConfiguration().iceServers!.every((server) =>
        typeof server.urls === "string"
          ? server.urls.length > 0
          : server.urls.every(Boolean),
      ),
    ).toBe(true);
  });
});
