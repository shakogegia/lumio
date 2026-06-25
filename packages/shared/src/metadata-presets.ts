import { FieldKind, FieldType } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";

export interface PresetField {
  key: string;
  label: string;
  type: FieldType;
  kind: FieldKind;
  /** Set for kind === Standard: which STANDARD_FIELDS entry this field surfaces. */
  builtinKey?: StandardFieldKey;
}

export interface PresetGroup {
  label: string;
  fields: PresetField[];
}

export interface PresetDef {
  id: string;
  name: string;
  groups: PresetGroup[];
}

const t = FieldType;
const custom = (key: string, label: string, type: FieldType = FieldType.Text): PresetField => ({
  key,
  label,
  type,
  kind: FieldKind.Custom,
});
const standard = (key: string, label: string, builtinKey: StandardFieldKey, type: FieldType): PresetField => ({
  key,
  label,
  type,
  kind: FieldKind.Standard,
  builtinKey,
});

/** Mirrors Negative Lab Pro's film-metadata sections 2–5 (26 fields;
 *  https://www.negativelabpro.com/guide/film-metadata/) plus an intentional
 *  "Roll" field (frames share a roll; matches filmexif:RollID). All custom fields. */
const FILM: PresetDef = {
  id: "film",
  name: "Film",
  groups: [
    {
      label: "Equipment",
      fields: [
        custom("camera-make", "Camera Make"),
        custom("camera-model", "Camera Model"),
        custom("lens-make", "Lens Make"),
        custom("lens-model", "Lens Model"),
        custom("film-stock", "Film Stock"),
        custom("film-iso", "Film ISO", t.Number),
        custom("film-format", "Film Format", t.Choice),
        custom("roll", "Roll"),
        custom("gear-notes", "Gear Notes", t.Textarea),
      ],
    },
    {
      label: "Shooting",
      fields: [
        custom("shot-at-iso", "Shot at ISO", t.Number),
        custom("aperture", "Aperture", t.Number),
        custom("shutter-speed", "Shutter Speed"),
        custom("focal-length", "Focal Length", t.Number),
        custom("date", "Date", t.Date),
        custom("shooting-notes", "Shooting Notes", t.Textarea),
      ],
    },
    {
      label: "Digitization",
      fields: [
        custom("scan-method", "Scan Method", t.Choice),
        custom("scan-equipment", "Scan Equipment"),
        custom("light-source", "Light Source"),
        custom("film-holder", "Film Holder"),
        custom("digitization-notes", "Digitization Notes", t.Textarea),
      ],
    },
    {
      label: "Development",
      fields: [
        custom("push-pull", "Push-Pull", t.Choice),
        custom("developed-at", "Developed At", t.Choice),
        custom("developer", "Developer"),
        custom("dilution", "Dilution"),
        custom("dev-time-temp", "Dev Time / Temp"),
        custom("dev-method", "Dev Method"),
        custom("dev-notes", "Dev Notes", t.Textarea),
      ],
    },
  ],
};

/** Standard EXIF fields, one group. */
const DIGITAL: PresetDef = {
  id: "digital",
  name: "Digital",
  groups: [
    {
      label: "Camera & exposure",
      fields: [
        standard("camera", "Camera", StandardFieldKey.Camera, t.Text),
        standard("lens", "Lens", StandardFieldKey.Lens, t.Text),
        standard("iso", "ISO", StandardFieldKey.Iso, t.Number),
        standard("shutter", "Shutter", StandardFieldKey.Shutter, t.Text),
        standard("aperture", "Aperture", StandardFieldKey.Aperture, t.Number),
        standard("focal", "Focal length", StandardFieldKey.Focal, t.Number),
        standard("date", "Date", StandardFieldKey.Date, t.Date),
      ],
    },
  ],
};

export const BUILTIN_PRESETS: PresetDef[] = [FILM, DIGITAL];

export function getPreset(id: string): PresetDef | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}
