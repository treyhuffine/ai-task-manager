# Remote Access & HTTPS

How to reach your dev server from other devices (phone, tablet, another laptop) — and why HTTPS matters for mobile.

## Why HTTPS matters

Most browser APIs that touch hardware (microphone, camera, clipboard, notifications) only work in a **secure context** — HTTPS, or `localhost`. On mobile, that means:

- **Voice input silently fails on plain HTTP.** `navigator.mediaDevices` is undefined, `getUserMedia` throws, the mic button is disabled with an "enable HTTPS" hint.
- This is a browser/platform rule, not an app choice.

If you only access the app on the machine it's running on (`http://localhost:4224`), you don't need any of this. LAN and remote access from other devices is where HTTPS becomes the gate.

## Built in: the Beamd tunnel

The app can open its own tunnel, no external service to wire up. Connect the machine once (`beamd login`, or Settings > Devices > Connect Beamd), then choose **Use Beamd URL** under Remote base URL. That opens a tunnel to this server and saves the returned URL as the remote base URL, so pairing links and notification deep links all point at it.

Turn on **Reconnect automatically on startup** to have the app re-open that tunnel every time it boots. Headless boxes need this: without it, a reboot leaves the machine unreachable until someone opens the UI, which is the thing that just became unreachable.

### Tunnel names and collisions

A Beamd tunnel is reached at `https://<name>.<beamd domain>`, and the name is unique per edge. The default name comes from the app id (`flow`, or `flow-dev` in development), which is identical on every install. So the second machine you run the app on gets:

```
open failed: 502 Bad Gateway: name_taken: flow.beamd.run is taken
```

That is not a bug, it means your other machine already holds the name. Give each machine its own under **Remote base URL > Advanced: Beamd tunnel name**. Names are single DNS labels: lowercase letters, numbers and hyphens, up to 63 characters, no dots.

Renaming is safe to do while a tunnel is live. The new name is opened first, then the setting is saved, then the old tunnel is closed, so a name that is also taken fails with nothing changed and the current tunnel still up.

For headless installs where there is no UI to click, set the name at launch instead:

```bash
FLOW_TUNNEL_NAME=flow-vps flow start
```

The env var wins over the saved setting and makes the settings field read-only, so the running config is never a lie.

## Options ranked by effort

**The overall best pick for most people is Cloudflare Tunnel** — option 2 below. The only reason it's not option 1 is the one-time domain purchase (~$10/yr at Cloudflare Registrar, at-cost). Everything else about it is free, permanent, and unlimited. If you're not buying a domain, start with option 1 instead.

### 1. ngrok with a free static domain — lowest friction

Permanent URL on the free tier, no domain or DNS required. One command to run.

```bash
brew install ngrok
# Sign up at ngrok.com, then paste your authtoken:
ngrok config add-authtoken <token>
# Claim your free static domain at dashboard.ngrok.com/domains → "New Domain"
ngrok http --url=your-name.ngrok-free.app 4224
```

Then point pairing at it:

```bash
flow pair --set-url https://your-name.ngrok-free.app
```

Pros: real cert, permanent URL, works over any network, zero DNS config.
Cons: free tier has a warning interstitial on first visit for unverified visitors; rate-limited; single reserved domain only.

### 2. Cloudflare Tunnel — the right default if you'll buy a domain

Completely free forever: unlimited bandwidth, unlimited tunnels, real cert auto-issued, no warning page, no rate limits, permanent URL under a domain you control (`flow.yourdomain.com`).

The only cost is a domain (~$10/yr at [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/), sold at-cost with no markup). That same domain works for any other project you ever do, so it's not really a tunnel cost — it's a one-time "I own a domain now" cost.

Prereq: domain on Cloudflare DNS (buy at Cloudflare Registrar for ~$10/yr, or move nameservers from any other registrar to Cloudflare, free).

```bash
brew install cloudflared
cloudflared tunnel login                        # browser auth
cloudflared tunnel create flow                  # creates tunnel
cloudflared tunnel route dns flow flow.yourdomain.com
cloudflared tunnel run --url http://localhost:4224 flow
```

Then:

```bash
flow pair --set-url https://flow.yourdomain.com
```

Pros: the most "real" setup. Works from anywhere. No middleman branding.
Cons: needs a domain.

### 3. Tailscale Serve — private to your tailnet

If you want the app reachable only from your own devices, not the public internet. Requires Tailscale installed on both ends.

**Important:** the Mac App Store version of Tailscale has historical quirks with `tailscale serve`. Use the standalone cask:

```bash
# If you have App Store Tailscale, delete it first
brew install --cask tailscale-app
# Sign in, then:
tailscale serve --bg --https=443 http://localhost:4224
flow pair --set-url https://<machine>.<tailnet>.ts.net
```

One-time prereq: enable HTTPS in the admin console at https://login.tailscale.com/admin/dns → "Enable HTTPS…".

Pros: fully private, free, permanent URL, real cert.
Cons: devices must be on your tailnet. One-time App Store swap if you're on that.

### 4. Other tunnel services

ngrok isn't the only tunnel. Worth-knowing alternatives:

| Service | Free permanent URL? | Cheap paid? | Warning page? | Notes |
|---|---|---|---|---|
| [Zrok](https://zrok.io) | Yes | n/a | No | Open source, self-hostable. Strongest ngrok replacement. |
| [Pinggy](https://pinggy.io) | No (60-min sessions) | **$2.50/mo** | No | Cheapest permanent paid tier. Multi-protocol (HTTP/HTTPS/TCP/UDP/TLS). SSH-based, no download. |
| [LocalXpose](https://localxpose.io) | Yes (tight caps) | Yes | No | ngrok-like UX. Good free tier for light use. |
| [Tunnelmole](https://tunnelmole.com) | Yes | n/a | No | Open source, `npx tunnelmole 4224`. Simpler than Zrok. |
| [localtunnel](https://localtunnel.me) | Not really | n/a | No | `npx localtunnel`. Subdomain not reserved — race on restart. |
| [Serveo](https://serveo.net) | Yes (with SSH key) | n/a | No | SSH-based, no install. Intermittent outages. |
| Cloudflare Quick Tunnel | No (rotates) | n/a | No | `cloudflared tunnel --url` — zero config, rotating URL. |
| [Expose](https://expose.dev) | n/a | **$10/yr** | No | Laravel team. Cheapest annual subscription. |

For the exhaustive list including every self-hostable option, see [awesome-tunneling](https://github.com/anderspitman/awesome-tunneling).

Self-hosted option (free after VPS cost, most reliable long-term):

- **frp on a VPS** (Oracle Free Tier or Hetzner CX11) with Caddy handling TLS. You own every hop. Requires a domain and ~an afternoon of setup.

### 5. LAN HTTP (no HTTPS) — works with limitations

If you just want to browse the app from another device on the same Wi-Fi and you don't need voice:

```bash
flow pair --lan     # prints the http://192.168.x.x URL + QR
```

Pros: zero setup.
Cons: **no voice input on mobile** (secure-context requirement). HTTP only. Only works on the same network.

## Which to pick

| Scenario | Recommended |
|---|---|
| **Most people, long-term** | **Cloudflare Tunnel** (+ ~$10/yr domain) |
| Will never buy a domain | **ngrok free static domain** or **Zrok** |
| Private to my devices only | **Tailscale Serve** (cask version) |
| Same-Wi-Fi read-only, no voice | **LAN HTTP** |
| Cheapest paid permanent, no domain | **Pinggy** ($2.50/mo) |
| Want to own every hop | **Self-hosted frp + Caddy on a VPS** |

## Re-pairing after switching URLs

Each URL is a distinct origin in the browser — the auth token lives in `localStorage` against that origin. When you switch (e.g. LAN HTTP → HTTPS via Tailscale), existing paired devices need to pair again on the new origin:

```bash
flow pair
```

Old URLs keep working if you leave them configured. The new QR/URL just covers the new origin.

## Notes

- The pairing URL persists across reboots via `flow pair --set-url`. Clear with `--clear-url`.
- The CLI prints multiple reachable addresses (Remote / LAN / localhost) whenever possible, so paired devices always have a working fallback.
- Voice transcription itself runs server-side (Parakeet via Docker), so the phone only needs to record and upload — HTTPS is purely for the `getUserMedia` gate.
