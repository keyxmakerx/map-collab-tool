import { PinConfigDialog } from "./pin-config.mjs";
import { DEFAULT_PIN_TYPES } from "./module.mjs";

const MODULE_ID = "map-collab-tool";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class MapPageSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.journal.JournalEntryPageSheet) {

  static DEFAULT_OPTIONS = {
    classes: ["mct-map-sheet"]
  };

  static PARTS = {
    map: {
      template: `modules/${MODULE_ID}/templates/map-page.hbs`
    }
  };

  #zoom = 1;
  #panX = 0;
  #panY = 0;
  #isPanning = false;
  #panStartX = 0;
  #panStartY = 0;
  #dragPin = null;
  #dragPinEl = null;
  #dragPinStartX = 0;
  #dragPinStartY = 0;
  #dragStartX = 0;
  #dragStartY = 0;
  #socketManager = null;
  #boundSocketHandlers = {};

  get title() {
    return this.document.name || game.i18n.localize("MCT.MapPage.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const mapImage = this.document.getFlag(MODULE_ID, "mapImage") || "";
    const allPins = this.document.getFlag(MODULE_ID, "pins") || [];
    const currentUserId = game.user.id;

    // Filter pins: show shared pins + own private pins
    const visiblePins = allPins.filter(pin => {
      if (pin.shared !== false) return true;
      return pin.createdBy === currentUserId;
    });

    const pinTypesMap = this.#getPinTypesMap();
    const pins = visiblePins.map(pin => {
      const pt = pinTypesMap.get(pin.type) || pinTypesMap.get("note");
      return {
        ...pin,
        icon: pt?.icon || "fa-map-pin",
        color: pt?.color || "#6b7280",
        isPrivate: pin.shared === false
      };
    });

    const defaultPinType = game.settings.get(MODULE_ID, "defaultPinType") || "note";
    const pinTypes = this.#getPinTypes().map(pt => ({
      ...pt,
      selected: pt.id === defaultPinType
    }));

    return {
      ...context,
      mapImage,
      pins,
      pinTypes,
      zoom: this.#zoom,
      panX: this.#panX,
      panY: this.#panY,
      isGM: game.user.isGM
    };
  }

  #getPinTypes() {
    const custom = this.document.getFlag(MODULE_ID, "pinTypes") || [];
    return [...DEFAULT_PIN_TYPES, ...custom];
  }

  #getPinTypesMap() {
    const types = this.#getPinTypes();
    return new Map(types.map(t => [t.id, t]));
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const viewport = this.element.querySelector(".mct-viewport");
    const mapLayer = this.element.querySelector(".mct-map-layer");
    if (!viewport || !mapLayer) return;

    // Zoom with mouse wheel
    viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.#zoom = Math.max(0.2, Math.min(5, this.#zoom + delta));
      this.#applyTransform(mapLayer);
    }, { passive: false });

    // Unified pointer handling: left-click drag = pan, left-click (no drag) on image = place pin
    const DRAG_THRESHOLD = 5; // px — movement beyond this counts as a drag, not a click
    let pointerDownTarget = null;

    viewport.addEventListener("pointerdown", (e) => {
      if (e.button === 0 || e.button === 1) {
        // Don't start a pan if we're dragging a pin
        if (this.#dragPin) return;

        // Don't intercept clicks on interactive elements (buttons, selects, etc.)
        if (e.target.closest("button, a, select, input")) return;

        e.preventDefault();
        this.#isPanning = true;
        this.#panStartX = e.clientX - this.#panX;
        this.#panStartY = e.clientY - this.#panY;
        this.#dragStartX = e.clientX;
        this.#dragStartY = e.clientY;
        pointerDownTarget = e.target;
        viewport.setPointerCapture(e.pointerId);
      }
    });

    viewport.addEventListener("pointermove", (e) => {
      if (this.#isPanning) {
        this.#panX = e.clientX - this.#panStartX;
        this.#panY = e.clientY - this.#panStartY;
        this.#applyTransform(mapLayer);
      }

      // Handle pin dragging — use pins-layer rect (the element pin % resolves against)
      if (this.#dragPin && this.#dragPinEl) {
        const rect = mapLayer.querySelector(".mct-pins-layer")?.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) return;
        const dx = ((e.clientX - this.#dragStartX) / rect.width) * 100;
        const dy = ((e.clientY - this.#dragStartY) / rect.height) * 100;
        const x = Math.max(0, Math.min(100, this.#dragPinStartX + dx));
        const y = Math.max(0, Math.min(100, this.#dragPinStartY + dy));
        this.#dragPinEl.style.left = `${x}%`;
        this.#dragPinEl.style.top = `${y}%`;
      }
    });

    viewport.addEventListener("pointerup", async (e) => {
      // Finish pin drag
      if (this.#dragPin) {
        const rect = mapLayer.querySelector(".mct-pins-layer")?.getBoundingClientRect();
        if (rect && rect.width && rect.height) {
          const dx = ((e.clientX - this.#dragStartX) / rect.width) * 100;
          const dy = ((e.clientY - this.#dragStartY) / rect.height) * 100;
          const x = Math.max(0, Math.min(100, this.#dragPinStartX + dx));
          const y = Math.max(0, Math.min(100, this.#dragPinStartY + dy));
          await this.#movePin(this.#dragPin, x, y);
        }
        viewport.releasePointerCapture(e.pointerId);
        this.#dragPinEl?.classList.remove("mct-pin-dragging");
        this.#dragPin = null;
        this.#dragPinEl = null;
        return;
      }

      if (this.#isPanning) {
        this.#isPanning = false;
        viewport.releasePointerCapture(e.pointerId);

        // Check if this was a click (not a drag) on the map image
        const dx = Math.abs(e.clientX - this.#dragStartX);
        const dy = Math.abs(e.clientY - this.#dragStartY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD && e.button === 0) {
          // It was a click, not a drag — place a pin if on the image
          const mapImage = mapLayer.querySelector(".mct-map-image");
          if (mapImage && (pointerDownTarget === mapImage || mapImage.contains(pointerDownTarget))) {
            if (game.user.isGM || game.settings.get(MODULE_ID, "enableForPlayers")) {
              const pinsLayer = mapLayer.querySelector(".mct-pins-layer");
              const rect = pinsLayer?.getBoundingClientRect() || mapImage.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              const y = ((e.clientY - rect.top) / rect.height) * 100;
              await this.#addPin(x, y);
            }
          }
        }
        pointerDownTarget = null;
        return;
      }
    });

    // Pin interactions (drag + right-click)
    this.#setupPinListeners(mapLayer, viewport);

    // Toolbar buttons
    this.element.querySelector(".mct-zoom-in")?.addEventListener("click", () => {
      this.#zoom = Math.min(5, this.#zoom + 0.2);
      this.#applyTransform(mapLayer);
    });
    this.element.querySelector(".mct-zoom-out")?.addEventListener("click", () => {
      this.#zoom = Math.max(0.2, this.#zoom - 0.2);
      this.#applyTransform(mapLayer);
    });
    this.element.querySelector(".mct-zoom-reset")?.addEventListener("click", () => {
      this.#zoom = 1;
      this.#panX = 0;
      this.#panY = 0;
      this.#applyTransform(mapLayer);
    });

    // Set image buttons (toolbar + empty state)
    this.element.querySelectorAll(".mct-set-image").forEach(btn => {
      btn.addEventListener("click", () => this.#pickImage());
    });

    // Set up socket listeners
    this.#setupSocket();
  }

  _onClose(options) {
    this.#teardownSocket();
    super._onClose(options);
  }

  _onCloseView() {
    this.#teardownSocket();
  }

  #applyTransform(mapLayer) {
    mapLayer.style.transform = `translate(${this.#panX}px, ${this.#panY}px) scale(${this.#zoom})`;
  }

  #setupPinListeners(mapLayer, viewport) {
    const pins = mapLayer.querySelectorAll(".mct-pin");
    for (const pinEl of pins) {
      const pinId = pinEl.dataset.pinId;

      // Drag to move
      pinEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();

        // Check permission
        const pin = this.#getPinById(pinId);
        if (!pin) return;
        if (!this.#canEditPin(pin)) return;

        this.#dragPin = pinId;
        this.#dragPinEl = pinEl;
        this.#dragPinStartX = pin.x;
        this.#dragPinStartY = pin.y;
        this.#dragStartX = e.clientX;
        this.#dragStartY = e.clientY;
        pinEl.classList.add("mct-pin-dragging");
        viewport.setPointerCapture(e.pointerId);
      });

      // Right-click to edit
      pinEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pin = this.#getPinById(pinId);
        if (!pin) return;
        if (!this.#canEditPin(pin)) return;
        this.#openPinConfig(pin);
      });
    }
  }

  #canEditPin(pin) {
    if (game.user.isGM) return true;
    if (!game.settings.get(MODULE_ID, "enableForPlayers")) return false;
    return pin.createdBy === game.user.id;
  }

  #getPinById(pinId) {
    const pins = this.document.getFlag(MODULE_ID, "pins") || [];
    return pins.find(p => p.id === pinId);
  }

  async #addPin(x, y) {
    const select = this.element.querySelector(".mct-pin-type-select");
    const pinTypeId = select?.value || game.settings.get(MODULE_ID, "defaultPinType") || "note";

    const pin = {
      id: foundry.utils.randomID(),
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      label: "",
      type: pinTypeId,
      shared: true,
      createdBy: game.user.id
    };

    try {
      const pins = [...(this.document.getFlag(MODULE_ID, "pins") || []), pin];
      await this.document.setFlag(MODULE_ID, "pins", pins);
      this.#getSocket()?.emit("pinAdded", { pageId: this.document.id, pin });
      this.#openPinConfig(pin);
    } catch (err) {
      ui.notifications.error("Failed to add pin.");
      console.error("MCT | addPin error:", err);
    }
  }

  async #movePin(pinId, x, y) {
    try {
      const rx = Math.round(x * 100) / 100;
      const ry = Math.round(y * 100) / 100;
      const pins = (this.document.getFlag(MODULE_ID, "pins") || []).map(p => {
        if (p.id !== pinId) return p;
        return { ...p, x: rx, y: ry };
      });
      await this.document.setFlag(MODULE_ID, "pins", pins);
      this.#getSocket()?.emit("pinMoved", { pageId: this.document.id, pinId, x: rx, y: ry });
    } catch (err) {
      ui.notifications.error("Failed to move pin.");
      console.error("MCT | movePin error:", err);
    }
  }

  async #updatePin(updatedPin) {
    try {
      const pins = (this.document.getFlag(MODULE_ID, "pins") || []).map(p => {
        if (p.id !== updatedPin.id) return p;
        return updatedPin;
      });
      await this.document.setFlag(MODULE_ID, "pins", pins);
      this.#getSocket()?.emit("pinUpdated", { pageId: this.document.id, pin: updatedPin });
    } catch (err) {
      ui.notifications.error("Failed to update pin.");
      console.error("MCT | updatePin error:", err);
    }
  }

  async #deletePin(pinId) {
    try {
      const pins = (this.document.getFlag(MODULE_ID, "pins") || []).filter(p => p.id !== pinId);
      await this.document.setFlag(MODULE_ID, "pins", pins);
      this.#getSocket()?.emit("pinDeleted", { pageId: this.document.id, pinId });
    } catch (err) {
      ui.notifications.error("Failed to delete pin.");
      console.error("MCT | deletePin error:", err);
    }
  }

  #openPinConfig(pin) {
    new PinConfigDialog(pin, this.document.id, {
      onSave: (updated) => this.#updatePin(updated),
      onDelete: (id) => this.#deletePin(id)
    }).render(true);
  }

  async #pickImage() {
    const fp = new FilePicker({
      type: "image",
      current: this.document.getFlag(MODULE_ID, "mapImage") || "",
      callback: async (path) => {
        await this.document.setFlag(MODULE_ID, "mapImage", path);
      }
    });
    fp.render(true);
  }

  #getSocket() {
    return game.modules.get(MODULE_ID)?.socketManager;
  }

  #setupSocket() {
    this.#teardownSocket();
    const socket = this.#getSocket();
    if (!socket) return;
    this.#socketManager = socket;

    const pageId = this.document.id;

    // Defer re-renders while the user is actively dragging a pin
    const safeRender = () => {
      if (this.#dragPin) return;
      this.render();
    };

    this.#boundSocketHandlers.pinAdded = (payload) => {
      if (payload.pageId !== pageId) return;
      safeRender();
    };
    this.#boundSocketHandlers.pinMoved = (payload) => {
      if (payload.pageId !== pageId) return;
      // Live-move the pin in the DOM without full re-render
      const pinEl = this.element?.querySelector(`[data-pin-id="${payload.pinId}"]`);
      if (pinEl) {
        pinEl.style.left = `${payload.x}%`;
        pinEl.style.top = `${payload.y}%`;
      } else {
        safeRender();
      }
    };
    this.#boundSocketHandlers.pinUpdated = (payload) => {
      if (payload.pageId !== pageId) return;
      safeRender();
    };
    this.#boundSocketHandlers.pinDeleted = (payload) => {
      if (payload.pageId !== pageId) return;
      safeRender();
    };

    for (const [type, handler] of Object.entries(this.#boundSocketHandlers)) {
      socket.on(type, handler);
    }
  }

  #teardownSocket() {
    if (!this.#socketManager) return;
    for (const [type, handler] of Object.entries(this.#boundSocketHandlers)) {
      this.#socketManager.off(type, handler);
    }
    this.#boundSocketHandlers = {};
    this.#socketManager = null;
  }

}
