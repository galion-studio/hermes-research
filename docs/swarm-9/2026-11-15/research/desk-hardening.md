# Swarm 9 research / desk-hardening

Lane: desk-hardening. Swarm: research. Owner: Maciej Grajczyk.
Written 2026-11-15T15:35:00+01:00 (Europe/Zagreb).

## What I read

- `RULES.md` and `GITHUB-SURVEY.md` for this swarm.
- Draft #6, `cursor/research-desk-checks-a951` at `636190a6ae48f7f5a251e311d4296814ef056da1`. I did not edit that branch.
- Open pull requests titled "Swarm 9 research plan": none. Searched `repo:galion-studio/hermes-research is:open` for that title, and again for "Swarm 9". Both returned no plan. This lane is the assignment in the launch message.

## What I checked

The desk on that branch already refused an oversized body, bound the process to loopback, and turned a missing Hermes into Offline with empty citations. It did not send a content security policy. The session cookie had `HttpOnly`, `SameSite=Strict`, and `Path=/`, and it did not have `Secure`. There was no rate limit. Unknown paths answered `text/plain`. `POST /health` was `404`. A slow trickle from Hermes could reset a socket timeout. `npm audit` could not run: there was no lockfile (`ENOLOCK`).

## What I changed

- Every response carries a content security policy (per-response nonce on the page style and script), `nosniff`, `no-referrer`, `DENY` frames, a closed permissions policy, and the same-origin opener and resource policies.
- One session may send 240 requests and 30 questions per 60 seconds. `GALION_RATE_LIMIT` and `GALION_ASK_RATE` override those two caps. A process-wide backstop is 10000 requests and 1000 questions in the same window.
- `research_session` is `HttpOnly; Secure; SameSite=Strict; Path=/` with no `Domain` and no `Max-Age`.
- `start()` always listens on loopback. A host argument does not move it. The default port is still 8787.
- `400`, `404`, `405`, `413`, and `429` share one JSON error document: empty citations, empty found, inferred, unknown, and sources. A plain-text `400` from the research origin is rewritten into that document. `POST /health` is `405`.
- A Hermes timeout is a wall clock. A dropped connection resolves as unreachable. Both stay Offline, with empty citations, on the desk.
- `package-lock.json` records the app with no dependencies, so `npm audit` can run. CI runs `npm run audit` for the app and for `e2e/`.

Found, Inferred, Unknown, port 8787, 432 Hz, Silence, and Offline with empty citations are unchanged. `LICENSE` is unchanged. Nothing was deployed.

## Commands and results

Node v22.23.4. Working tree on `cursor/research-desk-hardening-5619`.

`npm run build` — exit 0.

`npm test` — 39 pass, 0 fail, 0 skipped. Duration about 697 ms. The audit lines printed by that run:

```
npm audit app exit=0 info=0 low=0 moderate=0 high=0 critical=0 total=0
npm audit e2e exit=0 info=0 low=0 moderate=0 high=0 critical=0 total=0
```

`npm run audit` — exit 0. Both commands printed `found 0 vulnerabilities`.

`cd e2e && npm ci && npx playwright install --with-deps chromium && npx playwright test` — first run 17 passed, 1 failed. The failure was this test reading `set-cookie` from the document response, where Playwright does not surface that header. The browser had stored the cookie. The test now reads `headersArray()` from the API response. Second full run: 18 passed (12.0s).

CI on this head: not run yet at the time of this note. The workflow is `.github/workflows/ci.yml`.

## Open questions for Maciej

- Is 30 questions and 240 requests per session per minute the cap you want? The environment overrides are `GALION_ASK_RATE` and `GALION_RATE_LIMIT`.
- The cookie is a browser session cookie (`Secure`, no `Max-Age`). Say if it should persist for a fixed time.
- `POST /health` is now `405` with the shared error document. It was `404`.

## Refused or skipped

Did not merge, deploy, publish, force-push, or edit draft #1 or draft #6. Did not add a secret, a token, or a non-loopback address. Voice, symphony, and billing were out of scope. No paid API calls.
