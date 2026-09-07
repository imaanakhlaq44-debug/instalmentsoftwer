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
| `almassdm.pk` (or whatever you registered) | Hostinger shared hosting — this site | now |
| `app.almassdm.pk` | the VPS the dashboard will run on | later |

The two live in different places, and that is fine: the domain's DNS zone in
hPanel holds an `A` record for the VPS's IP under the name `app`, while the
root name keeps pointing at the shared hosting. Nothing about publishing the
site now blocks the dashboard later.

---

## 2. Build

While the dashboard is not hosted anywhere yet, build with `APP_URL=none`. The
"Sign in" button is then left out of the page entirely — a shop reading the
site should not meet a dead link where the product is supposed to be.

```bash
cd site
npm install
APP_URL=none npm run build
```

The build prints what it did with that button. Read the line; it is the one
thing about this build that can be wrong without looking wrong.

Once the dashboard is live, rebuild and re-upload with the real address:

```bash
APP_URL=https://app.almassdm.pk npm run build
```

---

## 3. Upload

Everything that goes on the server is the **contents of `site/dist`** — not the
folder itself. In hPanel: **Files → File Manager → `public_html`**.

1. Delete Hostinger's placeholder `default.php` / `index.html` if one is there.
2. Upload the contents of `site/dist`, including the dotfile `.htaccess`.
   File Manager's uploader takes a zip and unpacks it, which is faster and
   avoids missing a file; over FTP, turn on "show hidden files" first or
   `.htaccess` will be silently left behind.
3. Check the result: `public_html/index.html`, `styles.css`, the four images,
   the other four pages, and `.htaccess` — thirteen entries.

`.htaccess` forces HTTPS, compresses the pages and sets cache headers. Without
it the site still works; a visitor who typed the bare domain just stays on
plaintext HTTP.

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

There is no pipeline here and it does not need one: rebuild, upload the changed
files, done. If a change does not show up, it is the cache — `.htaccess` holds
a page for ten minutes.
