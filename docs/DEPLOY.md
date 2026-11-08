# Deploying coyote

coyote is a single static Go binary. It serves the web client, the signaling
WebSocket, and the SFU media plane from one process. There is **no database**, and
no separate TURN server: the SFU has a public IP, so peers reach it directly over UDP.
For the clients that can't use UDP, an optional TURN relay is built into the same
binary (see [TURN relay](#turn-relay)).

Two independent network planes, which matters for every step below:

| Plane | Transport | Who terminates it |
| --- | --- | --- |
| App shell + signaling | HTTPS / WSS on 443 | your reverse proxy (Caddy/nginx) |
| Media (RTP) | UDP on a fixed port range, directly to the box | the binary itself — **not** proxied |

## Why TLS is mandatory

Browsers only expose `getUserMedia` / `getDisplayMedia` on a **secure context**
(`https://` or `localhost`). Without HTTPS the camera/mic never turn on and the
lobby preview stays black. In production you terminate TLS at a reverse proxy
(recommended) or with the binary's own cert flags. `http://localhost:8080` works
for local dev only.

## Configuration

Flags take precedence over `WVC_*` environment variables, which take precedence
over defaults.

| Flag | Env | Default | Purpose |
| --- | --- | --- | --- |
| `-addr` | `WVC_ADDR` | `:8080` | HTTP listen address (put the proxy in front). |
| `-public-ip` | `WVC_PUBLIC_IP` | _(empty)_ | **Public IP advertised in ICE candidates.** Set to the server's reachable IP or clients can't send media. |
| `-udp-min` | `WVC_UDP_MIN` | `50000` | First UDP port for media. |
| `-udp-max` | `WVC_UDP_MAX` | `50199` | Last UDP port for media. Open this whole range in the firewall. |
| `-secret` | `WVC_SECRET` | _(empty)_ | Shared HMAC secret for join tokens **and** `/api/provision`. Must match the Anope module's secret. Empty disables all channel-room / token features. |
| `-adhoc` | `WVC_ADHOC` | `true` | Allow ad-hoc rooms (anyone visiting `/<name>` and joining creates one). Set `false` for a channel-rooms-only SwiftIRC deployment. |
| `-trust-proxy` | `WVC_TRUST_PROXY` | `false` | Trust `X-Forwarded-For`. **Enable only behind a trusted proxy** (it reads the last XFF entry). Off = the direct socket IP is used. |
| `-apple-app-id` | `WVC_APPLE_APP_ID` | _(empty)_ | iOS `<TEAMID>.<bundle id>`; serves `/.well-known/apple-app-site-association` so room links open the app. See [Mobile app links](#mobile-app-links). |
| `-android-package` | `WVC_ANDROID_PACKAGE` | _(empty)_ | Android applicationId for `/.well-known/assetlinks.json`. |
| `-android-cert-sha256` | `WVC_ANDROID_CERT_SHA256` | _(empty)_ | Comma-separated signing-cert SHA-256 fingerprints for assetlinks (both Android settings needed). |
| `-tls-cert` / `-tls-key` | `WVC_TLS_CERT` / `WVC_TLS_KEY` | _(empty)_ | Optional built-in TLS instead of a proxy. Set both or neither. |
| `-turn-addr` | `WVC_TURN_ADDR` | _(empty)_ | Plain-TCP listen address for the embedded [TURN relay](#turn-relay), exposed directly or behind a TLS-terminating proxy. Needs `-public-ip`. Set together with `-turn-urls`, or leave both empty for no relay. |
| `-turn-urls` | `WVC_TURN_URLS` | _(empty)_ | Comma-separated TURN URLs given to clients, e.g. `turns:turn.example.com:443?transport=tcp`. |
| `-log-level` | `WVC_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. An unparseable value refuses to start rather than falling back. |

### When to raise the log level

`debug` adds per-peer media-plane detail: joins and rejoins with their role and
session ref, and every ICE candidate the SFU declined. It is chatty on a busy room,
so raise it to chase something specific and put it back.

The case it exists for is **a participant nobody can see or hear while everything
else looks healthy**. Their own console shows the forwards announced and the tracks
live but no RTP arriving at all — `!! NO INBOUND RTP — label=yes media=yes
track=live` on every mic and camera. That is what an unbound sender looks like from
the receiving end: the SFU added and announced the forwards, but Pion binds a
forwarded track to a sender only once that peer's negotiation completes, so one
offer or answer that failed to apply silences every forward to them for the rest of
the call.

The lines that name it are already at `warn`, so they appear without raising
anything. Grep the server log for the affected peer id before turning the level up —
if one of these is present, it is the answer:

- `sfu peer media transport failed` — this peer's ICE/DTLS never established, or
  died. **This is a network fault, not a code one.** If it lands ~30s after that
  peer joined, their client could not reach the media UDP range at all: check that
  `-udp-min`–`-udp-max` is open to the box *and* that `-public-ip` is the address
  that peer actually reaches it on. On a cloud VM remember there are usually two
  firewalls — the provider's security list and the instance's own `iptables` — and
  the second one is the one people forget.
- `offer rejected` / `answer rejected` — the negotiation itself would not apply,
  carrying the room, the peer id and the underlying error.
- `media offer dropped (send overflow/closing)` — the peer never received the offer
  in the first place.

The matching **`sfu peer media transport closed`** is at `debug` on purpose: it is
reached on every ordinary teardown, including when the server closes the peer
connection itself, so it says nothing about health. Only `failed` is a fault.

A peer whose transport fails has its signaling socket closed too, so it reconnects
and rebuilds the call by itself within about a second. Before that it kept its place
in the roster with no media in either direction and no way back — present, and
neither seeing nor heard.

Routes served: `GET /` (app shell + assets), `GET /ws/{room}` (signaling),
`GET /api/rooms/{room}` (occupancy JSON), `POST /api/provision` (Anope), and
`GET /healthz`.

### TURN relay

Some clients can't reach the UDP range at all. A browser restricted to proxied
traffic (Chrome's WebRTC IP-handling policy `disable_non_proxied_udp`, which VPN and
privacy extensions set and which can also be a managed policy) gathers **no ICE
candidates** unless a TURN-over-TCP server is configured. It joins the room, since
signaling rides the HTTPS WebSocket, and then gets no media in either direction until
the server drops it ~30s later. Its console logs `[peer] ice gathering complete with
NO candidates`. UDP-hostile networks fail the same way.

The embedded relay gives those clients a path over TCP 443:

- **It relays only to the SFU** (`-public-ip`), so it can't be used as an open proxy.
- **Credentials are minted per join** (TURN REST style, valid 24h) and sent in the
  `joined` frame. The signing secret is random per process, so there's nothing to
  configure. A restart drops every call anyway, and the rejoin carries fresh
  credentials.
- **Plain TCP only.** Either expose it as `turn:<host>:3478?transport=tcp`, or put
  TLS in front of it on 443 under its own hostname and advertise
  `turns:<host>:443?transport=tcp` for networks that only allow 443 out. Clients that
  can use UDP never touch the relay.
- **Each allocation logs `turn relay allocation created peer=<id>` at info.** Only
  relayed clients allocate, so this line answers "was this participant relayed?"

Relayed media goes client → relay → SFU on the same host, so the relay adds no
extra network hop.

With Caddy, TLS-terminating a raw TCP stream needs the `layer4` plugin. For nginx, see
[TURN relay through nginx](#turn-relay-through-nginx). The Kubernetes manifests use a
Traefik `IngressRouteTCP`.

### Firewall

- **443/tcp** (or 80→443) to the box, proxied to `-addr`.
- **`-udp-min`–`-udp-max`/udp** open directly to the box (default 50000–50199).
  These carry media and must **not** go through the reverse proxy.
- `-public-ip` must equal the address clients reach over that UDP range.
- **3478/tcp**, if you advertise a plain `turn:…:3478` relay URL. Open it in both the
  cloud security list and the host firewall.

## Build & run

```
go build -o coyote ./cmd/coyote

# Channel-rooms-only SwiftIRC deployment behind a proxy:
./coyote \
  -addr 127.0.0.1:8080 \
  -public-ip 203.0.113.10 \
  -udp-min 50000 -udp-max 50199 \
  -secret "$WVC_SECRET" \
  -adhoc=false \
  -trust-proxy
```

Bind `-addr` to loopback (`127.0.0.1:8080`) when a proxy fronts it, so the plain
HTTP port isn't exposed. The UDP media range still binds on all interfaces and is
reached via `-public-ip`.

## Reverse proxy

### Caddy (recommended — automatic HTTPS)

`reverse_proxy` upgrades WebSockets and sets `X-Forwarded-For` on its own, so
`-trust-proxy` is safe with this config.

```caddyfile
# /etc/caddy/Caddyfile
vc.swiftirc.net {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

Caddy provisions and renews a Let's Encrypt certificate automatically. Nothing
else is required for TLS.

### nginx

nginx needs the upgrade headers spelled out for the WebSocket, and
`proxy_add_x_forwarded_for` to append the real client IP (which `-trust-proxy`
then reads).

```nginx
server {
    listen 443 ssl;
    server_name vc.swiftirc.net;

    ssl_certificate     /etc/letsencrypt/live/vc.swiftirc.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vc.swiftirc.net/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;          # WebSocket upgrade
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;                        # keep idle calls alive
    }
}
```

Media UDP does not pass through nginx — clients reach `-public-ip` on the UDP
range directly.

#### TURN relay through nginx

TURN is not HTTP, so the relay has to be proxied from a top-level `stream {}` block,
a sibling of `http {}`, never a `server {}` inside `http {}`. The `stream` module ships
with most distro builds; on Debian/Ubuntu it is loaded by
`/etc/nginx/modules-enabled/50-mod-stream.conf` (package `libnginx-mod-stream`).

**Plain TURN on 3478 (simplest).** This is enough for the common case, a browser
restricted to proxied traffic by a VPN or privacy extension: it only needs *some* TCP
path. The media inside the relay is already DTLS/SRTP-encrypted, so the plain `turn:`
scheme exposes nothing.

```nginx
# /etc/nginx/nginx.conf — top level, next to http {}
stream {
    server {
        listen 3478;
        proxy_pass 10.0.0.5:3478;   # coyote's -turn-addr (the SFU host)
        proxy_timeout 1h;           # stream default is 10m; a relayed call is one long connection
    }
}
```

Run coyote with `-turn-addr 10.0.0.5:3478` (or `0.0.0.0:3478`) and
`-turn-urls 'turn:vc.swiftirc.net:3478?transport=tcp'`, and open 3478/tcp to the nginx
box. If nginx and coyote share the host, nginx can't take 3478 itself: give coyote
`-turn-addr 127.0.0.1:3479` and `proxy_pass 127.0.0.1:3479`. Or skip nginx for TURN
entirely and let coyote listen on the public 3478.

**TURN over TLS on 443 (for networks that only let 443 out).** `stream` must then own
port 443 and split by SNI. The TURN hostname goes to a TLS-terminating listener in
front of the relay. Everything else passes through untouched to the existing HTTPS
`server {}` blocks, which move to a local port:

```nginx
stream {
    map $ssl_preread_server_name $tls_backend {
        turn.swiftirc.net  127.0.0.1:5349;   # TURN: terminate TLS below
        default            127.0.0.1:8443;   # everything else: the http {} servers
    }
    server {
        listen 443;
        ssl_preread on;
        proxy_pass $tls_backend;
        proxy_protocol on;                   # carry the real client IP to the http {} side
    }
    server {
        listen 127.0.0.1:5349 ssl proxy_protocol;
        ssl_certificate     /etc/letsencrypt/live/turn.swiftirc.net/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/turn.swiftirc.net/privkey.pem;
        proxy_pass 10.0.0.5:3478;
        proxy_timeout 1h;
    }
}
http {
    # every former "listen 443 ssl;" becomes:
    #   listen 127.0.0.1:8443 ssl proxy_protocol;
    #   set_real_ip_from 127.0.0.1;
    #   real_ip_header proxy_protocol;
    ...
}
```

Advertise `turns:turn.swiftirc.net:443?transport=tcp`, and give the TURN hostname its
own certificate, e.g. `certbot certonly --nginx -d turn.swiftirc.net`. Without the
`proxy_protocol`/`real_ip` lines, every HTTP client appears as 127.0.0.1 and
`X-Forwarded-For` (which `-trust-proxy` reads) carries the wrong address. Both URLs
can be advertised together, comma-separated in `-turn-urls`, and the browser tries
each.

**Verify** from any machine outside. A STUN binding request should get a binding
response back:

```
python3 - vc.swiftirc.net 3478 <<'EOF'
import os, socket, struct, sys
s = socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=6)
tid = os.urandom(12)
s.sendall(struct.pack("!HHI", 1, 0, 0x2112A442) + tid)
d = s.recv(2048)
print("OK: relay answered" if d[:2] == b"\x01\x01" and d[8:20] == tid else f"WRONG: {d[:60]!r}")
EOF
```

What the failures look like (each one seen in practice):

| Symptom | Meaning |
| --- | --- |
| Connection times out | A firewall drops 3478: the cloud security list (Oracle allows only 22 by default) or the host's iptables `REJECT`. Both layers need opening. |
| `HTTP/1.1 400 Bad Request — Server: nginx` | The port reaches nginx's `http {}` side. The block is in the wrong context. |
| Accepted, then closed with no data | `stream` is fine but can't reach the upstream. Check `/var/log/nginx/error.log` for `connect() failed ... while connecting to upstream`, the `proxy_pass` address, coyote's `turn relay listening` log line, and the coyote host's firewall toward the nginx box. |
| Browser logs `ice candidate error — turn:… 701` | The same reachability failure, seen from the client. |

### Built-in TLS (no proxy)

For a simple single-host setup you can skip the proxy:

```
./coyote -public-ip 203.0.113.10 -addr :443 \
  -tls-cert /etc/coyote/fullchain.pem \
  -tls-key  /etc/coyote/privkey.pem
```

You are then responsible for certificate renewal yourself.

## Renaming an existing deployment

The project was called `webrtc-chat` until it became `coyote`. Nothing in the
protocol or on-disk state changed, so an existing host needs only its names
brought across:

```
systemctl stop webrtc-chat
mv /etc/webrtc-chat /etc/coyote
mv /usr/local/bin/webrtc-chat /usr/local/bin/coyote
mv /etc/systemd/system/webrtc-chat.service /etc/systemd/system/coyote.service
# edit the unit: EnvironmentFile and ExecStart both still say webrtc-chat
systemctl daemon-reload && systemctl enable --now coyote
```

`WVC_SECRET` and every other env var keep their names — the `WVC_` prefix is
unchanged — so the Anope module needs no edit and rooms keep working. The Anope
module itself is still `m_webrtc_chat` and is deliberately untouched.

## systemd unit

```ini
# /etc/systemd/system/coyote.service
[Unit]
Description=coyote SFU
After=network-online.target
Wants=network-online.target

[Service]
User=webrtc
Group=webrtc
# Secret lives in a root-only env file, not on the command line (argv is world-readable).
EnvironmentFile=/etc/coyote/env
ExecStart=/usr/local/bin/coyote \
  -addr 127.0.0.1:8080 \
  -public-ip 203.0.113.10 \
  -udp-min 50000 -udp-max 50199 \
  -adhoc=false \
  -trust-proxy
Restart=on-failure
RestartSec=2s

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```
# /etc/coyote/env   (chmod 600, root-owned)
WVC_SECRET=the-shared-hmac-secret-also-in-anope.conf
```

```
systemctl daemon-reload
systemctl enable --now coyote
journalctl -u coyote -f
```

On restart the process broadcasts `server-restarting` and closes connections;
clients show "Reconnecting…" and re-join automatically once it's back up, so a
short `RestartSec` keeps interruptions brief.

## Kubernetes (k3s + Traefik)

This path and the systemd one differ in one structural way: under Kubernetes the pod
runs on the **host's** network namespace. That is not a preference. The SFU
allocates ephemeral media ports across `WVC_UDP_MIN`–`WVC_UDP_MAX` with no UDP mux,
and nothing in Kubernetes routes an arbitrary UDP range to a pod on the cluster network.
Traefik carries the app shell and signaling; media bypasses it and reaches the node
directly, exactly as it bypasses nginx above.

### Build and load the image

There is no registry in this flow — the image goes straight into k3s's containerd:

```
docker build -t coyote:0.1.0 .
docker save coyote:0.1.0 | sudo k3s ctr images import -
```

Two manifest details are what make that work:

- `imagePullPolicy: IfNotPresent` — the default sends k3s looking for a registry
  that does not exist.
- a real tag rather than `:latest`. The explicit policy above is what does the work;
  the tag is belt and braces, because an *omitted* pull policy defaults to `Always`
  on a `:latest` or untagged image.

**The image embeds whatever background scenes are in the build context.** Four of the
six are frames from copyrighted film and television (see `THIRD-PARTY-NOTICES.md`).
They are untracked, so a clone builds without them and a local checkout builds with
them. That is fine while the image only ever moves from your machine to your own
node. Pushing it to a public registry would distribute them — rebuild from a clean
clone first.

### TLS: the cert resolver must exist first

`deploy/k8s/ingressroute.yaml` references `certResolver: letsencrypt`, but **k3s's
bundled Traefik ships with no ACME resolver configured out of the box.** Apply the
manifests without doing anything else first and Traefik falls back to its default
self-signed certificate — and because TLS is mandatory here (browsers only expose
`getUserMedia` on a secure context, same as above), that makes the app unusable, not
merely untrusted.

Give the bundled Traefik a resolver before applying `ingressroute.yaml`, via a
`HelmChartConfig` k3s picks up on start (or `helm upgrade` if you manage Traefik
yourself):

```yaml
# /var/lib/rancher/k3s/server/manifests/traefik-config.yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    certificatesResolvers:
      letsencrypt:
        acme:
          email: you@example.net
          storage: /data/acme.json
          httpChallenge:
            entryPoint: web
```

The resolver's name (`letsencrypt` above) must match `certResolver` in
`ingressroute.yaml`, and the HTTP-01 challenge needs port 80 reachable from the
internet. If you'd rather not commit to this exact recipe, see k3s's own Traefik
customisation docs — but do not skip this step and assume the default works; it does
not, and the failure looks like a working deploy with a browser TLS warning until you
notice `getUserMedia` never fires.

### Deploy

```
kubectl create secret generic coyote --from-literal=secret='<shared HMAC secret>'
kubectl apply -f deploy/k8s/
```

Edit the host and `certResolver` in `deploy/k8s/ingressroute.yaml` to match your
Traefik setup first. Do the same for the TURN host in
`deploy/k8s/ingressroutetcp.yaml` and `WVC_TURN_URLS` in `deployment.yaml` (they must
match), and add a DNS record for the TURN host pointing at the node. Traefik routes it
by SNI on the same `websecure` entrypoint, terminates TLS, and forwards plain TCP to
the relay on `:3478`. To run without a relay, drop both `WVC_TURN_*` variables and
skip `ingressroutetcp.yaml`. `deploy/secret.example.yaml` is a template showing the Secret's
shape; it lives outside `deploy/k8s/` so a re-apply cannot overwrite your real
secret with its placeholder.

None of the three manifests sets a `namespace`, and the `kubectl create secret`
command above doesn't either — both commands rely on your active namespace being the
same one. If you pass `-n` to one, pass the same `-n` to the other, or the pod ends
up in one namespace looking for a Secret that only exists in another and sits stuck
at `ContainerCreating`/`CreateContainerConfigError`.

### Updating

Because the tag is pinned to `coyote:0.1.0` with `imagePullPolicy: IfNotPresent`,
re-running `docker save … | k3s ctr images import -` under the **same tag** and then
`kubectl apply -f deploy/k8s/` changes nothing: the Deployment spec `kubectl` compares
against is byte-identical, so there is no new ReplicaSet and no new pod. `kubectl`
prints `unchanged`, and it is easy to conclude — wrongly — that the fix shipped.

**Preferred: bump the tag.** Change the tag everywhere it appears — the `docker
build`/`docker save` commands above *and* `image: coyote:0.1.0` in
`deploy/k8s/deployment.yaml` — e.g. to `coyote:0.1.1`, then re-import and
`kubectl apply -f deploy/k8s/` again. This keeps `IfNotPresent` honest: the tag
genuinely identifies which bits are running, and `kubectl describe pod` shows it.

**Quick: force a restart under the same tag.** Re-import under the unchanged tag,
then:

```
kubectl rollout restart deployment/coyote
```

This works because `IfNotPresent` still finds the freshly-imported image locally, but
it has two costs: with `strategy: Recreate` the room briefly goes down during the
swap, and because the tag never changed, `kubectl describe pod` gives no evidence of
which build is actually running — you're trusting that the re-import happened.
Prefer the tag bump whenever you can.

### Three constraints, and why

**`replicas: 1`, `strategy: Recreate`.** Room state is in memory and there is no
database, so a second replica silently splits rooms — two people opening the same URL
land in different calls. Under `hostNetwork` a second pod also collides on `:8080`
and the UDP range, and `RollingUpdate` would deadlock trying to start the replacement
before the old pod releases them. The restart gap is already handled: the server
broadcasts `server-restarting` and clients re-join by themselves.

**`WVC_PUBLIC_IP` comes from `status.hostIP`, the node's _internal_ address.** That
is correct only when clients reach the node on that address. On a NAT'd node — a
cloud VM with a separate public IP — it is wrong, and the failure is the nastiest
this app has: the lobby preview works, everything looks healthy, and remote video is
simply black. Replace the `fieldRef` with the reachable address if that is your
situation.

**`WVC_ADDR` binds `:8080` to the node's own IP (`$(WVC_PUBLIC_IP)`), not every
interface.** The systemd deployment binds `-addr 127.0.0.1:8080` so the plain HTTP
port is unreachable from outside; that specific trick is impossible here, because
Traefik dials the pod at the node IP, not loopback. Binding `WVC_ADDR` to the node IP
instead of a bare `:8080` is the closest equivalent Kubernetes allows: on a
**multi-homed node** — a private `status.hostIP` behind a separate public NIC, the
common case on a cloud VM — this removes the exposure outright, because nothing
outside the private network can reach that address at all. On a **single-homed
public node**, where `status.hostIP` *is* the public address, the bind changes
nothing: the address is reachable either way, and the node firewall is the only
control.

This is not only about exposure. The manifest sets `WVC_TRUST_PROXY=true`, so the
server believes `X-Forwarded-For`. Anyone who can reach `:8080` directly can
therefore forge their source address past per-room IP bans. Loopback binding is what
made trusting that header safe under systemd; on a single-homed node here, the
firewall rule is what makes it safe, and it is worth verifying rather than assuming.

**Do not firewall this by "Traefik's CIDR."** Traefik has no CIDR of its own — it
shares the cluster pod CIDR (`10.42.0.0/16` on a default k3s) with every other pod —
and under `hostNetwork` it dials the *node's* IP, which sits outside both the pod and
service CIDRs. k3s's flannel masquerades that traffic, so it will very likely arrive
already SNATted to some other node-local address, not the pod CIDR. A rule that
allows "the pod CIDR" therefore blocks Traefik itself, and the symptom is a 502 with
no obvious cause. There is no source address you can name in advance here; test it
empirically instead (see the firewall check in the smoke check below).

### Firewall

- **443/tcp** to the node, for Traefik.
- **8080/tcp**: on a multi-homed node whose `status.hostIP` is private, 2a already
  keeps this off any public interface and no rule is needed. On a single-homed public
  node, this port is reachable to the world unless you block it — do **not** try to
  scope a rule to "Traefik's address"; there isn't a stable one to name (see above).
  Block external access to `:8080` at the node firewall and confirm with the `curl`
  step in the smoke check below, which must fail from outside.
- **50000–50199/udp** open to the node. Unchanged from the systemd deployment: this
  carries media and does not pass through Traefik.
- **3478/tcp** (the TURN relay) needs no external rule. Traefik reaches it on the node
  IP. If it is reachable from outside it is harmless, since every allocation needs
  minted credentials and it relays only to the SFU, but blocking it keeps 443 as the
  only way in.

### Traefik notes

Traefik forwards WebSocket upgrades natively — the explicit `Upgrade` headers the
nginx config above needs have no Traefik equivalent. Nor does `proxy_read_timeout
3600s`: the server pings every 20s, comfortably inside Traefik's 180s default
`idleTimeout`, so an idle call's signaling socket is never dropped.

The manifests use the `traefik.io/v1alpha1` CRD group (Traefik v3, which current k3s
ships). On Traefik v2 the group is `traefik.containo.us/v1alpha1`.

### TLS inside the pod

`readOnlyRootFilesystem: true`, plus TLS terminating at Traefik, means the built-in
`-tls-cert` / `-tls-key` path is unused here. Using it would need the certificate
mounted as a volume.

### Post-deploy smoke check (Kubernetes)

1. `kubectl get pod -l app=coyote` → `1/1 Running`, no restarts.
2. `kubectl logs -l app=coyote` → one `listening` line and **no** `no -public-ip set`
   warning. Check that its `publicIP` value is the address clients actually reach —
   the fastest way to catch the `status.hostIP` trap above.
3. `curl -fsS https://<host>/healthz` → `ok`, proving Traefik and TLS.
4. **From another host** (not the node itself): `curl --max-time 5
   http://<node-ip>:8080/healthz` **must fail** (connection refused/timeout). If it
   returns `ok`, `:8080` is reachable from outside and, with `WVC_TRUST_PROXY=true`,
   anyone can forge `X-Forwarded-For` past per-room IP bans — go fix the firewall (or,
   on a multi-homed node, check `status.hostIP` really is the private address you
   expect) before going further.
5. Join from two browsers on different networks and confirm two-way video. This is
   the only real proof the UDP range and `WVC_PUBLIC_IP` are right — the first four
   checks all pass without it.
6. **Verify banning actually scopes per-client, not per-cluster-edge.** k3s's default
   ServiceLB (klipper-lb) is known to masquerade inbound connections, which can make
   Traefik see every client as the same peer address; if that happens, the rightmost
   `X-Forwarded-For` entry is identical for everyone, and the per-room banned-IP set
   cannot tell participants apart — banning one guest bans the whole room, silently.
   Join from two genuinely different external networks, ban one participant, and
   confirm the other is unaffected. This depends on your k3s version and on whether
   the `traefik` Service has `externalTrafficPolicy: Local` (which is what preserves
   real source addresses through ServiceLB) — it's a "verify for your cluster" step,
   not a guaranteed break, but nothing else in the manifests, docs, or the checks
   above would surface it if it does happen.
7. **Verify the TURN relay** (if configured). The logs carry a `turn relay listening`
   line. Then, in a call, open DevTools → Network → the `/ws/` socket → the `joined`
   frame, and copy its `iceServers` entry (URL, username, credential) into the
   [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
   page. "Gather candidates" must list a `relay` candidate. If it doesn't, check the
   DNS record, the `IngressRouteTCP` host/cert, and that the TURN host matches
   `WVC_TURN_URLS`. For the real proof, join with a browser that blocks non-proxied
   UDP and keep the call up for several minutes, which rules out an idle or read
   timeout on Traefik's TCP route cutting the relay. The server logs
   `turn relay allocation created` for that participant.

## SwiftIRC / Anope integration: `!vc` → token link → join

The Anope module (Plan 4) and this server share one `-secret`. The flow:

1. **`!vc` in a channel.** The Anope module POSTs the channel's current settings
   snapshot to `POST /api/provision`, authenticated with the shared secret:

   ```
   POST /api/provision
   Authorization: Bearer <WVC_SECRET>
   Content-Type: application/json

   {"channel":"#swiftirc","room":"swiftirc","settings":{"identifiedOnly":true}}
   ```

   `204` = provisioned; `403` = server has no `-secret` (feature disabled);
   `401` = wrong secret. This binds `#channel → room slug` and its settings so an
   `identifiedOnly` room refuses guests, and a channel-rooms-only server
   (`-adhoc=false`) will accept joins to that slug.

2. **The link.** The bot replies in-channel with the public URL
   (`https://vc.swiftirc.net/<slug>`) and NOTICEs an identified user a personal
   **tokenized** link:

   ```
   https://vc.swiftirc.net/<slug>#t=<base64url(payload)>.<base64url(HMAC)>
   ```

   The token carries the room, nick, NickServ account, role (`op`/`voice`/`user`),
   a settings snapshot, and a ~10-minute expiry. It rides in the URL **fragment**
   (`#t=…`), which the browser never sends to the server or proxy — so it stays out
   of access logs. The client JS reads the fragment and puts the token inside the
   WebSocket `join` frame.

3. **Join.** The server verifies the token's HMAC and claims with `-secret`,
   grants the token's role, and (via the snapshot) re-provisions the room if it was
   lost to a restart. The read-only display name in the lobby is the token's nick;
   a locked room additionally prompts for its password.

Keep `WVC_SECRET` identical in `/etc/coyote/env` and the Anope module config,
and rotate both together — a mismatch rejects every token and every provision.

## Post-deploy smoke check

1. `curl -fsS https://vc.swiftirc.net/healthz` → `ok`.
2. Open `https://vc.swiftirc.net/testroom` in a browser; the lobby preview shows
   your camera (proves TLS + getUserMedia).
3. Join from two browsers on different networks; confirm two-way video (proves the
   UDP range and `-public-ip` are reachable). If the preview works but remote video
   never arrives, the media UDP ports or `-public-ip` are wrong.

## Mobile app links

Set these three variables to have room links open the Coyote iOS and Android apps
instead of the browser. Each `.well-known` document is served only when its
settings are present; without them the paths return 404.

- `WVC_APPLE_APP_ID=<TEAMID>.net.swiftirc.coyote` (serves `/.well-known/apple-app-site-association`)
- `WVC_ANDROID_PACKAGE=net.swiftirc.coyote` (serves `/.well-known/assetlinks.json`)
- `WVC_ANDROID_CERT_SHA256=<Play app-signing cert SHA-256, from Play Console → App integrity>`
  (both Android settings are needed for assetlinks to be served)

The reverse proxy must pass `/.well-known/*` through to coyote unmodified and without
redirects: Apple fetches the association file via its CDN and refuses redirects.
Verify with:

```bash
curl -sI https://vc.swiftirc.net/.well-known/apple-app-site-association
```
