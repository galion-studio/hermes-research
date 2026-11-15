import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contentSecurityPolicy, securityHeaders, withNonce } from "../../src/headers.js";
import { BIND_HOST, DEFAULT_PORT, listenTarget, newSessionId, sessionCookie, sessionToken } from "../../src/server.js";

describe("response headers", () => {
  it("builds a nonce policy without inline exceptions", () => {
    const nonce = "abcDEF789_-nonce";
    const csp = contentSecurityPolicy(nonce);
    assert.match(csp, new RegExp(`script-src 'self' 'nonce-${nonce}'`));
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
