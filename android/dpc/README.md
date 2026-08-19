# EMI Shield DPC — the app on the customer's phone

The Android Device Policy Controller for [EMI Shield](../README.md). It is the
half of the lock that actually holds a handset: the server decides *that* a
phone should be restricted, this decides *whether the restriction is real*, and
tells the server the truth either way.

Kotlin, minSdk 26, no Compose, no HTTP library. It talks to four endpoints and
draws two screens; anything larger than that would be weight carried on someone
else's phone for no reason.

---

## What it does

| | |
|---|---|
| **Enrols** | Redeems the shop's code at `POST /enroll` and keeps the device credential it is issued. The code arrives in the provisioning bundle, so nobody types it. |
| **Checks in** | Every fifteen minutes via WorkManager: battery, OS build, patch level, carrier. Collects any waiting command. |
| **Applies commands** | `LOCK` pins the phone to the lock screen as device owner; `UNLOCK` releases it. |
| **Acknowledges honestly** | Reports `applied: true` only when the restriction actually took hold. |
| **Survives restarts** | The lock is restored from the last state the phone *enforced*, before the network is consulted. |
| **Gives the phone back** | When the server answers 403 — device removed or retired — it unwinds every restriction and erases its own credential. |

## What it deliberately does not do

- **No location, no Wi-Fi SSID.** The server's check-in schema accepts both.
  Neither is ever sent. Whether an installment is overdue does not depend on
  where the customer is, and a financing app that quietly tracks people is a
  different product from this one.
- **No contacts, no call log, no SMS, no camera.** The full permission list is
  `INTERNET`, `ACCESS_NETWORK_STATE` and `RECEIVE_BOOT_COMPLETED`.
- **No remote wipe.** The protocol has no such command and this app implements
  none. Locking a financed handset is a contractual remedy; destroying the
  photographs on it is not.
- **No hiding.** The app has a launcher icon and a status screen showing what is
  owed, when it is due and who to call. Somebody paying for this phone is
  entitled to see what is on it.

---

## The one rule

`LockController` reports **what it managed to do, not what it was asked to do**.

If the app is not device owner — installed by hand rather than provisioned from
the QR — `applyLock` returns `Refused`, the acknowledgement carries
`applied: false` with the reason, the server leaves the command queued, and the
dashboard keeps showing `LOCK_PENDING`.

A dealer being told *the lock has not reached the phone yet* is recoverable. A
dealer telling a customer their phone is restricted when it is not is the
failure the whole protocol is shaped around, and this app is the only place that
truth can come from.

---

## Building

```bash
cd android
./gradlew testDebugUnitTest assembleDebug
```

The debug APK lands in `app/build/outputs/apk/debug/`. `local.properties` needs
`sdk.dir` pointing at your Android SDK; Android Studio writes it for you, and CI
gets it from `ANDROID_HOME`.

Unit tests are plain JVM tests — the JSON parsing that decides what a lock
screen says, and the URL joining that decides whether a provisioned phone can
find its server at all.

### Pointing it at a server

The QR carries the address. `gradle.properties` only supplies the fallback that
the typed enrolment form starts with:

```properties
emishield.defaultServerUrl=http://10.0.2.2:5000/api/dpc
```

`10.0.2.2` is the host machine as the emulator sees it. Debug builds permit
plaintext to loopback addresses **only**; a release build refuses plaintext
anywhere, because a device credential must not cross an unencrypted link.

---

## Provisioning a real phone

Device owner cannot be granted after setup. The phone must be factory-reset and
provisioned from the QR, which is exactly why it is worth doing: an app the
customer merely installed can be uninstalled on the first missed payment, and a
device owner survives until a factory reset — which the app then blocks.

1. Host the release APK somewhere the phone can reach, and configure the server:

   ```bash
   DPC_SERVER_URL=https://api.your-domain.pk/api/dpc
   DPC_APK_URL=https://your-domain.pk/dpc/emi-shield-dpc.apk
   DPC_APK_SIGNATURE_CHECKSUM=<base64url SHA-256 of the signing certificate>
   ```

   Without the last two the dashboard will print the QR **and tell you it cannot
   provision a phone** — a shop should find that out before a customer is
   standing at the counter, not after.

2. Generate the QR from the dashboard's Enrollment page.

3. On the factory-reset handset, tap the welcome screen six times to open the
   scanner, and scan it. The wizard downloads the APK, verifies its signing
   certificate against the checksum, installs it as device owner and hands the
   enrolment code to `EmiDeviceAdminReceiver`.

4. The app redeems the code, hardens the installation — no factory reset, no
   safe boot, no added users, cannot be uninstalled — and starts checking in.

### The signature checksum

```bash
keytool -printcert -jarfile app-release.apk | grep SHA256
```

Take those bytes, base64url-encode them without padding. A wrong checksum makes
the wizard refuse the download, which is the point: it is what stops a
lookalike APK being provisioned as owner of somebody's phone.

---

## Trying it without a phone

Two ways, and neither needs a handset:

- **The dashboard's Simulator page** drives the real endpoints against real
  records. It stands in for the phone, so `TOGGLE_ONLINE` performs the check-in
  and the acknowledgement in one step rather than the two round trips this app
  makes.
- **An emulator** running the debug build against `10.0.2.2:5000`, enrolling
  through the typed form with a code from the Enrollment page. It will check in,
  receive commands and acknowledge them — and it will refuse every lock with
  "device-owner privileges are not held", because an app installed by `adb` is
  not an owner. That refusal appearing on the dashboard is the protocol working.

---

## Layout

```
admin/   EmiDeviceAdminReceiver — provisioning hook
         LockController         — everything that actually restricts the phone
data/    Prefs                  — credential, cached policy, enforced lock state
         PolicyView             — the server's answer, parsed
net/     DpcApi                 — the four endpoints
         Telemetry              — what a check-in reports
work/    DpcSync                — one round of the protocol, in one place
         CheckInWorker          — the heartbeat
         CheckInScheduler       — cadence
         BootReceiver           — restore after a restart
ui/      LockActivity           — the restricted screen
         StatusActivity         — the unrestricted one
         EnrollActivity         — redeems the code
```

Every state change goes through `DpcSync`, so the periodic worker, the boot
receiver and the "check now" button cannot drift apart.
