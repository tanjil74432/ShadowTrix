"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { ApiButton } from "@/components/common/api-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

interface FileRow {
  id: string;
  originalName: string;
  sizeBytes: number;
}

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Private attachments: upload (validated by the server), download through an authorized route, delete while editing is allowed. */
export function FileManager({ eventId, submissionId, files, locked }: { eventId: string; submissionId: string | null; files: FileRow[]; locked: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file first.");
      return;
    }
    setPending(true);
    setError(null);
    setDone(false);
    let failure: string | null;
    try {
      // Object storage: the file goes straight to the private bucket through a signed URL; otherwise through the server.
      const direct = await sendDirect(file);
      failure = direct === "unavailable" ? await sendThroughServer(file) : direct;
    } catch {
      failure = "We could not reach the server. Check your connection and try again.";
    }
    setPending(false);
    if (failure === null) {
      ref.current?.reset();
      setDone(true);
      router.refresh();
    } else {
      setError(failure);
    }
  }

  const base = `/api/v1/events/${eventId}/my-submission/files`;
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  async function apiMessage(res: Response) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return data?.error?.message ?? "The upload failed.";
  }

  async function sendThroughServer(file: File): Promise<string | null> {
    const body = new FormData();
    body.set("file", file);
    const res = await fetch(base, { method: "POST", body, credentials: "same-origin" });
    return res.ok ? null : apiMessage(res);
  }

  /** Returns null on success, an error message, or "unavailable" when this deployment does not use object storage. */
  async function sendDirect(file: File): Promise<string | null> {
    const pre = await fetch(`${base}/presign`, json({ name: file.name, declaredMime: file.type, size: file.size }));
    if (pre.status === 501) return "unavailable";
    if (!pre.ok) return apiMessage(pre);
    const target = (await pre.json()) as { key: string; url: string; headers: Record<string, string> };
    let put: Response;
    try {
      put = await fetch(target.url, { method: "PUT", headers: target.headers, body: file, credentials: "omit", referrerPolicy: "no-referrer" });
    } catch {
      return "The file could not be sent to storage. Check your connection and try again.";
    }
    if (!put.ok) return "Storage refused the file. Try again.";
    const done = await fetch(`${base}/complete`, json({ key: target.key, name: file.name, declaredMime: file.type }));
    return done.ok ? null : apiMessage(done);
  }

  return (
    <div className="space-y-4">
      {files.length === 0 ? (
        <p className="text-fg-muted">No files yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-card">
              <span className="break-all">
                {submissionId ? (
                  <a href={`/api/v1/submissions/${submissionId}/files/${f.id}`} className="font-medium underline underline-offset-4">{f.originalName}</a>
                ) : (
                  f.originalName
                )}{" "}
                <span className="text-sm text-fg-subtle">({size(f.sizeBytes)})</span>
              </span>
              {!locked && (
                <ApiButton url={`/api/v1/events/${eventId}/my-submission/files/${f.id}`} method="DELETE" variant="ghost" confirm={`Remove ${f.originalName}?`}>
                  Remove
                </ApiButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && (
        <form ref={ref} onSubmit={onSubmit} noValidate className="space-y-3" aria-label="Upload a file">
          {error && <FormAlert>{error}</FormAlert>}
          {done && <FormNotice>File uploaded.</FormNotice>}
          <Field label="Add a file" hint="PDF, PNG, JPG, ZIP, TXT or MD. Up to 10 MB each, 5 files, 25 MB in total. Files are private to your team, the organizers and the judges.">
            {(p) => <Input {...p} name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.zip,.txt,.md" className="h-auto py-2" />}
          </Field>
          <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
            {pending ? "Uploading" : "Upload file"}
          </Button>
        </form>
      )}
    </div>
  );
}
