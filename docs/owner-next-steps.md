# Baqi kaam (owner ke liye) — 12 Nov 2026

Yeh woh kaam hain jo `main` merge aur VPS update ke baad baqi hain.

1. **DPC v1.5.2 release.** GitHub → Releases → Draft a new release → tag `dpc-v1.5.2`
   (Create new tag), target `main` → Publish. Phir Actions mein "Release DPC" chalna
   chahiye. Session se tag push nahi ho saka (403).
2. **Server ko nayi APK batana.** VPS par `deploy/.env` mein
   `DPC_APK_URL=https://github.com/imaanakhlaq44-debug/instalmentsoftwer/releases/download/dpc-v1.5.2/almas-sdm-dpc-v1.5.2.apk`
   phir `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d`.
   Checksum wahi rahega.
3. **Asli phones par test.** Infinix/Tecno, Vivo/Oppo, Samsung A, Xiaomi, aur ek Android 8–9.
   Dashboard → Phone tests mein har phone ka nateeja darj karein. Location for recovery
   sirf 1.5.2 wale phone par chalegi — usay khaas taur par aazmayein.
4. **Urdu tarjuma dekhna.** Dashboard Urdu mein kholein; naye screens (Buy locks, Lock orders,
   Feedback, Phone tests, WhatsApp, SMS settings) ki 262 lines Claude ne likhi hain, kisi ne
   check nahi kin.
5. **Accounts jab mil jayein.** SMS aggregator (sender mask), WhatsApp Business API, JazzCash
   merchant (pehle sandbox) — teeno ka code tayyar hai aur band hai.
6. **Backup restore ek dafa aazmana**, aur backups server se bahar copy karna
   (`deploy/DEPLOY.md`, section 6).
7. **Wakeel** se contract terms (v1.4) parhwana — brief: `docs/legal-review-brief.md`.

Live check (12 Nov, 19:39 UTC): website aur `app.almassdm.pro` dono chal rahe the, server
naya code chala raha tha (`/api/public/tested-phones` jawab de raha tha).
