// Prints the size of the production client bundle. Run from `web/` after `npm run build`:  node ../scripts/perf/bundle-report.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { gzipSync } from "node:zlib";

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const root = join(process.cwd(), ".next", "static");
const files = walk(root).filter((f) => /\.(js|css)$/.test(f));
const rows = files.map((f) => { const b = readFileSync(f); return { name: f.slice(root.length + 1).replaceAll("\\", "/"), raw: b.length, gzip: gzipSync(b).length }; });
const sum = (a, k) => a.reduce((n, r) => n + r[k], 0);
const kb = (n) => (n / 1024).toFixed(0);
console.log(`client JS+CSS: ${rows.length} files, ${kb(sum(rows, "raw"))} KB raw, ${kb(sum(rows, "gzip"))} KB gzip (all routes together, not per page)`);
const js = rows.filter((r) => r.name.endsWith(".js"));
const css = rows.filter((r) => r.name.endsWith(".css"));
console.log(`  JS ${kb(sum(js, "gzip"))} KB gzip, CSS ${kb(sum(css, "gzip"))} KB gzip`);
for (const r of [...rows].sort((a, b) => b.gzip - a.gzip).slice(0, 8)) console.log(`  ${r.name.slice(0, 50).padEnd(52)} ${kb(r.raw).padStart(5)} KB raw ${kb(r.gzip).padStart(4)} KB gzip`);
const media = walk(root).filter((f) => !/\.(js|css|map)$/.test(f));
console.log(`media/fonts: ${media.map((f) => `${basename(f)} ${kb(statSync(f).size)} KB`).join(", ")}`);
