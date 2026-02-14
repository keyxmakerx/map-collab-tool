import { PinConfigDialog } from "./pin-config.mjs";
import { DEFAULT_PIN_TYPES } from "./module.mjs";

const MODULE_ID = "map-collab-tool";
const DRAG_THRESHOLD = 5;

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

  // Zoom/pan state
  #zoom = 1;
  #panX = 0;
  #panY = 0;
  #isPanning = false;
  #panStartX = 0;
  #panStartY = 0;

  // Pin drag state
  #dragPin = null;
  #dragPinEl = null;
  #dragPinStartX = 0;
  #dragPinStartY = 0;
  #dragStartX = 0;
  #dragStartY = 0;

  // Drawing state
  #isDrawing = false;
  #drawColor = "#ff0000";
  #activeDrawing = null;
  #activePolyline = null;

  // Socket
  #socketManager = null;
  #boundSocketHandlers = {};

  // Journal popup
  #journalPopupEl = null;

  get title() {
    return this.document.name || game.i18n.localize("MCT.MapPage.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const mapImage = this.document.getFlag(MODULE_ID, "mapImage") || "";
    const allPins = this.document.getFlag(MODULE_ID, "pins") || [];
    const allDrawings = this.document.getFlag(MODULE_ID, "drawings") || [];
    const anyoneCanEdit = this.document.getFlag(MODULE_ID, "anyoneCanEdit") || false;
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
        isPrivate: pin.shared === false,
        isText: pin.type === "text",
        hasLink: !!(pin.linkedJournalId && pin.linkedPageId)
      };
    });

    const defaultPinType = game.settings.get(MODULE_ID, "defaultPinType") || "note";
    const pinTypes = this.#getPinTypes().map(pt => ({
      ...pt,
      selected: pt.id === defaultPinType
    }));

    // Prepare drawing data for SVG rendering
    const drawings = allDrawings.map(d => ({
      ...d,
      svgPoints: d.points.map(p => `${p.x},${p.y}`).join(" "),
      strokeWidth: (d.size || 3) * 0.1
    }));

    return {
      ...context,
      mapImage,
      pins,
      pinTypes,
      drawings,
      zoom: this.#zoom,
      panX: this.#panX,
      panY: this.#panY,
      isGM: game.user.isGM,
      isDrawing: this.#isDrawing,
      drawColor: this.#drawColor,
      anyoneCanEdit
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

    let pointerDownTarget = null;

    // ── Viewport pointer handling ──
    viewport.addEventListener("pointerdown", (e) => {
      if (e.button === 0 || e.button === 1) {
        if (this.#dragPin) return;
        if (e.target.closest("button, a, select, input")) return;

        // If drawing mode and clicking on the SVG/image area, start drawing
        if (this.#isDrawing && e.button === 0) {
          const svgLayer = mapLayer.querySelector(".mct-drawing-layer");
          if (svgLayer) {
            e.preventDefault();
            this.#startDrawing(e, svgLayer);
            viewport.setPointerCapture(e.pointerId);
            return;
          }
        }

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
      // Drawing mode
      if (this.#activeDrawing) {
        const svgLayer = mapLayer.querySelector(".mct-drawing-layer");
        if (svgLayer) this.#continueDrawing(e, svgLayer);
        return;
      }

      if (this.#isPanning) {
        this.#panX = e.clientX - this.#panStartX;
        this.#panY = e.clientY - this.#panStartY;
        this.#applyTransform(mapLayer);
      }

      // Pin dragging
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
      // Finish drawing
      if (this.#activeDrawing) {
        await this.#finishDrawing();
        viewport.releasePointerCapture(e.pointerId);
        return;
      }

      // Finish pin drag
      if (this.#dragPin) {
        const rect = mapLayer.querySelector(".mct-pins-layer")?.getBoundingClientRect();
        const movedDist = Math.abs(e.clientX - this.#dragStartX) + Math.abs(e.clientY - this.#dragStartY);

        if (rect && rect.width && rect.height && movedDist >= DRAG_THRESHOLD) {
          const dx = ((e.clientX - this.#dragStartX) / rect.width) * 100;
          const dy = ((e.clientY - this.#dragStartY) / rect.height) * 100;
          const x = Math.max(0, Math.min(100, this.#dragPinStartX + dx));
          const y = Math.max(0, Math.min(100, this.#dragPinStartY + dy));
          await this.#movePin(this.#dragPin, x, y);
        } else {
          // It was a click, not a drag — show journal popup if linked
          const pin = this.#getPinById(this.#dragPin);
          if (pin?.linkedJournalId) {
            this.#showJournalPopup(pin, this.#dragPinEl);
          }
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

        const dx = Math.abs(e.clientX - this.#dragStartX);
        const dy = Math.abs(e.clientY - this.#dragStartY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD && e.button === 0) {
          // Dismiss any open popup
          this.#dismissJournalPopup();

          if (!this.#isDrawing) {
            const mapImage = mapLayer.querySelector(".mct-map-image");
            if (mapImage && (pointerDownTarget === mapImage || mapImage.contains(pointerDownTarget))) {
              if (this.#canPlace()) {
                const pinsLayer = mapLayer.querySelector(".mct-pins-layer");
                const rect = pinsLayer?.getBoundingClientRect() || mapImage.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                await this.#addPin(x, y);
              }
            }
          }
        }
        pointerDownTarget = null;
        return;
      }
    });

    // Pin interactions
    this.#setupPinListeners(mapLayer, viewport);

    // ── Toolbar buttons ──
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

    // Set image buttons
    this.element.querySelectorAll(".mct-set-image").forEach(btn => {
      btn.addEventListener("click", () => this.#pickImage());
    });

    // Draw mode toggle
    this.element.querySelector(".mct-draw-toggle")?.addEventListener("click", () => {
      this.#isDrawing = !this.#isDrawing;
      this.element.querySelector(".mct-draw-toggle")?.classList.toggle("active", this.#isDrawing);
      this.element.querySelector(".mct-viewport")?.classList.toggle("mct-drawing-mode", this.#isDrawing);
    });

    // Draw color
    this.element.querySelector(".mct-draw-color")?.addEventListener("input", (e) => {
      this.#drawColor = e.target.value;
    });

    // Permissions toggle (GM only)
    this.element.querySelector(".mct-permissions-toggle")?.addEventListener("click", async () => {
      const current = this.document.getFlag(MODULE_ID, "anyoneCanEdit") || false;
      await this.document.setFlag(MODULE_ID, "anyoneCanEdit", !current);
      ui.notifications.info(!current
        ? game.i18n.localize("MCT.Notifications.EditingEnabled")
        : game.i18n.localize("MCT.Notifications.EditingDisabled"));
      this.render();
    });

    // Clear drawings (GM only)
    this.element.querySelector(".mct-clear-drawings")?.addEventListener("click", async () => {
      await this.document.setFlag(MODULE_ID, "drawings", []);
      this.#getSocket()?.emit("drawingsCleared", { pageId: this.document.id });
      this.render();
    });

    // Apply drawing mode class if active
    if (this.#isDrawing) {
      viewport.classList.add("mct-drawing-mode");
    }

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

  // ── Transform ──

  #applyTransform(mapLayer) {
    mapLayer.style.transform = `translate(${this.#panX}px, ${this.#panY}px) scale(${this.#zoom})`;
  }

  // ── Pin Listeners ──

  #setupPinListeners(mapLayer, viewport) {
    const pins = mapLayer.querySelectorAll(".mct-pin");
    for (const pinEl of pins) {
      const pinId = pinEl.dataset.pinId;

      // Left-click: start drag (or click for journal popup)
      pinEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (this.#isDrawing) return;
        e.stopPropagation();

        const pin = this.#getPinById(pinId);
        if (!pin) return;

        // Always allow starting a "drag" to detect clicks, but only commit moves if editable
        this.#dragPin = pinId;
        this.#dragPinEl = pinEl;
        this.#dragPinStartX = pin.x;
        this.#dragPinStartY = pin.y;
        this.#dragStartX = e.clientX;
        this.#dragStartY = e.clientY;
        if (this.#canEditPin(pin)) {
          pinEl.classList.add("mct-pin-dragging");
        }
        viewport.setPointerCapture(e.pointerId);
      });

      // Double-click: open linked journal
      pinEl.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pin = this.#getPinById(pinId);
        if (pin?.linkedJournalId) {
          this.#openLinkedJournal(pin);
        }
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

  // ── Permissions ──

  #canPlace() {
    if (game.user.isGM) return true;
    if (game.settings.get(MODULE_ID, "enableForPlayers")) return true;
    if (this.document.getFlag(MODULE_ID, "anyoneCanEdit")) return true;
    return false;
  }

  #canEditPin(pin) {
    if (game.user.isGM) return true;
    if (this.document.getFlag(MODULE_ID, "anyoneCanEdit")) return true;
    if (!game.settings.get(MODULE_ID, "enableForPlayers")) return false;
    return pin.createdBy === game.user.id;
  }

  #canDraw() {
    if (game.user.isGM) return true;
    if (this.document.getFlag(MODULE_ID, "anyoneCanEdit")) return true;
    return game.settings.get(MODULE_ID, "enableForPlayers");
  }

  // ── Pin Data ──

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
    const pin = this.#getPinById(pinId);
    if (pin && !this.#canEditPin(pin)) return;

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

  // ── Journal Link ──

  #showJournalPopup(pin, anchorEl) {
    this.#dismissJournalPopup();

    const journal = game.journal.get(pin.linkedJournalId);
    const page = journal?.pages.get(pin.linkedPageId);
    if (!journal) return;

    const popup = document.createElement("div");
    popup.className = "mct-journal-popup";

    const title = document.createElement("div");
    title.className = "mct-journal-popup-title";
    title.innerHTML = `<i class="fa-solid fa-book-open"></i> ${page?.name || journal.name}`;
    popup.appendChild(title);

    const openBtn = document.createElement("button");
    openBtn.className = "mct-journal-popup-open";
    openBtn.innerHTML = `<i class="fa-solid fa-external-link-alt"></i> ${game.i18n.localize("MCT.JournalPopup.Open")}`;
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#openLinkedJournal(pin);
      this.#dismissJournalPopup();
    });
    popup.appendChild(openBtn);

    // Position popup near the pin
    const viewport = this.element.querySelector(".mct-viewport");
    if (!viewport) return;
    viewport.appendChild(popup);
    this.#journalPopupEl = popup;

    const pinRect = anchorEl.getBoundingClientRect();
    const vpRect = viewport.getBoundingClientRect();
    popup.style.left = `${pinRect.left - vpRect.left + pinRect.width / 2}px`;
    popup.style.top = `${pinRect.top - vpRect.top - 8}px`;
  }

  #dismissJournalPopup() {
    if (this.#journalPopupEl) {
      this.#journalPopupEl.remove();
      this.#journalPopupEl = null;
    }
  }

  #openLinkedJournal(pin) {
    const journal = game.journal.get(pin.linkedJournalId);
    if (!journal) return;
    journal.sheet.render(true, { pageId: pin.linkedPageId });
  }

  // ── Drawing ──

  #startDrawing(e, svgLayer) {
    if (!this.#canDraw()) return;

    const rect = svgLayer.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    this.#activeDrawing = {
      id: foundry.utils.randomID(),
      points: [{ x, y }],
      color: this.#drawColor,
      size: 3,
      createdBy: game.user.id
    };

    // Create live polyline in SVG
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("stroke", this.#drawColor);
    polyline.setAttribute("stroke-width", "0.3");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("points", `${x},${y}`);
    svgLayer.appendChild(polyline);
    this.#activePolyline = polyline;
  }

  #continueDrawing(e, svgLayer) {
    if (!this.#activeDrawing || !this.#activePolyline) return;

    const rect = svgLayer.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    this.#activeDrawing.points.push({ x, y });

    const pointsStr = this.#activeDrawing.points.map(p => `${p.x},${p.y}`).join(" ");
    this.#activePolyline.setAttribute("points", pointsStr);
  }

  async #finishDrawing() {
    if (!this.#activeDrawing) return;

    // Only save if we have at least 2 points
    if (this.#activeDrawing.points.length >= 2) {
      try {
        const drawings = [...(this.document.getFlag(MODULE_ID, "drawings") || []), this.#activeDrawing];
        await this.document.setFlag(MODULE_ID, "drawings", drawings);
        this.#getSocket()?.emit("drawingAdded", { pageId: this.document.id, drawing: this.#activeDrawing });
      } catch (err) {
        console.error("MCT | drawing error:", err);
      }
    } else {
      // Remove the polyline if too short
      this.#activePolyline?.remove();
    }

    this.#activeDrawing = null;
    this.#activePolyline = null;
  }

  // ── Image ──

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

  // ── Socket ──

  #getSocket() {
    return game.modules.get(MODULE_ID)?.socketManager;
  }

  #setupSocket() {
    this.#teardownSocket();
    const socket = this.#getSocket();
    if (!socket) return;
    this.#socketManager = socket;

    const pageId = this.document.id;

    const safeRender = () => {
      if (this.#dragPin || this.#activeDrawing) return;
      this.render();
    };

    this.#boundSocketHandlers.pinAdded = (payload) => {
      if (payload.pageId !== pageId) return;
      safeRender();
    };
    this.#boundSocketHandlers.pinMoved = (payload) => {
      if (payload.pageId !== pageId) return;
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
    this.#boundSocketHandlers.drawingAdded = (payload) => {
      if (payload.pageId !== pageId) return;
      safeRender();
    };
    this.#boundSocketHandlers.drawingsCleared = (payload) => {
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
