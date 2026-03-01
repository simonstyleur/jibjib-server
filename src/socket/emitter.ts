import type { Server } from "socket.io";

let io: Server | null = null;

/**
 * Store a reference to the Socket.IO server instance.
 * Called once during initialization from socket/index.ts.
 */
export function setIO(server: Server): void {
  io = server;
}

/**
 * Get the Socket.IO server instance.
 * Throws if called before initialization.
 */
export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.IO server not initialized. Call setIO() first.");
  }
  return io;
}

/**
 * Emit an event to all sockets in a pair room.
 */
export function emitToPair(pairId: string, event: string, data: unknown): void {
  getIO().to(`pair:${pairId}`).emit(event, data);
}

/**
 * Emit an event to all sockets belonging to a specific user.
 */
export function emitToUser(userId: string, event: string, data: unknown): void {
  getIO().to(`user:${userId}`).emit(event, data);
}

/**
 * Emit an event to all sockets in a pair room except the sender.
 */
export function emitToPairExcept(
  pairId: string,
  socketId: string,
  event: string,
  data: unknown,
): void {
  getIO().to(`pair:${pairId}`).except(socketId).emit(event, data);
}
