"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Moon, Sun, Hash, LogOut, Copy, Link } from "lucide-react";
import { RoomJoin } from "../components/RoomJoin";
import { DeviceList } from "../components/DeviceList";
import { ConnectionIndicator } from "../components/ConnectionIndicator";
import { RoomInvitation, RoomQRShortcut } from "../components/RoomSharing";
import { FileUpload } from "../components/FileUpload";
import { TransferProgress } from "../components/TransferProgress";
import { TransferHistory } from "../components/TransferHistory";
import type { ConnectionStatus, Device, FileTransfer } from "../types/types";
import { WebRTCHandler } from "../utils/webRTCHandler";
import { SignalingClient } from "../utils/signalingClient";
import { TransferQueue } from "../utils/transferQueue";
import { acquireBrowserSession } from "../utils/browserSession";
import { detectDeviceType } from "../utils/deviceDetection";

interface Services {
  client: SignalingClient;
  handler: WebRTCHandler;
  queue: TransferQueue;
  leave: () => void;
}
const App: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [selfName, setSelfName] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [invitationUrl, setInvitationUrl] = useState("");
  const [theme, setTheme] = useState("light");
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [connectionError, setConnectionError] = useState("");
  const [roomReady, setRoomReady] = useState(false);
  const [roomPending, setRoomPending] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [peerStatuses, setPeerStatuses] = useState<Record<string, string>>({});
  const servicesRef = useRef<Services | null>(null);
  const roomRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const peersRef = useRef<Device[]>([]);
  const confirmedRef = useRef(false);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const selectedDevice = devices.find((device) => device.id === selectedId);
  const hasRoomContent = Boolean(
    roomId && (devices.length || transfers.length),
  );
  const hasOnlinePeers = devices.some((device) => device.online !== false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore a browser preference after hydration.
        setTheme(stored);
        document.documentElement.classList.toggle("dark", stored === "dark");
      }
    } catch {
      // Restricted storage should not prevent joining a room.
    }
  }, []);

  useEffect(() => {
    const sessionAbort = new AbortController();
    let disposeServices: (() => void) | undefined;
    void acquireBrowserSession({ signal: sessionAbort.signal }).then(
      (session) => {
        if (!session) return;
        if (sessionAbort.signal.aborted) {
          void session.release();
          return;
        }
        let handler: WebRTCHandler;
        const downloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
        const update = (transfer: FileTransfer) =>
          setTransfers((previous) => {
            const existing = previous.some((entry) => entry.id === transfer.id);
            return existing
              ? previous.map((entry) =>
                  entry.id === transfer.id ? { ...entry, ...transfer } : entry,
                )
              : [...previous, transfer];
          });
        const client = new SignalingClient(
          process.env.NEXT_PUBLIC_WEBSOCKET_URL || "",
          session.id,
          detectDeviceType(),
          (status, message) => {
            setConnection(status);
            setConnectionError(message || "");
            if (status !== "connected") {
              confirmedRef.current = false;
              setRoomReady(false);
            }
          },
          { resumeToken: session.resumeToken, onSession: session.save },
        );
        const queue = new TransferQueue(
          (job, signal) =>
            handler.sendFile(
              job.file,
              job.transfer.peerId!,
              job.transfer.id,
              signal,
            ),
          (peerId) =>
            client.connected &&
            confirmedRef.current &&
            peersRef.current.some(
              (peer) => peer.id === peerId && peer.online !== false,
            ),
          update,
        );
        const createHandler = () =>
          new WebRTCHandler(client, {
            onTransferProgress: (transfer) => queue.report(transfer),
            onPeerStatus: (id, status) =>
              setPeerStatuses((previous) => ({ ...previous, [id]: status })),
            onFileReceived: (fileName, data) => {
              const url = URL.createObjectURL(data);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = fileName;
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              downloadTimers.set(
                url,
                setTimeout(() => {
                  URL.revokeObjectURL(url);
                  downloadTimers.delete(url);
                }, 60000),
              );
            },
          });
        handler = createHandler();
        const services: Services = {
          client,
          queue,
          handler,
          leave: () => {
            applyRoom(null);
            if (client.connected) client.send({ type: "leave-room" });
            setRoomError("");
          },
        };
        servicesRef.current = services;
        const applyRoom = (next: string | null) => {
          if (next !== roomRef.current) {
            queue.clear();
            handler.cleanup();
            handler = createHandler();
            services.handler = handler;
            peersRef.current = [];
            selectedRef.current = null;
            setDevices([]);
            setSelectedId(null);
            setTransfers([]);
            setPeerStatuses({});
          }
          roomRef.current = next;
          client.setRoom(next);
          confirmedRef.current = true;
          setRoomReady(true);
          setRoomId(next);
          if (next) {
            const url = new URL(window.location.href);
            url.searchParams.set("room", next);
            url.hash = "";
            setInvitationUrl(url.toString());
          } else setInvitationUrl("");
        };
        const finishRequest = () => {
          clearTimeout(requestTimer.current);
          setRoomPending(false);
        };
        let invitationUsed = false;
        const unsubscribe = client.subscribe((message) => {
          switch (message.type) {
            case "self-identity":
              setSelfName(message.name!);
              if (message.roomId) applyRoom(message.roomId);
              else if (!roomRef.current) {
                confirmedRef.current = true;
                setRoomReady(true);
              }
              if (!invitationUsed) {
                invitationUsed = true;
                const invitation = new URL(
                  window.location.href,
                ).searchParams.get("room");
                if (
                  invitation &&
                  /^\d{5}$/.test(invitation) &&
                  invitation !== roomRef.current
                ) {
                  client.send({ type: "join-room", roomId: invitation });
                  setRoomPending(true);
                  requestTimer.current = setTimeout(() => {
                    setRoomPending(false);
                    setRoomError("Could not join the invitation. Try again.");
                    if (roomRef.current)
                      toast.error("Could not join the invitation. Try again.");
                  }, 10000);
                }
              }
              queue.wake();
              handler.recoverConnections();
              break;
            case "room-created":
            case "room-joined":
              applyRoom(message.roomId!);
              finishRequest();
              setRoomError("");
              toast.success(
                message.type === "room-created"
                  ? "Room " + message.roomId + " created"
                  : "Joined room " + message.roomId,
              );
              break;
            case "room-left":
              applyRoom(null);
              break;
            case "devices": {
              if (!roomRef.current) break;
              const peers = message.devices!;
              peersRef.current = peers;
              handler.setPeers(peers);
              setDevices(peers);
              if (
                selectedRef.current &&
                !peers.some((peer) => peer.id === selectedRef.current)
              ) {
                selectedRef.current = null;
                setSelectedId(null);
                toast.info("The selected device left the room");
              }
              queue.invalidatePeers(peers);
              break;
            }
            case "error":
              if (
                message.requestType === "create-room" ||
                message.requestType === "join-room"
              ) {
                finishRequest();
                setRoomError(message.message || "Could not enter this room");
                if (roomRef.current && confirmedRef.current)
                  toast.error(message.message || "Could not enter this room");
                if (
                  message.code === "room-not-found" &&
                  roomRef.current &&
                  !confirmedRef.current
                ) {
                  applyRoom(null);
                  toast.info(
                    "Your previous room expired. Create or join a room.",
                  );
                }
              }
              break;
          }
        });
        client.start();
        disposeServices = () => {
          clearTimeout(requestTimer.current);
          unsubscribe();
          queue.dispose();
          handler.cleanup();
          client.stop();
          for (const [url, timer] of downloadTimers) {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
          }
          servicesRef.current = null;
          void session.release();
        };
      },
    );
    return () => {
      sessionAbort.abort();
      disposeServices?.();
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Theme switching still works for this page without persistence.
    }
  };
  const requestRoom = (type: "create-room" | "join-room", code?: string) => {
    try {
      servicesRef.current?.client.send({ type, roomId: code });
      setRoomPending(true);
      setRoomError("");
      clearTimeout(requestTimer.current);
      requestTimer.current = setTimeout(() => {
        setRoomPending(false);
        setRoomError("The server did not respond. Try again.");
      }, 10000);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Not connected");
    }
  };
  const leaveRoom = () => {
    servicesRef.current?.leave();
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  };
  const copyRoom = async (invitation = false) => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(invitation ? invitationUrl : roomId);
      toast.success(invitation ? "Invitation link copied" : "Room code copied");
    } catch {
      toast.error(
        "Could not copy. You can select and copy the room code above.",
      );
    }
  };
  const selectDevice = (device: Device) => {
    selectedRef.current = device.id;
    setSelectedId(device.id);
  };
  const handleFileSelect = (files: File[]) => {
    if (
      !selectedDevice ||
      !servicesRef.current ||
      !roomReady ||
      !servicesRef.current.client.connected
    )
      return;
    servicesRef.current.queue.enqueue(files, selectedDevice);
  };
  const cancelTransfer = (transfer: FileTransfer) => {
    if (transfer.direction === "send")
      servicesRef.current?.queue.cancel(transfer.id);
    else servicesRef.current?.handler.cancelTransfer(transfer.id);
  };
  const removeTransfer = (id: string) => {
    servicesRef.current?.queue.remove(id);
    setTransfers((previous) => previous.filter((entry) => entry.id !== id));
  };
  return (
    <div className="flex min-h-dvh flex-col bg-gray-50 pt-8 dark:bg-zinc-900">
      <ConnectionIndicator
        status={connection}
        restoring={Boolean(roomId && !roomReady)}
        error={connectionError}
        onRetry={() => servicesRef.current?.client.retryNow()}
      />
      <button
        onClick={toggleTheme}
        aria-label={
          theme === "light" ? "Switch to dark theme" : "Switch to light theme"
        }
        className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-50 flex size-11 items-center justify-center rounded-full bg-gray-200 shadow-md dark:bg-zinc-600"
      >
        {theme === "light" ? (
          <Sun aria-hidden="true" />
        ) : (
          <Moon aria-hidden="true" />
        )}
      </button>
      <div
        className={`mx-auto w-full max-w-4xl px-4 pb-12 ${hasRoomContent ? "room-content" : ""}`}
      >
        <header className="relative z-10 mb-8 flex flex-col items-center justify-center gap-1">
          <Image
            priority
            width={512}
            height={512}
            className="mt-2 w-48"
            src={theme === "light" ? "/Logo.webp" : "/LogoDark.webp"}
            alt="BlinkSend Logo"
          />
          <p className="text-center text-gray-600 dark:text-neutral-300">
            Share files securely with devices on your browser
          </p>
          <p
            aria-live="polite"
            className="mt-1 text-center text-sm text-gray-500 dark:text-neutral-400"
          >
            You&apos;re being discovered by the name{" "}
            {selfName ? (
              <strong>{selfName}</strong>
            ) : (
              <span
                className="loader inline-block h-3! w-10 align-middle"
                aria-label="Loading your device name"
              >
                <span className="sr-only">Loading your device name</span>
              </span>
            )}
          </p>
          {roomId && devices.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => void copyRoom()}
                title="Copy room code"
                aria-label={"Copy room code " + roomId}
                className="flex min-h-11 items-center gap-2 rounded-full bg-blue-50 px-4 text-sm font-medium text-blue-700 ring-1 ring-blue-200 ring-inset dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-800"
              >
                <Hash size={14} aria-hidden="true" />
                {roomId}
                <Copy size={14} aria-hidden="true" />
              </button>
              <button
                onClick={() => void copyRoom(true)}
                className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-blue-700 hover:bg-blue-50 dark:text-indigo-200 dark:hover:bg-neutral-800"
              >
                <Link size={16} aria-hidden="true" />
                Invite link
              </button>
              <button
                onClick={leaveRoom}
                aria-label="Leave Room"
                title="Leave Room"
                className="flex size-11 items-center justify-center rounded-full bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-300"
              >
                <LogOut size={18} aria-hidden="true" />
              </button>
            </div>
          )}
        </header>
        {!roomId ? (
          <RoomJoin
            onCreateRoom={() => requestRoom("create-room")}
            onJoinRoom={(id) => requestRoom("join-room", id)}
            disabled={connection !== "connected" || roomPending}
            pending={roomPending}
            error={roomError}
          />
        ) : (
          <div>
            <section className="mb-8">
              <div className="mb-4 flex min-h-8 items-center justify-between gap-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-300">
                  Available Devices
                </h2>
                {devices.length === 0 && (
                  <button
                    onClick={leaveRoom}
                    aria-label="Leave Room"
                    title="Leave Room"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-300"
                  >
                    <LogOut size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
              {devices.length === 0 ? (
                <RoomInvitation
                  roomId={roomId}
                  invitationUrl={invitationUrl}
                  onCopyCode={() => void copyRoom()}
                  onCopyLink={() => void copyRoom(true)}
                />
              ) : (
                <div className="max-h-48 overflow-y-auto pr-1">
                  <DeviceList
                    devices={devices}
                    selectedDevice={selectedDevice || null}
                    onDeviceSelect={selectDevice}
                    peerStatuses={peerStatuses}
                  />
                </div>
              )}
            </section>
            {hasOnlinePeers && (
              <section className="mb-8">
                <FileUpload
                  onFileSelect={handleFileSelect}
                  disabled={
                    !selectedDevice ||
                    selectedDevice.online === false ||
                    connection !== "connected" ||
                    !roomReady ||
                    roomPending
                  }
                  disabledLabel={
                    connection !== "connected" || !roomReady
                      ? "Waiting for connection…"
                      : selectedDevice?.online === false
                        ? "Recipient is reconnecting…"
                        : "Select a device first"
                  }
                />
              </section>
            )}
            {hasRoomContent && (
              <div className="transfer-history-slot flex min-h-0">
                {transfers.length > 0 && (
                  <TransferHistory
                    transfers={transfers}
                    renderTransfer={(transfer, view) => (
                      <TransferProgress
                        key={transfer.id}
                        transfer={transfer}
                        view={view}
                        onRemove={removeTransfer}
                        onCancel={() => cancelTransfer(transfer)}
                        onRetry={() =>
                          servicesRef.current?.queue.retry(transfer.id)
                        }
                        retryDisabled={
                          connection !== "connected" ||
                          !devices.some(
                            (peer) =>
                              peer.id === transfer.peerId &&
                              peer.online !== false,
                          )
                        }
                        onPause={(paused) =>
                          servicesRef.current?.handler.pauseTransfer(
                            transfer.id,
                            paused,
                          )
                        }
                      />
                    )}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {roomId && devices.length > 0 && (
        <RoomQRShortcut roomId={roomId} invitationUrl={invitationUrl} />
      )}
    </div>
  );
};
export default App;
