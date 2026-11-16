import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { assertSafeKey, type Storage } from "./storage";

/** Development driver: files on local disk under one root directory (git-ignored). */
export function createLocalStorage(rootDir: string): Storage {
  const root = resolve(rootDir);
  const pathFor = (key: string) => {
    assertSafeKey(key);
    const full = resolve(root, key);
    // Defence in depth on top of the key allow-list: the resolved path must stay inside the root.
    if (!full.startsWith(root + sep)) throw new Error("Unsafe storage key");
    return full;
  };
  return {
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" });
    },
    async get(key) {
      try {
        return { bytes: new Uint8Array(await readFile(pathFor(key))) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async remove(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
