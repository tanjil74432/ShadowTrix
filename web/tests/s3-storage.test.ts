import { describe, expect, it } from "vitest";
import { createS3Storage, regionFromEndpoint, S3Error } from "@/server/storage/s3-storage";

const SECRET = "SUPER-SECRET-APPLICATION-KEY-1234567890";
const KEY_ID = "0051234567890abcdef0000000001";

function fakeNetwork(handler: (req: Request) => Response | Promise<Response>) {
  const seen: Request[] = [];
  const fetchFn = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    seen.push(req.clone());
    return handler(req);
  }) as typeof fetch;
  return { seen, fetchFn };
}

const cfg = (fetchFn: typeof fetch) => ({
  endpoint: "https://s3.us-west-004.backblazeb2.com/", region: "us-west-004", bucket: "shadowtrix-storage", accessKeyId: KEY_ID, secretAccessKey: SECRET, fetch: fetchFn,
});
const KEY = "submissions/0194c0de-0000-7000-8000-000000000001/0194c0de-0000-7000-8000-000000000002";

describe("S3 driver: signed requests", () => {
  it("uses path-style URLs and signs every request with SigV4 without leaking the secret", async () => {
    const net = fakeNetwork(() => new Response(null, { status: 200 }));
    const s = createS3Storage(cfg(net.fetchFn));
    await s.put(KEY, new Uint8Array([1, 2, 3]));
    const req = net.seen[0];
    expect(req.method).toBe("PUT");
    expect(req.url).toBe(`https://s3.us-west-004.backblazeb2.com/shadowtrix-storage/${KEY}`);
    const auth = req.headers.get("authorization") ?? "";
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=0051234567890abcdef0000000001\/\d{8}\/us-west-004\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/);
    expect(auth).not.toContain(SECRET);
    expect(req.url).not.toContain(SECRET);
    expect(await req.arrayBuffer()).toHaveProperty("byteLength", 3);
  });

  it("get returns bytes, and null for a missing object; remove tolerates a missing object", async () => {
    let status = 200;
    const net = fakeNetwork((req) => {
      if (new URL(req.url).searchParams.has("versions")) return new Response("<ListVersionsResult></ListVersionsResult>"); // a missing key lists as empty
      return status === 200 ? new Response(new Uint8Array([9, 8, 7])) : new Response("<Error><Code>NoSuchKey</Code></Error>", { status });
    });
    const s = createS3Storage(cfg(net.fetchFn));
    expect([...(await s.get(KEY))!.bytes]).toEqual([9, 8, 7]);
    status = 404;
    expect(await s.get(KEY)).toBeNull();
    await expect(s.remove(KEY)).resolves.toBeUndefined();
    expect(net.seen.map((r) => r.method)).toEqual(["GET", "GET", "GET"]); // two reads, then remove lists the (empty) versions and has nothing to delete
  });

  it("errors carry the status and S3 code only: no URL, no key, no secret", async () => {
    const net = fakeNetwork(() => new Response(`<Error><Code>AccessDenied</Code><Message>${KEY} ${SECRET}</Message></Error>`, { status: 403 }));
    const s = createS3Storage(cfg(net.fetchFn));
    const err = await s.get(KEY).catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err.message).toBe("S3 get failed (HTTP 403, AccessDenied)");
    expect(String(err.message) + String(err.stack)).not.toContain(SECRET);
  });

  it("head reports the object size or null", async () => {
    let code = 200;
    const net = fakeNetwork(() => new Response(null, { status: code, headers: { "content-length": "1234" } }));
    const s = createS3Storage(cfg(net.fetchFn));
    expect(await s.direct!.head(KEY)).toEqual({ size: 1234 });
    code = 404;
    expect(await s.direct!.head(KEY)).toBeNull();
  });

  it("refuses unsafe keys before any network call", async () => {
    const net = fakeNetwork(() => new Response(null));
    const s = createS3Storage(cfg(net.fetchFn));
    for (const bad of ["../etc/passwd", "a/../b", "/abs", "UPPER/case", "a b", "a.b", ""]) {
      await expect(s.put(bad, new Uint8Array([1])), bad).rejects.toThrow("Unsafe storage key");
      await expect(s.direct!.presignGet(bad, { contentType: "text/plain", disposition: "attachment", expiresSeconds: 60 }), bad).rejects.toThrow("Unsafe storage key");
    }
    expect(net.seen).toHaveLength(0);
  });
});

describe("S3 driver: presigned URLs", () => {
  it("the upload URL is bound to the method, key, content type, exact length and an expiry, and carries no secret", async () => {
    const s = createS3Storage(cfg(fakeNetwork(() => new Response(null)).fetchFn));
    const { url, headers } = await s.direct!.presignPut(KEY, { contentType: "application/pdf", size: 4321, expiresSeconds: 900 });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`https://s3.us-west-004.backblazeb2.com/shadowtrix-storage/${KEY}`);
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get("X-Amz-Credential")).toContain(KEY_ID);
    const signed = (u.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signed).toEqual(expect.arrayContaining(["host", "content-type", "content-length"]));
    expect(url).not.toContain(SECRET);
    expect(headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("the download URL forces an attachment with the stored type and expires", async () => {
    const s = createS3Storage(cfg(fakeNetwork(() => new Response(null)).fetchFn));
    const url = await s.direct!.presignGet(KEY, { contentType: "application/pdf", disposition: 'attachment; filename="a.pdf"', expiresSeconds: 60 });
    const u = new URL(url);
    expect(u.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(u.searchParams.get("response-content-disposition")).toBe('attachment; filename="a.pdf"');
    expect(u.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toContain(SECRET);
  });

  it("different parameters give different signatures (the signature really covers them)", async () => {
    const s = createS3Storage(cfg(fakeNetwork(() => new Response(null)).fetchFn));
    const sig = async (size: number) => new URL((await s.direct!.presignPut(KEY, { contentType: "application/pdf", size, expiresSeconds: 900 })).url).searchParams.get("X-Amz-Signature");
    expect(await sig(100)).not.toBe(await sig(101));
  });
});

describe("endpoint helpers", () => {
  it("reads the region from a Backblaze endpoint", () => {
    expect(regionFromEndpoint("https://s3.us-west-004.backblazeb2.com")).toBe("us-west-004");
    expect(regionFromEndpoint("https://s3.eu-central-003.backblazeb2.com/")).toBe("eu-central-003");
    expect(regionFromEndpoint("https://example.r2.cloudflarestorage.com")).toBeNull();
  });
});

/** A fake versioned bucket that behaves like Backblaze B2: a plain DELETE only adds a "hide" marker; data goes only when its versionId is deleted. */
function versionedBucket() {
  const store = new Map<string, { versionId: string; marker: boolean }[]>();
  let n = 0;
  const deletes: string[] = [];
  const handler = (req: Request) => {
    const u = new URL(req.url);
    const key = u.pathname.replace(/^\/shadowtrix-storage\/?/, "");
    if (req.method === "GET" && u.searchParams.has("versions")) {
      const prefix = u.searchParams.get("prefix") ?? "";
      const xml = [...store.entries()].filter(([k]) => k.startsWith(prefix)).flatMap(([k, vs]) =>
        vs.map((v) => `<${v.marker ? "DeleteMarker" : "Version"}><Key>${k}</Key><VersionId>${v.versionId}</VersionId></${v.marker ? "DeleteMarker" : "Version"}>`)).join("");
      return new Response(`<ListVersionsResult>${xml}</ListVersionsResult>`);
    }
    if (req.method === "PUT") { (store.get(key) ?? store.set(key, []).get(key)!).unshift({ versionId: `v${++n}`, marker: false }); return new Response(null); }
    if (req.method === "DELETE") {
      const vid = u.searchParams.get("versionId");
      deletes.push(`${key}${vid ? `?versionId=${vid}` : ""}`);
      const vs = store.get(key);
      if (!vid) { (vs ?? store.set(key, []).get(key)!).unshift({ versionId: `m${++n}`, marker: true }); return new Response(null, { status: 204 }); }
      if (!vs?.some((v) => v.versionId === vid)) return new Response(null, { status: 404 });
      store.set(key, vs.filter((v) => v.versionId !== vid));
      if (!store.get(key)!.length) store.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  return { store, deletes, handler };
}

describe("S3 driver: Backblaze file versions", () => {
  it("remove deletes every version and hide marker of the key, so no data is left using storage", async () => {
    const b = versionedBucket();
    const s = createS3Storage(cfg(fakeNetwork(b.handler).fetchFn));
    await s.put(KEY, new Uint8Array([1]));
    await s.put(KEY, new Uint8Array([2])); // overwritten: two versions
    b.store.get(KEY)!.unshift({ versionId: "mX", marker: true }); // already hidden once
    expect(b.store.get(KEY)).toHaveLength(3);
    await s.remove(KEY);
    expect(b.store.has(KEY)).toBe(false);
    expect(b.deletes.every((d) => d.includes("versionId="))).toBe(true); // never a plain DELETE (which would only hide)
    expect(b.deletes).toHaveLength(3);
  });

  it("deletes only the exact key: a longer key sharing the prefix is untouched", async () => {
    const b = versionedBucket();
    const s = createS3Storage(cfg(fakeNetwork(b.handler).fetchFn));
    const other = `${KEY}0`;
    await s.put(KEY, new Uint8Array([1]));
    b.store.set(other, [{ versionId: "keepme", marker: false }]);
    await s.remove(KEY);
    expect(b.store.has(KEY)).toBe(false);
    expect(b.store.get(other)).toEqual([{ versionId: "keepme", marker: false }]);
  });

  it("removing a key that has no versions is a no-op, and repeating it is harmless", async () => {
    const b = versionedBucket();
    const s = createS3Storage(cfg(fakeNetwork(b.handler).fetchFn));
    await s.remove(KEY);
    await s.remove(KEY);
    expect(b.deletes).toHaveLength(0);
  });

  it("falls back to a plain DELETE when the key may not list versions (HTTP 403 on the listing)", async () => {
    const seen: string[] = [];
    const net = fakeNetwork((req) => {
      seen.push(`${req.method} ${new URL(req.url).search ? "list" : "object"}`);
      return req.method === "GET" ? new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }) : new Response(null, { status: 204 });
    });
    await createS3Storage(cfg(net.fetchFn)).remove(KEY);
    expect(seen).toEqual(["GET list", "DELETE object"]);
  });

  it("a failing version delete surfaces as an error (so the cleanup job retries it)", async () => {
    const b = versionedBucket();
    const net = fakeNetwork((req) => (req.method === "DELETE" ? new Response("<Error><Code>InternalError</Code></Error>", { status: 500 }) : b.handler(req)));
    const s = createS3Storage(cfg(net.fetchFn));
    b.store.set(KEY, [{ versionId: "v1", marker: false }]);
    await expect(s.remove(KEY)).rejects.toMatchObject({ status: 500 });
  });
});
