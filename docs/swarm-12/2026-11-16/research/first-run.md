# Swarm 12 research — first run

The empty desk opens on one screen. The kicker is Galion Research. The heading is the voice line, What are we looking into? The line under it is `A question starts here.` The field, the file plus, Silence, Show interface, and the Ice / Sky / Ocean disc stay.

That screen is only the minimal empty desk. Show interface hides it. A question in flight, an error, an offline answer, and a returned answer hide it too. Found, Inferred, and Unknown stay on the open desk. Uploads stay as they are: any file, including a dotfile, no type list, no size cap. The page does not name an address.

`first-run-desktop.png` and `first-run-phone.png` are Playwright screenshots from this change, taken in Chromium on the machine that ran the suite. They are not photographs of a Raspberry Pi 5.

`.github/workflows/pi-seed.yml` builds the arm64 executable and starts it under qemu-user. `scripts/pi-seed/smoke.js` then calls `GET /health` and checks that `/research` contains this screen. qemu-user on an x64 runner does not boot Raspberry Pi OS and does not measure a Pi 5. A green run is an emulator result.
