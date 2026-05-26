import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { config } from "../config";
import { verifyAccessToken } from "../utils/jwt";
import { findUserById } from "../db/queries/user.queries";
import { findActivePairByUserId } from "../db/queries/pair.queries";
import { WS_EVENTS } from "../constants/events";
import { logger } from "../utils/logger";
import { setIO } from "./emitter";
import { handleConnection } from "./connection.handler";
import { registerItemHandlers } from "./item.handler";
import { registerMessageHandlers } from "./message.handler";
import { registerPresenceHandlers } from "./presence.handler";

/**
 * Data attached to each authenticated socket.
 */
interface SocketData {
  userId: string;
  pairId: string;
  userName: string;
}

/**
 * The Socket.IO server instance. Exported for direct access if needed,
 * but prefer using the emitter helpers.
 */
export let io: Server;

/**
 * Initialize the Socket.IO server, attach it to the HTTP server,
 * configure Redis adapter, and register middleware + event handlers.
 */
export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // -------------------------------------------------------------------
  // Redis adapter for horizontal scaling
  // Create dedicated pub/sub ioredis clients for the adapter.
  // -------------------------------------------------------------------
  let pubErrorLogged = false;
  let subErrorLogged = false;

  const pubClient = new Redis(config.redis.url, {
    // null disables MaxRetriesPerRequestError so a Redis outage doesn't
    // crash the backend process. Pub/sub clients retry forever in background.
    // enableOfflineQueue must stay TRUE so Socket.IO adapter's initial
    // psubscribe queues until the connection is ready (instead of throwing).
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.min(times * 1000, 30000);
    },
    lazyConnect: true,
  });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) => {
    if (!pubErrorLogged) {
      logger.warn({ err }, "Socket.IO Redis pub client error (further errors suppressed)");
      pubErrorLogged = true;
    }
  });

  subClient.on("error", (err) => {
    if (!subErrorLogged) {
      logger.warn({ err }, "Socket.IO Redis sub client error (further errors suppressed)");
      subErrorLogged = true;
    }
  });

  // Connect adapter Redis clients (non-blocking)
  pubClient.connect().catch(() => {});
  subClient.connect().catch(() => {});

  io.adapter(createAdapter(pubClient, subClient));

  // Store the io instance in the emitter module
  setIO(io);

  // -------------------------------------------------------------------
  // Authentication middleware
  // Extract JWT from auth.token (handshake) or query string, verify it,
  // look up user + pair, and attach data to socket.
  // -------------------------------------------------------------------
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth as { token?: string }).token ||
        (socket.handshake.query.token as string | undefined);

      if (!token) {
        return next(new Error("Authentication error: token required"));
      }

      // Verify the JWT
      const payload = verifyAccessToken(token);

      // Look up user in the database
      const user = await findUserById(payload.userId);
      if (!user) {
        return next(new Error("Authentication error: user not found"));
      }

      // Look up the user's active pair
      const pair = await findActivePairByUserId(payload.userId);
      if (!pair) {
        return next(new Error("Authentication error: user is not paired"));
      }

      // Attach user data to the socket for use by handlers
      (socket.data as SocketData).userId = user.id;
      (socket.data as SocketData).pairId = pair.id;
      (socket.data as SocketData).userName = user.name;

      next();
    } catch (err) {
      logger.warn({ err }, "WebSocket authentication failed");
      next(new Error("Authentication error: invalid token"));
    }
  });

  // -------------------------------------------------------------------
  // Connection handler
  // -------------------------------------------------------------------
  io.on("connection", async (socket) => {
    const typedSocket = socket as typeof socket & { data: SocketData };
    const { userId, pairId } = typedSocket.data;

    // Join the user to their pair room and personal room
    await socket.join(`pair:${pairId}`);
    await socket.join(`user:${userId}`);

    // Send a connected acknowledgement to the client
    socket.emit(WS_EVENTS.CONNECTED, {
      user_id: userId,
      pair_id: pairId,
    });

    // Handle connection lifecycle (online/offline presence)
    await handleConnection(typedSocket);

    // Register domain-specific event handlers
    registerItemHandlers(typedSocket);
    registerMessageHandlers(typedSocket);
    registerPresenceHandlers(typedSocket);

    logger.info(
      { userId, pairId, socketId: socket.id },
      "Socket handlers registered",
    );
  });

  logger.info("Socket.IO server initialized with Redis adapter");

  return io;
}
