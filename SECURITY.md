# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately. Do **not** open a public issue for
a security problem.

Use GitHub's **Report a vulnerability** button under the repository's Security
tab (Private Vulnerability Reporting), which keeps the report confidential
until a fix exists.

Please include what you did, what happened, and what you expected. A proof of
concept helps but is not required.

This is a hobby project maintained by one person, so expect a first response in
days rather than hours.

## Scope

Bomb Party is an offline desktop game with optional play over a local network.
It has no servers, no accounts, and no cloud component, so the realistic threat
model is narrow:

**In scope**

- Escaping the renderer sandbox, or reaching Node/Electron APIs from renderer
  JavaScript.
- Anything a malicious LAN peer can do to a host beyond playing badly:
  crashing it, corrupting its state, reading files, or executing code.
- Escaping the mods directory, or getting a mod to execute code.
- Malformed protocol messages that crash or hang the host.

**Out of scope**

- Anything requiring the attacker to already have code execution on the
  machine, or physical access.
- Vulnerabilities only reachable in development mode (`npm run dev`), which
  loads from `localhost` by design.
- Advisories against build-time dependencies that do not ship in a packaged
  build. `npm audit --omit=dev` currently reports zero vulnerabilities.
- Cheating between consenting players on a LAN. The host is authoritative, but
  the host operator is trusted.

## Design notes relevant to security

These are deliberate properties, not accidents, and are the things worth
attacking:

- The renderer runs with `sandbox: true`, `contextIsolation: true`, and
  `nodeIntegration: false`. `ipcRenderer` is never exposed; the preload
  publishes a fixed set of functions, none of which accepts a caller-supplied
  channel name.
- Navigation and window creation are both denied outright
  (`will-navigate` prevented, `setWindowOpenHandler` returns `deny`), and a
  restrictive Content-Security-Policy is set in the renderer document.
- Clients send intents, never state. Authorisation is checked twice: at the
  wire, where privileged intents are rejected before parsing, and again in the
  engine, which refuses any intent naming a player other than the authenticated
  sender.
- Mods are **data only**. There is no plugin entry point, so a mod cannot
  execute anything. Every mod path is verified to resolve inside the mods root.
- Inbound WebSocket messages are size-capped and validated against an explicit
  allowlist of message shapes.
