"use client";

import { useState } from "react";
import type { CardPerson } from "@/components/leadership/leadership-card";
import { Button } from "@/components/ui/button";
import type { LeadershipTemplate, MemberStyle } from "@/lib/leadership/template";

/**
 * "Download template": the Universal Matrix card exactly as the preview shows it, as a 2160 x 2700 px PNG (4:5). The image is made in the browser
 * from the same card component the public pages use (see lib/leadership/export-card), so nothing is sent anywhere. It is loaded only when used.
 */
export function DownloadTemplate({ person, template, style, label = "Download template" }: { person: CardPerson; template: LeadershipTemplate; style?: Partial<MemberStyle> | null; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function download() {
    setBusy(true); setStatus(""); setError("");
    try {
      const { renderLeadershipCardPng, saveBlob, EXPORT_FILENAME, EXPORT_WIDTH, EXPORT_HEIGHT } = await import("@/lib/leadership/export-card");
      const png = await renderLeadershipCardPng({ person, template, style });
      saveBlob(png, EXPORT_FILENAME);
      setStatus(`Downloaded ${EXPORT_FILENAME} (${EXPORT_WIDTH} × ${EXPORT_HEIGHT} px).`);
    } catch {
      setError("The template image could not be created. Try again in an up-to-date Chrome, Edge or Firefox.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="download-template">
      <Button type="button" variant="secondary" onClick={() => void download()} disabled={busy} aria-disabled={busy}>
        {busy ? "Preparing the image" : label}
      </Button>
      <p className="text-xs text-fg-muted">A high-resolution PNG (2160 × 2700 px, 4:5) of the card exactly as shown in the preview, including any changes you have not saved yet.</p>
      <p role="alert" className="min-h-4 text-sm text-danger">{error}</p>
      <p role="status" className="min-h-4 text-sm text-fg-muted">{status}</p>
    </div>
  );
}
