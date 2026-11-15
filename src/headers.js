// Response headers for the research desk. The page is one document with an inline
// style and an inline script, so each response gets its own nonce.

import { randomBytes } from "node:crypto";

export function newNonce() {
  return randomBytes(16).toString("base64url");
}

export function withNonce(html, nonce) {
  const token = String(nonce);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    throw new Error("nonce");
  }
  return String(html).replaceAll("<style>", `<style nonce="${token}">`).replaceAll("<script>", `<script nonce="${token}">`);
}

export function contentSecurityPolicy(nonce) {
  const token = String(nonce);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${token}'`,
    `style-src 'self' 'nonce-${token}'`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ");
}

export function securityHeaders(nonce) {
  return {
    "Content-Security-Policy": contentSecurityPolicy(nonce),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Cache-Control": "no-store",
  };
}
