import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BODY_LIMIT,
  BODY_TOO_LONG,
  EMPTY_QUESTION,
  QUESTION_LIMIT,
  QUESTION_TOO_LONG,
  errorBody,
  questionLength,
} from "../../src/limits.js";
import { newSessionId, sessionToken } from "../../src/server.js";

describe("limits", () => {
  it("counts characters and describes a clean error", () => {
    assert.equal(questionLength("a".repeat(QUESTION_LIMIT)), QUESTION_LIMIT);
    assert.equal(questionLength(" aaaa "), 6);
    assert.equal(questionLength("é"), 1);
    assert.equal(BODY_LIMIT, 32_768);
    assert.match(QUESTION_TOO_LONG, new RegExp(String(QUESTION_LIMIT)));
    assert.match(BODY_TOO_LONG, new RegExp(String(BODY_LIMIT)));
    const error = errorBody("empty", EMPTY_QUESTION);
    assert.equal(error.status, "Error");
    assert.equal(error.error, "empty");
    assert.deepEqual(error.citations, []);
    assert.deepEqual(error.sources, []);
    assert.equal(error.reply, EMPTY_QUESTION);
  });

  it("accepts only a session token", () => {
    const id = newSessionId();
    assert.match(id, /^[a-f0-9]{32}$/);
    assert.equal(sessionToken(id), id);
    assert.equal(sessionToken(`research_session=${id}; HttpOnly`), id);
    assert.equal(sessionToken("research_session=short"), null);
    assert.equal(sessionToken("no-session"), null);
  });
});
