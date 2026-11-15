// Request limits for the research desk. A question past the limit is refused.
// It is not clipped and then answered.

export const BODY_LIMIT = 32_768;
export const QUESTION_LIMIT = 2_000;

export const EMPTY_QUESTION = "The question is empty.";
export const BAD_JSON = "The question was not sent as JSON.";
export const QUESTION_TOO_LONG = `The question is longer than ${QUESTION_LIMIT} characters.`;
export const BODY_TOO_LONG = `The request is longer than ${BODY_LIMIT} bytes.`;

export function questionLength(value) {
  return [...String(value ?? "")].length;
}

export function errorBody(error, reply) {
  return {
    schema: "galion-research/1",
    app: "hermes",
    status: "Error",
    error,
    reply,
    citations: [],
    found: [],
    inferred: [],
    unknown: [],
    sources: [],
    helpers: "Helpers are quiet.",
  };
}
