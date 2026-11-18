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

/**
 * A more natural transparent cut-out for visual evidence: hair, head, neck, collar and shoulders on a FULLY TRANSPARENT background, 240 x 300
 * (the same size as PORTRAIT). Drawn from SVG by the image library, so it is a real PNG with an alpha channel.
 */
export async function silhouettePng(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300" viewBox="0 0 240 300">
    <defs>
      <linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d3445"/><stop offset="1" stop-color="#171b26"/></linearGradient>
      <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6b894"/><stop offset="1" stop-color="#c98f69"/></linearGradient>
    </defs>
    <path d="M6 300 C6 238 52 214 98 206 L142 206 C188 214 234 238 234 300 Z" fill="url(#cloth)"/>
    <rect x="104" y="170" width="32" height="48" rx="12" fill="#c98f69"/>
    <path d="M98 206 L120 246 L142 206 L128 200 L112 200 Z" fill="#e9edf5"/>
    <path d="M98 206 L120 246 L108 214 Z" fill="#0f1320"/><path d="M142 206 L120 246 L132 214 Z" fill="#0f1320"/>
    <ellipse cx="120" cy="108" rx="40" ry="52" fill="url(#skin)"/>
    <path d="M78 104 C74 52 108 40 124 40 C156 40 170 66 162 104 C158 84 146 70 120 68 C98 68 84 82 78 104 Z" fill="#1d1a19"/>
    <ellipse cx="106" cy="112" rx="3.6" ry="2.6" fill="#2a1d18"/><ellipse cx="134" cy="112" rx="3.6" ry="2.6" fill="#2a1d18"/>
    <path d="M108 138 C116 144 124 144 132 138" fill="none" stroke="#8e5a40" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
