import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attachmentDisposition,
  contentSecurityPolicy,
  postOriginAllowed,
  securityHeaders,
  uploadContentDisposition,
  withNonce,
} from "../../src/headers.js";
import { BIND_HOST, DEFAULT_PORT, listenTarget, newSessionId, sessionCookie, sessionToken } from "../../src/server.js";

describe("response headers", () => {
  it("builds a nonce policy without inline exceptions", () => {
    const nonce = "abcDEF789_-nonce";
    const csp = contentSecurityPolicy(nonce);
    assert.match(csp, new RegExp(`script-src 'self' 'nonce-${nonce}'`));
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, new RegExp(`style-src 'self' 'nonce-${nonce}'`));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.equal(csp.includes("unsafe-inline"), false);
    assert.equal(csp.includes("unsafe-eval"), false);
    assert.equal(csp.includes("*"), false);
    assert.equal(csp.includes("http:"), false);
    const headers = securityHeaders(nonce);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["Referrer-Policy"], "no-referrer");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
    assert.equal(headers["Cache-Control"], "no-store");
    const html = withNonce("<style>\n</style><script>\n</script>", nonce);
    assert.match(html, new RegExp(`<style nonce="${nonce}">`));
    assert.match(html, new RegExp(`<script nonce="${nonce}">`));
    assert.throws(() => withNonce("<script></script>", "bad nonce"), /nonce/);
  });

  it("attaches a served upload without a type or size gate", () => {
    const dot = attachmentDisposition(".notes");
    assert.match(dot, /^attachment;/);
    assert.equal(dot.includes("inline"), false);
    assert.match(dot, /filename="\.notes"/);
    assert.match(dot, /filename\*=UTF-8''\.notes$/);
    assert.equal(dot.includes("\r"), false);
    assert.equal(dot.includes("\n"), false);

    const html = attachmentDisposition("<img src=x onerror=alert(1)>.html");
    assert.match(html, /^attachment; filename="<img src=x onerror=alert\(1\)>\.html"; /);
    assert.equal(html.includes("inline"), false);
    assert.equal(html.includes("\r"), false);
    assert.equal(html.includes("\n"), false);

    const pathName = attachmentDisposition("../../etc/passwd");
    assert.match(pathName, /filename="passwd"/);
    assert.equal(pathName.includes(".."), false);

    const injected = attachmentDisposition('ok\r\nContent-Type: text/html"; filename="evil.html');
    assert.equal(injected.includes("\r"), false);
    assert.equal(injected.includes("\n"), false);
    assert.equal(injected.includes('filename="evil.html"'), false);
    assert.match(injected, /^attachment; filename="[^"]*"; filename\*=UTF-8''[^;\r\n]+$/);

    const broken = attachmentDisposition('notes;evil="x".txt');
    assert.match(broken, /filename="notes_evil=_x_.txt"/);
    assert.equal(broken.includes(";evil"), false);

    assert.match(attachmentDisposition("."), /filename="upload"/);
    assert.match(attachmentDisposition(".."), /filename="upload"/);
    assert.match(attachmentDisposition(""), /filename="upload"/);
    const cafe = attachmentDisposition("caf\u00e9.txt");
    assert.match(cafe, /filename="caf_.txt"/);
    assert.match(cafe, /filename\*=UTF-8''caf%C3%A9\.txt$/);

    assert.equal(uploadContentDisposition([]), null);
    assert.equal(uploadContentDisposition([{ name: "" }, { name: ".env" }]), attachmentDisposition(".env"));
    assert.equal(securityHeaders("abcDEF789_-nonce")["Content-Disposition"], undefined);
  });
});

describe("post origin", () => {
  it("allows this desk and refuses another site", () => {
    assert.equal(postOriginAllowed({}), true);
    assert.equal(postOriginAllowed({ host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787" }), true);
    assert.equal(postOriginAllowed({ host: "127.0.0.1:8787", origin: "https://galion.app" }), true);
    assert.equal(postOriginAllowed({ host: "galion.app", origin: "https://www.galion.app" }), true);
    assert.equal(postOriginAllowed({ host: "research.galion.app", origin: "https://research.galion.app" }), true);
    assert.equal(postOriginAllowed({ host: "127.0.0.1:8787", origin: "https://research.galion.app" }), true);
    assert.equal(postOriginAllowed({ host: "127.0.0.1:8787", origin: "http://127.0.0.1:9999" }), false);
    assert.equal(postOriginAllowed({ host: "galion.app", origin: "https://evil.example" }), false);
    assert.equal(postOriginAllowed({ host: "galion.app", origin: "null" }), false);
    assert.equal(postOriginAllowed({ host: "galion.app", origin: "http://galion.app" }), false);
    assert.equal(postOriginAllowed({ "sec-fetch-site": "cross-site" }), false);
    assert.equal(postOriginAllowed({ host: "127.0.0.1:8787", origin: "http://user:pass@127.0.0.1:8787" }), false);
  });
});

describe("session cookie", () => {
  it("sets HttpOnly, Secure, SameSite, and Path, and not a Domain", () => {
    const id = newSessionId();
    const cookie = sessionCookie(id);
    assert.equal(sessionToken(cookie), id);
    assert.match(cookie, new RegExp(`^research_session=${id};`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    assert.equal(/Domain=/i.test(cookie), false);
    assert.equal(/Max-Age=/i.test(cookie), false);
  });
});

describe("listen target", () => {
  it("keeps the default port and the loopback host", () => {
    assert.equal(DEFAULT_PORT, 8787);
    assert.deepEqual(listenTarget({}, {}), { host: BIND_HOST, port: 8787 });
    assert.deepEqual(listenTarget({ port: 0, host: "example.invalid" }, { PORT: "9" }), { host: BIND_HOST, port: 0 });
    assert.deepEqual(listenTarget({ host: "example.invalid" }, { PORT: "8787" }), { host: BIND_HOST, port: 8787 });
    assert.equal(listenTarget({}, { PORT: "" }).port, 8787);
  });
});
