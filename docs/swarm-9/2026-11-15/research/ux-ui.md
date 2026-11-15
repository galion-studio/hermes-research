# Swarm 9 research / ux-ui

Lane: ux-ui. Written 2026-11-15T15:34:00+01:00 (Europe/Zagreb).

## What was read

- Swarm rules and the 15 Nov GitHub survey.
- `galion-operating-system` `docs/brand/BRANDING-V2.md` on main (colours, type, focus ring, the rule that Sky on paper fails).
- `obsidian-open-mind` `brand/STYLE-GUIDE.md` and `brand/tokens.css` on main. The token file is the later type stack: Jost, IBM Plex Sans, IBM Plex Mono. The style guide still names Inter and Geist Mono.
- hermes-research pull request #6, head `636190a6ae48f7f5a251e311d4296814ef056da1`, branch `cursor/research-desk-checks-a951`. This branch starts there. That branch was not pushed to.
- Open pull requests titled like a Swarm 9 research plan. None was open at 2026-11-15T15:33:06+01:00. The search did return `Swarm 9 research/wire-one` (#7), `Swarm 9 os/galion-init` (#19), and `Swarm 9 os/site` (#22).

## What changed

`public/research.html` keeps one desk. The page now carries the Branding V2 / Open Mind tokens (`--om-ink` `#0B0F14`, `--om-ice` `#B8E8FF`, `--om-sky` `#58C4FF`, `--om-ocean` `#0B5FA5`, plus surface, line, mist, and text). The old `--ink` alias remains the text colour `#E6EDF3`, so existing rules do not flip to the background.

The rail has four themes: Ink, Ice, Sky, Ocean. Ink is the default. Every theme keeps the Ink ground. The wash and the panel tint change. Found stays Ice, Inferred stays Sky, Unknown stays text. The disc is still Ice, Sky, and Ocean, and it is not recoloured.

Keyboard: Skip to ask is the first stop. Tab order on the bare field is the field, Add files, Silence, Show interface, Voice. Return enqueues. Shift and return keeps the line. Escape hides the interface and returns focus to the toggle. `s` still toggles Silence outside the field, including when a theme radio is focused. Focus rings are Sky, 2 px, offset 3 px. An error ring is Ice.

Screen readers: the Found, Inferred, and Unknown lists are named, the empty lines are named ("Found is empty" and the same for the other two), and each heading carries a hidden sentence (in a source, reasoned from what is in hand, not established).

Loading sets `data-state="loading"`, shows "Reading the question.", and marks the open job `aria-busy`. An empty question sets `aria-invalid` and does not become Offline. The #6 guard still drops a late status or history read after a question is committed.

`prefers-reduced-motion: reduce` sets `data-motion="reduce"` and cuts transitions. The disc paint already holds still in that mode.

Playwright covers the keyboard path, the screen-reader names, loading, the empty desk, the error on phone and desktop, sideways overflow, the four themes with axe, and reduced motion. Existing axe checks stay. Screenshots are in this directory.

Uploads stay stubbed. `LICENSE` is unchanged. `src/server.js` is unchanged.

## Tests run here

Node v22.23.4. Playwright 1.65.1. Chromium was already in the local cache (`chromium-1255`).

- `npm run build` — exit 0
- `npm test` — 25 pass, 0 fail, 0 skipped
- `cd e2e && npx playwright test` — 18 passed (19.8s)

CI was not green yet at the time this note was written. The pull request body is updated after the run.

## Hooks left for wire-one

Pull request #7 injects `#wire-status` after `id="hermes-status"`, adds CSS before `</style>`, and inserts its fetch before `fetch("/research/hermes"`. Those three strings are still in `public/research.html`. This lane did not take that work in.

## Open questions for Maciej

1. The four themes stay on the Ink ground. A light Ice theme was not added. Branding V2 records Sky on paper at 1.85:1, so Ice and Sky cannot be the notebook headings on paper.
2. Jost and IBM Plex are named and not self-hosted here. This machine has Inter, not those families, so the screenshots use the system fallback. Say if Research should copy the landing-page WOFF2 subset.
3. This branch contains the #6 commits, then the desk polish. The pull request targets `main`. #6's branch was not updated.
4. The Swarm 9 research plan draft was not on GitHub at 2026-11-15T15:33:06+01:00.
