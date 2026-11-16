/**
 * Live self-test of the S3 driver against the real private bucket. Run from web/:
 *   npx tsx --conditions=react-server scripts/b2-selftest.mts
 * Reads web/.env.storage (git-ignored). Creates objects ONLY under the prefix selftest/<random>/, never touches anything else,
 * and deletes every version of exactly those objects at the end. Never prints keys, URLs or secrets.
 */
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { AwsClient } from "aws4fetch";
import { createS3Storage, regionFromEndpoint } from "../src/server/storage/s3-storage";

dotenv.config({ path: ".env.storage", quiet: true });
const { S3_ENDPOINT: endpoint, S3_REGION, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: keyId, S3_SECRET_ACCESS_KEY: secret } = process.env;
const present = (v?: string) => (v ? "set" : "MISSING");
console.log(`config: endpoint ${present(endpoint)} | bucket ${bucket ?? "MISSING"} | key id ${present(keyId)} | application key ${present(secret)}`);
if (!endpoint || !bucket || !keyId || !secret) {
  console.error("STOP: fill S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in web/.env.storage first.");
  process.exit(1);
}
const region = S3_REGION || regionFromEndpoint(endpoint);
if (!region) {
  console.error("STOP: S3_REGION is empty and cannot be read from the endpoint.");
  process.exit(1);
}
console.log(`endpoint host: ${new URL(endpoint).hostname} | region: ${region}`);

const storage = createS3Storage({ endpoint, region, bucket, accessKeyId: keyId, secretAccessKey: secret });
const direct = storage.direct!;
const raw = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: "s3", region });
const base = `${endpoint.replace(/\/+$/, "")}/${bucket}`;
const prefix = `selftest/${randomUUID()}`;
const results: [string, boolean, string?][] = [];
const record = (name: string, ok: boolean, note?: string) => { results.push([name, ok, note]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`); };
const text = (s: string) => new TextEncoder().encode(s);

async function purge() {
  // Remove every version and delete marker of the self-test prefix, and nothing else.
  const list = await raw.fetch(`${base}?versions&prefix=${encodeURIComponent(prefix)}`);
  const xml = await list.text();
  const items = [...xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    key: /<Key>([^<]+)<\/Key>/.exec(m[2])?.[1], version: /<VersionId>([^<]+)<\/VersionId>/.exec(m[2])?.[1],
  }));
  let removed = 0;
  for (const it of items) {
    if (!it.key || !it.version || !it.key.startsWith(prefix)) continue; // hard guard: only the test prefix
    const r = await raw.fetch(`${base}/${it.key}?versionId=${encodeURIComponent(it.version)}`, { method: "DELETE" });
    if (r.ok || r.status === 404) removed++;
  }
  return { found: items.length, removed, listStatus: list.status };
}

try {
  // 1. server-side put / get / head
  const a = `${prefix}/a`;
  await storage.put(a, text("hello shadowtrix"));
  const got = await storage.get(a);
  record("put + get round trip", !!got && new TextDecoder().decode(got.bytes) === "hello shadowtrix");
  record("head reports the size", (await direct.head(a))?.size === 16);
  record("head of a missing key is null", (await direct.head(`${prefix}/missing`)) === null);
  record("get of a missing key is null", (await storage.get(`${prefix}/missing`)) === null);

  // 2. the bucket is private: an unsigned request is refused
  const anon = await fetch(`${base}/${a}`);
  record("unsigned request is refused (bucket is private)", anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`);

  // 3. signed download: forced attachment, content type override
  const dl = await direct.presignGet(a, { contentType: "text/plain", disposition: 'attachment; filename="note.txt"', expiresSeconds: 60 });
  const dlRes = await fetch(dl);
  record("signed GET downloads the object", dlRes.ok && (await dlRes.text()) === "hello shadowtrix", `HTTP ${dlRes.status}`);
  record("signed GET forces attachment", (dlRes.headers.get("content-disposition") ?? "").startsWith("attachment"), dlRes.headers.get("content-disposition") ? "header present" : "header missing");

  // 4. signed upload: exact size and type
  const body = text("%PDF-1.7 selftest file");
  const b = `${prefix}/b`;
  const up = await direct.presignPut(b, { contentType: "application/pdf", size: body.length, expiresSeconds: 120 });
  const ok = await fetch(up.url, { method: "PUT", headers: up.headers, body });
  record("signed PUT accepts the exact size and type", ok.ok, `HTTP ${ok.status}`);
  record("uploaded object has the right size", (await direct.head(b))?.size === body.length);

  // 5. the signature must refuse a different size, a different type, a different key
  const c = `${prefix}/c`;
  const up2 = await direct.presignPut(c, { contentType: "application/pdf", size: body.length, expiresSeconds: 120 });
  const tooBig = await fetch(up2.url, { method: "PUT", headers: up2.headers, body: text("x".repeat(body.length + 50)) });
  record("signed PUT refuses a longer body", !tooBig.ok, `HTTP ${tooBig.status}`);
  const wrongType = await fetch(up2.url, { method: "PUT", headers: { "Content-Type": "text/html" }, body });
  record("signed PUT refuses a different content type", !wrongType.ok, `HTTP ${wrongType.status}`);
  const otherKey = await fetch(up2.url.replace(`${prefix}/c`, `${prefix}/d`), { method: "PUT", headers: up2.headers, body });
  record("signed PUT cannot be reused for another key", !otherKey.ok, `HTTP ${otherKey.status}`);

  // 6. browser access: CORS preflight from the app origins
  for (const origin of ["https://shadowtrix.vercel.app", "http://localhost:3010"]) {
    const pre = await fetch(up.url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } });
    const allow = pre.headers.get("access-control-allow-origin");
    record(`(advisory) CORS preflight allows ${origin}`, pre.ok && (allow === origin || allow === "*"), `HTTP ${pre.status}, allow-origin ${allow ? "present" : "absent"}`);
  }

  // 7. driver remove (on B2 this hides the file until the lifecycle rule or a version delete)
  await storage.remove(b);
  record("remove makes the object unreadable", (await storage.get(b)) === null);
  await storage.remove(`${prefix}/never-existed`);
  record("remove of a missing key is not an error", true);

  // 8. the driver's remove deletes EVERY version and hide marker (Backblaze keeps old versions otherwise)
  const versionsOf = async (k: string) => {
    const r = await raw.fetch(`${base}?versions&prefix=${encodeURIComponent(k)}`);
    return [...(await r.text()).matchAll(/<(Version|DeleteMarker)>/g)].length;
  };
  const v = `${prefix}/v`;
  await storage.put(v, text("first"));
  await storage.put(v, text("second")); // same key twice: two versions
  const before = await versionsOf(v);
  await storage.remove(v);
  const after = await versionsOf(v);
  record("remove deletes every version and marker (nothing left using storage)", before >= 2 && after === 0, `${before} versions before, ${after} after`);
  await storage.remove(v);
  record("repeating remove on a fully deleted key is harmless", (await versionsOf(v)) === 0);
} catch (e) {
  record("unexpected error", false, e instanceof Error ? `${e.message}${(e as { cause?: { code?: string } }).cause?.code ? `, cause ${(e as { cause: { code: string } }).cause.code}` : ""}` : "error");
} finally {
  const p = await purge();
  record("cleanup: every test version removed", p.listStatus === 200 && p.removed === p.found, `${p.removed} of ${p.found} versions/markers, list HTTP ${p.listStatus}`);
}
const failed = results.filter((r) => !r[1] && !r[0].startsWith("(advisory)")); // CORS is configured per site address, after the host is chosen
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
