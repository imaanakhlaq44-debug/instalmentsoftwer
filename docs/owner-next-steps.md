# Baqi kaam — 13 Nov 2026

`main` mein ab tak: ek-page sale form (#43), IMEI camera scan (#44), phone test checklist print (#45),
sale page par hi contract sign (#46). Sab ke CI checks pass.

## 1. Pehle yeh (aap ke haath se)
1. **Server update** (VPS par, apne computer par nahi — pehle `ssh root@VPS_IP`):
   ```
   cd /opt/almas-sdm
   ./deploy/backup.sh
   git pull
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```
   Check: dashboard → Customers → "Add Customer & Device": IMEI ke saath "Scan" button, sale ke baad sign ka qadam.
2. **Phone app v1.5.2 release**: GitHub → Releases → Draft a new release → tag `dpc-v1.5.2`
   (Create new tag), target `main` → Publish. Actions mein "Release DPC" chalna chahiye.
   (Claude session tag push nahi kar sakta — 403.)
3. **Server ko nayi APK**: VPS par `deploy/.env` mein
   `DPC_APK_URL=https://github.com/imaanakhlaq44-debug/instalmentsoftwer/releases/download/dpc-v1.5.2/almas-sdm-dpc-v1.5.2.apk`
   phir `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d`. Checksum wahi rahega.

## 2. Test (sab se zaroori)
4. **Asli phones par test**: Infinix/Tecno, Vivo/Oppo, Samsung A, Xiaomi, aur ek Android 8–9.
   Dashboard → Phone tests → "Print checklist" se sheet nikalein, har phone ka nateeja wapas darj karein.
   Location wala step sirf v1.5.2 wale phone par.
5. **Naya sale form dukaan par**: 2–3 asli sales; waqt bacha ya nahi, IMEI scan phone par chala ya nahi.
6. **Urdu tarjuma** dekhna: naye screens (sale form, sign, Buy locks, Lock orders, Feedback, Phone tests,
   WhatsApp, SMS settings) — Claude ka likha hua, kisi ne check nahi kiya.

## 3. Hifazat
7. Backup se data wapas laga kar ek dafa aazmana (`deploy/DEPLOY.md`, section 6).
8. Backups ki copy server se bahar rakhna.
9. Settings mein dukaan ka Google Account ID (Factory Reset Protection).

## 4. Accounts milne par (code tayyar, abhi band)
10. SMS company account + sender mask.
11. WhatsApp Business API (Meta).
12. JazzCash merchant — pehle sandbox par test.

## 5. Qanooni
13. Wakeel se terms v1.4 parhwana — brief: `docs/legal-review-brief.md`.

## Claude ke liye yaad-dasht (naye session mein)
- Server tests embedded PostgreSQL par chalte hain jo root user ko mana karta hai: ek normal user bana kar
  `server/` us ke home mein copy karein aur `npm test` usi user se chalayein, `TMPDIR` us ke home mein.
- Har nayi English UI line ka `client/src/i18n/romanUrdu.ts` aur `client/src/i18n/urdu.ts` dono mein tarjuma
  zaroori hai (`urdu.test.ts` check karta hai).
- Live site check ke liye environment "instalmentsoftwer" (almassdm.pro aur app.almassdm.pro allowed).
