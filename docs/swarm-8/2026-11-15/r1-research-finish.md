# Swarm 8, Research, R1 — 2026-11-15

Agent R1. Repository: galion-studio/hermes-research. Drafts only. Nothing was merged, deployed, published, force-pushed, or deleted.

## Licence

Owner wording, 2026-11-15 15:01 CET: a perpetual, open MIT licence held by Galion Labs, plus the four G.A.L.I.O.N. branding lines. `LICENSE` is the standard MIT text with the line `Copyright (c) 2026 Galion Labs`. No extra terms that change MIT's meaning. The follow-up correction: the licence already exists. Copy `https://raw.githubusercontent.com/galion-studio/galion-operating-system/main/LICENSE` byte for byte. Do not write new licence wording.

I downloaded that file during this run. It is 1257 bytes, sha256 `33a955cb5bedbd5a58802766dd6a692f252dd7b3c663809496c21782ec21b22a`. `cmp` against hermes-research `LICENSE` on `main` and on `tidy/galion-hygiene-20261114` after the merge was equal. No licence wording was written. The MIT copyright line in that file is exactly `Copyright (c) 2026 Galion Labs`. The four branding lines above the MIT heading are the ones in the operating-system file:

1. G.A.L.I.O.N. — General Autonomous Local Intelligence Open Network
2. Developed and distributed by Galion Labs
3. Perpetual Open MIT License
4. Copyright © 2026 Galion Labs. All rights reserved.

The fourth branding line is part of the copied file. It was not added here as a new term, and it was not removed.

## Draft PR 1

https://github.com/galion-studio/hermes-research/pull/1

Branch `tidy/galion-hygiene-20261114`. GitHub had marked it dirty: the branch was 2 commits ahead of the old base and 8 commits behind current `main`. I merged `origin/main` into the branch. No rebase, no force-push. Merge commit `98589de`. The only conflict was `.gitignore`. `LICENSE` merged clean because both sides were already the same bytes.

Resolved `.gitignore` keeps every line from `main` and adds the secret and build ignores that `main` did not already have:

- `*.pem`
- `*.key`
- `dist/`
- `build/`

`.env` and `node_modules/` were already on `main`. The merge did not keep the old branch's extra patterns: `.env.*`, `!.env.example`, `*.onnx`, `*.safetensors`, `*.pt`, `*.ckpt`, `*.gguf`, `target/`, `__pycache__/`, `*.pyc`, `*.log`, `.DS_Store`, `Thumbs.db`.

## What main already had from #3, #4, and #5

Read on `main` at `ed3ce99` (merge of #5), which includes #3 and #4.

- Node tests cover Offline, the error statuses, Silence, the loopback Hermes turn, citations, per-session sources, health, and the deploy kit. `npm test` reports 25 tests.
- Playwright on `main` had 8 tests: desktop, phone screenshots, Silence, reduced motion, axe serious/critical on the desktop desk and the bare field, contrast, and one local question. That local question did not assert `data-state="offline"`, the Offline status line, or the Local source row. Axe did not run at the phone size. An empty question was not opened in the browser.
- The page's first `GET /research/hermes` and `GET /research/history` could finish after the person had already committed a question and replace the status or the source lists. An error could be painted back to Offline. An offline answer's Local row could be cleared by an empty history payload.
- `README.md` told a reader to run `cd e2e && npm ci && npx playwright test` and said "This draft does not deploy."
- Two upload TODOs remain in `public/research.html` (`TODO: uploads are stubbed` and `TODO: accept files here`). `test/research.test.js` requires the first string to stay in the page. Uploads are still UI only.

## Fixes on the second draft

Branch `cursor/research-desk-checks-a951`, based on `main`. `LICENSE` is untouched.

- The first status and history reads do nothing after a question is committed. The history read that follows a finished ask still paints that session.
- The local-question Playwright test now requires the Offline mark, the Local source row, an empty citation list, and a hidden error.
- New browser checks: an empty question stays an error; a held status response does not relabel that error; a stale empty history payload does not wipe the offline answer.
- The phone test runs the same serious/critical axe check on the open desk and on the bare field.
- The README run step installs Chromium before Playwright. The "this draft" sentence now says the workflow does not deploy.

## Commands and results

All of these were run in this session. Node is v22.23.4.

On `tidy/galion-hygiene-20261114` after the merge, application files match `main`:

- `npm run build` — exit 0
- `npm test` — 25 pass, 0 fail, 0 skipped, 0 todo

On `cursor/research-desk-checks-a951` after the desk fixes:

- `npm run build` — exit 0
- `npm test` — 25 pass, 0 fail, 0 skipped, 0 todo
- `npm start` — the process came up, a request for the research page returned HTTP 200, the body contained the Galion Research title and the Ask anything placeholder, then the process was stopped
- `cd e2e && npm ci` — exit 0, 5 packages added, 0 vulnerabilities reported by npm
- `cd e2e && npx playwright test` before any browser download — exit 1, 11 failed. Every failure was `browserType.launch: Executable doesn't exist` for Chromium. This is the old README command on a machine with no Playwright browser cache.
- `cd e2e && npx playwright install chromium` — exit 0
- `cd e2e && npx playwright test` — exit 0, 11 passed (8.3s)
- the same command again — exit 0, 11 passed (9.7s)

No failure repeated between the two green Playwright runs. I did not run a longer flake loop. The older tests still use short fixed waits (`400`, `250`, `200`, `300`, and `500` milliseconds). Those waits passed both times.

CI is recorded below after the push. This section is updated only with runs I actually saw.

## What was read before the last edit

The 15 Nov 2026 GitHub survey, then the canonical files it names for this desk: `galion-operating-system` `LICENSE`, `docs/brand/BRANDING-V2.md`, `docs/voice-profile/README.md`, and `site/README.md`; `obsidian-open-mind` `docs/SOURCE-OF-TRUTH.md` and `docs/bind-defaults.md`; and, in this repo, `LICENSE`, `README.md`, `docs/DEPLOY.md`, `src/cues.js`. The desk on `main` already is the app: loopback port 8787, Found / Inferred / Unknown, 432 Hz and Silence, the session cookie, Offline with empty citations, and the dry-run deploy kit. This pass updates that desk. It does not add a second app, a second deploy guide, or licence wording.

`docs/brand/BRANDING-V2.md` section 10 still names `Copyright (c) 3000 Galion / galion-studio` for a signed document line. The owner instruction for this repository's `LICENSE` is the operating-system file, whose MIT line is `Copyright (c) 2026 Galion Labs`. The file was left as that copy.

## CI

Seen on GitHub Actions after the push, all `conclusion: success`, jobs `test` and `playwright` both success on the pull-request runs:

| Run | Event | Branch | Head | Result |
| --- | --- | --- | --- | --- |
| [43722446090](https://github.com/galion-studio/hermes-research/actions/runs/43722446090) | pull_request | `tidy/galion-hygiene-20261114` | `98589de` | success |
| [43722441674](https://github.com/galion-studio/hermes-research/actions/runs/43722441674) | push | `tidy/galion-hygiene-20261114` | `98589de` | success |
| [43722466996](https://github.com/galion-studio/hermes-research/actions/runs/43722466996) | pull_request | `cursor/research-desk-checks-a951` | `8308ab9` | success |
| [43722442846](https://github.com/galion-studio/hermes-research/actions/runs/43722442846) | push | `cursor/research-desk-checks-a951` | `8308ab9` | success |

Recorded 2026-11-15T15:08:00+01:00 (Europe/Zagreb). A later commit that only fills this section starts its own run.

## Decisions for Maciej

1. `LICENSE` is already the operating-system file. Merging draft PR 1 does not need a wording edit. Leave the four branding lines, including the fourth line as copied.
2. `.gitignore` on PR 1 keeps `main` and adds `*.pem`, `*.key`, `dist/`, and `build/`. Say if the dropped model, cache, log, and OS patterns should come back. `.env.example` stays tracked.
3. The upload TODOs stay until a product decision wires files into the research turn. Removing them would fail `test/research.test.js`.
4. The desk-check draft is the small repair for the late status/history reads, the missing Offline and phone axe checks, and the README browser step. It does not deploy.
5. Both pull requests stay drafts. This agent does not merge them.
