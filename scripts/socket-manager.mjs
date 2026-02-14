/**
 * SocketManager - Handles real-time communication between connected clients.
 *
 * Message types:
 *  - cursorMove: Broadcast cursor position
 *  - strokeStart: A user started drawing
 *  - strokeUpdate: New points added to an in-progress stroke
 *  - strokeEnd: A user finished a stroke
 *  - ping: A user pinged a location
 *  - clearDrawings: A user cleared their drawings
 */

export class SocketManager {
  /** @type {string} */
  #moduleId;

  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /**
   * @param {string} moduleId - The module identifier for socket namespacing.
   */
  constructor(moduleId) {
    this.#moduleId = moduleId;
    this.#registerSocketListener();
  }

  /**
   * Register the socket.io listener for this module's namespace.
   */
  #registerSocketListener() {
    game.socket.on(`module.${this.#moduleId}`, (payload) => {
      this.#handleMessage(payload);
    });
  }

  /**
   * Emit a message to all other connected clients.
   * @param {string} type - The message type.
   * @param {object} data - The message payload.
   */
  emit(type, data) {
    const payload = {
      type,
      userId: game.user.id,
      userName: game.user.name,
      userColor: game.user.color?.toString() ?? "#ffffff",
      data,
      timestamp: Date.now()
    };
    game.socket.emit(`module.${this.#moduleId}`, payload);
  }

  /**
   * Register a listener for a specific message type.
   * @param {string} type - The message type to listen for.
   * @param {Function} callback - The callback function.
   */
  on(type, callback) {
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, []);
    }
    this.#listeners.get(type).push(callback);
  }

  /**
   * Remove a listener for a specific message type.
   * @param {string} type - The message type.
   * @param {Function} callback - The callback to remove.
   */
  off(type, callback) {
    const callbacks = this.#listeners.get(type);
    if (!callbacks) return;
    const idx = callbacks.indexOf(callback);
    if (idx !== -1) callbacks.splice(idx, 1);
  }

  /**
   * Handle an incoming socket message and dispatch to listeners.
   * @param {object} payload - The received message payload.
   */
  #handleMessage(payload) {
    // Don't process our own messages
    if (payload.userId === game.user.id) return;

    const callbacks = this.#listeners.get(payload.type);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(payload);
      }
    }
  }
}
