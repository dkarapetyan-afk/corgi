//! Fills SVG path data into RGBA pixels, each pixel covered by exactly the
//! area of it the path encloses. Enough of SVG to draw the brand marks tabs
//! wear: every path command, filled by the nonzero rule.
import type { Rgb } from "./palette";

export interface Layer {
  d: string;
  rgb: Rgb;
}
/** Draws `layers` in order, their `view` box (SVG's viewBox: x, y, width,
 * height) fitted and centered in `width` by `height` pixels, as straight
 * RGBA. */
export function rasterize(
  layers: readonly Layer[],
  view: readonly [number, number, number, number],
  width: number,
  height: number,
) {
  const scale = Math.min(width / view[2], height / view[3]),
    dx = (width - view[2] * scale) / 2 - view[0] * scale,
    dy = (height - view[3] * scale) / 2 - view[1] * scale,
    stride = width + 2,
    area = new Float32Array(stride * height),
    paint = new Float32Array(width * height * 4);
  for (const layer of layers) {
    area.fill(0);
    for (const shape of outlines(layer.d, scale))
      for (let i = 0; i < shape.length; i += 2) {
        const j = (i + 2) % shape.length;
        edge(
          area,
          stride,
          height,
          shape[i] * scale + dx,
          shape[i + 1] * scale + dy,
          shape[j] * scale + dx,
          shape[j + 1] * scale + dy,
        );
      }
    for (let row = 0; row < height; row++) {
      let sum = 0;
      for (let col = 0; col < width; col++) {
        sum += area[row * stride + col];
        const cover = Math.min(1, Math.abs(sum)),
          at = (row * width + col) * 4;
        if (cover === 0) continue;
        // Premultiplied, one layer over the last.
        for (let c = 0; c < 3; c++) paint[at + c] = layer.rgb[c] * cover + paint[at + c] * (1 - cover);
        paint[at + 3] = cover + paint[at + 3] * (1 - cover);
      }
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let at = 0; at < out.length; at += 4) {
    const alpha = paint[at + 3];
    if (alpha === 0) continue;
    for (let c = 0; c < 3; c++) out[at + c] = Math.round(paint[at + c] / alpha);
    out[at + 3] = Math.round(alpha * 255);
  }
  return out;
}

const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
class Reader {
  private at = 0;
  constructor(private d: string) {}
  private skip() {
    while (this.at < this.d.length && " \t\r\n,".includes(this.d[this.at])) this.at++;
  }
  done() {
    this.skip();
    return this.at >= this.d.length;
  }
  command(): string | null {
    this.skip();
    const c = this.d[this.at];
    if (!/[a-zA-Z]/.test(c)) return null;
    this.at++;
    return c;
  }
  number(): number {
    this.skip();
    number.lastIndex = this.at;
    const found = number.exec(this.d);
    if (!found) throw Error("InvalidPath");
    this.at += found[0].length;
    return Number(found[0]);
  }
  /** An arc's flag, which needs no separator from what follows it. */
  flag(): boolean {
    this.skip();
    const c = this.d[this.at++];
    if (c !== "0" && c !== "1") throw Error("InvalidPath");
    return c === "1";
  }
}
/** The closed shapes `d` outlines, as flat [x, y, x, y, …] in its own units.
 * Curves are cut finer the larger `scale` draws them. */
export function outlines(d: string, scale: number): number[][] {
  const r = new Reader(d),
    out: number[][] = [];
  let shape: number[] = [],
    x = 0,
    y = 0,
    // Where the shape started, and the last curve's control point.
    start_x = 0,
    start_y = 0,
    control_x = 0,
    control_y = 0,
    command = "",
    last = "";
  const close = () => {
    if (shape.length >= 6) out.push(shape);
    shape = [];
  };
  const to = (next_x: number, next_y: number) => {
    if (!shape.length) shape.push(x, y);
    shape.push(next_x, next_y);
    x = next_x;
    y = next_y;
  };
  const steps = (length: number) => Math.min(48, Math.max(2, Math.ceil((length * scale) / 1.5)));
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const x0 = x,
      y0 = y,
      n = steps(Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2));
    for (let k = 1; k <= n; k++) {
      const t = k / n,
        u = 1 - t;
      to(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      );
    }
    control_x = x2;
    control_y = y2;
  };
  const quadratic = (x1: number, y1: number, x2: number, y2: number) => {
    const x0 = x,
      y0 = y,
      n = steps(Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1));
    for (let k = 1; k <= n; k++) {
      const t = k / n,
        u = 1 - t;
      to(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
    control_x = x1;
    control_y = y1;
  };
  while (!r.done()) {
    const next = r.command();
    if (next) command = next;
    else if (!command || command === "z" || command === "Z") throw Error("InvalidPath");
    const relative = command === command.toLowerCase(),
      ox = relative ? x : 0,
      oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M":
        close();
        x = start_x = ox + r.number();
        y = start_y = oy + r.number();
        // Pairs after a move are lines.
        command = relative ? "l" : "L";
        break;
      case "L":
        to(ox + r.number(), oy + r.number());
        break;
      case "H":
        to(ox + r.number(), y);
        break;
      case "V":
        to(x, oy + r.number());
        break;
      case "C":
        cubic(ox + r.number(), oy + r.number(), ox + r.number(), oy + r.number(), ox + r.number(), oy + r.number());
        break;
      case "S": {
        const smooth = /[CcSs]/.test(last);
        cubic(
          smooth ? 2 * x - control_x : x,
          smooth ? 2 * y - control_y : y,
          ox + r.number(),
          oy + r.number(),
          ox + r.number(),
          oy + r.number(),
        );
        break;
      }
      case "Q":
        quadratic(ox + r.number(), oy + r.number(), ox + r.number(), oy + r.number());
        break;
      case "T": {
        const smooth = /[QqTt]/.test(last);
        quadratic(smooth ? 2 * x - control_x : x, smooth ? 2 * y - control_y : y, ox + r.number(), oy + r.number());
        break;
      }
      case "A": {
        const rx = r.number(),
          ry = r.number(),
          rotation = r.number(),
          large = r.flag(),
          sweep = r.flag();
        arc(x, y, rx, ry, rotation, large, sweep, ox + r.number(), oy + r.number(), scale, to);
        break;
      }
      case "Z":
        close();
        x = start_x;
        y = start_y;
        break;
      default:
        throw Error("InvalidPath");
    }
    last = command;
  }
  close();
  return out;
}
/** An elliptical arc from (x1, y1) to (x2, y2), as SVG's endpoint
 * parameterization describes it, through `to`. */
function arc(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  scale: number,
  to: (x: number, y: number) => void,
) {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return to(x2, y2);
  const phi = (rotation * Math.PI) / 180,
    cos = Math.cos(phi),
    sin = Math.sin(phi),
    hx = (x1 - x2) / 2,
    hy = (y1 - y2) / 2,
    px = cos * hx + sin * hy,
    py = -sin * hx + cos * hy,
    // Radii too small to reach are scaled up until they do.
    grow = Math.sqrt(Math.max(1, (px * px) / (rx * rx) + (py * py) / (ry * ry)));
  rx *= grow;
  ry *= grow;
  const num = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px,
    den = rx * rx * py * py + ry * ry * px * px,
    k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den)),
    cx_ = (k * rx * py) / ry,
    cy_ = (-k * ry * px) / rx,
    cx = cos * cx_ - sin * cy_ + (x1 + x2) / 2,
    cy = sin * cx_ + cos * cy_ + (y1 + y2) / 2,
    angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy),
    theta = angle(1, 0, (px - cx_) / rx, (py - cy_) / ry);
  let delta = angle((px - cx_) / rx, (py - cy_) / ry, (-px - cx_) / rx, (-py - cy_) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const n = Math.min(64, Math.max(2, Math.ceil((Math.abs(delta) * Math.max(rx, ry) * scale) / 1.5)));
  for (let i = 1; i < n; i++) {
    const t = theta + (delta * i) / n,
      ex = rx * Math.cos(t),
      ey = ry * Math.sin(t);
    to(cx + cos * ex - sin * ey, cy + sin * ex + cos * ey);
  }
  to(x2, y2);
}
/** Adds the area right of the edge from (ax, ay) to (bx, by) in each pixel,
 * signed by its direction, to `area` as differences along each row; a running
 * sum along the row then gives each pixel's winding coverage. Rows are
 * `stride` long, two more than the image, so an edge's last cell fits. */
function edge(area: Float32Array, stride: number, height: number, ax: number, ay: number, bx: number, by: number) {
  if (ay === by) return;
  const dir = ay < by ? 1 : -1,
    [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay],
    dxdy = (x1 - x0) / (y1 - y0),
    right = stride - 2,
    clamp = (v: number) => Math.min(right, Math.max(0, v));
  let x = y0 < 0 ? x0 - y0 * dxdy : x0;
  for (let row = Math.max(0, Math.floor(y0)); row < Math.min(height, Math.ceil(y1)); row++) {
    const line = row * stride,
      dy = Math.min(row + 1, y1) - Math.max(row, y0),
      next = x + dxdy * dy,
      d = dy * dir,
      from = clamp(Math.min(x, next)),
      to = clamp(Math.max(x, next)),
      i0 = Math.floor(from),
      i1 = Math.ceil(to);
    if (i1 <= i0 + 1) {
      const mid = (from + to) / 2 - i0;
      area[line + i0] += d - d * mid;
      area[line + i0 + 1] += d * mid;
    } else {
      // The edge crosses several pixels: a triangle in the first and last,
      // even slices between.
      const s = 1 / (to - from),
        f0 = from - i0,
        a0 = 0.5 * s * (1 - f0) * (1 - f0),
        f1 = to - i1 + 1,
        am = 0.5 * s * f1 * f1;
      area[line + i0] += d * a0;
      if (i1 === i0 + 2) area[line + i0 + 1] += d * (1 - a0 - am);
      else {
        const a1 = s * (1.5 - f0);
        area[line + i0 + 1] += d * (a1 - a0);
        for (let i = i0 + 2; i < i1 - 1; i++) area[line + i] += d * s;
        area[line + i1 - 1] += d * (1 - (a1 + (i1 - i0 - 3) * s) - am);
      }
      area[line + i1] += d * am;
    }
    x = next;
  }
}
