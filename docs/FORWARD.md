# Forward contract

Galion Research stays the desk on loopback port 8787. Two other programs can sit on this machine. This contract is how the desk reaches them. Both configured upstreams are loopback `http` only. A username, a password, `https`, or any other host is refused and is not dialed.

Read from source on 2026-11-15, not from a live process:

- `obsidian-open-mind` `crates/openmind-desktop` binds `127.0.0.1:18181` (`DEFAULT_BIND` in `src/lib.rs`). `GET` and `HEAD` of `/one` and `/research` are HTML entry pages (`reply` in `src/http.rs`). Each page carries `data-entry="one"` or `data-entry="research"` (`entry` in `src/page.rs`). `GET /health` is not that listener. `GET /probes` is a different read-only report and is not this contract.
- `galion-one-voice` `galion-render` `src/backends/web.rs` serves the research desk on its own loopback listener. `GET /health` is the text `ok`. `GET /research/hermes`, `GET /research/history`, and `POST /research/ask` are the JSON routes. The ask body is `galion-research/1` with `status`, `reply`, and `citations` as `{ "n", "text" }`. An empty question is `400` with the text `question`. The gateway key stays on that server.

This desk does not start either process, and it does not bind 18181.

## Config

| Variable | Upstream | When it is used |
| --- | --- | --- |
| `GALION_OPENMIND_URL` | openmind-desktop | Loopback origin only. Example: `http://127.0.0.1:18181`. |
| `GALION_VOICE_URL` | galion-one-voice web surface | Loopback origin only. When set, this is the voice upstream. |
| `GALION_RESEARCH_URL` | older research origin | Used only when `GALION_VOICE_URL` is unset. The same loopback `http` rule applies. `https` and any other host are refused and are not dialed. |
| `GALION_UPSTREAM_TIMEOUT_MS` | both | Default 4000. Clamped from 50 to 4000. |

`GET /one` redirects to `{GALION_OPENMIND_URL}/one` when that value is an accepted loopback origin. Otherwise it stays `GALION_ONE_URL`, default `https://galion.app/one`.

## What is forwarded

| This desk | openmind-desktop | galion-one-voice |
| --- | --- | --- |
| `GET /research/wire` | `GET /one` and `GET /research` | `GET /health` |
| `GET /one` | redirect to `/one` | — |
| `GET /research/hermes` | — | `GET /research/hermes` |
| `GET /research/history` | — | `GET /research/history` |
| `POST /research/ask` | — | `POST /research/ask` with `{ "question": "..." }` |

The desk page itself stays here. openmind-desktop's `/research` entry is not a substitute for it.

No `Authorization` header is added on these forwards. The Hermes key is not copied into `/research/wire`.

## Health and status

`GET /health` is unchanged. It answers `{"ok":true,"service":"galion-research","bind":"127.0.0.1"}` and does not dial an upstream.

`GET /research/wire` is the indicator. The served desk page shows it as `One · … · Voice · … · Hermes · …` beside the Hermes line. The static file `public/research.html` is not edited; the line is added when the page is served.

States:

| State | Meaning |
| --- | --- |
| `unset` | That variable is empty. |
| `refused` | The value is not loopback `http`. Nothing is dialed. The ask uses Hermes, then local knowledge, and that local answer has an empty citation list. |
| `up` | Open Mind returned both entry pages, or the voice `/health` body was `ok`, or Hermes `GET /health` on its loopback port was 2xx. |
| `down` | The connection failed, or the status was outside 2xx. |
| `timeout` | The exchange passed `GALION_UPSTREAM_TIMEOUT_MS`. |
| `malformed` | The bytes were not the entry page, or the voice health body was not `ok`. |
| `offline` | Hermes is not attached. Its port is not dialed. |

Hermes `GET /health` is the port of `GALION_LLM_URL` with the path `/health`. The probe does not send the key and does not post a chat completion. A chat URL that is not loopback is `refused`.

## Citations

A voice `2xx` body is kept only when it is JSON `schema` `galion-research/1` and, for an ask, `status` and `reply` are strings and `citations` is an array of `{ "n", "text" }` with an integer `n` from 1 to 999 and a non-empty `text` of at most 240 characters. At most 12 citations. `key`, when present, is only `set` or `none`.

The desk does not turn a `[n]` line in the reply into a citation. An empty `citations` array stays empty. A body that is not that shape, a timeout, a down connection, or a body that contains the gateway key is not shown. The desk then uses the local Hermes turn, and if that does not answer, local knowledge with `status` `Offline` and `citations` `[]`.

A voice `400` is returned as text, same as before, unless the body contains the gateway key.

## Tests

`test/contract/forward.test.js` speaks only to stub servers on the loopback interface. It covers a handed citation, a timeout, Hermes down, a malformed upstream body, and a refused non-loopback config. The malformed body is not copied into the answer.
