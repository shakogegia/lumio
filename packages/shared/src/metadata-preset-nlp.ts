import { FieldType, FieldKind } from "./enums.js";
import type { PresetDef } from "./metadata-presets.js";

const t = FieldType;
const custom = (key: string, label: string, type: FieldType = FieldType.Text, options?: string[]) => ({
  key,
  label,
  type,
  kind: FieldKind.Custom,
  ...(options ? { options } : {}),
});

/** Mirrors Negative Lab Pro's film-metadata sections 2–5 (26 fields;
 *  https://www.negativelabpro.com/guide/film-metadata/) plus an intentional
 *  "Roll" field (frames share a roll; matches filmexif:RollID). All custom fields. */
export const NLP_PRESET: PresetDef = {
  id: "nlp",
  name: "Negative Lab Pro",
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
        custom("film-format", "Film Format", t.Choice, ["35mm", "Panoramic", "6×4.5", "6×6", "6×7", "6×9", "4×5", "8×10", "110", "127"]),
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
        custom("scan-method", "Scan Method", t.Choice, ["Digital Camera Scan", "Flatbed Scan", "Dedicated Film Scanner", "Lab Scan"]),
        custom("scan-equipment", "Scan Equipment"),
        custom("light-source", "Light Source"),
        custom("film-holder", "Film Holder"),
        custom("digitization-notes", "Digitization Notes", t.Textarea),
      ],
    },
    {
      label: "Development",
      fields: [
        custom("push-pull", "Push-Pull", t.Choice, ["-5", "-4", "-3", "-2", "-1", "0", "+1", "+2", "+3", "+4", "+5"]),
        custom("developed-at", "Developed At", t.Choice, ["Home", "Lab"]),
        custom("developer", "Developer"),
        custom("dilution", "Dilution"),
        custom("dev-time-temp", "Dev Time / Temp"),
        custom("dev-method", "Dev Method"),
        custom("dev-notes", "Dev Notes", t.Textarea),
      ],
    },
  ],
};
