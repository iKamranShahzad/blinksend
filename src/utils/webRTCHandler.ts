import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Device, FileTransfer, SignalMessage } from "../types/types";
import type { SignalTransport } from "./signalingClient";
import {
  CHUNK_SIZE,
  MAX_RECEIVE_BYTES,
  PROTOCOL_VERSION,
  decodeChunk,
  encodeChunk,
  generateId,
  safeFileName,
  TransferCancelledError,
  waitForCondition,
} from "./transferProtocol";

interface Peer {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  events: EventTarget;
  candidates: RTCIceCandidateInit[];
  signaling: Promise<void>;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  restartCount: number;
  recoveryTimer?: ReturnType<typeof setTimeout>;
}
interface Outgoing {
  transfer: FileTransfer;
  wireId: string;
  file: File;
  peerId: string;
  channel?: RTCDataChannel;
  controller: AbortController;
  events: EventTarget;
  metadataReady: boolean;
  sentChunks: number;
  acknowledgedChunks: number;
  completed: boolean;
  paused: boolean;
  digest?: string;
  started: number;
  lastReport: number;
}
interface Incoming {
  transfer: FileTransfer;
  peerId: string;
  channel: RTCDataChannel;
  chunks: Uint8Array<ArrayBuffer>[];
  hash: ReturnType<typeof sha256.create>;
  totalChunks: number;
  nextIndex: number;
  receivedBytes: number;
  fileType: string;
  timer?: ReturnType<typeof setTimeout>;
  started: number;
  lastReport: number;
  paused: boolean;
}
interface Callbacks {
  onTransferProgress: (transfer: FileTransfer) => void;
  onFileReceived: (fileName: string, fileData: Blob) => void;
  onPeerStatus?: (peerId: string, status: string) => void;
}

export function getIceConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const urls = (process.env.NEXT_PUBLIC_TURN_SERVER_URL || "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => /^(stun|turn|turns):/.test(url));
  if (urls.length)
    iceServers.push({
      urls,
      username: process.env.NEXT_PUBLIC_TURN_SERVER_USERNAME || undefined,
      credential: process.env.NEXT_PUBLIC_TURN_SERVER_CREDENTIAL || undefined,
    });
  return {
    iceServers,
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    iceCandidatePoolSize: 10,
  };
}

/** Protocol v2: one channel per peer, independent send/receive identities, automatic reception. */
export class WebRTCHandler {
  private peers = new Map<string, Peer>();
  private allowedPeers = new Map<string, Device>();
  private outgoing = new Map<string, Outgoing>();
  private incoming = new Map<string, Incoming>();
  private receiveBytes = 0;
  private disposed = false;
  private unsubscribe: () => void;
  constructor(
    private signal: SignalTransport,
    private callbacks: Callbacks,
    private options: {
      peerFactory?: (
        config: RTCConfiguration,
        peerId: string,
      ) => RTCPeerConnection;
      timeoutMs?: number;
    } = {},
  ) {
    this.unsubscribe = signal.subscribe(this.handleSignalingMessage);
  }
  private changed(events: EventTarget) {
    events.dispatchEvent(new Event("change"));
  }
  private timeout() {
    return this.options.timeoutMs || 30000;
  }
  setPeers(devices: Device[]) {
    this.allowedPeers = new Map(devices.map((device) => [device.id, device]));
    for (const id of this.peers.keys()) {
      if (!this.allowedPeers.has(id))
        this.closePeer(id, "Recipient left the room");
    }
  }
  recoverConnections() {
    for (const [id, peer] of this.peers) {
      if (["failed", "disconnected"].includes(peer.pc.connectionState))
        this.recoverPeer(id, peer);
    }
  }
  private getPeer(id: string): Peer {
    if (this.disposed || !this.allowedPeers.has(id))
      throw new Error("Recipient is not in your room");
    let peer = this.peers.get(id);
    if (peer && peer.pc.connectionState === "closed") {
      this.closePeer(id, "Connection closed");
      peer = undefined;
    }
    if (peer) return peer;
    const pc = this.options.peerFactory
      ? this.options.peerFactory(getIceConfiguration(), id)
      : new RTCPeerConnection(getIceConfiguration());
    peer = {
      pc,
      events: new EventTarget(),
      candidates: [],
      signaling: Promise.resolve(),
      makingOffer: false,
      ignoreOffer: false,
      settingAnswer: false,
      restartCount: 0,
    };
    this.peers.set(id, peer);
    const current = peer;
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.signal.connected && !this.disposed) {
        try {
          this.signal.send({
            type: "rtc-candidate",
            to: id,
            candidate: candidate.toJSON(),
          });
        } catch {
          /* Signaling recovery retries negotiation when the socket returns. */
        }
      }
    };
    pc.ondatachannel = ({ channel }) =>
      this.attachChannel(id, current, channel);
    pc.onnegotiationneeded = () => {
      void this.negotiate(id, current);
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== current) return;
      this.callbacks.onPeerStatus?.(id, pc.connectionState);
      this.changed(current.events);
      if (pc.connectionState === "connected") {
        clearTimeout(current.recoveryTimer);
        current.recoveryTimer = undefined;
        current.restartCount = 0;
      } else if (["disconnected", "failed"].includes(pc.connectionState))
        this.recoverPeer(id, current);
      else if (pc.connectionState === "closed")
        this.closePeer(id, "Peer connection closed");
    };
    return current;
  }
  private async negotiate(id: string, peer: Peer) {
    if (this.disposed || this.peers.get(id) !== peer || !this.signal.connected)
      return;
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      if (peer.pc.localDescription)
        this.signal.send({
          type:
            peer.pc.localDescription.type === "offer"
              ? "rtc-offer"
              : "rtc-answer",
          to: id,
          sdp: peer.pc.localDescription.sdp,
        });
    } catch {
      this.closePeer(id, "Could not negotiate this connection. Try again.");
    } finally {
      peer.makingOffer = false;
    }
  }
  private recoverPeer(id: string, peer: Peer) {
    if (peer.recoveryTimer || this.disposed) return;
    this.callbacks.onPeerStatus?.(id, "reconnecting");
    // A brief disconnected state is recoverable; don't tear down a healthy data channel immediately.
    peer.recoveryTimer = setTimeout(
      () => {
        peer.recoveryTimer = undefined;
        if (peer.pc.connectionState === "connected") return;
        if (this.signal.connected && peer.restartCount < 2) {
          peer.restartCount++;
          peer.pc.restartIce();
          this.recoverPeer(id, peer);
        } else
          this.closePeer(id, "Connection lost. Reconnect and retry this file.");
      },
      Math.min(10000, this.timeout()),
    );
  }
  private handleSignalingMessage = (message: SignalMessage) => {
    if (this.disposed) return;
    if (
      message.type === "error" &&
      message.to &&
      message.requestType?.startsWith("rtc-")
    ) {
      this.closePeer(message.to, message.message || "Recipient is unavailable");
      return;
    }
    const id = message.from;
    if (!id || !this.allowedPeers.has(id) || !message.type.startsWith("rtc-"))
      return;
    let peer: Peer;
    try {
      peer = this.getPeer(id);
    } catch {
      this.callbacks.onPeerStatus?.(id, "failed");
      return;
    }
    peer.signaling = peer.signaling
      .then(async () => {
        if (this.disposed || this.peers.get(id) !== peer) return;
        if (message.type === "rtc-connect") {
          if (this.signal.id < id && !peer.channel)
            this.attachChannel(
              id,
              peer,
              peer.pc.createDataChannel("blinksend-v2", { ordered: true }),
            );
          return;
        }
        if (message.type === "rtc-candidate" && message.candidate) {
          if (peer.ignoreOffer) return;
          if (!peer.pc.remoteDescription) {
            if (peer.candidates.length >= 256)
              throw new Error("Too many ICE candidates");
            peer.candidates.push(message.candidate);
          } else await this.addCandidate(peer, message.candidate);
          return;
        }
        if (!message.sdp || !["rtc-offer", "rtc-answer"].includes(message.type))
          return;
        const offer = message.type === "rtc-offer";
        const ready =
          !peer.makingOffer &&
          (peer.pc.signalingState === "stable" || peer.settingAnswer);
        peer.ignoreOffer = offer && !ready && this.signal.id < id;
        if (peer.ignoreOffer) {
          peer.candidates = [];
          return;
        }
        peer.settingAnswer = !offer;
        await peer.pc.setRemoteDescription({
          type: offer ? "offer" : "answer",
          sdp: message.sdp,
        });
        peer.settingAnswer = false;
        for (const candidate of peer.candidates.splice(0))
          await this.addCandidate(peer, candidate);
        if (offer) {
          await peer.pc.setLocalDescription();
          this.signal.send({
            type: "rtc-answer",
            to: id,
            sdp: peer.pc.localDescription!.sdp,
          });
        }
      })
      .catch(() =>
        this.closePeer(id, "Connection negotiation failed. Try again."),
      );
  };
  private async addCandidate(peer: Peer, candidate: RTCIceCandidateInit) {
    const fragment = candidate.usernameFragment;
    if (
      fragment &&
      !peer.pc.remoteDescription?.sdp
        .split(/\r?\n/)
        .includes("a=ice-ufrag:" + fragment)
    )
      return;
    await peer.pc.addIceCandidate(candidate);
  }
  private attachChannel(id: string, peer: Peer, channel: RTCDataChannel) {
    if (
      this.peers.get(id) !== peer ||
      this.disposed ||
      channel.label !== "blinksend-v2"
    ) {
      channel.close();
      return;
    }
    if (peer.channel && peer.channel !== channel) {
      channel.close();
      return;
    }
    peer.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => {
      this.changed(peer.events);
    };
    channel.onbufferedamountlow = () => {
      for (const transfer of this.outgoing.values())
        if (transfer.peerId === id) this.changed(transfer.events);
    };
    channel.onclose = () =>
      this.closePeer(id, "Connection closed. Retry this file.");
    channel.onerror = () =>
      this.closePeer(id, "Data connection failed. Retry this file.");
    channel.onmessage = (event) => {
      if (this.disposed) return;
      try {
        this.handleData(event.data, id, channel);
      } catch {
        this.closePeer(id, "Invalid transfer data received");
      }
    };
    if (channel.readyState === "open") this.changed(peer.events);
  }
  private sendControl(
    channel: RTCDataChannel | undefined,
    message: Record<string, unknown>,
  ) {
    if (channel?.readyState === "open") {
      try {
        channel.send(JSON.stringify(message));
      } catch {
        /* A close event or the bounded acknowledgment wait settles the transfer. */
      }
    }
  }
  private touchIncoming(transfer: Incoming, paused = false) {
    clearTimeout(transfer.timer);
    transfer.timer = setTimeout(
      () =>
        this.failIncoming(
          transfer,
          "Transfer stopped responding. Ask the sender to retry.",
        ),
      paused ? 30 * 60 * 1000 : this.timeout(),
    );
  }
  private progress(
    transfer: Outgoing | Incoming,
    status: FileTransfer["status"],
    bytes: number,
    force = false,
  ) {
    const now = Date.now();
    const rate = bytes / Math.max((now - transfer.started) / 1000, 0.1);
    transfer.transfer = {
      ...transfer.transfer,
      status,
      transferredBytes: bytes,
      progress: transfer.transfer.fileSize
        ? Math.min(100, Math.round((bytes / transfer.transfer.fileSize) * 100))
        : status === "completed"
          ? 100
          : 0,
      bytesPerSecond: rate,
      remainingSeconds: rate
        ? Math.ceil((transfer.transfer.fileSize - bytes) / rate)
        : undefined,
    };
    if (force || now - transfer.lastReport >= 150) {
      transfer.lastReport = now;
      this.callbacks.onTransferProgress(transfer.transfer);
    }
  }
  private dropIncoming(transfer: Incoming) {
    clearTimeout(transfer.timer);
    this.incoming.delete(transfer.transfer.id);
    this.receiveBytes -= transfer.transfer.fileSize;
    transfer.hash.destroy();
    transfer.chunks = [];
  }
  private failIncoming(transfer: Incoming, message: string, cancelled = false) {
    if (!this.incoming.has(transfer.transfer.id)) return;
    this.sendControl(transfer.channel, {
      type: cancelled ? "file-cancel" : "file-error",
      transferId: transfer.transfer.id,
      message,
    });
    this.dropIncoming(transfer);
    if (!this.disposed)
      this.callbacks.onTransferProgress({
        ...transfer.transfer,
        status: cancelled ? "cancelled" : "error",
        error: message,
      });
  }
  private handleData(raw: unknown, peerId: string, channel: RTCDataChannel) {
    if (raw instanceof ArrayBuffer) {
      const chunk = decodeChunk(raw);
      const transfer = this.incoming.get(chunk.id);
      if (!transfer || transfer.peerId !== peerId) return;
      const expected = Math.min(
        CHUNK_SIZE,
        transfer.transfer.fileSize - transfer.receivedBytes,
      );
      if (
        chunk.index !== transfer.nextIndex ||
        chunk.bytes.byteLength !== expected ||
        expected <= 0
      ) {
        this.failIncoming(transfer, "Invalid chunk order or length");
        return;
      }
      transfer.chunks.push(chunk.bytes);
      transfer.hash.update(chunk.bytes);
      transfer.nextIndex++;
      transfer.receivedBytes += chunk.bytes.byteLength;
      this.touchIncoming(transfer, transfer.paused);
      this.progress(
        transfer,
        transfer.paused ? "paused" : "receiving",
        transfer.receivedBytes,
      );
      if (
        transfer.nextIndex % 8 === 0 ||
        transfer.nextIndex === transfer.totalChunks
      )
        this.sendControl(channel, {
          type: "chunk-ack",
          transferId: chunk.id,
          receivedChunks: transfer.nextIndex,
        });
      return;
    }
    if (typeof raw !== "string" || raw.length > 8192)
      throw new Error("Invalid control message");
    const data: Record<string, unknown> = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.type !== "string" ||
      typeof data.transferId !== "string"
    )
      throw new Error("Invalid control message");
    const id = data.transferId;
    if (data.type === "file-info") {
      if (
        data.protocolVersion !== PROTOCOL_VERSION ||
        typeof data.fileName !== "string" ||
        !data.fileName.length ||
        typeof data.fileSize !== "number" ||
        !Number.isSafeInteger(data.fileSize) ||
        data.fileSize < 0 ||
        data.fileSize > MAX_RECEIVE_BYTES ||
        this.receiveBytes + data.fileSize > MAX_RECEIVE_BYTES ||
        data.chunkSize !== CHUNK_SIZE ||
        data.totalChunks !== Math.ceil(data.fileSize / CHUNK_SIZE) ||
        !/^[0-9a-f-]{36}$/i.test(id) ||
        this.incoming.has(id) ||
        this.incoming.size >= 32
      ) {
        this.sendControl(channel, {
          type: "file-error",
          transferId: id,
          message:
            data.protocolVersion !== PROTOCOL_VERSION
              ? "Refresh both clients to update BlinkSend"
              : "File exceeds the available 256 MB receive budget, or metadata is invalid",
        });
        return;
      }
      const transfer: Incoming = {
        transfer: {
          id,
          fileName: safeFileName(data.fileName),
          fileSize: data.fileSize,
          peerId,
          peerName: this.allowedPeers.get(peerId)?.name,
          direction: "receive",
          status: "receiving",
          progress: 0,
          transferredBytes: 0,
        },
        peerId,
        channel,
        chunks: [],
        hash: sha256.create(),
        totalChunks: data.totalChunks as number,
        nextIndex: 0,
        receivedBytes: 0,
        fileType:
          typeof data.fileType === "string" && data.fileType.length < 128
            ? data.fileType
            : "application/octet-stream",
        started: Date.now(),
        lastReport: 0,
        paused: false,
      };
      this.incoming.set(id, transfer);
      this.receiveBytes += data.fileSize;
      this.touchIncoming(transfer);
      this.progress(transfer, "receiving", 0, true);
      this.sendControl(channel, { type: "file-ready", transferId: id }); // Technical readiness only; no approval UI.
      return;
    }
    const outgoing = this.outgoing.get(id);
    if (outgoing?.peerId === peerId) {
      if (data.type === "file-ready") outgoing.metadataReady = true;
      else if (data.type === "chunk-ack") {
        if (
          !Number.isInteger(data.receivedChunks) ||
          (data.receivedChunks as number) < outgoing.acknowledgedChunks ||
          (data.receivedChunks as number) > outgoing.sentChunks
        ) {
          outgoing.controller.abort(
            new Error("Invalid receiver acknowledgment"),
          );
          return;
        }
        outgoing.acknowledgedChunks = data.receivedChunks as number;
        this.progress(
          outgoing,
          outgoing.paused ? "paused" : "transferring",
          Math.min(
            outgoing.file.size,
            outgoing.acknowledgedChunks * CHUNK_SIZE,
          ),
        );
      } else if (data.type === "file-complete") {
        if (
          data.sha256 !== outgoing.digest ||
          data.fileSize !== outgoing.file.size
        )
          outgoing.controller.abort(
            new Error("Receiver integrity confirmation did not match"),
          );
        else outgoing.completed = true;
      } else if (data.type === "file-error" || data.type === "file-cancel") {
        outgoing.controller.abort(
          data.type === "file-cancel"
            ? new TransferCancelledError(
                "Transfer cancelled by the other device",
              )
            : new Error(
                typeof data.message === "string"
                  ? data.message.slice(0, 300)
                  : "Receiver could not finish this file",
              ),
        );
      }
      this.changed(outgoing.events);
      return;
    }
    const incoming = this.incoming.get(id);
    if (!incoming || incoming.peerId !== peerId) return;
    if (data.type === "file-cancel" || data.type === "file-error") {
      this.dropIncoming(incoming);
      this.callbacks.onTransferProgress({
        ...incoming.transfer,
        status: data.type === "file-cancel" ? "cancelled" : "error",
        error:
          typeof data.message === "string"
            ? data.message.slice(0, 300)
            : "Sender stopped this transfer",
      });
    } else if (data.type === "file-pause" || data.type === "file-resume") {
      incoming.paused = data.type === "file-pause";
      this.touchIncoming(incoming, data.type === "file-pause");
      this.progress(
        incoming,
        data.type === "file-pause" ? "paused" : "receiving",
        incoming.receivedBytes,
        true,
      );
    } else if (data.type === "file-end") {
      if (
        incoming.receivedBytes !== incoming.transfer.fileSize ||
        incoming.nextIndex !== incoming.totalChunks ||
        typeof data.sha256 !== "string" ||
        bytesToHex(incoming.hash.digest()) !== data.sha256
      ) {
        this.failIncoming(
          incoming,
          "File integrity verification failed. Ask the sender to retry.",
        );
        return;
      }
      try {
        this.progress(incoming, "finalizing", incoming.receivedBytes, true);
        const blob = new Blob(incoming.chunks, { type: incoming.fileType });
        this.callbacks.onFileReceived(incoming.transfer.fileName, blob);
        this.progress(incoming, "completed", incoming.receivedBytes, true);
        this.sendControl(channel, {
          type: "file-complete",
          transferId: id,
          fileSize: blob.size,
          sha256: data.sha256,
        });
        this.dropIncoming(incoming);
      } catch {
        this.failIncoming(
          incoming,
          "Could not prepare the automatic download. Retry this file.",
        );
      }
    }
  }
  async sendFile(
    file: File,
    peerId: string,
    uiId = generateId(),
    signal?: AbortSignal,
  ) {
    if (file.size > MAX_RECEIVE_BYTES)
      throw new Error("Files up to 256 MB are supported in this release");
    const peer = this.getPeer(peerId);
    const controller = new AbortController();
    const transfer: Outgoing = {
      transfer: {
        id: uiId,
        fileName: file.name,
        fileSize: file.size,
        direction: "send",
        peerId,
        peerName: this.allowedPeers.get(peerId)?.name,
        status: "pending",
        progress: 0,
      },
      wireId: generateId(),
      file,
      peerId,
      controller,
      events: new EventTarget(),
      metadataReady: false,
      sentChunks: 0,
      acknowledgedChunks: 0,
      completed: false,
      paused: false,
      started: Date.now(),
      lastReport: 0,
    };
    this.outgoing.set(transfer.wireId, transfer);
    const abort = () =>
      controller.abort(signal?.reason || new TransferCancelledError());
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const hash = sha256.create();
    try {
      if (!peer.channel) {
        if (this.signal.id < peerId)
          this.attachChannel(
            peerId,
            peer,
            peer.pc.createDataChannel("blinksend-v2", { ordered: true }),
          );
        else this.signal.send({ type: "rtc-connect", to: peerId });
      }
      await waitForCondition(
        () => peer.channel?.readyState === "open",
        peer.events,
        controller.signal,
        Math.min(15000, this.timeout()),
        "Could not connect to this device. Check both connections and retry.",
      );
      transfer.channel = peer.channel!;
      this.sendControl(transfer.channel, {
        type: "file-info",
        protocolVersion: PROTOCOL_VERSION,
        transferId: transfer.wireId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(file.size / CHUNK_SIZE),
      });
      await waitForCondition(
        () => transfer.metadataReady,
        transfer.events,
        controller.signal,
        Math.min(10000, this.timeout()),
        "Receiver did not become ready. Refresh both clients and retry.",
      );
      this.progress(transfer, "transferring", 0, true);
      for (let index = 0; index < Math.ceil(file.size / CHUNK_SIZE); index++) {
        await waitForCondition(
          () => !transfer.paused,
          transfer.events,
          controller.signal,
          30 * 60 * 1000,
          "Paused transfer expired",
        );
        await waitForCondition(
          () =>
            transfer.channel!.bufferedAmount <= 1024 * 1024 &&
            index - transfer.acknowledgedChunks < 32,
          transfer.events,
          controller.signal,
          this.timeout(),
          "Transfer stalled. Check the connection and retry.",
          true,
        );
        const bytes = new Uint8Array(
          await file
            .slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
            .arrayBuffer(),
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        hash.update(bytes);
        transfer.sentChunks = index + 1;
        transfer.channel!.send(encodeChunk(transfer.wireId, index, bytes));
      }
      await waitForCondition(
        () => transfer.acknowledgedChunks === transfer.sentChunks,
        transfer.events,
        controller.signal,
        this.timeout(),
        "Receiver stopped acknowledging this file. Retry.",
        true,
      );
      transfer.digest = bytesToHex(hash.digest());
      this.progress(transfer, "finalizing", file.size, true);
      this.sendControl(transfer.channel, {
        type: "file-end",
        transferId: transfer.wireId,
        sha256: transfer.digest,
      });
      await waitForCondition(
        () => transfer.completed,
        transfer.events,
        controller.signal,
        this.timeout(),
        "Receiver did not confirm the completed file. Retry.",
      );
    } catch (error) {
      this.sendControl(transfer.channel, {
        type:
          error instanceof TransferCancelledError
            ? "file-cancel"
            : "file-error",
        transferId: transfer.wireId,
        message: error instanceof Error ? error.message : "Transfer failed",
      });
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.outgoing.delete(transfer.wireId);
      hash.destroy();
    }
  }
  pauseTransfer(uiId: string, paused: boolean) {
    const transfer = [...this.outgoing.values()].find(
      (entry) => entry.transfer.id === uiId,
    );
    if (!transfer || transfer.completed) return;
    transfer.paused = paused;
    this.sendControl(transfer.channel, {
      type: paused ? "file-pause" : "file-resume",
      transferId: transfer.wireId,
    });
    this.progress(
      transfer,
      paused ? "paused" : "transferring",
      Math.min(transfer.file.size, transfer.acknowledgedChunks * CHUNK_SIZE),
      true,
    );
    this.changed(transfer.events);
  }
  cancelTransfer(id: string) {
    const incoming = this.incoming.get(id);
    if (incoming) this.failIncoming(incoming, "Transfer cancelled", true);
    const outgoing = [...this.outgoing.values()].find(
      (entry) => entry.transfer.id === id,
    );
    outgoing?.controller.abort(new TransferCancelledError());
  }
  private closePeer(id: string, message: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    clearTimeout(peer.recoveryTimer);
    for (const transfer of this.outgoing.values())
      if (transfer.peerId === id) transfer.controller.abort(new Error(message));
    for (const transfer of this.incoming.values())
      if (transfer.peerId === id) this.failIncoming(transfer, message);
    if (peer.channel) {
      peer.channel.onclose = null;
      peer.channel.onerror = null;
      peer.channel.onmessage = null;
      peer.channel.onopen = null;
      peer.channel.onbufferedamountlow = null;
      peer.channel.close();
    }
    peer.pc.onconnectionstatechange = null;
    peer.pc.onicecandidate = null;
    peer.pc.ondatachannel = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();
    this.changed(peer.events);
    if (!this.disposed) this.callbacks.onPeerStatus?.(id, "failed");
  }
  cleanup() {
    this.disposed = true;
    this.unsubscribe();
    for (const transfer of this.outgoing.values())
      transfer.controller.abort(new TransferCancelledError("Room closed"));
    for (const id of this.peers.keys()) this.closePeer(id, "Room closed");
    for (const transfer of this.incoming.values()) this.dropIncoming(transfer);
    this.allowedPeers.clear();
  }
}
