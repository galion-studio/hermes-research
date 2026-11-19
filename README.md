# Galion Research

Galion Research is a PhD-level research workspace, separate from Galion One, with its own memory. This repository is the Galion Research web app for `research.galion.app`. It can hand a voice across to Galion One. It is not a copy of the One page.

The desk uses Ink `#0B0F14`, Ice `#B8E8FF`, Sky `#58C4FF`, Ocean `#0B5FA5`. The field says Ask anything…. The file plus sits on the left of that field and the voice disc sits on the right. Show interface opens Sources, Citations, the Notebook (Found, Inferred, Unknown), and an experiment card that asks before anything runs. Hide interface returns to the bare field. The page says Galion Research for live users is coming very soon, and links to the desktop alpha workflow because no GitHub Release is published yet.

The voice is: Galion Research. What are we looking into? The handoff from Galion One is voice-only. No letter is drawn on the disc. The disc is Ice, Sky, and Ocean.

The rail offers four themes: Ink, Ice, Sky, and Ocean. Ink is the one the desk opens on. The ground stays Ink in all four, so Ice and Sky text keep their contrast. The disc does not change colour. Focus rings are Sky, 2 px, with a 3 px offset. Escape hides the interface. Send enqueues the question. Return does the same. Shift and return keeps the line. Found, Inferred, and Unknown each have a screen-reader name. Reduced motion holds the disc and skips transitions. A question in flight says `Reading the question.` An empty desk, an empty question, and an offline answer stay separate states.

Ultra is $220/€220 per month. That line is copy, not a checkout.

The research engine runs on this machine. Its crates are still named hermes-rs and hermes-gateway. This process does not ship a voice model, a clone, or an audio file. Research cues are 432 Hz just-intonation ratios in `src/cues.js` and on the page. Definitions only. Silence, and `?silence=1`, keeps those cues quiet. The Silence control sits on the field. Typing in the field does not toggle it. `s` does, when focus is outside the field.

The 7 October 2026 notes are kept in [docs/archive](docs/archive/).

## Run

```sh
npm start
```

The desk is at `http://127.0.0.1:8787/research` (and `/`). `PORT` changes the port. The process binds the loopback interface.

`GET /health` is the read-only probe an OS status page calls. The body is `{"ok":true,"service":"galion-research","bind":"127.0.0.1"}`. It sets no cookie, it is not counted by the rate limit, and it does not dial Hermes or a research origin. A browser page on loopback `http`, including the name `localhost`, may read that body. Any other origin is not copied into the response. Any other method is `405`.

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

### Research engine

When `GALION_RESEARCH_URL` is unset, or that origin cannot be reached, the research engine on this machine answers. The engine crates and the variables below still use the historical name.

| Variable | Role |
| --- | --- |
| `GALION_LLM` | `hermes` to attach. `canned`, `echo`, and `mock` stay off this client. |
| `GALION_LLM_URL` | Loopback `http://127.0.0.1:8642/v1/chat/completions` when unset. Other hosts are refused, so the key is not sent off the machine. A set URL with no mode also attaches, same as galion-one-voice. |
| `GALION_LLM_MODEL` | Default `hermes-agent`. |
| `GALION_LLM_KEY_FILE` | Optional dotenv file. A name with no `/`, no `\`, and no `..` is read from `$CREDENTIALS_DIRECTORY` when that directory is an absolute path (systemd `LoadCredential=`). An absolute path is read as given. A relative path is ignored. |
| `GALION_LLM_KEY_NAME` | Line name in that file, such as `API_SERVER_KEY`. Both file and name must be set. A non-empty value wins over `GALION_LLM_KEY`. |
| `GALION_LLM_KEY` | Fallback bearer token when the file is unset, unreadable, or has no matching line. Server-side only. Commented and empty in the examples. |
| `GALION_LLM_TIMEOUT_MS` | Default 3000, clamped between 50 and 95000. The live voice desk uses 85000. |

A host drop-in can hand the gateway file to the unit. The committed unit does not set the key, a live path, or `LoadCredential`.

```
LoadCredential=hermes-env:/opt/galion/hermes/.env
Environment=GALION_LLM_KEY_FILE=hermes-env
Environment=GALION_LLM_KEY_NAME=API_SERVER_KEY
```

`hermes-env` is the credential name. `API_SERVER_KEY` is the line in `/opt/galion/hermes/.env` on the host. That path is not in the committed unit.

The research turn uses the Galion Research system prompt from `galion-cascade` `research_turn`. Citation lines are the `[n]` lines the model actually returned. If there is no source, the reply says so and the citation list stays empty. This desk does not invent a paper, a URL, a date, or a measurement.

While a question is in flight the page shows one line: `Helpers: reading, sources, notebook.` Research may split the work that way on its own. When the turn returns, the line goes quiet.

`GET /research/progress` is that session's in-flight phase. The page shows it as one quiet line, `Reading.`, and hides the line when the turn returns. Another session does not see it.

Sources are one list: the title, the domain, and the link. A link is shown only when the citation already carried an `http` or `https` URL. The desk does not invent one.

When Hermes is attached, the question goes to that loopback gateway, not to the voice desk. The gateway's `[n]` lines, `citations`, `search_results`, and `url_citation` annotations are the sources. A citation with a URL is also a Found line when the reply did not already separate one.

### Offline

If the galion-one-voice origin is down and Hermes does not answer, the desk continues from local knowledge and marks the answer `Offline`. The quiet line is `Helpers are quiet. Local knowledge carries the question.` The reply says `Offline` and `Local`. Citations stay empty. A local line is labelled `Local` in that session's sources. It is not a citation. What this process already knows is the voice, the price, the palette, and the connection to Galion One. It does not fill a gap with a made-up source.

A Hermes timeout and a dropped Hermes connection both stay on that path. The timeout is a wall clock (`GALION_LLM_TIMEOUT_MS`), so a slow trickle cannot hold the turn open. Found, Inferred, and Unknown are unchanged. Silence and the 432 Hz cues are unchanged.

### Sources stay on the session

A browser session is the `research_session` cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, and no `Domain`. It is a session cookie. `POST /research/ask`, `GET /research/history`, and `GET /research/sources` read and write that session only. A citation is stored with the label `Citation` only when the turn returned one. Another session does not see it.

### Response headers

Every response sends a content security policy. The page's style and script carry a per-response nonce, and inline sources without it are refused. The other headers are `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a closed camera, microphone, geolocation, and payment policy, and the same-origin opener and resource policies.

### Limits and errors

A request body over 32768 bytes, or a question over 2000 characters, is `413` with `status: "Error"`. An empty question or a body that is not JSON is `400`. An unknown path is `404`. A known path with the wrong method is `405`. More than 30 questions, or more than 240 requests, from one session in 60 seconds is `429`. `GET /health` is not one of those requests. `GALION_ASK_RATE` and `GALION_RATE_LIMIT` override those two caps. Each of those responses is the same JSON shape: `error`, `reply`, and empty citations, found, inferred, unknown, and sources. The reply is the limit, not an answer. The question is not stored. The page shows that sentence in the error line. It does not label the failure `Offline` and it does not invent a source. A plain-text refusal from the research origin is rewritten into that same shape.

### Files

Any file can be handed with the question, including a dotfile. There is no type list and no size cap. The bytes stream to a directory outside this repository. The turn hears the file name, the size, and a short text prefix. That prefix length is `EXCERPT_BYTES` in `src/uploads.js`. The file is not a citation.

## Tests and CI

```sh
npm run build
npm test
```

Node 22, no packages. `npm run build` is a syntax check of the sources, the health check, and the tests. There is no bundle step. `npm test` runs the unit tests, the integration tests against a stub Hermes, `test/research.test.js`, and `npm audit` for this package and for `e2e/`. The unit tests cover local knowledge, the size limits, the rate limit, the cookie flags, the loopback rule, and per-session sources without opening a socket. The integration tests stay on the loopback interface, including a timeout and a dropped connection. The page tests cover Silence, the Offline mark, a loopback Hermes turn that keeps the key out of the reply, citation lines, the notebook piles, the forward to a `/research` origin, `GET /health`, and the deploy kit.

Desktop and phone screenshots, plus the accessibility checks:

```sh
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

GitHub Actions (`.github/workflows/ci.yml`) runs `npm run build`, `npm run audit`, `npm test`, and the Playwright suite on push and on pull request. The workflow installs Chromium with its system libraries before the suite. It does not deploy.

## End-to-end harness (laptop CI)

`npm run test:e2e-local` starts the real server (`node src/server.js`) as its own process on 127.0.0.1 and checks it from outside: health, an ask round trip, the Found / Inferred / Unknown split and citation sources, cross-site 403s, upload modes 700/600 (Linux only), offline fallback to local knowledge, the `/research/*` routes, and forwarding to the voice desk. Hermes is a loopback stub, so no model is called and nothing is paid for. The live model setting is not touched.

The two whole-file upload tests were `todo` until the upload fix (#33) landed; they now pass and the marks are off. A future `todo` test still shows as XFAIL, and as XPASS once it passes.

On the laptop, `scripts/laptop-ci/research-e2e.ps1` (installed as `G:\galion\ci\research-e2e.ps1`, task `GalionResearchE2E`, every 5 min) runs the `ci/e2e-local` job from `scripts/laptop-ci/e2e-job.json` through `run-ci.ps1` on each new commit that GalionRepoMirror brings into `G:\galion\work\repos\hermes-research`. It writes one line per commit to `G:\galion\logs\ci\hermes-research-e2e.log`. It never pushes.

## Deploy kit

The desk is not deployed. The kit in this repo is the hardened unit, the env example, the health check, and the release layout. See [docs/DEPLOY.md](docs/DEPLOY.md). The scripts refuse `--execute`. Nothing in this repository connects to a host, and nothing here changes DNS.

To serve this app at `research.galion.app`, a person adds a DNS record for that name to the same front that already reaches the machine, then points that host at this process on loopback port 8787. Same-origin posts on `https://research.galion.app` are already allowed. This repository does not make that DNS change and does not edit the front.

The Pi 5 seed is a single executable of this same desk for `linux-arm64` and `linux-x64`. The workflow that builds it smoke-starts the arm64 binary under qemu-user. It does not boot a Raspberry Pi. See [docs/PI5-SEED.md](docs/PI5-SEED.md).

## Licence

Standard MIT, plus:

- G.A.L.I.O.N. — General Autonomous Local Intelligence Open Network
- Developed and distributed by Galion Labs
- Perpetual Open MIT License
- Copyright © 2026 Galion Labs. All rights reserved.

See [LICENSE](LICENSE).
