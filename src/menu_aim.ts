import type { Rect } from "./layout";

/** A pointer resting this long short of the target has stopped aiming for it. */
export const aim_ms = 300;

/** The triangle from a row's exit point to the target's left edge. Terminal
 * cells move in whole steps, so the apex sits two columns behind the exit:
 * a first step straight down can count as aiming, a second does not. */
export function aimed(rect: Rect, from: { x: number; y: number }, x: number, y: number): boolean {
  const ax = from.x - 2;
  const ay = from.y;
  const edge = rect.x;
  if (x <= ax || x >= edge) return false;
  const top = (rect.y - ay) * (x - ax);
  const bottom = (rect.y + rect.h - 1 - ay) * (x - ax);
  const slope = (y - ay) * (edge - ax);
  return slope >= top && slope <= bottom;
}
