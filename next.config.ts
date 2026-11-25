import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  // Next.js dev (turbopack) evaluates code at runtime; keep script-src locked
  // down in production and only relax `unsafe-eval` outside of it.
  `script-src 'self'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  // Never allow the CRM to be framed, including by malicious sites.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join(" ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Defense-in-depth against XSS and clickjacking; relaxes only the
          // style/script requirements of Next.js dev tooling.
          { key: "Content-Security-Policy", value: csp },
          // Browsers ignore HSTS over plain HTTP / localhost, so it is safe
          // to emit unconditionally; it enforces HTTPS in production.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
