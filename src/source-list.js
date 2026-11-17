// A source the desk can show: a title, the host, and the link.
// A link is kept only when the text already carried an http(s) URL.
// This module does not look up a page and does not invent a URL.

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/i;

export function safeSourceHref(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (url.username || url.password || !url.hostname) return "";
  return url.href;
}

export function sourceDomain(href) {
  const safe = safeSourceHref(href);
  if (!safe) return "";
  return new URL(safe).hostname.replace(/^www\./i, "").toLowerCase();
}

function clip(value, max) {
  return [...String(value)].slice(0, max).join("");
}

export function sourceView(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const match = URL_IN_TEXT.exec(raw);
  if (!match) return { title: clip(raw, 240), domain: "", href: "" };
  const href = safeSourceHref(match[0].replace(/[.,;:]+$/g, ""));
  const domain = sourceDomain(href);
  let title = raw
    .replace(match[0], " ")
    .replace(/[[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[—–\-:|]+|[—–\-:|]+$/g, "")
    .trim();
  if (!title) title = domain;
  return { title: clip(title, 240), domain, href };
}
