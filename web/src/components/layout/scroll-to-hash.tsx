"use client";

import { useEffect } from "react";

/**
 * Scrolls to the section named in the URL hash once the content that contains it is on the page. The Our Team content streams in after the page
 * shell, so the browser's own fragment scroll can run before the section exists (slow connections); this runs when the sections have mounted.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
