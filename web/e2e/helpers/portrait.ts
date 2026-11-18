import { crc32, deflateSync } from "node:zlib";

/**
 * A real transparent portrait cut-out, built without any image library: an opaque head and shoulders on a FULLY TRANSPARENT background
 * (RGBA PNG, colour type 6). The head is centred horizontally at 30% of the height, so tests can probe known opaque and transparent pixels.
 */
export const PORTRAIT = { w: 240, h: 300, head: { x: 0.5, y: 0.3 }, corner: { x: 2, y: 2 } };

export function portraitPng(): Buffer {
  const { w, h } = PORTRAIT;
  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      const o = 1 + x * 4;
      let px: [number, number, number, number] = [0, 0, 0, 0];
      if (inEllipse(x, y, w * 0.5, h * 1.02, w * 0.46, h * 0.4)) px = [42, 47, 59, 255];
      if (inEllipse(x, y, w * 0.5, h * 0.3, w * 0.2, h * 0.17)) px = [224, 176, 140, 255];
      row[o] = px[0]; row[o + 1] = px[1]; row[o + 2] = px[2]; row[o + 3] = px[3];
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
