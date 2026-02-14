/**
 * Collaborative Map Tool - Main Module Entry Point
 * A system-agnostic collaborative drawing and annotation tool for Foundry VTT v13.
 */

import { CollaborationLayer } from "./collaboration-layer.mjs";
import { SocketManager } from "./socket-manager.mjs";
import { registerSettings } from "./settings.mjs";
import { registerSceneControls } from "./scene-controls.mjs";
import { ColorPickerApp } from "./color-picker-app.mjs";

const MODULE_ID = "map-collab-tool";

/**
 * Assigned player colors to avoid conflicts.
 * Falls back to the player's Foundry user color.
 */
function getPlayerColor() {
  return game.user.color?.toString() ?? "#ffffff";
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Collaborative Map Tool`);

  // Register the custom canvas layer
  CONFIG.Canvas.layers.collaboration = {
    layerClass: CollaborationLayer,
    group: "interface"
  };

  // Register module settings
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);

  // Initialize socket communication
  const socketManager = new SocketManager(MODULE_ID);
  game.modules.get(MODULE_ID).socketManager = socketManager;
  game.modules.get(MODULE_ID).api = {
    getLayer: () => canvas.collaboration,
    getSocketManager: () => socketManager,
    getPlayerColor
  };
});

// Register scene control buttons (v13 object-based API)
Hooks.on("getSceneControlButtons", (controls) => {
  registerSceneControls(controls);
});

// When the canvas is ready, set up event listeners on our layer
Hooks.on("canvasReady", () => {
  const layer = canvas.collaboration;
  if (layer) {
    const socketManager = game.modules.get(MODULE_ID)?.socketManager;
    if (socketManager) {
      layer.setSocketManager(socketManager);
    }
  }
});

export { MODULE_ID };
