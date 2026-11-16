# Pi 5 seed

Galion Research as one executable for a Raspberry Pi 5 running Raspberry Pi OS Bookworm 64-bit (aarch64). The executable is the official Node.js 22.23.4 `linux-arm64` binary with this desk injected. The Pi does not need a separate Node install. The same desk is also built for `linux-x64`.

This repository does not copy the binary onto a Pi, does not start systemd, and does not open a socket except on the runner that builds it. The scripts refuse `--execute`.

## What was tested

`.github/workflows/pi-seed.yml` runs on an x64 GitHub-hosted runner.

- It builds both executables there.
- It starts the x64 executable on that runner.
- It starts the arm64 executable under qemu-user, with the `aarch64-linux-gnu` cross sysroot. Ubuntu 24.04 provides that emulator as `qemu-aarch64-static` from `qemu-user-static`. Ubuntu 26.04, the image behind `ubuntu-latest` when this workflow first ran, provides it as `qemu-aarch64` from `qemu-user`.
- Each process must answer `GET /health` on `127.0.0.1`. The body is `{"ok":true,"service":"galion-research","bind":"127.0.0.1"}`. The smoke also loads `/research` and asks one question, which stays `Offline` with an empty citation list.

That is the whole hardware claim. qemu-user does not boot Raspberry Pi OS. It does not run `galion-research-pi5.service`. It does not apply `MemoryMax=256M`, `IPAddressAllow=localhost`, or the rest of the sandbox. It does not measure the Pi's storage, network, or CPU. A human on a Raspberry Pi 5 is the check this workflow does not do.

The arm64 binary is the official Node.js build. Its glibc requirement, read from the binary, stops at GLIBC_2.28. Raspberry Pi OS Bookworm ships a newer glibc. That is why the binary is a plausible fit. It was not confirmed by booting Bookworm on a Pi.

## Offline

`src/server.js` binds `127.0.0.1`. A host argument cannot move it. The unit sets `PORT=8787` after the optional environment file, so the listen address is `127.0.0.1:8787`.

With `GALION_RESEARCH_URL` unset and Hermes unset, a question is answered from local knowledge and marked `Offline`. Citations stay empty. `GET /health` does not call Hermes or a research origin, and it does not include a key.

The unit sets `IPAddressDeny=any` and `IPAddressAllow=localhost`. The process cannot dial off the machine. A Hermes on `127.0.0.1` still fits inside that rule. Widening the address policy is a human edit of the unit.

Uploads are unchanged from `src/uploads.js`. Any file name, including a dotfile. No type list and no size cap. That is the desk's rule, kept on purpose. The bytes go to a directory outside the install tree (the default is the temp directory). The artifact upload in the workflow also sets no file-type filter and no size cap.

## Archive

The workflow uploads one artifact, `research-pi5-seed-<sha>.tar.gz`. `<sha>` is the full git commit the workflow checked out.

| File | What |
| --- | --- |
| `galion-research-linux-arm64` | The Pi executable. |
| `galion-research-linux-x64` | The same desk for an x64 machine. |
| `galion-research-pi5.service` | systemd unit. Loopback `127.0.0.1:8787`. |
| `LICENSE` | Byte-identical to [LICENSE](../LICENSE). |
| `SHA256SUMS` | SHA-256 of those four files, `sha256sum -c` format. |

`compression-level: 0` on the upload only skips a second compression of the gzip. It is not a size cap.

Check the archive before installing it:

```sh
sha256sum -c SHA256SUMS
```

## Build

Node 22 single executable applications run one CommonJS script. The build bundles `src/` and inlines `public/research.html`, then `node --experimental-sea-config` writes a blob with `useCodeCache` and `useSnapshot` false. Those two fields are architecture-specific. Left on, the arm64 executable crashes. The blob is produced by the official `linux-x64` Node binary of version 22.23.4 and injected, with `postject`, into fresh copies of the official `linux-arm64` and `linux-x64` binaries. The injected fuse is `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` flipped to `1`.

The build downloads those two Node tarballs from `nodejs.org` and checks the SHA-256 pinned in `scripts/pi-seed/lib.js`. It downloads `esbuild` and `postject` from the npm registry to bundle and inject. It does not deploy.

`node scripts/pi-seed/build.js` writes `build/pi-seed/out/`. `node scripts/pi-seed/smoke.js` checks a binary. `node scripts/pi-seed/pack.js` writes the archive. `--execute` exits 2.

## Install, by a human

These steps are not run by CI.

The `galion` user must already exist. This kit does not create the account.

```text
/opt/galion/research/release/<sha>/galion-research
/opt/galion/research/current -> /opt/galion/research/release/<sha>
```

1. Unpack the archive. `sha256sum -c SHA256SUMS`.
2. Copy `galion-research-linux-arm64` to `/opt/galion/research/release/<sha>/galion-research` and set mode `0755`. Copy `LICENSE` and `SHA256SUMS` beside it.
3. `ln -sfn /opt/galion/research/release/<sha> /opt/galion/research/current`
4. Copy `galion-research-pi5.service` to `/etc/systemd/system/galion-research-pi5.service`. `systemctl daemon-reload` when the unit file changes. Enable and start `galion-research-pi5` only if `galion-research.service` is not already bound to port 8787.
5. On the Pi, `GET http://127.0.0.1:8787/health`. If Node happens to be installed, `node scripts/check-health.js 8787` is the same check. The desk does not need Node.

The optional environment file is `/etc/galion/research.env`, mode `0600`, owner `galion`. The key is written there, on the host. It is not in the archive. Responses say `key` is `set` or `none`.

`MemoryMax=256M` is the cap from the other research unit. This workflow did not run the executable under that cap.

## Rollback

The previous tree stays at `release/<previous-sha>`.

```sh
ln -sfn /opt/galion/research/release/<previous-sha> /opt/galion/research/current
systemctl restart galion-research-pi5
```

Then check `GET /health` on `127.0.0.1:8787`.

## Licence

`LICENSE` in the archive is a byte copy of the repo file. Standard MIT, plus the four Galion Labs lines in [LICENSE](../LICENSE).
