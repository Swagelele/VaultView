/** Golden angle in degrees — successive multiples spread hues maximally around the wheel. */
const GOLDEN_ANGLE = 137.508;

/**
 * Map a slice index to a unique, deterministic, dark-theme-friendly color.
 *
 * Hues step by the golden angle so any number of assets each get a distinct, non-repeating color
 * (no 5-token palette cap). Saturation and lightness are fixed for legibility on the dark surface.
 * Pure and stable: the same index always yields the same color, so a slice and its legend swatch
 * stay in sync when both are colored by their shared index.
 */
export function allocationColor(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `hsl(${hue.toFixed(2)}, 65%, 55%)`;
}
