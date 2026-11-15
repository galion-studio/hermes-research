# Swarm 9 — Research plan

Orchestrator record for Galion Research (`hermes-research`). Times are Europe/Zagreb, offset `+01:00`.

Base is `main` at `ed3ce9993f58ec655af4f23c2438eb83cd7ea844` unless a lane note says a later merge. Drafts [#1](https://github.com/galion-studio/hermes-research/pull/1) and [#6](https://github.com/galion-studio/hermes-research/pull/6) are not Swarm 9. Do not edit those branches, do not push to them, and do not merge them. The owner said on 2026-11-15 at 15:29 that both are green and ready, so they stay for the owner.

Checked open pull requests at 15:36. The only pre-swarm drafts are #1 and #6. Neither is blocked or failing, so none were taken. Swarm 9 pull requests: [#7](https://github.com/galion-studio/hermes-research/pull/7) wire-one (no #6 commits), [#8](https://github.com/galion-studio/hermes-research/pull/8) ux-ui and [#9](https://github.com/galion-studio/hermes-research/pull/9) desk-hardening (both contain #6).

## Design direction (FRXDEL, 2026-11-15 15:25)

Not perfect, but working. A genuinely great user experience. A very minimal but beautiful UI. Everything connected like a symphony: the operating system, the desktop, the apps, and the browsers on Linux should feel like one product. Prefer shipping a working, connected flow over polish.

Reuse Branding V2 and the Open Mind style guide. Do not invent a second visual language, a second desk, or a second licence.

- `galion-operating-system` `docs/brand/BRANDING-V2.md` and `marks/`
- `obsidian-open-mind` `brand/BRAND.md`, `brand/STYLE-GUIDE.md`, `brand/tokens.css`, `brand/palette.json`
- This desk already uses that palette: Ink `#0B0F14`, Ice `#B8E8FF`, Sky `#58C4FF`, Ocean `#0B5FA5`

Keep Found / Inferred / Unknown, 432 Hz and Silence, the `research_session` cookie, Offline / Local with empty citations, port 8787, and the dry-run deploy kit. Ultra prices stay copy. No checkout.

## Standing permission (2026-11-15 15:21, restated 15:26)

The orchestrator merges a Swarm 9 pull request when every required and non-skipped CI check is green on the current head, local tests were re-run, and the review has nothing open. One pull request at a time. The next branch is updated from `main` and CI runs again before that merge.

The gitignore-restore pull request stays a draft. Do not mark it ready and do not merge it.

Still forbidden: force-push, history rewrite, protection bypass, skipped checks, secrets, server credentials, DNS, Cloudflare, HADES, firewall, and deploys other than workflows the repository already has. The deploy kit still refuses `--execute`.

## Owner decisions already made

| When | Decision | What the swarm does |
| --- | --- | --- |
| 15:24 | Restore every `.gitignore` pattern draft #1 dropped | Draft `Swarm 9 research/gitignore-restore`, branched from `main`. Stays a draft. |
| 15:24, replaced 15:29 | Uploads | Wire them now. Any file, including dotfiles. No type allowlist. No size limit. Loopback only. Stream to disk. Keep the bytes out of git. |
| 15:29 | Drafts #1 and #6 | Leave them for the owner. |

Uploads behaviour past that (how much of a huge file the turn reads, how long a file stays on disk) is still easy to change. The knobs live at the top of `src/uploads.js`: excerpt length and the temp directory. Do not add a type list or a size cap unless the owner says so.

## Merge order

1. Owner merges #1, then #6. This swarm does not.
2. Swarm 9, one at a time, after CI is green and the review is clear: this plan, then `Swarm 9 research/uploads`, then the lane pull requests that are not already merged. Update each next branch from `main` before its CI re-run.
3. `Swarm 9 research/gitignore-restore` is not in that list. It stays a draft.
4. [#7](https://github.com/galion-studio/hermes-research/pull/7) is on `main` as merge `e1d5fb0e3567a2fcd73d7af93ebacc5d9e441827`. It does not carry #6.
5. [#12](https://github.com/galion-studio/hermes-research/pull/12) uploads is on `main` as merge `4d87709c7be5647e5822d5b3d8c5879f254dd1a7`. Head `ddebcfd` had four successful checks and does not carry #6. Local `npm test` after merging wire-one in: 40 pass, 0 fail.
6. [#8](https://github.com/galion-studio/hermes-research/pull/8) (`Swarm 9 research/ux-ui`, head `6e199dc`) and [#9](https://github.com/galion-studio/hermes-research/pull/9) (`Swarm 9 research/desk-hardening`, head `ec37040`) both contain #6 commits `8308ab9` and `636190a`. #6 is still open. Do not merge them until the owner has merged #6 onto `main`. #9 is already conflicting with `main`. Then rebase each branch onto `main` and merge once that new head is green. No force-push: if the rebase cannot be published without one, merge `main` into the branch instead.

## Where draft #6 already touches files

Branch `cursor/research-desk-checks-a951`, head `636190a6ae48f7f5a251e311d4296814ef056da1`. Do not commit on that branch.

| File | What #6 changes |
| --- | --- |
| `public/research.html` | After a question is committed, the first status and history reads do not relabel or wipe it. |
| `e2e/research.spec.js` | Offline mark, empty question, late status, late history, phone axe. |
| `README.md` | Install Chromium before Playwright. The workflow does not deploy. |
| `docs/swarm-8/2026-11-15/r1-research-finish.md` | Swarm 8 notes. |

A lane that must edit `public/research.html` or `e2e/research.spec.js` branches from `main` in a new branch. Keep the `turnStarted` guard if you touch that script, so a late history read cannot wipe a handed file. Do not take #6's other commits into the branch. The owner merges #6.

Draft #1 touches only `.gitignore` on `tidy/galion-hygiene-20261114`. The restore draft is a new branch. It keeps #1's added patterns and restores the ones the merge dropped.

## Lanes

Files do not overlap. `package.json`'s `build` script is the one shared edit: append `node --check` for files you add, and do not reorder the rest. Notes for a lane go in that lane's pull request at `docs/swarm-9/2026-11-15/research/<lane>.md`.

### 1. Desk hardening

Security headers, the existing limit errors, and error responses that stay `status: "Error"` with empty citations. Not Offline, and not a made-up source.

| Path | Work |
| --- | --- |
| `src/security.js` | New. CSP and the other response headers. Inline style and script stay allowed so the current page keeps working. |
| `src/limits.js` | Error body stays the error shape. Do not add a file-size cap. |
| `src/server.js` | Apply `securityHeaders()` from `send` and the other writers. Do not change the upload stream or `src/forward.js`. |
| `test/unit/security.test.js` | New. |
| `test/unit/limits.test.js` | Only if an error-body assertion is missing. |
| `docs/swarm-9/2026-11-15/research/hardening.md` | Notes. |

Acceptance:

- `GET /research` carries `Content-Security-Policy`, `nosniff`, and `no-store`.
- A 400 and a 413 still use `status: "Error"`, empty citations, and empty sources. The question is not stored.
- `npm run build` and `npm test` pass.
- `.gitignore` is not edited here.

Out of scope: the gitignore proposal is already decided and lives on the restore draft. Upload TODOs are removed by the uploads pull request, not by this lane.

### 2. Wiring to One

[#7](https://github.com/galion-studio/hermes-research/pull/7) is this lane. Changes stay inside `hermes-research`. Do not edit `galion-one-voice` or `obsidian-open-mind`.

The contract it added:

- `GALION_OPENMIND_URL` loopback only. `GET /one` and `GET /research` on openmind-desktop, port 18181 when that origin is set.
- `GALION_VOICE_URL` loopback only. galion-one-voice `GET /health` text `ok`, plus `/research/hermes`, `/research/history`, and `POST /research/ask`.
- A citation is kept only when the JSON already had `{ "n", "text" }`. Timeout, a down upstream, or a malformed body falls through to local knowledge with an empty citation list.
- `GET /research/wire` is the indicator. The desk line is injected when the page is served, so `public/research.html` stays free for #6 and for uploads.

`f1145eb` removed the `https` dial. `GALION_RESEARCH_URL` now has to be loopback http, same as `GALION_VOICE_URL`. A refused origin falls through to Hermes, then Offline / Local, with citations `[]`.

| Path | Owned by this lane |
| --- | --- |
| `src/forward.js` | The contract. |
| `src/server.js` | Call the contract. Leave the multipart upload branch alone once uploads has it. |
| `test/contract/forward.test.js` | Stubs on loopback. |
| `test/unit/forward.test.js` | Origin rules. |
| `docs/FORWARD.md` | The contract note. |
| `.env.example`, `deploy/research.env.example`, `docs/DEPLOY.md` | Loopback examples. No secret. |
| `docs/swarm-9/2026-11-15/research/wire-one.md` | Notes. |

`GET /one` stays a redirect to the desktop `/one` entry. This repo does not draw the One dot. Research routes are the proxied ones.

### 3. UX and accessibility

The existing desk only. Minimal, working, and on the current palette. No new page.

| Path | Work |
| --- | --- |
| `public/research.html` | Focus, names, and the live file line. Do not remove the upload `FormData` path or the `turnStarted` guard. |
| `e2e/research.spec.js` | Axe serious/critical stays empty on the desk you touch. Do not delete the upload test. |
| `docs/swarm-9/2026-11-15/research/ux.md` | Notes. |

Acceptance:

- Ink, Ice, Sky, and Ocean are unchanged. 432 Hz, Silence, and `?silence=1` stay.
- Show interface and Hide interface stay. The notebook piles stay Found, Inferred, Unknown.
- A keyboard user can reach Ask, Silence, Show interface, Voice, and Add files.
- Playwright axe reports no serious or critical violation on the open desk and the bare field.

#6 already edits the two code files above. Branch from `main` after the uploads pull request is on `main`, and keep both behaviours.

## Uploads (its own pull request)

Title `Swarm 9 research/uploads`. Not one of the three lanes, so it does not take their notes files.

Owner rule, 15:29: the person can hand any file, including a dotfile. No type allowlist. No size limit. The listener stays loopback. Bytes are streamed to a directory outside this repo (the system temp directory unless `GALION_UPLOAD_DIR` points somewhere that is also outside the repo). Nothing uploaded is committed.

The turn hears the file name, the size, and a short prefix when the prefix is text. The prefix length is the adjustable knob. Citations stay empty unless a model line already cited a source. A rejected empty question is still `400` and does not keep the file.

Tests: a Node upload of a dotfile, a Node upload of a large file streamed in chunks (larger than the 32768-byte JSON body cap, and not rejected), and a Playwright upload through the file control.

| Path |
| --- |
| `src/uploads.js` |
| `src/server.js` (multipart branch only) |
| `src/desk.js` (handed file on the turn) |
| `public/research.html` |
| `e2e/research.spec.js` |
| `test/unit/uploads.test.js` |
| `test/integration/uploads.test.js` |
| `README.md` (short Files note, away from #6's Playwright paragraph) |
| `docs/swarm-9/2026-11-15/research/uploads.md` |

## Gitignore restore (draft, not merged)

Compared `8b3918933ed53a9b3d19afd6b6ca2acd6ac6bd94:.gitignore` (the earlier file on #1) with `98589de57838ab4d62d95e0c7aef1da03e76bea3:.gitignore` (the #1 head after the merge). These patterns are in the earlier file and absent from the #1 head. The restore draft puts them back on top of current `main`, and also keeps the four patterns #1 added that `main` does not have yet (`*.pem`, `*.key`, `dist/`, `build/`).

Restored:

- `.env.*`
- `!.env.example`
- `*.onnx`
- `*.safetensors`
- `*.pt`
- `*.ckpt`
- `*.gguf`
- `target/`
- `__pycache__/`
- `*.pyc`
- `*.log`
- `.DS_Store`
- `Thumbs.db`

`main` patterns that the earlier file did not have stay: `e2e/test-results/`, `e2e/playwright-report/`, `e2e/blob-report/`, `e2e/artifacts/`. No other lane edits `.gitignore`.

## What this swarm does not do

No second app. No licence wording. No voice, symphony repo, billing, or deploy execute. No edit to `SOUL.md`, `config.yaml`, `LOCKS.toml`, `voices/`, `weights/`, or `runtimes/`. Workers report to Samantha. They read this file on the open draft titled `Swarm 9 research plan` before they start, and they stay on their lane's files.
