# Swarm 9, research, wire-one — 2026-11-15

Lane wire-one. Repository: galion-studio/hermes-research. Draft until CI is green, then ready for review. Nothing was merged, deployed, published, force-pushed, or deleted.

Timestamp below is Europe/Zagreb.

## Plan

Searched open pull requests in galion-studio/hermes-research for `Swarm 9 research plan` before the edit and again at 2026-11-15T15:29:28+01:00. Both searches returned `total_count` 0. No plan file was read because that draft was not present.

## What was read

- Uploaded Swarm 8 rules and Swarm 9 additions, and the 15 Nov 2026 GitHub survey.
- This repo on `main` at `ed3ce99`: `src/server.js`, `src/hermes.js`, `src/desk.js`, `public/research.html` (read only), `README.md` (read only), tests, deploy kit.
- `obsidian-open-mind` `docs/desktop/README.md`, `docs/bind-defaults.md`, `crates/openmind-desktop/src/http.rs`, `crates/openmind-desktop/src/page.rs`, `crates/openmind-desktop/src/probe.rs`. Desktop `DEFAULT_BIND` is `127.0.0.1:18181`. `GET /one` and `GET /research` are HTML entries with `data-entry`. No files in that repo were edited.
- `galion-one-voice` `galion-render/src/backends/web.rs` (the `/research` routes and `GET /health` → text `ok`) and the header of pull request 128. No files in that repo were edited.

## Pull request 6

https://github.com/galion-studio/hermes-research/pull/6 changes `README.md`, `e2e/research.spec.js`, `public/research.html`, and adds `docs/swarm-8/2026-11-15/r1-research-finish.md`. None of those paths are in this branch. The desk indicator is inserted when `/research` is served, so the static page file stays as it is on `main`.

## What changed

- `docs/FORWARD.md` — loopback forward contract for openmind-desktop and the galion-one-voice `/research` routes.
- `src/forward.js` — config, probes, citation acceptance, and the served-page indicator.
- `src/server.js` — `GET /research/wire`, voice forward, Open Mind redirect when configured.
- `test/contract/forward.test.js` — stub servers for success, timeout, Hermes down, malformed upstream, and a refused non-loopback config.
- `test/unit/forward.test.js` — origin rules and citation acceptance without a socket.
- `.env.example`, `deploy/research.env.example`, `docs/DEPLOY.md`, `package.json`.

`GET /health` still does not dial an upstream. A citation is kept only when the voice JSON already has `{ "n", "text" }`.

## Commands and results

Node v22.23.4. Working tree tests, 2026-11-15T15:29:28+01:00:

- `npm run build` — exit 0
- `npm test` — 35 pass, 0 fail, 0 skipped, 0 todo, duration_ms 568.193319

`cd e2e && npm ci && npx playwright install chromium && npx playwright test` — exit 0, 8 passed (7.1s). Those 8 are the suite on `main`. The extra browser checks on pull request 6 were not run here because that spec file was not edited.

A separate Chromium pass opened the served desk (not committed):

- With no upstreams, after Show interface, `#wire-status` was visible and read `ONE · UNSET · VOICE · UNSET · HERMES · OFFLINE`. No page error.
- With loopback stubs for both upstreams, the same line read `ONE · UP · VOICE · UP · HERMES · OFFLINE`.

## Decisions for Maciej

1. `GALION_VOICE_URL` is the loopback voice upstream. `GALION_RESEARCH_URL` is used only when that is unset. An `https` research origin still forwards the JSON routes and is reported as `public` without a probe. Say if that `https` forward should stop.
2. Open Mind is not dialed until `GALION_OPENMIND_URL` is set. The example is `http://127.0.0.1:18181`. Say if an empty value should mean that address.
3. The galion-one-voice web surface in the file I read uses `127.0.0.1:0` in tests. This contract does not pick a default voice port.
4. The Swarm 9 research plan draft was not on GitHub at 15:29+01:00. This lane followed the worker brief.
