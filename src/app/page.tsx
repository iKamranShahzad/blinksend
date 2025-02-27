"use client";
import React, { useState, useEffect } from "react";
import { Device, FileTransfer, FileTransferReceiver } from "../types/types";
import { detectDeviceType } from "../utils/deviceDetection";
import { DeviceList } from "../components/DeviceList";
import { FileUpload } from "../components/FileUpload";
import { TransferProgress } from "../components/TransferProgress";
import Image from "next/image";
import { RoomJoin } from "@/components/RoomJoin";
import { Sun, Moon } from "lucide-react";

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

const App: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [selfName, setSelfName] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [theme, setTheme] = useState("light");

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

  useEffect(() => {
    if (!ws) return;

    const incomingTransfers = new Map<string, FileTransferReceiver>();

    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "file-chunk") {
          const { transfer, chunk } = data;
          let receiver = incomingTransfers.get(transfer.id);

          if (!receiver) {
            receiver = {
              fileName: transfer.fileName,
              fileSize: transfer.fileSize,
              totalChunks: transfer.totalChunks,
              receivedChunks: new Map<number, Uint8Array>(),
              receivedCount: 0,
            };
            incomingTransfers.set(transfer.id, receiver);
          }

          // Store the chunk and update progress
          receiver.receivedChunks.set(
            transfer.currentChunk,
            new Uint8Array(chunk),
          );
          receiver.receivedCount++;

          // Throttle UI updates
          if (
            receiver.receivedCount % 5 === 0 ||
            receiver.receivedCount === receiver.totalChunks ||
            receiver.receivedCount === 1
          ) {
            const progress = Math.round(
              (receiver.receivedCount / receiver.totalChunks) * 100,
            );

            setTransfers((prev) => {
              const existingTransfer = prev.find((t) => t.id === transfer.id);
              if (existingTransfer) {
                return prev.map((t) =>
                  t.id === transfer.id
                    ? { ...t, progress, status: "receiving" }
                    : t,
                );
              } else {
                return [
                  ...prev,
                  {
                    id: transfer.id,
                    fileName: transfer.fileName,
                    fileSize: transfer.fileSize,
                    progress,
                    status: "receiving",
                  },
                ];
              }
            });
          }

          // If all chunks are received, assemble and save the file
          if (receiver.receivedCount === receiver.totalChunks) {
            assembleAndSaveFile(transfer.id, receiver);
            // Clean up
            incomingTransfers.delete(transfer.id);
          }
        }
      } catch (error) {
        console.error("Error processing incoming file chunk:", error);
      }
    };

    // Separate function to assemble file to help with memory management
    const assembleAndSaveFile = (
      transferId: string,
      receiver: FileTransferReceiver,
    ) => {
      try {
        const orderedChunks: Uint8Array[] = [];

        // Process chunks in order
        for (let i = 0; i < receiver.totalChunks; i++) {
          const chunkData = receiver.receivedChunks.get(i);
          if (chunkData) {
            orderedChunks.push(chunkData);
            // Clear the reference as we go to help GC
            receiver.receivedChunks.delete(i);
          } else {
            console.error(`Missing chunk ${i} for transfer ${transferId}`);
            return;
          }
        }

        // Create blob and download
        const fileBuffer = new Blob(orderedChunks);
        const url = URL.createObjectURL(fileBuffer);

        const a = document.createElement("a");
        a.href = url;
        a.download = receiver.fileName;
        a.click();

        // Clean up
        URL.revokeObjectURL(url);

        // Update transfer status
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress: 100, status: "completed" }
              : t,
          ),
        );
      } catch (error) {
        console.error("Error assembling file:", error);
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId ? { ...t, status: "error" } : t,
          ),
        );
      }
    };

    ws.addEventListener("message", onMessage);
    return () => {
      ws.removeEventListener("message", onMessage);
    };
  }, [ws]);

  useEffect(() => {
    const websocket = new WebSocket("wss://blinksend-backend.onrender.com");

    websocket.onopen = () => {
      console.log("Connected to server");
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

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "room-created":
          setRoomId(data.roomId);
          setRoomError(null);
          break;
        case "room-joined":
          setRoomId(data.roomId);
          setRoomError(null);
          break;
        case "room-error":
          setRoomError(data.message);
          break;
        case "self-identity":
          setSelfName(data.name);
          break;
        case "devices":
          setDevices(data.devices);
          break;
        case "transfer-progress":
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === data.transfer.id ? { ...t, ...data.transfer } : t,
            ),
          );
          break;
        case "file-received": {
          // Handle received file (pretty cheeky)
          const { fileName, fileData } = data;
          const blob = new Blob([new Uint8Array(fileData)]);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          break;
        }
      }
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, []);

  const WINDOW_SIZE = 5; // Number of chunks to send before waiting for acknowledgments (i guess 5 is good, idk)

  const handleFileSelect = (file: File) => {
    if (!selectedDevice || !ws) return;

    const transfer: FileTransfer = {
      id: generateUUID(),
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      status: "pending",
    };

    // Create smaller chunks for large files
    const adaptiveChunkSize =
      file.size > 100 * 1024 * 1024
        ? 512 * 1024 // 512KB for large files
        : CHUNK_SIZE; // Default 1MB for smaller files

    setTransfers((prev) => [...prev, transfer]);

    const totalChunks = Math.ceil(file.size / adaptiveChunkSize);
    let currentChunk = 0;
    const acknowledgedChunks = new Set<number>();

    // Use a smaller window size for large files to reduce memory pressure
    const adaptiveWindowSize = file.size > 50 * 1024 * 1024 ? 2 : WINDOW_SIZE;

    const sendChunks = () => {
      // Limit concurrent chunks based on file size
      while (
        currentChunk - acknowledgedChunks.size < adaptiveWindowSize &&
        currentChunk < totalChunks
      ) {
        sendChunk(currentChunk);
        currentChunk++;
      }
    };

    const sendChunk = async (chunkIndex: number) => {
      const start = chunkIndex * adaptiveChunkSize;
      const end = Math.min(start + adaptiveChunkSize, file.size);
      const chunk = file.slice(start, end);

      try {
        let buffer: ArrayBuffer | null = await chunk.arrayBuffer();
        let uint8Array: Uint8Array | null = new Uint8Array(buffer);

        // Send chunk with minimal metadata
        ws.send(
          JSON.stringify({
            type: "file-transfer",
            transfer: {
              id: transfer.id,
              fileName: transfer.fileName,
              fileSize: transfer.fileSize,
              currentChunk: chunkIndex,
              totalChunks,
            },
            targetDevice: selectedDevice.id,
            chunk: Array.from(uint8Array),
          }),
        );

        // Help garbage collection
        buffer = null;
        uint8Array = null;
      } catch (error) {
        console.error("Error sending chunk:", error);
      }
    };

    // Add delay between processing acknowledgments to reduce CPU load
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "chunk-received" && data.transferId === transfer.id) {
          acknowledgedChunks.add(data.chunkIndex);

          const progress = Math.round(
            (acknowledgedChunks.size / totalChunks) * 100,
          );

          // Throttle UI updates to reduce render load
          if (progress % 5 === 0 || progress === 100) {
            setTransfers((prev) =>
              prev.map((t) =>
                t.id === transfer.id
                  ? { ...t, progress, status: "transferring" }
                  : t,
              ),
            );
          }

          if (acknowledgedChunks.size === totalChunks) {
            setTransfers((prev) =>
              prev.map((t) =>
                t.id === transfer.id
                  ? { ...t, progress: 100, status: "completed" }
                  : t,
              ),
            );
            ws.removeEventListener("message", onMessage);
          } else {
            // Add small delay to prevent overwhelming the server
            setTimeout(sendChunks, 10);
          }
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    };

    ws.addEventListener("message", onMessage);
    sendChunks();
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
              <p className="mt-2 flex items-center text-sm font-semibold text-cyan-700">
                <svg
                  className="mr-1 h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17z"
                  ></path>
                </svg>
                Room ID: {roomId}
              </p>
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
          {roomError && (
            <div className="mt-4 w-full rounded-lg border border-red-200 bg-red-100 p-3 text-center text-red-600">
              {roomError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
