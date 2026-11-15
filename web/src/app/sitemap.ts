import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/** Only pages with real content are listed. "Coming soon" routes are noindex and excluded. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: site.url, changeFrequency: "weekly", priority: 1 }];
}
