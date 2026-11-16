import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" }, // clickjacking: nobody may frame ShadowTrix
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Ignored by browsers over plain http, so it is harmless on localhost and effective behind https.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/**
 * Content-Security-Policy. Everything is restricted to our own origin; nothing external is allowed (no third-party
 * scripts, frames, fonts or images), forms may only post to us, and nobody may frame the site.
 *
 * Honest limit: Next.js needs inline bootstrap scripts, and a nonce-based "strict" policy would force every page to be
 * rendered per request (giving up the static shell). So script-src and style-src allow 'unsafe-inline'. The policy
 * still blocks injected external scripts, data exfiltration to other origins (connect-src), plugins, base-tag and
 * form-action hijacks. A nonce or hash policy is tracked in docs/planning/security-backlog.md.
 */
const isProd = process.env.NODE_ENV === "production";
// Direct uploads: the browser PUTs the file to the object-storage endpoint, so exactly that origin (and nothing else) may be contacted.
let storageOrigin = "";
if (process.env.STORAGE_DRIVER === "s3" && process.env.S3_ENDPOINT) {
  try {
    storageOrigin = ` ${new URL(process.env.S3_ENDPOINT).origin}`;
  } catch {
    /* an invalid S3_ENDPOINT is reported by the environment validation at runtime */
  }
}
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${storageOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  ...(process.env.APP_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
].join("; ");
securityHeaders.push({ key: "Content-Security-Policy", value: csp });

const nextConfig: NextConfig = {
  // Do not advertise the framework in every response.
  poweredByHeader: false,
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Native Argon2 binding must not be bundled.
  serverExternalPackages: ["@node-rs/argon2"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages whose URL carries a single-use token must never leak it through the Referer header.
      {
        source: "/:page(verify-email|reset-password)",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
