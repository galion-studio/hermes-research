# Deploy kit

Galion Research is not deployed. This repository holds the kit a human can apply later. Nothing here connects to a host, changes DNS, Cloudflare, a firewall, or a port, or restarts a unit.

The shape follows [galion-one-voice `scripts/deploy/release-dryrun.sh`](https://github.com/galion-studio/galion-one-voice/blob/main/scripts/deploy/release-dryrun.sh): keep each install on disk, point `current` at it with `ln -sfn`, restart the unit, and roll back by pointing `current` at the previous directory. That script uses `/opt/galion/<ver>` and `/opt/galion/current`. Research uses its own root so it does not replace the voice symlink.

```text
/opt/galion/research/release/<sha>/
/opt/galion/research/current -> /opt/galion/research/release/<sha>
```

`<sha>` is the full git commit that CI ran. Older `release/<sha>` directories stay on disk. Rollback does not delete them.

## Files

| Path | What |
| --- | --- |
| `deploy/systemd/galion-research.service` | systemd unit. `User=galion`. `PORT=8787`. Sandbox. Localhost only. |
| `deploy/research.env.example` | Environment file with no secret. Copy on the host to `/etc/galion/research.env`. |
| `scripts/check-health.js` | `GET /health` on `127.0.0.1` only. `--execute` exits 2. |
| `scripts/deploy/release-dryrun.sh` | Prints the layout and the rollback. `--execute` exits 2. |
| `.env.example` | The same variables for a local shell. No secret. |

## Listener

`src/server.js` binds `127.0.0.1`. The unit sets `PORT=8787` after the environment file, so the listen address is `127.0.0.1:8787`. A `PORT` line in the env file does not move it.

Sandbox:

- `NoNewPrivileges=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`
- `ProtectSystem=strict`, `ProtectHome=yes`
- `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectControlGroups`
- `ProtectClock`, `ProtectHostname`, `RestrictNamespaces`, `RestrictRealtime`, `RestrictSUIDSGID`, `LockPersonality`
- `CapabilityBoundingSet=` empty, `DevicePolicy=closed`
- `RestrictAddressFamilies=AF_INET AF_INET6 AF_NETLINK` (`AF_NETLINK` is how the process reads local interface state; it is not a path off the machine)
- `IPAddressDeny=any` and `IPAddressAllow=localhost`
- `MemoryMax=256M`, the ceiling named for the galion-voice unit draft in galion-one-voice `docs/deploy/TITANAXE-VPS.md`. It is a cap, not a measured size of this process.
- `Restart=on-failure` and `RestartSec=5`, as in `deploy/systemd/galion-clone-cbx.service`

`User=galion` must already exist. This kit does not create the account. Node on the host is `/usr/bin/node`, version 22 or newer, the range in `package.json`.

`IPAddressAllow=localhost` keeps the desk and Hermes (`127.0.0.1:8642`) on the machine. A `GALION_RESEARCH_URL` that is not loopback `http` is refused in the process and is not dialed. The ask then uses Hermes on loopback, then local knowledge, with an empty citation list. Widening the address policy is a human edit of the unit.

The unit does not set a syscall filter, and it does not set `MemoryDenyWriteExecute`. This tree has not run a syscall filter against Node 22, and V8 maps pages it both writes and executes.

## Environment

`deploy/research.env.example` lists every variable the process reads. `GALION_LLM_KEY` is commented and empty. The real key is written on the host, mode `0600`, owner `galion`. It is not copied into a reply. Responses say `key` is `set` or `none`.

## Health

`GET /health` returns `200` and `{"ok":true,"service":"galion-research","bind":"127.0.0.1"}`. It does not call Hermes, the research origin, or include the key.

`GET /research/wire` is the desk indicator. It dials only the loopback upstreams from [docs/FORWARD.md](FORWARD.md). It does not include the key. `GET /health` does not call it.

```sh
node scripts/check-health.js
node scripts/check-health.js 8787
```

The script accepts a port and always requests `http://127.0.0.1:<port>/health`. Any other argument, or `--execute`, exits 2. It does not start the process.

## Release

Print the steps. This does not copy files and does not restart anything.

```sh
scripts/deploy/release-dryrun.sh
scripts/deploy/release-dryrun.sh <sha>
```

`--execute` exits 2.

A human, after CI is green on that sha:

1. Unpack that commit into `/opt/galion/research/release/<sha>/`. Do not build on the host. Leave older release directories in place.
2. `ln -sfn /opt/galion/research/release/<sha> /opt/galion/research/current`
3. Install the unit and the env file if they are not installed yet. `systemctl daemon-reload` when the unit file changes. `systemctl restart galion-research`
4. On that host, `node scripts/check-health.js 8787` against loopback.
5. Record who, the sha, and the time outside this repo.

`WorkingDirectory` and `ExecStart` use `/opt/galion/research/current`, so the symlink is the cutover.

## Rollback

Read `current` before the next cutover. The previous tree is still at `release/<previous-sha>`.

```sh
ln -sfn /opt/galion/research/release/<previous-sha> /opt/galion/research/current
systemctl restart galion-research
node scripts/check-health.js 8787
```

The dry-run script prints the same rollback line. The previous directory is kept.

## CI

`.github/workflows/ci.yml` runs `npm run build`, `npm test`, and the Playwright suite on push and on pull request. `npm run build` is `node --check` on the sources, the health check, and the tests. There is no bundle and no deploy job. Playwright stays the desktop and phone check from the research desk.

## Licence

Standard MIT, plus the four Galion Labs lines in [LICENSE](../LICENSE).
