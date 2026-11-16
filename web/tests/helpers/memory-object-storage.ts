import type { Storage } from "@/server/storage/storage";

/** In-memory object store with the direct-access capability. Records what was signed; nothing leaves the process. */
export function memoryObjectStorage() {
  const objects = new Map<string, Uint8Array>();
  const signed: { key: string; contentType: string; size: number }[] = [];
  const removed: string[] = [];
  const control = { failRemoveTimes: 0, failPutTimes: 0, onPut: null as null | ((key: string) => Promise<void>) };
  const storage: Storage = {
    async put(key, bytes) {
      if (control.onPut) await control.onPut(key);
      if (control.failPutTimes > 0) { control.failPutTimes--; throw new Error("simulated storage outage"); }
      objects.set(key, bytes);
    },
    async get(key) { const b = objects.get(key); return b ? { bytes: b } : null; },
    async remove(key) {
      if (control.failRemoveTimes > 0) { control.failRemoveTimes--; throw new Error("simulated storage outage"); }
      removed.push(key);
      objects.delete(key);
    },
    direct: {
      async head(key) { const b = objects.get(key); return b ? { size: b.length } : null; },
      async presignPut(key, o) { signed.push({ key, contentType: o.contentType, size: o.size }); return { url: `https://bucket.invalid/${key}?sig=fake`, headers: { "Content-Type": o.contentType } }; },
      async presignGet(key, o) { return `https://bucket.invalid/${key}?get=1&exp=${o.expiresSeconds}&d=${encodeURIComponent(o.disposition)}`; },
    },
  };
  return { storage, objects, signed, removed, control };
}
