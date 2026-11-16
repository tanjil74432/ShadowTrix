import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export const PLACEHOLDERS = ["name", "event", "team", "project", "rank"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** Returns the placeholders in a template body that are not on the allow-list. */
export function unknownPlaceholders(body: string): string[] {
  return [...body.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1]).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
}

export function fillTemplate(body: string, values: Record<Placeholder, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, key: string) => (key in values ? values[key as Placeholder] : ""));
}

/**
 * The standard PDF fonts only cover WinAnsi (Western European) characters. Anything outside it would make the PDF library
 * throw, so unsupported characters are replaced with "?" instead of failing to issue or download the certificate.
 * (Full Unicode names would need an embedded font; see the known limitations in the documentation.)
 */
export function winAnsiSafe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.replace(/[\r\n\t]+/g, " ")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface CertificateContent {
  heading: string;
  body: string;
  recipientName: string;
  eventTitle: string;
  issuedAt: Date;
  code: string;
  verifyUrl: string;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  revoked?: boolean;
}

/**
 * Renders the certificate as an A4 landscape PDF using pdf-lib (pure JavaScript, no external service). Black and white, the
 * platform's plain look. The document dates are fixed to the issue time so the same certificate always produces the same
 * metadata. The verification code and URL are printed on the page.
 */
export async function renderCertificatePdf(c: CertificateContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${c.heading} - ${c.recipientName}`);
  pdf.setProducer("ShadowTrix");
  pdf.setCreator("ShadowTrix");
  pdf.setCreationDate(c.issuedAt);
  pdf.setModificationDate(c.issuedAt);
  const page = pdf.addPage([841.89, 595.28]);
  const { width, height } = page.getSize();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.05, 0.05);
  const grey = rgb(0.35, 0.35, 0.35);

  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: ink, borderWidth: 2 });
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: grey, borderWidth: 0.5 });

  const center = (text: string, y: number, font: PDFFont, size: number, color = ink) => {
    const t = winAnsiSafe(font, text);
    page.drawText(t, { x: (width - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  };

  center("SHADOWTRIX", height - 90, bold, 14, grey);
  center(c.heading, height - 150, bold, 34);
  center("presented to", height - 195, regular, 13, grey);
  center(c.recipientName, height - 245, bold, 30);
  let y = height - 290;
  for (const line of wrap(regular, winAnsiSafe(regular, c.body), 15, width - 220)) {
    center(line, y, regular, 15);
    y -= 22;
  }
  center(c.eventTitle, y - 10, bold, 16);

  if (c.signatoryName) {
    page.drawLine({ start: { x: width / 2 - 110, y: 118 }, end: { x: width / 2 + 110, y: 118 }, thickness: 0.7, color: ink });
    center(c.signatoryName, 102, bold, 12);
    if (c.signatoryTitle) center(c.signatoryTitle, 88, regular, 10, grey);
  }
  const issued = c.issuedAt.toISOString().slice(0, 10);
  page.drawText(winAnsiSafe(regular, `Issued ${issued}`), { x: 60, y: 62, size: 10, font: regular, color: grey });
  const code = winAnsiSafe(regular, `Certificate ${c.code}  -  verify at ${c.verifyUrl}`);
  page.drawText(code, { x: width - 60 - regular.widthOfTextAtSize(code, 9), y: 62, size: 9, font: regular, color: grey });
  if (c.revoked) {
    page.drawText("REVOKED", { x: width / 2 - 150, y: height / 2 - 20, size: 90, font: bold, color: rgb(0.6, 0.1, 0.1), opacity: 0.35 });
  }
  return pdf.save();
}
