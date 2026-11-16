import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { AwsClient } from "aws4fetch";
import { db, expect, test, uiLogin } from "./helpers/fixtures";

/**
 * Opt-in (B2_BROWSER=1, with playwright.b2.config.ts). A REAL browser upload through the real page to the real private bucket:
 * this is the only thing that proves the bucket's CORS rule works. Nothing here prints a key, URL or secret.
 */
test.skip(!process.env.B2_BROWSER, "real-bucket browser test; run with playwright.b2.config.ts");

/** Read lazily, only when the test really runs: this file is loaded by every Playwright run (including CI, where .env.storage does not exist). */
function makeCtx() {
  const env = dotenv.parse(readFileSync(".env.storage"));
  const endpoint = env.S3_ENDPOINT.replace(/\/+$/, "");
  const region = env.S3_REGION || /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(new URL(endpoint).hostname)![1];
  const client = new AwsClient({ accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, service: "s3", region, retries: 2 });
  return { env, endpoint, client, base: `${endpoint}/${env.S3_BUCKET}` };
}
let cached: ReturnType<typeof makeCtx> | null = null;
const b2 = () => (cached ??= makeCtx());
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n% real browser upload test\n");

const head = async (key: string) => (await b2().client.fetch(`${b2().base}/${key}`, { method: "HEAD", signal: AbortSignal.timeout(30_000) })).status;
const versionCount = async (key: string) => {
  const r = await b2().client.fetch(`${b2().base}?versions&prefix=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(30_000) });
  return [...(await r.text()).matchAll(/<(Version|DeleteMarker)>/g)].length;
};
const purge = async (key: string) => {
  // test hygiene only: delete every version of exactly this test object
  const xml = await (await b2().client.fetch(`${b2().base}?versions&prefix=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(30_000) })).text();
  for (const m of xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)) {
    const k = /<Key>([^<]+)<\/Key>/.exec(m[2])?.[1], v = /<VersionId>([^<]+)<\/VersionId>/.exec(m[2])?.[1];
    if (k === key && v) await b2().client.fetch(`${b2().base}/${k}?versionId=${encodeURIComponent(v)}`, { method: "DELETE" });
  }
};

/** Raw requests to the bucket get a hard timeout, so a stalled connection fails loudly instead of consuming the whole test budget. */
const tfetch = (input: string | URL, init: RequestInit = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });

test("a real browser uploads to the private bucket; the attached object is immutable; downloads redirect; the outbox deletes every version", async ({ page, users, request }) => {
  const organizer = await users.create({ roles: ["ORGANIZER"] });
  const owner = await users.create({ fullName: "B2 Browser Tester" });
  const stranger = await users.create({ fullName: "B2 Stranger" });
  const now = Date.now();
  const event = await db().event.create({
    data: {
      slug: `e2e-b2-${randomUUID().slice(0, 8)}`, title: "E2E B2 browser upload", category: "HACKATHON", summary: "Real bucket browser test.", description: "Real bucket browser test.", status: "PUBLISHED", createdById: organizer.id,
      organizers: { create: { userId: organizer.id, isLead: true } }, registrationOpensAt: new Date(now - 86_400_000), registrationClosesAt: new Date(now + 5 * 86_400_000),
      startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 8 * 86_400_000), submissionDeadline: new Date(now + 7 * 86_400_000), capacity: 10,
    },
  });
  await db().registration.create({ data: { eventId: event.id, userId: owner.id, status: "CONFIRMED" } });

  const problems: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|CORS|Access-Control|Refused to/i.test(m.text())) problems.push(m.text().replace(/https?:\/\/\S+/g, "<url>").slice(0, 160)); });
  let key = "";
  let tempKey = "";
  let putUrl = ""; // the signed upload URL the page used (kept in memory only, never printed)
  page.on("request", (r) => { if (r.method() === "PUT" && new URL(r.url()).hostname === new URL(b2().endpoint).hostname) putUrl = r.url(); });
  try {
    await uiLogin(page, owner, `/events/${event.slug}/submission`);
    await page.locator('input[type="file"]').setInputFiles({ name: "b2-browser-test.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload file" }).click();
    // If CORS is missing or wrong this shows "The file could not be sent to storage" (the browser blocks the PUT).
    const failure = page.getByRole("alert").filter({ hasText: /storage|upload failed|refused/i });
    await Promise.race([
      expect(page.getByText("File uploaded.")).toBeVisible({ timeout: 60_000 }),
      failure.waitFor({ timeout: 60_000 }).then(() => { throw new Error(`The browser upload failed (${problems.join(" | ") || "no console detail"}). The bucket's CORS rule is missing or does not allow this origin.`); }),
    ]);
    const file = await db().submissionFile.findFirstOrThrow({ where: { submission: { eventId: event.id } }, include: { submission: true } });
    key = file.storageKey;
    expect(key).toMatch(/^submissions\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    expect(file.sizeBytes).toBe(PDF.length);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await head(key)).toBe(200); // the object really is in the real bucket
    expect((await db().pendingUpload.findFirstOrThrow({ where: { ownerId: owner.id } })).status).toBe("COMPLETED");
    expect(problems, "no CSP or CORS console errors").toEqual([]);

    // privacy: an unsigned request to the bucket is refused, and a stranger cannot get a download link
    expect([401, 403]).toContain((await tfetch(`${b2().base}/${key}`)).status);
    const downloadPath = `/api/v1/submissions/${file.submissionId}/files/${file.id}`;
    await page.context().clearCookies(); // /login redirects a signed-in user away, so end the owner session first
    await uiLogin(page, stranger, "/dashboard");
    await page.waitForURL(/\/dashboard/);
    expect((await page.request.get(downloadPath, { maxRedirects: 0 })).status()).toBe(404);

    // the owner is redirected (307) to a short-lived signed URL on the bucket host that forces a download
    await page.context().clearCookies();
    await uiLogin(page, owner, "/dashboard");
    await page.waitForURL(/\/dashboard/);
    const redirect = await page.request.get(downloadPath, { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    const location = new URL(redirect.headers()["location"]);
    expect(location.hostname).toBe(new URL(b2().endpoint).hostname);
    expect(location.searchParams.get("X-Amz-Expires")).toBe("60");
    const dl = await tfetch(location);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition") ?? "").toMatch(/^attachment/);
    expect(Buffer.from(await dl.arrayBuffer()).equals(PDF)).toBe(true);
    expect(redirect.headers()["cache-control"]).toMatch(/no-store/);

    // IMMUTABLE OBJECT: the browser's signed upload URL is still valid, so tamper with the temporary object through it, exactly as a
    // malicious user could. The attached permanent object must not change.
    expect(putUrl).not.toBe("");
    tempKey = decodeURIComponent(new URL(putUrl).pathname.replace(`/${b2().env.S3_BUCKET}/`, ""));
    expect(tempKey).toMatch(/^incoming\//);
    expect(tempKey).not.toBe(key); // the attached key is a different, permanent key
    const evil = Buffer.from(PDF.toString("latin1").replace("browser upload test", "TAMPERED upload ok!")); // same length, still a PDF
    expect(evil.length).toBe(PDF.length);
    expect((await tfetch(putUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: evil })).status).toBe(200); // the URL still accepts a PUT
    expect((await versionCount(tempKey)) >= 2).toBe(true);
    const again = await page.request.get(downloadPath, { maxRedirects: 0 });
    const redownload = await tfetch(new URL(again.headers()["location"]));
    expect(Buffer.from(await redownload.arrayBuffer()).equals(PDF)).toBe(true); // the attached file still serves the validated bytes

    // maintenance: the temporary object is deleted (with every version) by the protected endpoint once its URL has expired
    await db().$executeRaw`UPDATE storage_deletions SET next_attempt_at = now() WHERE storage_key = ${tempKey}`; // fast-forward the 17-minute delay
    expect((await request.post("/api/v1/internal/cleanup", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
    expect(await head(tempKey)).toBe(200); // an unauthorized call deleted nothing
    const run = await request.post("/api/v1/internal/cleanup", { headers: { Authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
    expect(run.status()).toBe(200);
    await expect.poll(() => head(tempKey), { timeout: 60_000 }).toBe(404);
    await expect.poll(() => versionCount(tempKey), { timeout: 60_000 }).toBe(0);
    expect(await head(key)).toBe(200); // the permanent object is untouched by the cleanup

    // deleting the file in the page queues the object (database trigger) and removes it with every version
    page.on("dialog", (d) => void d.accept());
    await page.goto(`/events/${event.slug}/submission`);
    await page.getByRole("button", { name: "Remove" }).first().click();
    await expect.poll(() => head(key), { timeout: 60_000 }).toBe(404);
    await expect.poll(() => versionCount(key), { timeout: 60_000 }).toBe(0); // no old version or hide marker left using storage
    await expect.poll(() => db().storageDeletion.count({ where: { storageKey: key } }), { timeout: 30_000 }).toBe(0);
    expect(await db().submissionFile.count({ where: { storageKey: key } })).toBe(0);
  } finally {
    if (key) await purge(key); // hygiene if the test failed half way: only this test's objects
    if (tempKey) await purge(tempKey);
    await db().storageDeletion.deleteMany({ where: { storageKey: { in: [key || "none", tempKey || "none"] } } });
    await db().pendingUpload.deleteMany({ where: { ownerId: owner.id } });
    await db().submission.deleteMany({ where: { eventId: event.id } });
    await db().event.deleteMany({ where: { id: event.id } });
    void request;
  }
});
