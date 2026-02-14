const MODULE_ID = "map-collab-tool";

export class SocketManager {
  #listeners = new Map();
  #socketName = `module.${MODULE_ID}`;

  constructor() {
    game.socket.on(this.#socketName, (data) => {
      const { type, payload, userId } = data;
      if (userId === game.user.id) return;
      const callbacks = this.#listeners.get(type);
      if (!callbacks) return;
      for (const cb of callbacks) {
        cb(payload, userId);
      }
    });
  }

  emit(type, payload) {
    game.socket.emit(this.#socketName, {
      type,
      payload,
      userId: game.user.id
    });
  }

  on(type, callback) {
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, []);
    }
    this.#listeners.get(type).push(callback);
  }

  off(type, callback) {
    const callbacks = this.#listeners.get(type);
    if (!callbacks) return;
    const idx = callbacks.indexOf(callback);
    if (idx !== -1) callbacks.splice(idx, 1);
  }
}
