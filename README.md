# Collaborative Map Tool

A system-agnostic Foundry VTT v13 module that enables real-time collaborative drawing and annotation on the shared battle map.

## Features

- **Real-time collaborative drawing** — All connected players see each other's strokes as they draw
- **Player cursors** — See where other players are pointing on the map
- **Ping** — Click to ping a location, visible to all players with an animated ring
- **Drawing tools** — Freehand, rectangle, ellipse, line, and text annotations
- **Per-player colors** — Each player draws in their own color (defaults to their Foundry user color)
- **Persistence** — Finished drawings are saved as Foundry DrawingDocuments so they survive page reloads
- **System agnostic** — Works with any game system (D&D 5e, Pathfinder, Fate, etc.)
- **GM controls** — GM can clear all drawings; players can clear their own

## Installation

1. In Foundry VTT, go to **Settings → Add-on Modules → Install Module**
2. Paste the manifest URL or install from the package browser
3. Enable the module in your world's module settings

## Usage

1. Activate the **Collaboration Tools** control group in the left sidebar (users icon)
2. Select a drawing tool:
   - **Pointer** — Click to ping a location
   - **Freehand** — Click and drag to draw freely
   - **Rectangle** — Click and drag to draw a rectangle
   - **Ellipse** — Click and drag to draw an ellipse
   - **Line** — Click and drag to draw a straight line
   - **Text** — Click to place a text annotation
3. Use the **Eraser** button to clear your own drawings
4. GM can use the **Trash** button to clear all collaborative drawings

## Configuration

Module settings are available under **Settings → Module Settings → Collaborative Map Tool**:

| Setting | Scope | Default | Description |
|---|---|---|---|
| Enable for Players | World | `true` | Allow non-GM users to use the tools |
| Show Player Cursors | World | `true` | Display remote player cursors |
| Default Draw Color | Client | User color | Override drawing color |
| Stroke Width | Client | `4` | Line thickness in pixels |
| Persist Drawings | World | `true` | Save as DrawingDocuments |

## Architecture

```
map-collab-tool/
├── module.json              # Foundry module manifest
├── scripts/
│   ├── module.mjs           # Entry point, hooks, initialization
│   ├── collaboration-layer.mjs  # Custom InteractionLayer for drawing
│   ├── socket-manager.mjs   # Real-time socket communication
│   ├── scene-controls.mjs   # v13 scene control buttons
│   ├── color-picker-app.mjs # ApplicationV2 color picker
│   └── settings.mjs         # Module settings registration
├── styles/
│   └── map-collab-tool.css  # UI styles
├── templates/
│   └── color-picker.hbs     # Color picker template
└── lang/
    └── en.json              # English translations
```

### Key Technical Decisions

- **Custom `InteractionLayer`** registered via `CONFIG.Canvas.layers` — provides a dedicated drawing surface that doesn't conflict with Foundry's built-in Drawing layer
- **Socket.io** via `game.socket` with the `module.map-collab-tool` namespace — broadcasts ephemeral state (cursors, in-progress strokes) for real-time feel
- **`DrawingDocument`** via `Scene.createEmbeddedDocuments` — persists finished drawings using Foundry's built-in document system, which automatically syncs to all clients
- **v13 object-based scene controls** — uses the new `getSceneControlButtons` API where controls are objects keyed by name

## Compatibility

- **Foundry VTT**: v13+
- **Game Systems**: Any (system agnostic)

## License

MIT
