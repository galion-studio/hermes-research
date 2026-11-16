// Response headers for the research desk. The page is one document with an inline
// style and an inline script, so each response gets its own nonce.

import { randomBytes } from "node:crypto";

import { isLoopback } from "./hermes.js";

const PUBLIC_ORIGINS = new Set(["https://galion.app", "https://www.galion.app"]);

function oneHeader(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name);
  if (!key) return "";
  const value = headers[key];
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : "";
  return value == null ? "" : String(value);
}

export function postOriginAllowed(headers) {
  if (oneHeader(headers, "sec-fetch-site").toLowerCase() === "cross-site") return false;
  const origin = oneHeader(headers, "origin");
  if (!origin) return true;
  if (origin === "null") return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:" && PUBLIC_ORIGINS.has(url.origin)) return true;
  const host = oneHeader(headers, "host");
  if (!host || url.host !== host) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || isLoopback(url.hostname));
}

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
