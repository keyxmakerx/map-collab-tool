import { DEFAULT_PIN_TYPES } from "./module.mjs";

const MODULE_ID = "map-collab-tool";

export class PinConfigDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    tag: "form",
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
      handler: PinConfigDialog._onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/pin-config.hbs`
    }
  };

  _pin;
  _pageId;
  _onSave;
  _onDelete;

  constructor(pin, pageId, { onSave, onDelete } = {}) {
    super();
    this._pin = pin;
    this._pageId = pageId;
    this._onSave = onSave;
    this._onDelete = onDelete;
  }

  async _prepareContext() {
    const pinTypes = this._getPinTypes().map(pt => ({
      ...pt,
      selected: pt.id === this._pin.type
    }));
    return {
      label: this._pin.label || "",
      shared: this._pin.shared !== false,
      pinTypes
    };
  }

  _getPinTypes() {
    const page = game.journal
      ?.reduce((pages, j) => pages.concat(Array.from(j.pages)), [])
      ?.find(p => p.id === this._pageId);
    const custom = page?.getFlag(MODULE_ID, "pinTypes") || [];
    return [...DEFAULT_PIN_TYPES, ...custom];
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const deleteBtn = this.element.querySelector(".mct-delete-pin");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (this._onDelete) this._onDelete(this._pin.id);
        this.close();
      });
    }
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    if (this._onSave) {
      this._onSave({
        ...this._pin,
        label: data.label || "",
        type: data.type || "note",
        shared: !!data.shared
      });
    }
  }
}
