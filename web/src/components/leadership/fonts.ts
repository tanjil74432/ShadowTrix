import localFont from "next/font/local";

/**
 * The five decorative-typography fonts (see ./fonts/README.md): open-source files kept in the repository and served by the app itself, so no
 * external font service is involved. They are not preloaded: the browser downloads a font file only when a card actually uses that preset.
 * (next/font needs literal options, so each call spells them out.)
 */
const calligraphy = localFont({ src: "./fonts/PinyonScript-Regular.ttf", variable: "--lt-font-calligraphy", weight: "400", display: "swap", preload: false });
const signature = localFont({ src: "./fonts/MrsSaintDelafield-Regular.ttf", variable: "--lt-font-signature", weight: "400", display: "swap", preload: false });
const futuristic = localFont({ src: "./fonts/Orbitron-Variable.ttf", variable: "--lt-font-futuristic", weight: "400 900", display: "swap", preload: false });
const editorial = localFont({ src: "./fonts/DMSerifDisplay-Regular.ttf", variable: "--lt-font-editorial", weight: "400", display: "swap", preload: false });
const matrix = localFont({ src: "./fonts/ShareTechMono-Regular.ttf", variable: "--lt-font-matrix", weight: "400", display: "swap", preload: false });

/** Put this class on any element that renders decorative text (the card does; so do the preset previews). */
export const LEADERSHIP_FONT_CLASS = [calligraphy, signature, futuristic, editorial, matrix].map((f) => f.variable).join(" ");
