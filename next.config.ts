import type { NextConfig } from "next";

/**
 * Content Security Policy. PRD §11 task 3 — A+ on securityheaders.com.
 *
 *   - 'self' for everything by default.
 *   - script-src: 'self' + 'unsafe-inline' for Next.js hydration markers
 *     (would tighten with nonces in a future hardening pass; nonce
 *     support requires moving CSP to proxy.ts so each render gets a
 *     fresh nonce — out of scope for v1).
 *   - style-src: 'self' + 'unsafe-inline' for Tailwind / shadcn inline
 *     style attributes.
 *   - img-src: data: blob: for embedded photo previews + signature
 *     captures, plus storage origins.
 *   - connect-src: 'self' for Server Actions; storage origin so the
 *     browser can PUT directly to S3-presigned URLs.
 *   - frame-ancestors 'none' makes this site un-embeddable.
 *   - form-action 'self' restricts where forms POST.
 */
const cspDirectives: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'", "https:"],
  "object-src": ["'self'", "blob:"],
  "frame-src": ["'self'", "blob:"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "base-uri": ["'self'"],
  "manifest-src": ["'self'"],
  "worker-src": ["'self'", "blob:"],
  "media-src": ["'self'", "blob:"],
  "upgrade-insecure-requests": [],
};

const csp = Object.entries(cspDirectives)
  .map(([k, v]) => (v.length === 0 ? k : `${k} ${v.join(" ")}`))
  .join("; ");

const securityHeaders = [
  // PRD §11: A+ baseline.
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=(self)",
      "geolocation=(self)",
      "microphone=()",
      "payment=()",
      "usb=()",
      "fullscreen=(self)",
    ].join(", "),
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Allow embedded PDF viewer + storage iframes.
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Output a self-contained `.next/standalone/` bundle so the Docker
  // image only needs `node` + the standalone tree (no node_modules
  // copy at runtime). PRD §13.
  output: "standalone",

  async headers() {
    return [
      {
        // Apply to every route.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
