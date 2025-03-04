"use client";
import React, { useState, useEffect, useRef } from "react";
import { Device, FileTransfer } from "../types/types";
import { detectDeviceType } from "../utils/deviceDetection";
import { DeviceList } from "../components/DeviceList";
import { FileUpload } from "../components/FileUpload";
import { TransferProgress } from "../components/TransferProgress";
import Image from "next/image";
import { RoomJoin } from "@/components/RoomJoin";
import { Sun, Moon, LogOut, Hash } from "lucide-react";
import { toast } from "sonner";
import { WebRTCHandler } from "@/utils/webRTCHandler";

const App: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [selfName, setSelfName] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [theme, setTheme] = useState("light");
  const webRTCHandlerRef = useRef<WebRTCHandler | null>(null);

  useEffect(() => {
    const storedTheme = localStorage.getItem("theme");
    if (storedTheme) {
      setTheme(storedTheme);
      document.documentElement.classList.add(storedTheme);
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";

    document.documentElement.classList.remove(theme);
    document.documentElement.classList.add(newTheme);
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  };

  const generateUUID = (): string => {
    if ("randomUUID" in crypto) {
      return crypto.randomUUID();
    } else {
      return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          parseInt(c, 10) ^
          (crypto.getRandomValues(new Uint8Array(1))[0] &
            (15 >> (parseInt(c, 10) / 4)))
        ).toString(16),
      );
    }
  };

  const handleCreateRoom = () => {
    if (ws) {
      ws.send(
        JSON.stringify({
          type: "create-room",
        }),
      );
    }
  };

  const handleJoinRoom = (id: string) => {
    if (ws) {
      ws.send(
        JSON.stringify({
          type: "join-room",
          roomId: id,
        }),
      );
    }
  };

  const handleLeaveRoom = () => {
    if (!ws || !roomId) return;

    ws.send(
      JSON.stringify({
        type: "leave-room",
        roomId: roomId,
      }),
    );

    setRoomId(null);
    setSelectedDevice(null);
    setDevices([]);
    setTransfers([]);
  };

  useEffect(() => {
    if (!ws) return;

    // WebRTC initialization dawgg
    webRTCHandlerRef.current = new WebRTCHandler(ws, {
      onTransferProgress: (transfer) => {
        setTransfers((prev) => {
          const existingTransfer = prev.find((t) => t.id === transfer.id);
          if (existingTransfer) {
            return prev.map((t) => (t.id === transfer.id ? transfer : t));
          } else {
            return [...prev, transfer];
          }
        });
      },
      onTransferComplete: (transfer) => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transfer.id
              ? { ...t, progress: 100, status: "completed" }
              : t,
          ),
        );
      },
      onTransferError: (transfer, error) => {
        console.error(`Transfer error for ${transfer.fileName}: ${error}`);
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transfer.id ? { ...t, status: "error" } : t,
          ),
        );
      },
      onFileReceived: (fileName, fileData) => {
        const url = URL.createObjectURL(fileData);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      },
    });

    return () => {
      if (webRTCHandlerRef.current) {
        webRTCHandlerRef.current.cleanup();
        webRTCHandlerRef.current = null;
      }
    };
  }, [ws]);

  useEffect(() => {
    const websocket = new WebSocket("wss://blinksend-backend.onrender.com");

    toast.loading("Connecting to BlinkSend server...", {
      id: "websocket-connection",
      duration: Infinity,
    });

    websocket.onopen = () => {
      console.log("Connected to server");
      toast.success("Connected to BlinkSend, happy file sharing!", {
        id: "websocket-connection",
        duration: 2000,
      });

      websocket.send(
        JSON.stringify({
          type: "register",
          device: {
            id: generateUUID(),
            name: navigator.platform,
            type: detectDeviceType(),
          },
        }),
      );
    };

    websocket.onclose = () => {
      toast.error("Disconnected from server", {
        id: "websocket-connection",
      });
    };

    websocket.onerror = () => {
      toast.error("Connection error", {
        id: "websocket-connection",
      });
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "room-created":
          setRoomId(data.roomId);
          toast.success(`You created room ${data.roomId}`);
          break;
        case "room-joined":
          setRoomId(data.roomId);
          toast.success(`You joined room ${data.roomId}`);
          break;
        case "room-error":
          toast.error(data.message);
          break;
        case "room-left":
          setRoomId(null);
          setSelectedDevice(null);
          setDevices([]);
          toast.success(`You left the room ${data.roomId}`);

          if (webRTCHandlerRef.current) {
            webRTCHandlerRef.current.cleanup();
          }
          break;
        case "self-identity":
          setSelfName(data.name);
          break;
        case "devices":
          setDevices(data.devices);
          break;
        case "device-joined":
          toast.info(`${data.deviceName} joined the room`, {
            icon: "👋",
          });
          break;
        case "device-left":
          toast.info(`${data.deviceName} left the room`, {
            icon: "👋",
          });
          break;
        // Other WebSocket message types, later baby
      }
    };

    setWs(websocket);

    return () => {
      websocket.close();
      toast.dismiss("websocket-connection");
    };
  }, []);

  const handleFileSelect = async (file: File) => {
    if (!selectedDevice || !webRTCHandlerRef.current) return;

    try {
      // Use WebRTC for file transfer, I hate my ISP
      await webRTCHandlerRef.current.sendFile(file, selectedDevice.id);
    } catch (error) {
      console.error("Failed to initiate file transfer:", error);

      // Add an error transfer to the list
      const errorTransfer: FileTransfer = {
        id: generateUUID(),
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        status: "error",
      };

      setTransfers((prev) => [...prev, errorTransfer]);
    }
  };

  return (
    <div>
      <button
        onClick={toggleTheme}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-gray-200 p-2 shadow-md dark:bg-zinc-600 sm:bottom-auto sm:right-4 sm:top-4"
      >
        {theme === "light" ? <Sun /> : <Moon />}
      </button>
      <div className="min-h-screen bg-gray-50 py-8 dark:bg-zinc-900">
        <div className="mx-auto max-w-4xl px-4">
          <header className="relative z-10 mb-8 flex flex-col items-center justify-center gap-1">
            <Image
              priority={true}
              width={512}
              height={512}
              className="mt-2 w-48"
              src={theme === "light" ? "/Logo.webp" : "/LogoDark.webp"}
              alt="BlinkSend Logo"
            />
            <p className="text-center text-gray-600 dark:text-neutral-300">
              Share files securely with devices on your browser
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">
              You&apos;re being discovered by the name{" "}
              <strong>{selfName}</strong>{" "}
              {selfName === null && (
                <span className="loader">
                  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                </span>
              )}
            </p>
            {roomId && (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 shadow-sm ring-1 ring-inset ring-blue-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-800">
                  <Hash size={14} className="mr-1.5" />
                  {roomId}
                </div>
                <button
                  onClick={handleLeaveRoom}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-50 text-rose-600 shadow-sm transition-colors hover:bg-rose-100 hover:text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50 dark:hover:text-rose-300"
                  title="Leave Room"
                >
                  <LogOut size={14} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </header>

          {!roomId ? (
            <RoomJoin
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
            />
          ) : (
            <>
              <section className="mb-8">
                <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-300">
                  Available Devices
                </h2>
                <DeviceList
                  devices={devices}
                  selectedDevice={selectedDevice}
                  onDeviceSelect={setSelectedDevice}
                  roomId={roomId}
                />
              </section>

              <section className="mb-8">
                <FileUpload
                  onFileSelect={handleFileSelect}
                  disabled={!selectedDevice}
                />
              </section>

              {transfers.length > 0 && (
                <section>
                  <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-300">
                    Transfers
                  </h2>
                  <div
                    className="max-h-72 space-y-2 lg:max-h-44"
                    style={{
                      scrollbarWidth: "none",
                      overflowY: "auto",
                    }}
                  >
                    {transfers.map((transfer) => (
                      <TransferProgress key={transfer.id} transfer={transfer} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
