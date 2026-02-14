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

  game.settings.register(MODULE_ID, "defaultPinType", {
    name: "MCT.Settings.DefaultPinType.Name",
    hint: "MCT.Settings.DefaultPinType.Hint",
    scope: "client",
    config: true,
    type: String,
    default: "note",
    choices: {
      location: "Location",
      danger: "Danger",
      treasure: "Treasure",
      quest: "Quest",
      note: "Note"
    }
  });
}
