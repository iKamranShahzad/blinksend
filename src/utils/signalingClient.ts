import type { ConnectionStatus, Device, SignalMessage } from "../types/types";

export interface SignalTransport {
  readonly id: string;
  readonly connected: boolean;
  send(message: SignalMessage): void;
  subscribe(listener: (message: SignalMessage) => void): () => void;
}

export function parseSignalMessage(raw: unknown): SignalMessage | null {
  try {
    if (typeof raw !== "string") return null;
    const data = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.type !== "string"
    )
      return null;
    if (data.type === "self-identity" && data.protocolVersion !== 2)
      return {
        type: "error",
        code: "upgrade-required",
        message: "Update the BlinkSend server and refresh this page",
      };
    if (
      data.type === "devices" &&
      (!Array.isArray(data.devices) ||
        !data.devices.every(
          (peer: Device) =>
            peer &&
            typeof peer.id === "string" &&
            typeof peer.name === "string" &&
            typeof peer.type === "string" &&
            typeof peer.online === "boolean",
        ))
    )
      return null;
    if (
      data.type === "self-identity" &&
      (typeof data.id !== "string" ||
        typeof data.name !== "string" ||
        typeof data.resumeToken !== "string" ||
        data.protocolVersion !== 2 ||
        !(
          data.roomId === null ||
          (typeof data.roomId === "string" && /^\d{5}$/.test(data.roomId))
        ))
    )
      return null;
    if (
      ["room-created", "room-joined"].includes(data.type) &&
      (typeof data.roomId !== "string" || !/^\d{5}$/.test(data.roomId))
    )
      return null;
    return data as SignalMessage;
  } catch {
    return null;
  }
}

export class SignalingClient implements SignalTransport {
  private socket: WebSocket | null = null;
  private listeners = new Set<(message: SignalMessage) => void>();
  private stopped = false;
  private attempts = 0;
  private resumeToken?: string;
  private desiredRoom: string | null = null;
  private leftRoom = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastMessage = 0;
  public connected = false;
  constructor(
    private url: string,
    readonly id: string,
    private deviceType: string,
    private onStatus: (status: ConnectionStatus, message?: string) => void,
    private options: {
      socketFactory?: (url: string) => WebSocket;
      retryMs?: number;
      heartbeatMs?: number;
      timeoutMs?: number;
      resumeToken?: string;
      onSession?: (resumeToken: string) => void;
    } = {},
  ) {
    this.resumeToken = options.resumeToken;
  }
  subscribe(listener: (message: SignalMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setRoom(roomId: string | null) {
    this.desiredRoom = roomId;
    this.leftRoom = roomId === null;
  }
  send(message: SignalMessage) {
    if (!this.connected || this.socket?.readyState !== 1)
      throw new Error("Waiting for the server connection. Try again shortly.");
    this.socket.send(JSON.stringify(message));
  }
  start() {
    this.stopped = false;
    if (typeof window !== "undefined")
      window.addEventListener("online", this.retryNow);
    this.connect();
  }
  retryNow = () => {
    if (this.stopped || this.connected || this.socket?.readyState === 0) return;
    clearTimeout(this.retryTimer);
    this.connect();
  };
  private connect() {
    if (this.stopped) return;
    this.onStatus(
      typeof navigator !== "undefined" && !navigator.onLine
        ? "offline"
        : this.attempts
          ? "reconnecting"
          : "connecting",
    );
    let socket: WebSocket;
    try {
      socket = (this.options.socketFactory || ((url) => new WebSocket(url)))(
        this.url,
      );
    } catch {
      this.onStatus(
        "error",
        "Invalid signaling address. Check the app configuration.",
      );
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(
      () => socket.close(),
      this.options.timeoutMs || 12000,
    );
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: "register",
          protocolVersion: 2,
          device: { id: this.id, type: this.deviceType },
          resumeToken: this.resumeToken,
        }),
      );
    socket.onmessage = (event) => {
      if (this.stopped || this.socket !== socket) return;
      const message = parseSignalMessage(event.data);
      if (!message) return;
      if (message.type === "error" && message.code === "upgrade-required") {
        socket.close(4001, message.message);
        return;
      }
      this.lastMessage = Date.now();
      if (message.type === "self-identity") {
        if (message.id !== this.id) {
          socket.close(4003, "Invalid identity");
          return;
        }
        this.resumeToken = message.resumeToken;
        this.options.onSession?.(message.resumeToken!);
        this.connected = true;
        this.attempts = 0;
        clearTimeout(this.connectTimer);
        this.onStatus("connected");
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
          if (
            Date.now() - this.lastMessage >
            (this.options.heartbeatMs || 15000) * 3
          )
            socket.close();
          else if (socket.readyState === 1)
            socket.send(JSON.stringify({ type: "ping" }));
        }, this.options.heartbeatMs || 15000);
        if (this.leftRoom && message.roomId) {
          this.send({ type: "leave-room" });
          message.roomId = null;
        } else if (this.desiredRoom && !message.roomId)
          this.send({ type: "join-room", roomId: this.desiredRoom });
      }
      for (const listener of this.listeners) listener(message);
    };
    socket.onerror = () => {}; // close handles retry; browsers provide no useful error details.
    socket.onclose = (event) => {
      if (this.stopped || this.socket !== socket) return;
      clearTimeout(this.connectTimer);
      clearInterval(this.heartbeat);
      this.connected = false;
      if ([1008, 4000, 4001, 4003].includes(event.code)) {
        this.onStatus(
          "error",
          event.reason || "Refresh BlinkSend to reconnect.",
        );
        return;
      }
      this.attempts++;
      this.onStatus(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "offline"
          : "reconnecting",
      );
      const delay = Math.min(
        (this.options.retryMs || 1000) * 2 ** Math.min(this.attempts - 1, 4),
        15000,
      );
      this.retryTimer = setTimeout(
        () => this.connect(),
        delay + Math.random() * delay * 0.2,
      );
    };
  }
  stop() {
    this.stopped = true;
    this.connected = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    clearInterval(this.heartbeat);
    if (typeof window !== "undefined")
      window.removeEventListener("online", this.retryNow);
    this.socket?.close();
    this.listeners.clear();
  }
}
