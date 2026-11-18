import sharp from "sharp";

/** Largest portrait, in pixels (width x height). 16 MP is far above any real portrait yet bounds decoder memory to roughly 64 MB. */
export const MAX_PORTRAIT_PIXELS = 16_000_000;
export const MAX_PORTRAIT_SIDE = 8_000;

export type PortraitFormat = "png" | "jpeg" | "webp";

/**
 * Proves a portrait is a real image of the format its extension claims by fully decoding it, with a hard pixel limit.
 * Nothing is re-encoded: the caller stores the original bytes, so transparency and colour are preserved exactly.
 * Returns a short, safe reason on failure (never the decoder's own message).
 */
export async function verifyPortraitImage(bytes: Uint8Array, expected: PortraitFormat): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const image = sharp(Buffer.from(bytes), { limitInputPixels: MAX_PORTRAIT_PIXELS, failOn: "error", sequentialRead: true, animated: false });
    const meta = await image.metadata();
    if (meta.format !== expected) return { ok: false, reason: "The file content does not match its extension." };
    if (!meta.width || !meta.height) return { ok: false, reason: "The image could not be read." };
    if (meta.width > MAX_PORTRAIT_SIDE || meta.height > MAX_PORTRAIT_SIDE || meta.width * meta.height > MAX_PORTRAIT_PIXELS) return { ok: false, reason: "The image is too large (at most 16 megapixels)." };
    if ((meta.pages ?? 1) > 1) return { ok: false, reason: "Animated images are not allowed." };
    await image.raw().toBuffer(); // decodes every pixel; a truncated or corrupt file throws here
    return { ok: true };
  } catch (e) {
    const limit = e instanceof Error && /pixel limit/i.test(e.message);
    return { ok: false, reason: limit ? "The image is too large (at most 16 megapixels)." : "The file is not a valid image, or it is damaged." };
  }
}
