/**
 * Scene Controls - Register collaborative drawing tools in the v13 scene controls sidebar.
 *
 * In v13, controls is an object keyed by control name (not an array).
 * Tools must have onChange or onClick to avoid errors.
 */

const MODULE_ID = "map-collab-tool";

/**
 * Register the collaborative map tools into the scene controls.
 * @param {object} controls - The v13 scene controls object.
 */
export function registerSceneControls(controls) {
  const isAllowed = game.user.isGM || game.settings.get(MODULE_ID, "enableForPlayers");
  if (!isAllowed) return;

  controls.collaboration = {
    name: "collaboration",
    title: "MCT.Controls.Title",
    icon: "fa-solid fa-users-rectangle",
    layer: "collaboration",
    visible: true,
    tools: {
      pointer: {
        name: "pointer",
        title: "MCT.Tools.Pointer",
        icon: "fa-solid fa-hand-pointer",
        order: 0,
        onChange: (active) => {
          if (canvas.collaboration) canvas.collaboration.activeTool = "pointer";
        }
      },
      freehand: {
        name: "freehand",
        title: "MCT.Tools.Freehand",
        icon: "fa-solid fa-pencil",
        order: 1,
        onChange: (active) => {
          if (canvas.collaboration) canvas.collaboration.activeTool = "freehand";
        }
      },
      rectangle: {
        name: "rectangle",
        title: "MCT.Tools.Rectangle",
        icon: "fa-regular fa-square",
        order: 2,
        onChange: (active) => {
          if (canvas.collaboration) canvas.collaboration.activeTool = "rectangle";
        }
      },
      ellipse: {
        name: "ellipse",
        title: "MCT.Tools.Ellipse",
        icon: "fa-regular fa-circle",
        order: 3,
        onChange: (active) => {
          if (canvas.collaboration) canvas.collaboration.activeTool = "ellipse";
        }
      },
      line: {
        name: "line",
        title: "MCT.Tools.Line",
        icon: "fa-solid fa-slash",
        order: 4,
        onChange: (active) => {
          if (canvas.collaboration) canvas.collaboration.activeTool = "line";
        }
      },
      text: {
        name: "text",
        title: "MCT.Tools.Text",
        icon: "fa-solid fa-font",
        order: 5,
        onChange: (active) => {
          if (canvas.collaboration) canvas.collaboration.activeTool = "text";
        }
      },
      clear: {
        name: "clear",
        title: "MCT.Tools.Clear",
        icon: "fa-solid fa-eraser",
        order: 6,
        button: true,
        onChange: () => {
          canvas.collaboration?.clearMyDrawings();
        }
      },
      clearAll: {
        name: "clearAll",
        title: "MCT.Tools.ClearAll",
        icon: "fa-solid fa-trash-can",
        order: 7,
        button: true,
        visible: game.user.isGM,
        onChange: () => {
          Dialog.confirm({
            title: "Clear All Drawings",
            content: "<p>Remove all collaborative drawings from this scene?</p>",
            yes: () => canvas.collaboration?.clearAllDrawings(),
            no: () => {},
            defaultYes: false
          });
        }
      }
    },
    activeTool: "pointer"
  };
}
