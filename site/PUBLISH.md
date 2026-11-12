# Publishing the marketing site

The site is six pages of plain HTML, one stylesheet and four images, plus an
unlisted folder of social-media images under `m/`. It has no server side, so
unlike the dashboard and the API it **can** live on ordinary shared hosting.
This is the runbook for putting it on Hostinger's web hosting. The dashboard and
API now run separately, on the VPS.

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
| `app.almassdm.pro` | the VPS the dashboard runs on | when the VPS is up |

The two live in different places, and that is fine: the domain's DNS zone in
hPanel holds an `A` record for the VPS's IP under the name `app`, while the
root name keeps pointing at the shared hosting. The two do not depend on each
other.

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

With `SITE_APP_URL` unset the button is left out of the page entirely — a shop
reading the site should not meet a dead link where the product is supposed to
be.

The dashboard is now hosted. If the variable has not been set yet, set it to the
dashboard's real address (for example `https://app.almassdm.pro`) and run the
workflow by hand from the **Actions** tab (a variable is not a commit,
so nothing triggers a deploy on its own). The button comes back pointing at the
real address.

Every run logs the value it built with, so a deploy that published the wrong
button is visible in the log rather than only in the page.

The same variable switches on the **Tested phones** section of the handset-app
page. That list is not written into the site: it is read in the visitor's
browser from the dashboard's public endpoint (`/api/public/tested-phones`), so
a phone appears the moment a super admin ticks **Show on website** on a phone
test, with no rebuild. While `SITE_APP_URL` is unset the section is left out of
the build, and once it is set the section still stays hidden until at least one
phone test has been published.

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
- `/guide.html`, `/pricing.html`, `/how-it-works.html`, `/dpc.html`, `/legal.html`,
- the "Sign in" button, if `SITE_APP_URL` is set, opening the dashboard.

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

## Testimonials

The home page's testimonials section is published only when there are real
ones. The samples in `src/pages/index.html` are never published; while the
data file is empty the build leaves the whole section out.

A real one comes into being like this:

1. A shop owner opens **Feedback** in the dashboard, writes a quote, picks a
   rating, the name and city to show, and ticks the consent box.
2. The super admin opens **Shop feedback** and approves it. The platform cannot
   edit the words — only approve, reject with a note, or unpublish.
3. The API then lists it at `GET /api/public/testimonials` (quote, name, city,
   rating, language — nothing else).
4. The site build prints whatever is in `src/data/testimonials.json`.

Step 4 is build-time on purpose, not a fetch from the visitor's browser: the
page stays plain HTML that loads with the API down and without JavaScript.

**Automatic (once the API is hosted):** set the repository variable
`SITE_API_URL` to the API's address. Every deploy then pulls the approved list
first, and a nightly run does the same, so an approval, an unpublish or a
shop's withdrawal reaches the site within a day — or at once if you run the
*Deploy site* workflow by hand. If the API cannot be reached the deploy stops
and the site stays as it was.

**By hand (before that):**

```bash
TESTIMONIALS_API_URL=https://<api-address> npm --prefix site run testimonials:pull
git add site/src/data/testimonials.json && git commit -m "site: update testimonials" && git push
```

Do not type testimonials into the data file yourself. It should only ever hold
what the endpoint returned.

## Uploading by hand, if you ever have to

The workflow is the normal path. If GitHub is down or the FTP account is being
replaced, the same result is the contents of `site/dist` (fifteen files and the
`m/` folder): build as above, then in hPanel go
to **Files → File Manager → `public_html`**, delete Hostinger's placeholder
`default.php` / `index.html`, and upload the **contents of `site/dist`** — not
the folder itself. Zip it first; File Manager unpacks a zip, and that is the
only reliable way to carry `.htaccess` across. Over an FTP client, turn on
"show hidden files" first or it is silently left behind.

`.htaccess` forces HTTPS, compresses the pages and sets cache headers. Without
it the site still works; a visitor who typed the bare domain just stays on
plaintext HTTP.
