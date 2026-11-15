# Swarm 9 research — uploads

2026-11-15, Europe/Zagreb (+01:00).

Owner decision at 15:29: any file, including a dotfile. No type allowlist. No size limit. Loopback only. Stream to disk. Keep the bytes out of git.

`src/uploads.js` writes under the system temp directory, or `GALION_UPLOAD_DIR` when that path is outside this repo. `EXCERPT_BYTES` is the short prefix the turn sees. Citations are not invented from the file.

## Checked

`POST /research/ask` on `main` accepted only JSON and stopped at 32768 bytes. The page cleared the file input and did not send it. `test/research.test.js` required the stub TODO. That assertion is updated because the owner asked for the upload to work.

## Tests

Node v22.23.4, on this branch before the push.

- `npm run build` — exit 0
- `npm test` — 29 pass, 0 fail, 0 skipped
- `cd e2e && npm ci && npx playwright install chromium && npx playwright test` — 9 passed (7.2s), including the `.notes` upload

The Node suite includes a dotfile parsed in one-byte chunks and a 1 MiB file posted in 64 KiB writes. Neither was rejected. Both landed outside the repo.
