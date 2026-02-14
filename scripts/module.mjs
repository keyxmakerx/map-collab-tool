import { SocketManager } from "./socket-manager.mjs";
import { registerSettings } from "./settings.mjs";
import { MapPageSheet } from "./map-page-sheet.mjs";

const MODULE_ID = "map-collab-tool";

export const DEFAULT_PIN_TYPES = [
  { id: "location", label: "Location", icon: "fa-location-dot", color: "#3b82f6" },
  { id: "danger", label: "Danger", icon: "fa-skull-crossbones", color: "#ef4444" },
  { id: "treasure", label: "Treasure", icon: "fa-gem", color: "#f59e0b" },
  { id: "quest", label: "Quest", icon: "fa-scroll", color: "#8b5cf6" },
  { id: "note", label: "Note", icon: "fa-note-sticky", color: "#6b7280" }
];

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Collaborative Map Tool`);

  // Register module settings
  registerSettings();

  // Register the custom "map" journal page type
  Object.assign(CONFIG.JournalEntryPage.typeLabels, {
    "map": "MCT.PageType.Map"
  });

  // Register the MapPageSheet for our custom page type
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, MapPageSheet, {
    types: ["map"],
    makeDefault: true,
    label: "MCT.MapPage.SheetLabel"
  });
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);

  const socketManager = new SocketManager();
  const mod = game.modules.get(MODULE_ID);
  mod.socketManager = socketManager;
  mod.api = {
    getSocketManager: () => socketManager,
    DEFAULT_PIN_TYPES
  };
});

export { MODULE_ID };
