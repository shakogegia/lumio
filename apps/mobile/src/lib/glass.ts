import { Platform } from "react-native";
import { isLiquidGlassAvailable } from "expo-glass-effect";

/**
 * True only where Apple's Liquid Glass material is available (iOS 26+).
 * Gates GlassView usage so every glass element has a solid fallback elsewhere.
 * Evaluated once — availability is fixed for the lifetime of the process.
 */
export const GLASS = Platform.OS === "ios" && isLiquidGlassAvailable();
