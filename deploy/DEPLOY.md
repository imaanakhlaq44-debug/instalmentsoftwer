# Deploying Almas SDM on a VPS

From a freshly created Ubuntu server to a dashboard a shop can log into and a
handset can check in to. Written against **Hostinger's KVM VPS**, but nothing
here is specific to them — any provider that rents an Ubuntu box with a public
IP works the same way.

Budget an hour, most of which is waiting.

---

## What this gives you

Three containers on one machine:

| | |
|---|---|
| **db** | PostgreSQL 16, on a named volume, **not** reachable from the internet |
| **server** | The API. Applies pending migrations, then listens on 5000 inside the network only |
| **web** | Caddy. Terminates TLS, serves the dashboard, forwards `/api/*` to the server |

The dashboard and the API are on **one origin**, because the dashboard calls
`/api` as a relative path. The handsets talk to `/api/dpc` through the same
certificate.

---

## Why not Hostinger's cheap shared plan

It cannot run this. Shared/web hosting runs PHP under a web server it controls;
this is a long-lived Node process with PostgreSQL beside it, and shared plans
offer neither. **KVM VPS 1** — 1 vCPU, 4 GB RAM, 50 GB NVMe — is the smallest
plan that works, and it is comfortably more than this needs: each handset sends
one small check-in every fifteen minutes, so a fleet of several hundred is a few
requests a second at worst.

---

## 1. Before you touch the server

**A domain.** Not an IP address. The DPC's release build refuses plaintext HTTP,
so a certificate is mandatory, and a certificate needs a name. Point an `A`
record at the VPS's IP and let it propagate — `dig +short your-domain.pk` should
answer with that IP before you go further.

**An SSH key.** Hostinger's panel takes a public key when the VPS is created;
choosing that over a root password is the single largest security decision here,
and it is free.

---

## 2. Prepare the machine

SSH in as root, then:

```bash
apt update && apt upgrade -y
apt install -y git ufw

# Docker, from Docker's own repository rather than Ubuntu's older package.
curl -fsSL https://get.docker.com | sh
```

Close everything except SSH and the web:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
```

PostgreSQL's port is deliberately absent, and so is the API's. Neither is
published to the host at all — they exist only on Docker's internal network. A
Postgres port open to the internet is how a customer database ends up for sale.

---

## 3. Get the code and configure it

```bash
git clone https://github.com/imaanakhlaq44-debug/instalmentsoftwer.git /opt/almas-sdm
cd /opt/almas-sdm
cp deploy/.env.example deploy/.env
```

Generate the two secrets and put them in `deploy/.env`:

```bash
openssl rand -base64 32                                              # POSTGRES_PASSWORD
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
```

(no Node on the box yet? `openssl rand -hex 48` gives an equally good secret.)

Then fill in the rest:

| Key | Value |
|---|---|
| `SITE_DOMAIN` | the domain from step 1, no `https://`, no trailing slash |
| `ADMIN_EMAIL` | a real inbox — the only warning you get before a certificate expires |
| `DPC_APK_URL` | from the DPC release notes |
| `DPC_APK_SIGNATURE_CHECKSUM` | from the same place |

The last two are printed in the release GitHub Actions publishes — see
[android/RELEASE.md](../android/RELEASE.md). Leaving them empty is allowed: the
Enrollment page will print the QR and say plainly that it cannot provision a
factory-reset phone.

`deploy/.env` is git-ignored and must stay on the server.

---

## 4. Start it

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

The first run builds both images and takes a few minutes. Watch it come up:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f
```

What should appear, in order: PostgreSQL ready, then Prisma applying every
migration, then `Almas SDM Server listening on port 5000`, and from Caddy a line
about obtaining a certificate.

If the certificate step fails, the cause is almost always DNS: the domain does
not yet resolve to this machine, and Let's Encrypt checked. Fix the record, wait,
then `docker compose ... restart web`.

---

## 5. Create the first accounts

The database starts **empty**. `AUTO_SEED` is forced to `false` in production —
the config refuses to boot otherwise — because demo customers in a live shop's
records would be worse than no records.

### The platform's super admin

Only a super admin can issue packs of locks, and no endpoint can create one, so
the first is made from a shell on the server. The password is typed at a hidden
prompt, twice, and never appears in history or logs:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  exec server node dist/scripts/createSuperAdmin.js --email you@example.com --name "Your Name"
```

Sign in at `https://your-domain.pk` with that email. This is the account that
issues a shop its locks once payment has arrived (Licenses page).

### A dealership

A shop registers itself from the dashboard: the login page links to
**`/register`** (shop name, owner, mobile, email, city, address, password, and
how many locks it wants). That calls `POST /api/auth/register-dealer`, which
creates the dealership, its enforcement policy and the owner's `DEALER_ADMIN`
login in one transaction. Sign-ups are limited to 5 per address per hour
(`SIGNUP_RATE_LIMIT_MAX` / `SIGNUP_RATE_LIMIT_WINDOW_MINUTES`).

It does **not** issue locks. The number asked for is recorded, the shop appears
on the super admin's **Lock orders** page, and the super admin issues the locks
once the money has arrived. Until then a financed sale is refused at the
counter. Staff accounts, customers and devices are then done from the
dashboard.

---

## 6. Turn the backups on

The provider's snapshots are not backups of your data. They restore a whole
machine to a moment; they will not give you one customer's ledger back after a
mistaken deletion, and they live in the same account you might one day lose.

```bash
crontab -e
```

```cron
30 2 * * * cd /opt/almas-sdm && ./deploy/backup.sh >> /var/log/almas-backup.log 2>&1
```

Then **test a restore before you need one**:

```bash
gunzip -c deploy/backups/almas-sdm-<date>.sql.gz | \
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  exec -T db psql -U almas -d almas_sdm
```

A backup nobody has ever restored is a hope, not a backup.

**Copy them off the machine.** A dump sitting on the same disk as the database
survives a mistake but not a dead server. `rsync` them to a laptop, or to any
storage you control, on the same schedule.

---

## 7. Point the handsets at it

Confirm the API answers publicly:

```bash
curl https://your-domain.pk/api/health
```

Then the Enrollment page's QR should print without the "cannot provision"
warning. Use the latest release's values — `dpc-v1.5.1` at the time of
writing — not an older tag's; a phone provisioned from an old APK has to update
itself before it has any of the later fixes. That is the moment everything is connected: the shop can hand a phone
to a customer.

---

## Updating

```bash
cd /opt/almas-sdm
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Migrations run automatically as the server container starts. Take a backup first
— `./deploy/backup.sh` — because a migration is the one kind of change that
cannot simply be rolled back by starting the old image.

### The contract PDF needs Chromium in the server image

"Download PDF" on an agreement is rendered by headless Chromium inside the
`server` container, because nothing else available shapes Urdu correctly. The
image change is one line in `server/Dockerfile` — `apk add chromium
ttf-liberation` in the runtime stage — and the next `up -d --build` above picks
it up. Nothing else changes: no new container, no new port, no new variable
(`PDF_CHROMIUM_PATH` exists only for a Chromium installed somewhere unusual).

What it costs: about 500 MB more image, a longer first build, and a few hundred
megabytes of memory for the second or two a PDF takes. Renders are queued one
at a time, so a 4 GB VPS is not at risk. The Urdu font is not a system package;
it ships inside `node_modules` and is embedded in each document.

If Chromium is absent or will not start, the endpoint answers 503 with a message
saying so and the dashboard's **Print / Save as PDF** button — which uses the
browser on the person's own device — still works. To check after a deploy:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec server chromium-browser --version
```

> This image change has been built by CI only. It has not been run on a real
> VPS yet — download one agreement and open it before telling a shop it works.

## Watching it

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs --tail 100 server
```

Set the compose command as a shell alias on the box and stop typing it:

```bash
echo "alias asdm='docker compose -f /opt/almas-sdm/deploy/docker-compose.yml --env-file /opt/almas-sdm/deploy/.env'" >> ~/.bashrc
```

---

## Things worth knowing before a customer depends on this

- **The certificate renews itself**, and Caddy keeps it on a named volume. Do
  not delete that volume casually; Let's Encrypt rate-limits repeat issuance for
  the same name.
- **Where the data lives.** Customer names, CNICs, addresses, IMEIs and payment
  history sit on a server in whichever country the VPS is in. That is not
  unlawful, but it is a question a bank or a large client will eventually ask,
  and the answer should not be a surprise.
- **One machine.** If it dies, the shop cannot take payments through the system
  and no handset can check in — though a phone already locked stays locked, and
  one already unlocked stays usable, so nobody's phone is bricked by an outage.
  Backups are what make the recovery an afternoon rather than a catastrophe.
- **`docker compose down -v` deletes the volumes**, which means the database and
  the certificate. There is no confirmation prompt.
