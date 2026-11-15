import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASK_LIMIT,
  ERROR_KEYS,
  RATE_LIMITED,
  REQUEST_LIMIT,
  createRateLimiter,
  errorBody,
  rateLimitsFromEnv,
} from "../../src/limits.js";

describe("rate limiter", () => {
  it("caps one session and leaves another session alone", () => {
    const limiter = createRateLimiter({ requestLimit: 10, askLimit: 2, windowMs: 60_000, globalRequestLimit: 10, globalAskLimit: 10 });
    const now = 1_000_000;
    assert.equal(limiter.hit("alpha", "ask", now).ok, true);
    assert.equal(limiter.hit("alpha", "ask", now + 1).ok, true);
    const blocked = limiter.hit("alpha", "ask", now + 2);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfter >= 1, true);
    assert.equal(limiter.hit("beta", "ask", now + 3).ok, true);
    assert.equal(limiter.hit("alpha", "request", now + 4).ok, true);
    assert.equal(limiter.hit("alpha", "ask", now + 60_000).ok, true);
  });

  it("reads the caps from the environment", () => {
    const limits = rateLimitsFromEnv({ GALION_ASK_RATE: "4", GALION_RATE_LIMIT: "9", GALION_RATE_WINDOW_MS: "1000" });
    assert.equal(limits.askLimit, 4);
    assert.equal(limits.requestLimit, 9);
    assert.equal(limits.windowMs, 1000);
    const fallback = rateLimitsFromEnv({});
    assert.equal(fallback.askLimit, ASK_LIMIT);
    assert.equal(fallback.requestLimit, REQUEST_LIMIT);
    const error = errorBody("rate", RATE_LIMITED);
    assert.deepEqual(Object.keys(error), [...ERROR_KEYS]);
    assert.deepEqual(error.citations, []);
    assert.deepEqual(error.found, []);
    assert.deepEqual(error.inferred, []);
    assert.deepEqual(error.unknown, []);
    assert.deepEqual(error.sources, []);
  });
});
