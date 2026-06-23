import { useColorScheme } from "react-native";

/**
 * Mobile theme, matched to the web app's design tokens (apps/web globals.css).
 * The web defines its palette in oklch; the values below are those exact tokens
 * converted to hex so React Native (which doesn't parse oklch) renders the same
 * neutrals. Light/dark are switched by the OS color scheme.
 */
export type ThemeColors = {
  /** App background — plain white (light) / black (dark); cards float above it. */
  background: string;
  foreground: string;
  /** Card / row surface that floats above the grouped background. */
  card: string;
  /** Subtle fills (e.g. the protocol-prefix chip). */
  muted: string;
  /** Secondary text: section headers, captions, placeholders. */
  mutedForeground: string;
  /** Hairline separators and input borders. */
  border: string;
  /** Solid accent — primary button fill, switch tint. Flips with the theme. */
  primary: string;
  primaryForeground: string;
  destructive: string;
};

// Background is plain white/black; cards sit above it — delineated by their
// border in light (white card on white) and by being lighter in dark (#171717
// on #000). Remaining neutrals come from the web's globals.css tokens.
const light: ThemeColors = {
  background: "#FFFFFF",
  foreground: "#0A0A0A",
  card: "#F2F2F7",
  muted: "#F5F5F5",
  mutedForeground: "#737373",
  border: "#E5E5E5",
  primary: "#171717",
  primaryForeground: "#FAFAFA",
  destructive: "#E7000A",
};

const dark: ThemeColors = {
  background: "#000000",
  foreground: "#FAFAFA",
  card: "#171717",
  muted: "#262626",
  mutedForeground: "#A1A1A1",
  border: "rgba(255,255,255,0.12)",
  primary: "#E5E5E5",
  primaryForeground: "#171717",
  destructive: "#FF6467",
};

/** Corner radii — web `--radius` is 0.625rem (10px); grouped cards use the
 *  rounder `xl` (iOS inset-grouped feel); buttons are pills (rounded-4xl). */
export const radius = { md: 8, lg: 10, xl: 16, pill: 999 } as const;

// Typography uses the platform's system font (San Francisco on iOS, Roboto on
// Android) — no custom family is set, so weights are all we specify.
export const weight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export type Theme = { colors: ThemeColors; scheme: "light" | "dark" };

export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { colors: scheme === "dark" ? dark : light, scheme };
}
