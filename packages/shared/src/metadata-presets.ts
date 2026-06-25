import { FieldType, FieldKind } from "./enums.js";
import { NLP_PRESET } from "./metadata-preset-nlp.js";

export interface PresetField {
  key: string;
  label: string;
  type: FieldType;
  kind: FieldKind;
  /** Set for kind === Standard: which STANDARD_FIELDS entry this field surfaces. */
  builtinKey?: string;
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

export const BUILTIN_PRESETS: PresetDef[] = [NLP_PRESET];

export function getPreset(id: string): PresetDef | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}
