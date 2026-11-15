# Swarm 9 research — orchestrator notes

2026-11-15, Europe/Zagreb (+01:00). Repository `galion-research` / `hermes-research`.

## Checked

- `README.md`, `docs/DEPLOY.md`, `src/server.js`, `src/desk.js`, `src/hermes.js`, `src/limits.js`, `src/local.js`, `src/cues.js`, `public/research.html`, `test/research.test.js`, `e2e/research.spec.js`, `.gitignore`.
- Draft #1 head `98589de57838ab4d62d95e0c7aef1da03e76bea3` and the earlier `.gitignore` at `8b3918933ed53a9b3d19afd6b6ca2acd6ac6bd94`.
- Draft #6 head `636190a6ae48f7f5a251e311d4296814ef056da1`. Files: `README.md`, `e2e/research.spec.js`, `public/research.html`, `docs/swarm-8/2026-11-15/r1-research-finish.md`.
- Open pull requests at 15:32: #1, #6, and #7. No other open pull request. #1 and #6 are the pre-swarm drafts the owner called green. They were not merged and their branches were not edited.
- #7 CI on `a0540541619120d0fb11e7542e31a0aba76a7a91`: four check runs, `test` and `playwright`, push and pull_request, all `success`, none skipped. Local tests of that head: not re-run on this machine yet, so it was not merged. A review comment holds it because an `https` `GALION_RESEARCH_URL` is still dialed.

## Changed

The plan file is the shared record. The gitignore restore and the upload stream are separate branches, so this branch does not carry them.

## Open for Maciej

- Merge #1 and #6 when you want them. This swarm will not.
- The gitignore-restore draft waits as a draft even though you already chose restore.
- How much of a handed file the turn should read, and how long the temp file should live. The code starts with a short prefix and leaves the bytes in the temp directory.
