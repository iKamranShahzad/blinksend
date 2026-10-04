import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseSignalMessage,
  SignalingClient,
} from "../src/utils/signalingClient";

class Socket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number; reason: string }) => void;
  onerror?: () => void;
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
}
afterEach(() => vi.useRealTimers());
describe("signaling recovery", () => {
  it("registers a refreshed page with its stored token and saves the server's replacement", () => {
    const socket = new Socket();
    const save = vi.fn();
    const client = new SignalingClient(
      "ws://local",
      "self",
      "Browser",
      () => {},
      {
        socketFactory: () => socket as unknown as WebSocket,
        resumeToken: "saved-token",
        onSession: save,
      },
    );
    client.start();
    socket.open();
    expect(socket.sent[0]).toMatchObject({
      device: { id: "self" },
      resumeToken: "saved-token",
    });
    socket.receive({
      type: "self-identity",
      id: "self",
      name: "Name",
      roomId: "12345",
      resumeToken: "replacement-token",
      protocolVersion: 2,
    });
    expect(save).toHaveBeenCalledWith("replacement-token");
    client.stop();
  });
  it("requires registration readiness and reuses only its own authenticated session", async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const client = new SignalingClient(
      "ws://local",
      "self",
      "Browser",
      () => {},
      {
        socketFactory: () => {
          const socket = new Socket();
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
        retryMs: 10,
      },
    );
    client.start();
    sockets[0].open();
    expect(() => client.send({ type: "create-room" })).toThrow();
    sockets[0].receive({
      type: "self-identity",
      id: "self",
      name: "Name",
      resumeToken: "token",
      roomId: null,
      protocolVersion: 2,
    });
    client.setRoom("12345");
    expect(client.connected).toBe(true);
    sockets[0].close(1006);
    expect(client.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(12);
    sockets[1].open();
    expect(sockets[1].sent[0]).toMatchObject({
      type: "register",
      device: { id: "self" },
      resumeToken: "token",
    });
    sockets[1].receive({
      type: "self-identity",
      id: "self",
      name: "Name",
      resumeToken: "token",
      roomId: null,
      protocolVersion: 2,
    });
    expect(sockets[1].sent.at(-1)).toEqual({
      type: "join-room",
      roomId: "12345",
    });
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors an offline leave on reconnect and stops retrying rejected sessions", async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const client = new SignalingClient(
      "ws://local",
      "self",
      "Browser",
      () => {},
      {
        socketFactory: () => {
          const socket = new Socket();
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
        retryMs: 10,
      },
    );
    client.start();
    sockets[0].open();
    client.setRoom(null);
    sockets[0].receive({
      type: "self-identity",
      id: "self",
      name: "Name",
      resumeToken: "token",
      roomId: "12345",
      protocolVersion: 2,
    });
    expect(sockets[0].sent.at(-1)?.type).toBe("leave-room");
    sockets[0].close(4003);
    await vi.advanceTimersByTimeAsync(20000);
    expect(sockets).toHaveLength(1);
    client.stop();
  });
  it("ignores malformed data rather than throwing inside a message listener", () => {
    expect(parseSignalMessage("{bad")).toBeNull();
    expect(
      parseSignalMessage('{"type":"devices","devices":[null]}'),
    ).toBeNull();
    expect(
      parseSignalMessage('{"type":"room-joined","roomId":"wrong"}'),
    ).toBeNull();
    expect(
      parseSignalMessage('{"type":"self-identity","name":"Legacy"}')?.code,
    ).toBe("upgrade-required");
  });
});
