/**
 * CollaborationLayer - A custom InteractionLayer for collaborative drawing.
 *
 * This layer renders on top of the standard Foundry canvas and handles:
 *  - Freehand drawing with real-time socket broadcast
 *  - Shape drawing (rectangles, ellipses, lines)
 *  - Text annotations
 *  - Player cursor display
 *  - Pointer/ping functionality
 */

const MODULE_ID = "map-collab-tool";

export class CollaborationLayer extends foundry.canvas.layers.InteractionLayer {

  /** @type {import("./socket-manager.mjs").SocketManager|null} */
  #socketManager = null;

  /** Container for remote player cursors */
  #cursorContainer = null;

  /** Container for in-progress (ephemeral) strokes from other users */
  #remoteStrokeContainer = null;

  /** Container for the local user's in-progress stroke */
  #localStrokeContainer = null;

  /** Container for completed collaborative drawings */
  #drawingContainer = null;

  /** Container for ping animations */
  #pingContainer = null;

  /** Map of remote user cursors: userId -> PIXI display object */
  #remoteCursors = new Map();

  /** Map of remote user in-progress strokes: userId -> PIXI.Graphics */
  #remoteStrokes = new Map();

  /** Current local drawing state */
  #drawing = false;

  /** Current tool: "pointer" | "freehand" | "rectangle" | "ellipse" | "line" | "text" */
  #activeTool = "pointer";

  /** Points collected during the current freehand stroke */
  #currentPoints = [];

  /** Starting point for shape tools */
  #shapeStart = null;

  /** The PIXI.Graphics object for the current local stroke */
  #currentGraphics = null;

  /** Throttle timer for cursor broadcasts */
  #cursorThrottle = 0;

  /** @override */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "collaboration",
      zIndex: 500
    });
  }

  /**
   * Assign the socket manager after the module is ready.
   * @param {import("./socket-manager.mjs").SocketManager} socketManager
   */
  setSocketManager(socketManager) {
    this.#socketManager = socketManager;
    this.#registerSocketListeners();
  }

  /** @override */
  async _draw(options) {
    // Create child containers in render order
    this.#drawingContainer = this.addChild(new PIXI.Container());
    this.#remoteStrokeContainer = this.addChild(new PIXI.Container());
    this.#localStrokeContainer = this.addChild(new PIXI.Container());
    this.#pingContainer = this.addChild(new PIXI.Container());
    this.#cursorContainer = this.addChild(new PIXI.Container());
  }

  /** @override */
  async _tearDown(options) {
    this.#remoteCursors.clear();
    this.#remoteStrokes.clear();
    this.#drawing = false;
    this.#currentPoints = [];
    this.#shapeStart = null;
    this.#currentGraphics = null;
    this.removeChildren();
  }

  /** @override */
  _activate() {
    super._activate();
    this.interactiveChildren = true;
    if (this.#drawingContainer) this.#drawingContainer.interactiveChildren = true;
  }

  /** @override */
  _deactivate() {
    super._deactivate();
    this.interactiveChildren = false;
  }

  // ─── Tool Management ───────────────────────────────────────────────

  get activeTool() {
    return this.#activeTool;
  }

  set activeTool(tool) {
    this.#activeTool = tool;
  }

  // ─── Drawing Properties ────────────────────────────────────────────

  get drawColor() {
    const custom = game.settings.get(MODULE_ID, "defaultColor");
    if (custom) return custom;
    return game.user.color?.toString() ?? "#ffffff";
  }

  get strokeWidth() {
    return game.settings.get(MODULE_ID, "strokeWidth") ?? 4;
  }

  // ─── Pointer / Mouse Events ────────────────────────────────────────

  /** @override */
  _onClickLeft(event) {
    if (this.#activeTool === "pointer") {
      this.#emitPing(event);
      return;
    }
    if (this.#activeTool === "text") {
      this.#handleTextClick(event);
      return;
    }
  }

  /** @override */
  _onDragLeftStart(event) {
    const pos = event.interactionData.origin;
    if (this.#activeTool === "pointer") return;
    this.#drawing = true;

    if (this.#activeTool === "freehand") {
      this.#currentPoints = [{ x: pos.x, y: pos.y }];
      this.#currentGraphics = new PIXI.Graphics();
      this.#localStrokeContainer.addChild(this.#currentGraphics);
      this.#socketManager?.emit("strokeStart", {
        tool: "freehand",
        color: this.drawColor,
        width: this.strokeWidth,
        points: [{ x: pos.x, y: pos.y }]
      });
    } else {
      // Shape tools: rectangle, ellipse, line
      this.#shapeStart = { x: pos.x, y: pos.y };
      this.#currentGraphics = new PIXI.Graphics();
      this.#localStrokeContainer.addChild(this.#currentGraphics);
      this.#socketManager?.emit("strokeStart", {
        tool: this.#activeTool,
        color: this.drawColor,
        width: this.strokeWidth,
        points: [{ x: pos.x, y: pos.y }]
      });
    }
  }

  /** @override */
  _onDragLeftMove(event) {
    if (!this.#drawing || !this.#currentGraphics) return;
    const pos = event.interactionData.destination;

    if (this.#activeTool === "freehand") {
      this.#currentPoints.push({ x: pos.x, y: pos.y });
      this.#drawFreehand(this.#currentGraphics, this.#currentPoints, this.drawColor, this.strokeWidth);
      // Throttle: send updates every few points
      if (this.#currentPoints.length % 3 === 0) {
        this.#socketManager?.emit("strokeUpdate", {
          points: this.#currentPoints.slice(-3)
        });
      }
    } else {
      // Redraw the shape preview
      this.#drawShape(this.#currentGraphics, this.#activeTool, this.#shapeStart, pos, this.drawColor, this.strokeWidth);
      this.#socketManager?.emit("strokeUpdate", {
        endPoint: { x: pos.x, y: pos.y }
      });
    }
  }

  /** @override */
  _onDragLeftDrop(event) {
    if (!this.#drawing) return;
    this.#drawing = false;
    const pos = event.interactionData.destination;

    if (this.#activeTool === "freehand") {
      this.#currentPoints.push({ x: pos.x, y: pos.y });
      this.#drawFreehand(this.#currentGraphics, this.#currentPoints, this.drawColor, this.strokeWidth);
    } else {
      this.#drawShape(this.#currentGraphics, this.#activeTool, this.#shapeStart, pos, this.drawColor, this.strokeWidth);
    }

    // Move the finished stroke to the persistent drawing container
    this.#localStrokeContainer.removeChild(this.#currentGraphics);
    this.#drawingContainer.addChild(this.#currentGraphics);

    // Emit stroke completion
    this.#socketManager?.emit("strokeEnd", {
      tool: this.#activeTool,
      color: this.drawColor,
      width: this.strokeWidth,
      points: this.#activeTool === "freehand" ? this.#currentPoints : null,
      startPoint: this.#shapeStart,
      endPoint: { x: pos.x, y: pos.y }
    });

    // Optionally persist as a Foundry DrawingDocument
    this.#maybePersist(this.#activeTool, this.#currentPoints, this.#shapeStart, pos);

    this.#currentGraphics = null;
    this.#currentPoints = [];
    this.#shapeStart = null;
  }

  /** @override */
  _onDragLeftCancel(event) {
    this.#drawing = false;
    if (this.#currentGraphics) {
      this.#localStrokeContainer.removeChild(this.#currentGraphics);
      this.#currentGraphics.destroy();
      this.#currentGraphics = null;
    }
    this.#currentPoints = [];
    this.#shapeStart = null;
  }

  /** @override */
  _onMouseMove(event) {
    // Broadcast cursor position to other users (throttled)
    const now = Date.now();
    if (now - this.#cursorThrottle < 50) return; // 20 fps max
    this.#cursorThrottle = now;

    const pos = event.interactionData?.destination ?? event.data?.getLocalPosition(this);
    if (!pos) return;
    this.#socketManager?.emit("cursorMove", { x: pos.x, y: pos.y });
  }

  // ─── Drawing Helpers ───────────────────────────────────────────────

  /**
   * Draw a freehand stroke on a PIXI.Graphics object.
   */
  #drawFreehand(gfx, points, color, width) {
    gfx.clear();
    if (points.length < 2) return;
    gfx.setStrokeStyle({ width, color, cap: "round", join: "round" });
    gfx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      gfx.lineTo(points[i].x, points[i].y);
    }
    gfx.stroke();
  }

  /**
   * Draw a shape (rectangle, ellipse, line) on a PIXI.Graphics object.
   */
  #drawShape(gfx, tool, start, end, color, width) {
    gfx.clear();
    gfx.setStrokeStyle({ width, color, cap: "round", join: "round" });

    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);

    switch (tool) {
      case "rectangle":
        gfx.rect(x, y, w, h);
        gfx.stroke();
        break;
      case "ellipse":
        gfx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
        gfx.stroke();
        break;
      case "line":
        gfx.moveTo(start.x, start.y);
        gfx.lineTo(end.x, end.y);
        gfx.stroke();
        break;
    }
  }

  // ─── Ping ──────────────────────────────────────────────────────────

  #emitPing(event) {
    const pos = event.interactionData.origin;
    this.#showPing(pos.x, pos.y, this.drawColor, game.user.name);
    this.#socketManager?.emit("ping", { x: pos.x, y: pos.y });
  }

  /**
   * Show an animated ping at the given canvas position.
   */
  #showPing(x, y, color, label) {
    const ping = new PIXI.Graphics();
    ping.position.set(x, y);
    this.#pingContainer.addChild(ping);

    // Add a label
    const text = new PIXI.Text({
      text: label ?? "",
      style: {
        fontFamily: "Signika",
        fontSize: 14,
        fill: color,
        stroke: { color: "#000000", width: 2 },
        align: "center"
      }
    });
    text.anchor.set(0.5, 2.5);
    ping.addChild(text);

    // Animate expanding rings
    let frame = 0;
    const maxFrames = 60;
    const ticker = canvas.app.ticker;

    const animate = () => {
      frame++;
      const progress = frame / maxFrames;
      const radius = 10 + progress * 40;
      const alpha = 1 - progress;

      ping.clear();
      ping.setStrokeStyle({ width: 3, color, alpha });
      ping.circle(0, 0, radius);
      ping.stroke();
      ping.setStrokeStyle({ width: 2, color, alpha: alpha * 0.5 });
      ping.circle(0, 0, radius * 0.6);
      ping.stroke();

      if (frame >= maxFrames) {
        ticker.remove(animate);
        this.#pingContainer.removeChild(ping);
        ping.destroy({ children: true });
      }
    };

    ticker.add(animate);
  }

  // ─── Text ──────────────────────────────────────────────────────────

  #handleTextClick(event) {
    const pos = event.interactionData.origin;
    const content = prompt("Enter annotation text:");
    if (!content) return;

    const text = new PIXI.Text({
      text: content,
      style: {
        fontFamily: "Signika",
        fontSize: 16,
        fill: this.drawColor,
        stroke: { color: "#000000", width: 2 },
        wordWrap: true,
        wordWrapWidth: 300
      }
    });
    text.position.set(pos.x, pos.y);
    this.#drawingContainer.addChild(text);

    this.#socketManager?.emit("strokeEnd", {
      tool: "text",
      color: this.drawColor,
      text: content,
      points: null,
      startPoint: { x: pos.x, y: pos.y },
      endPoint: { x: pos.x, y: pos.y }
    });
  }

  // ─── Persistence (DrawingDocument) ─────────────────────────────────

  async #maybePersist(tool, points, startPoint, endPoint) {
    const persist = game.settings.get(MODULE_ID, "persistDrawings");
    if (!persist) return;
    if (!canvas.scene) return;

    const drawingData = this.#buildDrawingData(tool, points, startPoint, endPoint);
    if (!drawingData) return;

    try {
      await canvas.scene.createEmbeddedDocuments("Drawing", [drawingData]);
    } catch (err) {
      console.warn(`${MODULE_ID} | Failed to persist drawing:`, err);
    }
  }

  /**
   * Convert a collaborative stroke into DrawingDocument-compatible data.
   */
  #buildDrawingData(tool, points, startPoint, endPoint) {
    const color = this.drawColor;
    const width = this.strokeWidth;

    switch (tool) {
      case "freehand": {
        if (!points || points.length < 2) return null;
        // Normalize points relative to the bounding box origin
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        const normalizedPoints = points.map(p => [p.x - minX, p.y - minY]);

        return {
          shape: {
            type: "p", // polygon
            width: maxX - minX,
            height: maxY - minY,
            points: normalizedPoints.flat()
          },
          x: minX,
          y: minY,
          strokeWidth: width,
          strokeColor: color,
          strokeAlpha: 1,
          fillType: 0,
          bezierFactor: 0.5,
          flags: { [MODULE_ID]: { collaborative: true, author: game.user.id } }
        };
      }
      case "rectangle": {
        if (!startPoint || !endPoint) return null;
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const w = Math.abs(endPoint.x - startPoint.x);
        const h = Math.abs(endPoint.y - startPoint.y);
        return {
          shape: { type: "r", width: w, height: h },
          x, y,
          strokeWidth: width,
          strokeColor: color,
          strokeAlpha: 1,
          fillType: 0,
          flags: { [MODULE_ID]: { collaborative: true, author: game.user.id } }
        };
      }
      case "ellipse": {
        if (!startPoint || !endPoint) return null;
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const w = Math.abs(endPoint.x - startPoint.x);
        const h = Math.abs(endPoint.y - startPoint.y);
        return {
          shape: { type: "e", width: w, height: h },
          x, y,
          strokeWidth: width,
          strokeColor: color,
          strokeAlpha: 1,
          fillType: 0,
          flags: { [MODULE_ID]: { collaborative: true, author: game.user.id } }
        };
      }
      case "line": {
        if (!startPoint || !endPoint) return null;
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        return {
          shape: {
            type: "p",
            width: Math.abs(endPoint.x - startPoint.x),
            height: Math.abs(endPoint.y - startPoint.y),
            points: [
              startPoint.x - x, startPoint.y - y,
              endPoint.x - x, endPoint.y - y
            ]
          },
          x, y,
          strokeWidth: width,
          strokeColor: color,
          strokeAlpha: 1,
          fillType: 0,
          flags: { [MODULE_ID]: { collaborative: true, author: game.user.id } }
        };
      }
      default:
        return null;
    }
  }

  // ─── Socket Listeners ──────────────────────────────────────────────

  #registerSocketListeners() {
    if (!this.#socketManager) return;

    // Remote cursor movement
    this.#socketManager.on("cursorMove", (payload) => {
      if (!game.settings.get(MODULE_ID, "showCursors")) return;
      this.#updateRemoteCursor(payload.userId, payload.userName, payload.userColor, payload.data);
    });

    // Remote stroke start
    this.#socketManager.on("strokeStart", (payload) => {
      const gfx = new PIXI.Graphics();
      this.#remoteStrokeContainer.addChild(gfx);
      this.#remoteStrokes.set(payload.userId, {
        graphics: gfx,
        tool: payload.data.tool,
        color: payload.data.color,
        width: payload.data.width,
        points: [...(payload.data.points || [])],
        startPoint: payload.data.points?.[0] ?? null
      });
    });

    // Remote stroke update
    this.#socketManager.on("strokeUpdate", (payload) => {
      const stroke = this.#remoteStrokes.get(payload.userId);
      if (!stroke) return;

      if (stroke.tool === "freehand" && payload.data.points) {
        stroke.points.push(...payload.data.points);
        this.#drawFreehand(stroke.graphics, stroke.points, stroke.color, stroke.width);
      } else if (payload.data.endPoint) {
        this.#drawShape(stroke.graphics, stroke.tool, stroke.startPoint, payload.data.endPoint, stroke.color, stroke.width);
      }
    });

    // Remote stroke end
    this.#socketManager.on("strokeEnd", (payload) => {
      // Clean up the in-progress stroke
      const stroke = this.#remoteStrokes.get(payload.userId);
      if (stroke) {
        this.#remoteStrokeContainer.removeChild(stroke.graphics);
        stroke.graphics.destroy();
        this.#remoteStrokes.delete(payload.userId);
      }

      // Draw the final result
      const { data } = payload;
      if (data.tool === "text") {
        const text = new PIXI.Text({
          text: data.text,
          style: {
            fontFamily: "Signika",
            fontSize: 16,
            fill: data.color,
            stroke: { color: "#000000", width: 2 },
            wordWrap: true,
            wordWrapWidth: 300
          }
        });
        text.position.set(data.startPoint.x, data.startPoint.y);
        this.#drawingContainer.addChild(text);
      } else {
        const gfx = new PIXI.Graphics();
        if (data.tool === "freehand" && data.points) {
          this.#drawFreehand(gfx, data.points, data.color, data.width);
        } else if (data.startPoint && data.endPoint) {
          this.#drawShape(gfx, data.tool, data.startPoint, data.endPoint, data.color, data.width);
        }
        this.#drawingContainer.addChild(gfx);
      }
    });

    // Remote ping
    this.#socketManager.on("ping", (payload) => {
      this.#showPing(payload.data.x, payload.data.y, payload.userColor, payload.userName);
    });

    // Remote clear
    this.#socketManager.on("clearDrawings", (payload) => {
      // Remove drawings authored by the requesting user
      this.#removeDrawingsByUser(payload.userId);
    });

    this.#socketManager.on("clearAllDrawings", () => {
      this.clearAllDrawings(false);
    });
  }

  // ─── Remote Cursor Rendering ───────────────────────────────────────

  #updateRemoteCursor(userId, userName, color, pos) {
    let cursor = this.#remoteCursors.get(userId);
    if (!cursor) {
      cursor = this.#createCursorGraphic(userName, color);
      this.#cursorContainer.addChild(cursor);
      this.#remoteCursors.set(userId, cursor);
    }
    cursor.position.set(pos.x, pos.y);
  }

  #createCursorGraphic(name, color) {
    const container = new PIXI.Container();

    // Cursor arrow
    const arrow = new PIXI.Graphics();
    arrow.setFillStyle({ color });
    arrow.moveTo(0, 0);
    arrow.lineTo(0, 18);
    arrow.lineTo(5, 14);
    arrow.lineTo(10, 22);
    arrow.lineTo(13, 20);
    arrow.lineTo(8, 12);
    arrow.lineTo(14, 10);
    arrow.closePath();
    arrow.fill();
    container.addChild(arrow);

    // Name label
    const label = new PIXI.Text({
      text: name,
      style: {
        fontFamily: "Signika",
        fontSize: 12,
        fill: color,
        stroke: { color: "#000000", width: 2 }
      }
    });
    label.position.set(16, 8);
    container.addChild(label);

    return container;
  }

  // ─── Clear Operations ──────────────────────────────────────────────

  /**
   * Clear all collaborative drawings from this layer.
   * @param {boolean} [broadcast=true] - Whether to broadcast to other clients.
   */
  clearAllDrawings(broadcast = true) {
    if (this.#drawingContainer) {
      this.#drawingContainer.removeChildren().forEach(c => c.destroy({ children: true }));
    }
    if (broadcast) {
      this.#socketManager?.emit("clearAllDrawings", {});
    }
  }

  /**
   * Clear drawings made by the current user.
   * @param {boolean} [broadcast=true] - Whether to broadcast to other clients.
   */
  clearMyDrawings(broadcast = true) {
    // For ephemeral drawings, we clear the whole local container
    // (persistent drawings should be deleted via DrawingDocument)
    if (this.#localStrokeContainer) {
      this.#localStrokeContainer.removeChildren().forEach(c => c.destroy({ children: true }));
    }
    if (broadcast) {
      this.#socketManager?.emit("clearDrawings", {});
    }

    // Also remove persisted drawings with our flag
    this.#clearPersistedDrawings();
  }

  #removeDrawingsByUser(userId) {
    // For ephemeral drawings, the in-progress strokes are removed via strokeEnd.
    // Persisted drawings are cleaned up via their flags.
  }

  async #clearPersistedDrawings() {
    if (!canvas.scene) return;
    const drawings = canvas.scene.drawings.filter(d =>
      d.getFlag(MODULE_ID, "collaborative") && d.getFlag(MODULE_ID, "author") === game.user.id
    );
    if (drawings.length > 0) {
      const ids = drawings.map(d => d.id);
      try {
        await canvas.scene.deleteEmbeddedDocuments("Drawing", ids);
      } catch (err) {
        console.warn(`${MODULE_ID} | Failed to delete persisted drawings:`, err);
      }
    }
  }
}
