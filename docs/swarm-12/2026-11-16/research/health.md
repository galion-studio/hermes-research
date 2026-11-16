# Swarm 12 research — read-only health

`GET /health` is the probe an OS status page calls. The body is unchanged: `{"ok":true,"service":"galion-research","bind":"127.0.0.1"}`.

Before this change the probe set a `research_session` cookie and counted toward the request rate limit. A status page polling the desk could fill that limit. The probe now returns before either of those steps. It still does not dial Hermes or a research origin, and the body still has no key.

A browser on another origin can read the body only when that origin is loopback `http`, including the name `localhost`. The response echoes that origin and sets `Cross-Origin-Resource-Policy: cross-origin`. Any other `Origin` is dropped. The body never repeats it. Other methods stay `405`, and a body over 32768 bytes is still `413`.

Uploads are unchanged: any file, including a dotfile, no type list, no size cap.

The arm64 smoke in `.github/workflows/pi-seed.yml` already starts the seed under qemu-user and calls `GET /health`. That run is an emulator on an x64 runner. It is not a Raspberry Pi 5 result.
