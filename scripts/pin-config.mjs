import { DEFAULT_PIN_TYPES } from "./module.mjs";

const MODULE_ID = "map-collab-tool";

export class PinConfigDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "mct-pin-config",
    tag: "div",
    window: {
      title: "MCT.PinConfig.Title",
      icon: "fa-solid fa-map-pin",
      resizable: false
    },
    position: {
      width: 320,
      height: "auto"
    },
    form: {
      handler: PinConfigDialog.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/pin-config.hbs`
    }
  };

  #pin;
  #pageId;
  #onSave;
  #onDelete;

  constructor(pin, pageId, { onSave, onDelete } = {}) {
    super();
    this.#pin = pin;
    this.#pageId = pageId;
    this.#onSave = onSave;
    this.#onDelete = onDelete;
  }

  async _prepareContext() {
    const pinTypes = this.#getPinTypes().map(pt => ({
      ...pt,
      selected: pt.id === this.#pin.type
    }));
    return {
      label: this.#pin.label || "",
      shared: this.#pin.shared !== false,
      pinTypes
    };
  }

  #getPinTypes() {
    const page = game.journal
      ?.reduce((pages, j) => pages.concat(Array.from(j.pages)), [])
      ?.find(p => p.id === this.#pageId);
    const custom = page?.getFlag(MODULE_ID, "pinTypes") || [];
    return [...DEFAULT_PIN_TYPES, ...custom];
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const deleteBtn = this.element.querySelector(".mct-delete-pin");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (this.#onDelete) this.#onDelete(this.#pin.id);
        this.close();
      });
    }
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    if (this.#onSave) {
      this.#onSave({
        ...this.#pin,
        label: data.label || "",
        type: data.type || "note",
        shared: !!data.shared
      });
    }
  }
}
