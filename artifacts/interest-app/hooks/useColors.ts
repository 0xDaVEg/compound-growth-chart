import colors from "@/constants/colors";

/**
 * Returns the design tokens for the light palette.
 *
 * The dark palette is deliberately ignored so the app always renders
 * with a white background, matching the original design.
 */
export function useColors() {
  return { ...colors.light, radius: colors.radius };
}
