# Phone intake QR and CNIC scan — 17 November 2026

The new-sale form now offers welcome-screen phone intake before registration and local CNIC OCR with an editable review.

- The QR provisions the existing Almas DPC as Android Device Owner, receives available manufacturer/model/OS/IMEIs/serial, and waits while the counter completes the sale. The same token is attached inside the sale transaction. No second reset or QR is required.
- Single-phone binding, shop scope, expiry, cancellation, identity matching and transaction rollback protect intake sessions. Intake alone creates no customer, device, financing plan or consumed lock. Existing signed-contract rules still control restrictions.
- Cancelling or expiring an unattached intake lets its own DPC relinquish Device Owner. An attached financed phone is never released by this path. Expired unassigned hardware reports are cleared by scheduled cleanup; the credential tombstone remains so a returning phone can see cancellation.
- CNIC front/back photos are processed by a self-hosted Tesseract English/Urdu worker in the browser. Photos and recognized text are not uploaded or saved by the scanner. Only reviewed form fields are submitted in the normal sale request. This is text extraction, not NADRA identity verification. Mobile/emergency contacts are entered separately.
- Camera/photo capture supports JPEG/PNG/WebP up to 15 MB. Blurred or unusual cards can require manual correction. Unsupported phone identifiers remain manual fields.

## Validation

- Client full suite: 417 passed; after final UI/translation updates, affected suites 43 passed.
- Initial backend intake/DPC/sale helper checks: 48 passed. Final intake/financial/contracts/re-enrollment regression checks: 47 passed.
- Production dashboard build and server type check passed.
- Actual Chromium OCR test: synthetic card CNIC, name and address matched; no POST/upload requests during recognition; confirmation filled the customer form.
- Actual Chromium phone intake test: rendered QR, submitted a simulated handset report, and automatically filled model/IMEI; desktop and mobile layouts captured.
- Signed Android DPC 1.6.0, versionCode 10, built and tested by existing signing workflow on feature branch. Final build: https://github.com/imaanakhlaq44-debug/instalmentsoftwer/actions/runs/44087302281
- APK SHA256: d09bd29143c98ffc0e39779993f6ddc97eed91135b19e5b13dde4a677d70a759
- Signing certificate matches the previous live APK: 02af180c2f3363b05450b8de7811f04e4f79b5891f9903dc4eb7b633f1a0465e

## Deployment

Publish the verified APK at `/downloads/almas-sdm-dpc-1.6.0.apk` in the dashboard image and set DPC_APK_URL to `https://app.almassdm.pro/downloads/almas-sdm-dpc-1.6.0.apk`. Keep the existing DPC_APK_SIGNATURE_CHECKSUM. Run the additive phone_intakes migration before serving the new API. Retain pre-release backup and API/web rollback images. Rolling back code must not restore an old financial database over newer transactions.

## Practical acceptance still required

Real welcome-screen provisioning, OEM-specific identifier availability, cancellation/release behavior and real Pakistani CNIC photography require a backed-up/empty test handset and a card with its holder's consent. No physical phone was reset, updated, enrolled, locked or released during development. Browser/server tests simulate handset messages and do not prove every OEM behavior.
