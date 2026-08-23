# Releasing the DPC

The app in [`dpc/`](dpc/) is the half of the lock that actually holds a handset.
Until a signed build of it is hosted somewhere a factory-reset phone can reach,
the product's central promise is written but unproven — a QR that provisions
nothing.

This is the runbook for changing that. Read it once before starting: the signing
key is created in step 1 and cannot be replaced afterwards without a factory
reset on every phone in the fleet.

---

## 1. Create the signing key — once, and only once

```bash
keytool -genkeypair -v \
  -keystore almas-sdm-release.jks \
  -storetype PKCS12 \
  -keyalg RSA -keysize 4096 \
  -validity 10950 \
  -alias almas-sdm
```

`keytool` asks for a password and for the name to put on the certificate. Use
the dealership's registered business name.

**Twenty-five thousand days is not a typo.** A DPC signed with an expired
certificate cannot be updated, and the phones it is installed on are device
owner — the customer cannot factory-reset their way out of it. Give the key a
life longer than any plan you will ever finance on it.

### What happens if this file is lost

Nothing on the phones stops working, and nothing can ever update them. An APK
signed with a different key will not install over one signed with this key.
Every handset in the fleet would have to be collected, factory-reset and
re-enrolled by hand.

### What happens if this file leaks

Somebody else can sign an APK that a factory-reset phone will accept as its
device owner, having verified the signature honestly.

So: **two offline copies, in two places, plus the password written down
separately.** Not in the repository, not in the project folder, not in
OneDrive-synced storage. `android/.gitignore` covers `*.jks`, `*.keystore` and
`keystore.properties`, but that only stops an accident.

---

## 2. Point the build at the key

Locally, copy [`keystore.properties.example`](keystore.properties.example) to
`android/keystore.properties` and fill it in. That file is git-ignored.

```properties
storeFile=C:/keys/almas-sdm-release.jks
storePassword=…
keyAlias=almas-sdm
keyPassword=…
```

For CI, put the same four values in the repository's GitHub secrets, with the
keystore itself base64-encoded:

```bash
base64 -w0 almas-sdm-release.jks     # macOS/Git Bash: base64 -i almas-sdm-release.jks
```

| Secret | Value |
|---|---|
| `ALMAS_KEYSTORE_BASE64` | the output of the command above |
| `ALMAS_KEYSTORE_PASSWORD` | the store password |
| `ALMAS_KEY_ALIAS` | `almas-sdm` |
| `ALMAS_KEY_PASSWORD` | the key password |

Optionally set the repository **variable** `DPC_DEFAULT_SERVER_URL` to the
production API, e.g. `https://api.your-domain.pk/api/dpc`. It is only the
fallback the typed enrolment form starts with — a phone provisioned from the QR
takes its server address from the QR itself.

Nothing configured? The debug build, the unit tests and CI all still work.
`assembleRelease` refuses rather than quietly producing an unsigned APK.

---

## 3. Read the certificate checksum

```bash
cd android && ./gradlew :dpc:printSigningCertChecksum
```

```
Certificate : CN=Al Madina Mobile Hub, O=Al Madina Mobile Hub
Expires     : Tue Nov 04 12:41:07 PKT 2055

DPC_APK_SIGNATURE_CHECKSUM=EXAMPLEonly_not_a_real_checksum_do_not_copy
```

(43 characters — 32 bytes, base64url, no padding.)

This value goes into the provisioning QR, and the setup wizard refuses to
install anything whose certificate does not hash to it. Do **not** derive it by
hand from `keytool -printcert`: the wizard wants the SHA-256 of the *signing
certificate*, base64url-encoded with the padding stripped, and the fingerprint
`keytool` prints most prominently is a colon-separated SHA-1 hex string. Three
opportunities to be subtly wrong, and the failure is a phone that abandons setup
without saying why.

---

## 4. Cut a release

Raise `versionCode` and `versionName` in [`dpc/build.gradle.kts`](dpc/build.gradle.kts),
commit, then tag:

```bash
git tag dpc-v1.0.0
git push origin dpc-v1.0.0
```

`versionCode` must go **up** every time. Android refuses to install a build
whose code is lower than the one already on the phone, and that is the only
mechanism by which a fleet ever gets a fix.

[`.github/workflows/release-dpc.yml`](../.github/workflows/release-dpc.yml)
runs the unit tests, builds the signed APK, reads the checksum from the key that
signed it, and publishes both to a GitHub Release — with the exact two lines of
server configuration in the release notes.

### Why GitHub Releases

A factory-reset phone downloads this APK during setup, **before** it has been
given any credentials. So the host must be public, HTTPS, and reliable at the
hour a customer is standing at the counter.

| | |
|---|---|
| **GitHub Releases** ✅ | Free, HTTPS, a direct asset URL, no infrastructure, and every published version stays downloadable. Start here. |
| **The shop's own server** | Reasonable later: Express can serve the file, and the domain matches the API. But it must be HTTPS with a valid certificate, and it puts provisioning behind the same box the shop already depends on. |
| **Google Play** ❌ | Not an option. Provisioning needs a direct APK URL, and Play does not give one. Play's device-admin policy is also hostile to an app like this. |
| **Drive / Dropbox links** ❌ | These serve an HTML page, not the APK, and the wizard downloads what it is given. |

The APK is not a secret. Its checksum is what makes it trustworthy, and that
comes from the server the shop controls.

### Building one by hand instead

```bash
cd android && ./gradlew :dpc:assembleRelease
# dpc/build/outputs/apk/release/dpc-release.apk
```

---

## 5. Configure the server

```bash
DPC_SERVER_URL=https://api.your-domain.pk/api/dpc
DPC_APK_URL=https://github.com/<owner>/<repo>/releases/download/dpc-v1.0.0/almas-sdm-dpc-v1.0.0.apk
DPC_APK_SIGNATURE_CHECKSUM=<from step 3>
```

Until all three are set, the Enrollment page prints the QR **and says it cannot
provision a factory-reset phone** — better found here than with a customer
waiting.

`DPC_ADMIN_COMPONENT` defaults to
`pk.almassdm.dpc/pk.almassdm.dpc.admin.AlmasDeviceAdminReceiver` and only needs
setting if the package or the receiver class is ever renamed again.

---

## 6. Prove it on real handsets

This is the step the product is actually waiting on. Everything above can be
completed in an afternoon; this is what turns a written system into a shippable
one.

**On each phone**, factory-reset, then:

1. Tap the welcome screen six times to open the QR scanner.
2. Scan the QR from the Enrollment page.
3. Watch it download the APK, verify the certificate, install it as device
   owner, and complete setup.

**Then run the whole cycle:**

| Check | What it proves |
|---|---|
| Status screen shows the plan and the shop's number | Enrolment completed and the credential works |
| Mark the installment overdue, lock from the dashboard | The command reaches the phone and the kiosk holds |
| Press Home, Back, Recents; try the notification shade | The lock is real, not a window somebody can leave |
| Dial 15 from the lock screen | Emergency calls survive the restriction |
| Reboot while locked | `BootReceiver` restores it before the network is consulted |
| Record the payment | The unlock reaches the phone and it gives the handset back |
| Turn off mobile data for longer than the offline limit | The handset restricts itself, and reports it on reconnect |
| Try to factory-reset from Settings | Device owner blocks it |
| Try to uninstall the app | Blocked |

**Cover the range a Pakistani shop actually sells** — an Infinix or Tecno, a
Vivo or Oppo, a Samsung A-series, a Xiaomi, and at least one handset on Android
8 or 9. OEM skins differ most in exactly the places this app depends on: the
home button, the recents key, battery optimisation killing WorkManager, and
whether the setup wizard's six-tap scanner is where it should be.

Record what each one did. A handset that cannot be held is something the shop
must know before it finances a phone on it, not after.

---

## Rotating the key

Don't, unless it has leaked. There is no clean path: an APK signed with a new
key will not update an installed one, and the handsets are device owner. If it
must happen, every phone is collected, factory-reset and re-enrolled, and the
old key is destroyed only once the last one is done.
