import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { LeadershipCard, type CardPerson } from "@/components/leadership/leadership-card";
import type { LeadershipTemplate, MemberStyle } from "@/lib/leadership/template";

/**
 * Turns the Universal Matrix Leadership Template into a high-resolution PNG, in the browser, with no extra library and no server round trip.
 *
 * The image is made from the SAME `LeadershipCard` component that the public pages and the preview use, so the design cannot drift: the card is
 * rendered off-screen at its normal on-screen width, its final layout and styles are copied into a self-contained SVG (together with the fonts and
 * the portrait it uses, embedded as data), and the browser draws that SVG onto a canvas at EXPORT_SCALE times the size. Text, lines and glows are
 * vector, so they are redrawn sharply at the larger size rather than enlarged; only the member's own portrait is limited by its uploaded resolution.
 */
export const EXPORT_BASE_WIDTH = 360; // the card's width in CSS pixels, as in the preview
export const EXPORT_SCALE = 6; // 360 x 6 = 2160 px wide
export const EXPORT_WIDTH = EXPORT_BASE_WIDTH * EXPORT_SCALE; // 2160
export const EXPORT_HEIGHT = (EXPORT_WIDTH * 5) / 4; // 2700: the card is 4:5
export const EXPORT_FILENAME = `shadowtrix-leadership-template-${EXPORT_WIDTH}x${EXPORT_HEIGHT}.png`;

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The file could not be read."));
    r.readAsDataURL(blob);
  });

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`A resource of the card could not be loaded (${res.status}).`);
  return blobToDataUrl(await res.blob());
}

const waitFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** Copies the browser's final, resolved style of every element into the clone, so the SVG needs none of the page's stylesheets. */
function inlineStyles(src: Element, dst: Element, families: Set<string>) {
  const cs = getComputedStyle(src);
  let css = "";
  for (let i = 0; i < cs.length; i++) css += `${cs[i]}:${cs.getPropertyValue(cs[i])};`;
  (dst as HTMLElement).setAttribute("style", css);
  for (const f of cs.fontFamily.split(",")) families.add(f.replace(/["']/g, "").trim());
  for (let i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i], families);
}

/** The @font-face rules of the fonts the card uses, with their font files embedded as data. */
async function embeddedFontCss(families: Set<string>): Promise<string> {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; } // a stylesheet from another origin cannot be read, and the card uses none
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      if (!families.has(family)) continue;
      let text = rule.cssText;
      for (const m of Array.from(text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))) {
        if (m[1].startsWith("data:")) continue;
        text = text.replace(m[0], `url(${await urlToDataUrl(new URL(m[1], sheet.href ?? location.href).href)})`);
      }
      rules.push(text);
    }
  }
  return rules.join("\n");
}

export interface ExportInput {
  person: CardPerson;
  template: LeadershipTemplate;
  style?: Partial<MemberStyle> | null;
}

/** Draws the card to a PNG of EXPORT_WIDTH x EXPORT_HEIGHT pixels. */
export async function renderLeadershipCardPng({ person, template, style }: ExportInput): Promise<Blob> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BASE_WIDTH}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<LeadershipCard person={person} template={template} style={style} eager />));
    const card = host.firstElementChild as HTMLElement | null;
    if (!card) throw new Error("The card could not be drawn.");
    // everything the card shows must be ready before it is copied: fonts, then the portrait
    await document.fonts.ready;
    await Promise.all(Array.from(host.querySelectorAll("img")).map((img) => (img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode())));
    await waitFrame();

    const clone = card.cloneNode(true) as HTMLElement;
    const families = new Set<string>();
    inlineStyles(card, clone, families);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const originals = Array.from(card.querySelectorAll("img"));
    await Promise.all(Array.from(clone.querySelectorAll("img")).map(async (img, i) => {
      img.setAttribute("src", await urlToDataUrl(originals[i].currentSrc || originals[i].src));
      img.removeAttribute("srcset");
      img.removeAttribute("loading");
    }));

    const w = EXPORT_BASE_WIDTH, h = Math.round(card.getBoundingClientRect().height);
    const fonts = await embeddedFontCss(families);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><style><![CDATA[${fonts}]]></style></defs>` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;

    const image = new Image();
    image.decoding = "async";
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_WIDTH;
    canvas.height = EXPORT_HEIGHT;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("This browser cannot draw the image.");
    g.imageSmoothingQuality = "high";
    g.drawImage(image, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The image could not be created.");
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Saves a blob as a file download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
