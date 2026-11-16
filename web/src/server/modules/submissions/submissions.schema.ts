import { z } from "zod";
import { MAX_FILE_BYTES } from "@/server/storage/file-validation";

const noControl = (v: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(v);

/**
 * Links are only ever displayed (we never fetch them), but they are shown to organizers and judges, so: https only,
 * no embedded credentials, bounded length. `javascript:`, `data:` and `http:` links are rejected.
 */
export const httpsUrl = z
  .string()
  .trim()
  .max(300, "The link is too long.")
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Enter a full link that starts with https://");

const optionalUrl = z.union([httpsUrl, z.literal("").transform(() => null), z.null()]).optional();

/** GitHub (or a similar host) for the repository link. */
const REPO_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"];
const repoUrl = z.union([
  httpsUrl.refine((v) => {
    try {
      return REPO_HOSTS.includes(new URL(v).hostname.replace(/^www\./, ""));
    } catch {
      return false;
    }
  }, "Use a link to GitHub, GitLab, Bitbucket or Codeberg."),
  z.literal("").transform(() => null),
  z.null(),
]).optional();

export const submissionSchema = z.object({
  title: z.string().trim().min(3, "The title must be at least 3 characters.").max(120, "The title must be at most 120 characters.").refine(noControl, "The title contains characters that are not allowed."),
  description: z.string().trim().min(20, "Describe your project in at least 20 characters.").max(5000, "The description must be at most 5000 characters.").refine(noControl, "The description contains characters that are not allowed."),
  repoUrl,
  demoUrl: optionalUrl,
  extraLinks: z.array(httpsUrl).max(5, "At most 5 additional links.").default([]),
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

/** Step 1 of a direct upload: what the browser is about to send. The bytes are checked later, after they are stored. */
export const directUploadSchema = z.object({
  name: z.string().min(1).max(255),
  declaredMime: z.string().max(100).default(""),
  size: z.number().int().positive().max(MAX_FILE_BYTES, "The file is larger than 10 MB."),
});

/** Step 2: the key returned by step 1 plus the original name and type. */
export const completeUploadSchema = z.object({
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(255),
  declaredMime: z.string().max(100).default(""),
});
