# Galion Research

Galion One is the product. Galion Research is a voice inside it, and this workspace. It connects to Galion One. It is not a copy of the One page.

The desk is the page already live at [galion.app/research](https://galion.app/research), from [galion-studio/galion-one-voice#128](https://github.com/galion-studio/galion-one-voice/pull/128). Ink `#0B0F14`, Ice `#B8E8FF`, Sky `#58C4FF`, Ocean `#0B5FA5`. The field says Ask anything. Beside it, a voice disc and a file plus. Show interface opens Sources, Citations, the Notebook (Found, Inferred, Unknown), and an experiment card that asks before anything runs. Hide interface returns to the bare field.

The voice is: Galion Research. What are we looking into? The handoff from Galion One is voice-only. No letter is drawn on the disc. The disc is Ice, Sky, and Ocean.

Ultra is $220/€220 per month. That line is copy, not a checkout.

Hermes is the research agent. This process does not ship a voice model, a clone, or an audio file. Research cues are 432 Hz just-intonation ratios in `src/cues.js` and on the page. Definitions only. Silence, and `?silence=1`, keeps those cues quiet. The Silence control sits on the field. Typing in the field does not toggle it. `s` does, when focus is outside the field.

The 7 October 2026 notes are kept in [docs/archive](docs/archive/).

## Run

```sh
npm start
```

The desk is at `http://127.0.0.1:8787/research` (and `/`). `PORT` changes the port. The process binds the loopback interface.

## How this connects

Two paths, then local knowledge. The gateway key never leaves the server that holds it, and it is never written into a response. Responses say `key` is `set` or `none`.

### galion-one-voice `/research`

Set `GALION_RESEARCH_URL` to the origin that already serves the research routes. For the live page, that origin is `https://galion.app`.

This process then forwards:

| This app | galion-one-voice |
| --- | --- |
| `GET /research` | the desk page, served here |
| `GET /research/hermes` | `GET /research/hermes` |
| `GET /research/history` | `GET /research/history` |
| `POST /research/ask` | `POST /research/ask` with `{ "question": "..." }` |

The JSON shape is `galion-research/1`: `status`, `reply`, `citations` as `{ "n", "text" }`, and `found`, `inferred`, `unknown`. An empty question is `400`. The Hermes key stays on galion-one-voice. This app does not add an `Authorization` header to that forward.

`GET /one` redirects to Galion One (`GALION_ONE_URL`, default `https://galion.app/one`). That is the product link. This repo does not draw the One dot.

### Hermes

When `GALION_RESEARCH_URL` is unset, or that origin cannot be reached, Hermes is the engine on this machine.

| Variable | Role |
| --- | --- |
| `GALION_LLM` | `hermes` to attach. `canned`, `echo`, and `mock` stay off this client. |
| `GALION_LLM_URL` | Loopback `http://127.0.0.1:8642/v1/chat/completions` when unset. Other hosts are refused, so the key is not sent off the machine. A set URL with no mode also attaches, same as galion-one-voice. |
| `GALION_LLM_MODEL` | Default `hermes-agent`. |
| `GALION_LLM_KEY` | Optional bearer token. Server-side only. |
| `GALION_LLM_TIMEOUT_MS` | Default 3000, clamped between 50 and 30000. |

The research turn uses the Galion Research system prompt from `galion-cascade` `research_turn`. Citation lines are the `[n]` lines the model actually returned. If there is no source, the reply says so and the citation list stays empty. This desk does not invent a paper, a URL, a date, or a measurement.

While a question is in flight the page shows one line: `Helpers: reading, sources, notebook.` Research may split the work that way on its own. When the turn returns, the line goes quiet.

### Offline

If the galion-one-voice origin is down and Hermes does not answer, the desk continues from local knowledge and marks the answer `Offline`. The quiet line is `Helpers are quiet. Local knowledge carries the question.` The reply says `Offline` and `Local`. Citations stay empty. A local line is labelled `Local` in that session's sources. It is not a citation. What this process already knows is the voice, the price, the palette, and the connection to Galion One. It does not fill a gap with a made-up source.

### Sources stay on the session

A browser session is the `research_session` cookie. `POST /research/ask`, `GET /research/history`, and `GET /research/sources` read and write that session only. A citation is stored with the label `Citation` only when the turn returned one. Another session does not see it.

### Limits and errors

A request body over 32768 bytes, or a question over 2000 characters, is `413` with `status: "Error"`. An empty question or a body that is not JSON is `400` with the same shape. The reply is the limit, not an answer. Citations and sources stay empty, and the question is not stored. The page shows that sentence in the error line. It does not label the failure `Offline` and it does not invent a source.

### Files

Any file can be handed with the question, including a dotfile. There is no type list and no size cap. The bytes stream to a directory outside this repository. The turn hears the file name, the size, and a short text prefix. That prefix length is `EXCERPT_BYTES` in `src/uploads.js`. The file is not a citation.

## Tests and CI

```sh
npm run build
npm test
```

Node 22, no packages. `npm run build` is a syntax check of the sources, the health check, and the tests. There is no bundle step. `npm test` runs the unit tests, the integration tests against a stub Hermes, and `test/research.test.js`. The unit tests cover local knowledge, the size limits, the loopback rule, and per-session sources without opening a socket. The integration tests speak only to a stub Hermes on the loopback interface. The page tests cover Silence, the Offline mark, a loopback Hermes turn that keeps the key out of the reply, citation lines, the notebook piles, the forward to a `/research` origin, `GET /health`, and the deploy kit.

Desktop and phone screenshots, plus the accessibility checks:

```sh
cd e2e && npm ci && npx playwright test
```

GitHub Actions (`.github/workflows/ci.yml`) runs `npm run build`, `npm test`, and the Playwright suite on push and on pull request. This draft does not deploy.

## Deploy kit

The desk is not deployed. The kit in this repo is the hardened unit, the env example, the health check, and the release layout. See [docs/DEPLOY.md](docs/DEPLOY.md). The scripts refuse `--execute`. Nothing in this repository connects to a host.

## Licence

Standard MIT, plus:

- G.A.L.I.O.N. — General Autonomous Local Intelligence Open Network
- Developed and distributed by Galion Labs
- Perpetual Open MIT License
- Copyright © 2026 Galion Labs. All rights reserved.

See [LICENSE](LICENSE).
