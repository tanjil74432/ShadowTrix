"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { ApiButton } from "@/components/common/api-button";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function PhotoUploader({ memberId, hasPhoto }: { memberId: string; hasPhoto: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose an image first.");
      return;
    }
    const body = new FormData();
    body.set("file", file);
    setPending(true);
    setError(null);
    setDone(false);
    const res = await fetch(`/api/v1/admin/members/${memberId}/photo`, { method: "POST", body, credentials: "same-origin" }).catch(() => null);
    setPending(false);
    if (res?.ok) {
      ref.current?.reset();
      setDone(true);
      router.refresh();
    } else {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "The upload failed.");
    }
  }
  return (
    <div className="space-y-3">
      <form ref={ref} onSubmit={onSubmit} noValidate className="space-y-3" aria-label="Upload a profile photo">
        {error && <FormAlert>{error}</FormAlert>}
        {done && <FormNotice>Photo saved.</FormNotice>}
        <Field label="Profile photo" hint="PNG, WebP or JPEG, up to 2 MB. For the Matrix card use a portrait whose background is already removed (a transparent PNG or WebP); it is shown exactly as uploaded. Shown publicly only when the profile is verified and published.">
          {(p) => <Input {...p} name="file" type="file" accept=".png,.jpg,.jpeg,.webp" className="h-auto py-2" />}
        </Field>
        <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>{pending ? "Uploading" : "Upload photo"}</Button>
      </form>
      {hasPhoto && <ApiButton url={`/api/v1/admin/members/${memberId}/photo`} method="DELETE" variant="ghost" confirm="Remove this photo?">Remove photo</ApiButton>}
    </div>
  );
}
