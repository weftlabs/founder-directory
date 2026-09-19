import { inflateSync } from "node:zlib";
import { clipShareText } from "./founder-share";

// Read advance widths from the bundled WOFF, so fitting follows the actual font.
// Only this trusted, local Latin font is accepted; no visitor supplies a font.
function fontMeasure(font: Buffer, size: number) {
  function table(tag: string) {
    for (let i = 0; i < font.readUInt16BE(12); i++) {
      const entry = 44 + i * 20;
      if (font.toString("ascii", entry, entry + 4) !== tag) continue;
      const offset = font.readUInt32BE(entry + 4);
      const length = font.readUInt32BE(entry + 8);
      const bytes = font.subarray(offset, offset + length);
      return length < font.readUInt32BE(entry + 12)
        ? inflateSync(bytes)
        : bytes;
    }
    throw new Error("Missing bundled font table");
  }
  const units = table("head").readUInt16BE(18);
  const count = table("hhea").readUInt16BE(34);
  const metrics = table("hmtx");
  const cmap = table("cmap");
  let mapping: Buffer | undefined;
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    if (cmap.readUInt16BE(offset) === 4) {
      mapping = cmap.subarray(offset);
      break;
    }
  }
  if (!mapping) throw new Error("Unsupported bundled font mapping");
  const map = mapping;
  const segments = map.readUInt16BE(6) / 2;
  const starts = 16 + segments * 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  function width(code: number) {
    for (let i = 0; i < segments; i++) {
      if (
        code > map.readUInt16BE(14 + i * 2) ||
        code < map.readUInt16BE(starts + i * 2)
      )
        continue;
      const delta = map.readInt16BE(deltas + i * 2);
      const range = map.readUInt16BE(ranges + i * 2);
      let glyph = range
        ? map.readUInt16BE(
            ranges +
              i * 2 +
              range +
              2 * (code - map.readUInt16BE(starts + i * 2)),
          )
        : code;
      if (!range || glyph) glyph = (glyph + delta) & 65535;
      // Two pixels per character cover positive kerning; renderer letter spacing
      // is negative. This deliberately overestimates the rendered line width.
      return (
        (metrics.readUInt16BE(Math.min(glyph, count - 1) * 4) / units) * size +
        2
      );
    }
    throw new Error("Unsupported share image character");
  }
  return (value: string) =>
    Array.from(value).reduce((sum, char) => sum + width(char.charCodeAt(0)), 0);
}

export function fitShareRoast(value: string, font: Buffer) {
  const fontSize = 58;
  const lineHeight = fontSize * 1.13;
  const measure = fontMeasure(font, fontSize);
  let remaining = clipShareText(value, 400);
  const lines: string[] = [];
  while (remaining && lines.length < 5) {
    let end = 0;
    while (
      end < remaining.length &&
      measure(remaining.slice(0, end + 1)) <= 1088
    )
      end++;
    if (!end) throw new Error("Share image character cannot fit");
    if (end < remaining.length) {
      const space = remaining.lastIndexOf(" ", end);
      if (space > 0) end = space;
    }
    lines.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  const truncated = remaining.length > 0;
  if (truncated) {
    let last = lines[lines.length - 1];
    while (measure(`${last}...`) > 1088) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}...`;
  }
  return {
    lines,
    truncated,
    fontSize,
    lineHeight,
    lineWidths: lines.map(measure),
  };
}

export function fitShareName(value: string, font: Buffer, fallback: string) {
  const measure = fontMeasure(font, 26);
  const name = clipShareText(value, 200, fallback);
  if (measure(name) <= 535) return name;
  let end = name.length;
  while (end && measure(`${name.slice(0, end).trimEnd()}...`) > 535) end--;
  return `${name.slice(0, end).trimEnd()}...`;
}
