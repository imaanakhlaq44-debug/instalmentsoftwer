# Publishing the marketing site

The site is five pages of plain HTML, one stylesheet and four images — about
380 kB in total. It has no server side, so unlike the dashboard and the API it
**can** live on ordinary shared hosting. This is the runbook for putting it on
Hostinger's web hosting, which is where it goes first, before the rest of the
system has anywhere to run.

> The dashboard and the API cannot go here. They are a long-lived Node process
> with PostgreSQL beside it, and shared plans offer neither — see
> [deploy/DEPLOY.md](../deploy/DEPLOY.md).

---

## 1. Decide the two names now

Pick them before uploading anything, because the site's "Sign in" button is
baked in at build time and the DNS records are easier to add together.

| Name | Points at | When |
|---|---|---|
| `almassdm.pro` (or whatever you registered) | Hostinger shared hosting — this site | now |
| `app.almassdm.pro` | the VPS the dashboard will run on | later |

The two live in different places, and that is fine: the domain's DNS zone in
hPanel holds an `A` record for the VPS's IP under the name `app`, while the
root name keeps pointing at the shared hosting. Nothing about publishing the
site now blocks the dashboard later.

---

## 2. Give GitHub the FTP account

Publishing is done by [`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml):
every push to `main` that touches `site/` builds the site and uploads it. There
is nothing to drag into File Manager, and nothing that can be forgotten — which
matters more than it sounds, because the one file most likely to be left behind
by hand is the dotfile `.htaccess`.

**In hPanel: Files → FTP Accounts.** Use the account it already lists, or make
one scoped to `public_html`. You need three values from that page: the server's
hostname, the username, and the password.

**In GitHub: Settings → Secrets and variables → Actions.** Under *Secrets*:

| Secret | Value |
|---|---|
| `SITE_FTP_SERVER` | the FTP hostname from hPanel — a name, not `ftp://…` |
| `SITE_FTP_USERNAME` | the FTP username |
| `SITE_FTP_PASSWORD` | that account's password |

Under *Variables*, both optional:

| Variable | Default | Set it when |
|---|---|---|
| `SITE_APP_URL` | `none` | the dashboard is hosted — see below |
| `SITE_FTP_DIR` | `/public_html/` | the domain's files are not at that path |

**Check that path before the first deploy.** `/public_html/` is where the files
go only when the plan hosts one website. A plan carrying several puts each
domain under its own directory — `/domains/almassdm.pro/public_html/` — and an
upload to the wrong one publishes this site over a different domain's. hPanel's
**FTP Accounts** page names the directory each account opens in; File Manager
shows the same path in its breadcrumb. If it is not `/public_html/`, set
`SITE_FTP_DIR` to what it actually is.

The upload uses **FTPS**. Plain FTP would send that password across the
internet in clear text, and it can write to your document root.

If a secret is missing the run stops on its first step and says which one,
rather than failing later with a connection error that explains nothing.

---

## 3. The "Sign in" button

While the dashboard is not hosted anywhere, `SITE_APP_URL` stays unset. The
button is then left out of the page entirely — a shop reading the site should
not meet a dead link where the product is supposed to be.

Once the dashboard is live, set the variable to `https://app.almassdm.pro` and
run the workflow by hand from the **Actions** tab (a variable is not a commit,
so nothing triggers a deploy on its own). The button comes back pointing at the
real address.

Every run logs the value it built with, so a deploy that published the wrong
button is visible in the log rather than only in the page.

To see either build locally:

```bash
cd site
npm install
APP_URL=none npm run build            # what is published today
APP_URL=https://app.almassdm.pro npm run build
```

---

## 4. Certificate

**Websites → SSL → install** for the domain, and turn on **Force HTTPS**. Let it
issue before you tell anyone the address. A certificate here is free and takes
minutes; the `.htaccess` redirect assumes one exists, so doing this second
would send visitors into a redirect loop against a certificate that isn't there
yet.

---

## 5. Check it from a phone

Not from the machine that built it — from a phone on mobile data, which is how
the people this site is for will see it:

- the padlock in the address bar,
- the Urdu toggle in the header (it writes to `localStorage`, so it should
  still be Urdu on the second visit),
- `/pricing.html`, `/how-it-works.html`, `/dpc.html`, `/legal.html`,
- no "Sign in" button, because there is nothing to sign in to yet.

---

## Re-publishing

Edit a page, push to `main`, and the workflow does the rest — it uploads only
what changed, so a wording fix is a few kilobytes.

If a change does not show up, it is the cache before it is the deploy. There
are two of them: `.htaccess` holds a page in the visitor's browser for ten
minutes, and if the CDN is switched on in hPanel it holds its own copy in front
of the server — **Dashboard → Cache → Clear cache** empties that one. The run's
own log lists every file it sent, so start there before suspecting either.

---

## Uploading by hand, if you ever have to

The workflow is the normal path. If GitHub is down or the FTP account is being
replaced, the same result is thirteen files: build as above, then in hPanel go
to **Files → File Manager → `public_html`**, delete Hostinger's placeholder
`default.php` / `index.html`, and upload the **contents of `site/dist`** — not
the folder itself. Zip it first; File Manager unpacks a zip, and that is the
only reliable way to carry `.htaccess` across. Over an FTP client, turn on
"show hidden files" first or it is silently left behind.

`.htaccess` forces HTTPS, compresses the pages and sets cache headers. Without
it the site still works; a visitor who typed the bare domain just stays on
plaintext HTTP.
