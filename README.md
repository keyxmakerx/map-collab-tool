# Collaborative Map Tool

A system-agnostic Foundry VTT v13 module that provides interactive map journal pages with collaborative pin placement. Players can open a map, place pins of different types, drag them around, and share or keep them private.

## Features

- **Interactive map journal pages** — Add a "Map" page type to any journal entry with a custom image
- **Drag-and-drop pins** — Click to place pins, drag to reposition, right-click to edit or delete
- **5 built-in pin types** — Location, Danger, Treasure, Quest, and Note — each with a distinct icon and color
- **Private & shared pins** — Players can mark pins as private (only visible to them) or shared (visible to all)
- **Real-time sync** — Pin changes broadcast to all connected clients via sockets
- **Zoom & pan** — Mouse wheel to zoom, middle-click drag to pan large maps
- **Permission controls** — GM can toggle whether players are allowed to place pins
- **System agnostic** — Works with any game system

## Installation

1. In Foundry VTT, go to **Settings > Add-on Modules > Install Module**
2. Paste the manifest URL or install from the package browser
3. Enable the module in your world's module settings

## Usage

1. Create a new **Journal Entry** (or open an existing one)
2. Add a new page and select the **Map** type
3. Click **Set Map Image** to upload or pick a map image
4. **Left-click** on the map to place a pin of the selected type
5. **Drag** pins to reposition them
6. **Right-click** a pin to edit its label, type, or visibility — or delete it
7. Use the toolbar to switch pin types and zoom in/out

## Configuration

| Setting | Scope | Default | Description |
|---|---|---|---|
| Enable for Players | World | `true` | Allow players to add and edit their own pins |
| Default Pin Type | Client | `Note` | Default pin type when placing new pins |

## Pin Types

| Type | Icon | Color | Use Case |
|---|---|---|---|
| Location | Map pin | Blue | Towns, landmarks, points of interest |
| Danger | Skull | Red | Hostile areas, traps, warnings |
| Treasure | Gem | Amber | Loot, hidden caches, rewards |
| Quest | Scroll | Purple | Quest objectives, NPC locations |
| Note | Sticky note | Gray | General annotations |

## Architecture

```
map-collab-tool/
├── module.json              # Foundry module manifest
├── scripts/
│   ├── module.mjs           # Entry point, hooks, page type registration
│   ├── map-page-sheet.mjs   # Custom JournalPageSheet for the map viewer
│   ├── pin-config.mjs       # ApplicationV2 dialog for editing pins
│   ├── socket-manager.mjs   # Real-time socket communication
│   └── settings.mjs         # Module settings registration
├── styles/
│   └── map-collab-tool.css  # UI styles
├── templates/
│   ├── map-page.hbs         # Map viewer template
│   └── pin-config.hbs       # Pin edit dialog template
└── lang/
    └── en.json              # English translations
```

## Compatibility

- **Foundry VTT**: v13+
- **Game Systems**: Any (system agnostic)

## License

MIT
