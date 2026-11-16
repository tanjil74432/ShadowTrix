import "server-only";
import { AwsClient } from "aws4fetch";
import { log } from "@/server/logging/logger";
import { assertSafeKey, type Storage } from "./storage";

export interface S3Config {
  /** e.g. https://s3.us-west-004.backblazeb2.com (path-style addressing: <endpoint>/<bucket>/<key>) */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Tests inject a fake network here. */
  fetch?: typeof fetch;
}

/** Backblaze endpoints are s3.<region>.backblazeb2.com; the region is read from the host when it is not configured. */
export function regionFromEndpoint(endpoint: string): string | null {
  return /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(new URL(endpoint).hostname)?.[1] ?? null;
}

/** An error that carries the HTTP status and the S3 error code only: never a URL, a header or any credential. */
export class S3Error extends Error {
  constructor(public readonly op: string, public readonly status: number, public readonly code: string | null) {
    super(`S3 ${op} failed (HTTP ${status}${code ? `, ${code}` : ""})`);
  }
}

async function failure(op: string, res: Response): Promise<S3Error> {
  const body = await res.text().catch(() => "");
  return new S3Error(op, res.status, /<Code>([A-Za-z0-9_]+)<\/Code>/.exec(body)?.[1] ?? null);
}

/**
 * S3-compatible driver (Backblaze B2, Cloudflare R2, MinIO, AWS) over plain signed HTTPS requests. The bucket stays private:
 * the browser only ever gets a short-lived signed URL for ONE key (upload or download), created after the server has
 * authorized the request. Objects are never listed or made public.
 *
 * Note for Backblaze: DeleteObject without a version id "hides" the file. Set the bucket lifecycle rule to
 * "Keep only the last version of the file" so hidden files are really removed (see docs/operations/free-hosting-plan.md).
 */
export function createS3Storage(cfg: S3Config): Storage {
  const base = cfg.endpoint.replace(/\/+$/, "");
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: cfg.region, retries: 2 });

  const urlFor = (key: string) => {
    assertSafeKey(key);
    return `${base}/${cfg.bucket}/${key}`;
  };
  // Real network: aws4fetch signs and retries transient failures (connection resets, 5xx, throttling) with backoff. Tests inject a fake.
  const signedFetch = async (url: string, init: RequestInit) => (cfg.fetch ? cfg.fetch(await client.sign(url, init)) : client.fetch(url, init));
  const presign = async (url: URL, method: string, headers: Record<string, string>, expiresSeconds: number) => {
    url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
    const signed = await client.sign(url.toString(), { method, headers, aws: { signQuery: true, allHeaders: true } });
    return signed.url;
  };

  return {
    async put(key, bytes) {
      // Content-Length is declared explicitly: inside Next.js the patched fetch turns the body into a stream, which is sent without a length,
      // and Backblaze then answers 411 MissingContentLength (found by the real-bucket browser test; invisible with a mock or outside Next).
      const res = await signedFetch(urlFor(key), { method: "PUT", body: bytes as BodyInit, headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.byteLength) } });
      if (!res.ok) throw await failure("put", res);
    },
    async get(key) {
      const res = await signedFetch(urlFor(key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw await failure("get", res);
      return { bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    /**
     * Deletes the object AND every version of it. Backblaze (and versioned S3 buckets) keep old versions: a plain DELETE only adds
     * a "hide" marker and the data keeps using storage. If the key may not list versions, falls back to the plain DELETE.
     * Only entries whose key is exactly `key` are deleted. Missing objects are not an error.
     */
    async remove(key) {
      const url = urlFor(key);
      // A key can have many versions (a signed upload URL may be reused within its validity). Delete a page at a time and list again until
      // none are left; the cap only guards against a store that never converges.
      for (let round = 0; round < 50; round++) {
        const list = await signedFetch(`${base}/${cfg.bucket}?versions&max-keys=100&prefix=${encodeURIComponent(key)}`, { method: "GET" });
        if (list.status === 403) {
          // This credential may not list versions: all that can be done is a plain delete, which only HIDES the file on Backblaze.
          log.warn("storage.remove_hide_only"); // no key, no URL: an operator must give the application key the listFiles capability
          const res = await signedFetch(url, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw await failure("remove", res);
          return;
        }
        if (!list.ok) throw await failure("list-versions", list);
        const xml = await list.text();
        let deleted = 0;
        for (const m of xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)) {
          if (/<Key>([^<]+)<\/Key>/.exec(m[2])?.[1] !== key) continue;
          const versionId = /<VersionId>([^<]+)<\/VersionId>/.exec(m[2])?.[1];
          if (!versionId) continue;
          const res = await signedFetch(`${url}?versionId=${encodeURIComponent(versionId)}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw await failure("remove", res);
          deleted++;
        }
        if (deleted === 0) return; // nothing (more) to delete
      }
      throw new S3Error("remove", 0, "TooManyVersions");
    },
    direct: {
      async head(key) {
        const res = await signedFetch(urlFor(key), { method: "HEAD" });
        if (res.status === 404) return null;
        if (!res.ok) throw new S3Error("head", res.status, null);
        return { size: Number(res.headers.get("content-length")) };
      },
      /** The signature covers the method, the object key, the content type and the exact content length: the browser cannot upload anything else with this URL. */
      async presignPut(key, o) {
        const url = await presign(new URL(urlFor(key)), "PUT", { "Content-Type": o.contentType, "Content-Length": String(o.size) }, o.expiresSeconds);
        return { url, headers: { "Content-Type": o.contentType } };
      },
      async presignGet(key, o) {
        const u = new URL(urlFor(key));
        u.searchParams.set("response-content-type", o.contentType);
        u.searchParams.set("response-content-disposition", o.disposition);
        return presign(u, "GET", {}, o.expiresSeconds);
      },
    },
  };
}
