export function scaleBrowserInputPoint(
  x: number,
  y: number,
  scale: number,
): { x: number; y: number } {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { x: Math.round(x * factor), y: Math.round(y * factor) };
}
