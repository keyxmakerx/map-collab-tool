/**
 * ColorPickerApp - A simple ApplicationV2-based color picker for the collaborative tools.
 * Players can select their drawing color from a palette or use a custom color input.
 */

const MODULE_ID = "map-collab-tool";

const PRESET_COLORS = [
  "#ff0000", "#ff6600", "#ffcc00", "#00cc00",
  "#0066ff", "#9933ff", "#ff33cc", "#ffffff",
  "#cccccc", "#666666", "#333333", "#000000"
];

export class ColorPickerApp extends foundry.applications.api.ApplicationV2 {

  static DEFAULT_OPTIONS = {
    id: "mct-color-picker",
    window: {
      title: "MCT.Title",
      icon: "fa-solid fa-palette",
      resizable: false
    },
    position: {
      width: 220,
      height: "auto"
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/color-picker.hbs`
    }
  };

  async _prepareContext(options) {
    const currentColor = game.settings.get(MODULE_ID, "defaultColor") || game.user.color?.toString() || "#ffffff";
    const strokeWidth = game.settings.get(MODULE_ID, "strokeWidth") ?? 4;

    return {
      colors: PRESET_COLORS,
      currentColor,
      strokeWidth
    };
  }

  _onRender(context, options) {
    const html = this.element;

    // Color swatch clicks
    html.querySelectorAll(".mct-color-swatch").forEach(swatch => {
      swatch.addEventListener("click", (ev) => {
        const color = ev.currentTarget.dataset.color;
        game.settings.set(MODULE_ID, "defaultColor", color);
        html.querySelector("#mct-custom-color").value = color;
        this.#updateActiveColor(html, color);
      });
    });

    // Custom color input
    const customInput = html.querySelector("#mct-custom-color");
    customInput?.addEventListener("change", (ev) => {
      game.settings.set(MODULE_ID, "defaultColor", ev.target.value);
      this.#updateActiveColor(html, ev.target.value);
    });

    // Stroke width slider
    const widthSlider = html.querySelector("#mct-stroke-width");
    widthSlider?.addEventListener("change", (ev) => {
      game.settings.set(MODULE_ID, "strokeWidth", Number(ev.target.value));
    });
  }

  #updateActiveColor(html, color) {
    html.querySelectorAll(".mct-color-swatch").forEach(s => s.classList.remove("active"));
    const match = html.querySelector(`.mct-color-swatch[data-color="${color}"]`);
    if (match) match.classList.add("active");
  }
}
