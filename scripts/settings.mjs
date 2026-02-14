/**
 * Register module settings.
 */

const MODULE_ID = "map-collab-tool";

export function registerSettings() {
  game.settings.register(MODULE_ID, "enableForPlayers", {
    name: "MCT.Settings.EnableForPlayers.Name",
    hint: "MCT.Settings.EnableForPlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showCursors", {
    name: "MCT.Settings.ShowCursors.Name",
    hint: "MCT.Settings.ShowCursors.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "defaultColor", {
    name: "MCT.Settings.DefaultColor.Name",
    hint: "MCT.Settings.DefaultColor.Hint",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "strokeWidth", {
    name: "MCT.Settings.StrokeWidth.Name",
    hint: "MCT.Settings.StrokeWidth.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 4,
    range: { min: 1, max: 20, step: 1 }
  });

  game.settings.register(MODULE_ID, "persistDrawings", {
    name: "MCT.Settings.PersistDrawings.Name",
    hint: "MCT.Settings.PersistDrawings.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}
