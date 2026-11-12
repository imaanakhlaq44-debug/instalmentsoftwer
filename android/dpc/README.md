# Almas SDM DPC — the app on the customer's phone

The Android Device Policy Controller for [Almas SDM](../README.md). It is the
half of the lock that actually holds a handset: the server decides *that* a
phone should be restricted, this decides *whether the restriction is real*, and
tells the server the truth either way.

Kotlin, minSdk 26, no Compose, no HTTP library. It talks to four endpoints and
draws a handful of screens (status, lock, enrolment, released); anything larger
would be weight carried on someone else's phone for no reason. Current version:
**1.5.1** (`versionCode` 8).

---

## What it does

| | |
|---|---|
| **Enrols** | Redeems the shop's code at `POST /enroll` and keeps the device credential it is issued. The code arrives in the provisioning bundle, so nobody types it. |
| **Checks in** | Every fifteen minutes via WorkManager: battery, OS build, patch level, carrier, and (from 1.5.0) the hardware snapshot — IMEIs, serial, device-owner state, integrity signals, FRP status. Collects any waiting command. |
| **Applies commands** | `LOCK` pins the phone to the lock screen as device owner; `UNLOCK` releases it. |
| **Acknowledges honestly** | Reports `applied: true` only when the restriction actually took hold. |
| **Holds itself when nobody can reach it** | If it has not reached the server for the dealer's limit *and* an installment is past its grace period by the schedule it already holds, it restricts itself. See [The offline rule](#the-offline-rule). |
| **Survives restarts** | The lock is restored from the last state the phone *enforced*, before the network is consulted. |
| **Gives the phone back** | When the server answers 403 — paid off, released or retired — it unwinds every restriction, gives up device owner and erases its own credential. See [Letting the phone go](#letting-the-phone-go). |
| **Reports tampering** | IMEIs, serial and OS integrity on every check-in, and a hardware attestation from the secure chip when the server asks. See [Hardware integrity](#hardware-integrity-140-and-key-attestation-150). |

## What it deliberately does not do

- **No tracking.** Location is read only in answer to a recovery request the
  server has approved — see [Location for recovery](#location-for-recovery-130)
  for exactly when. The permission is granted for that one fix and set back to
  denied straight after, and the customer is shown a notification each time.
  The Wi-Fi SSID, which the server's check-in schema also accepts, is never
  sent.
- **No contacts, no call log, no SMS, no camera.** The manifest asks for
  exactly these permissions:

  | Permission | Why |
  |---|---|
  | `INTERNET`, `ACCESS_NETWORK_STATE` | Talking to the server |
  | `RECEIVE_BOOT_COMPLETED` | Restoring the lock after a restart |
  | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (1.3+) | One fix per approved recovery request; granted and revoked around it by the app itself as device owner |
  | `POST_NOTIFICATIONS` (1.3+) | Telling the customer their location was shared |
  | `READ_PHONE_STATE` (1.4+) | Reading the handset's own IMEI(s) and serial, to compare with the sale record |

  `READ_PHONE_STATE` is the broadest-sounding of these. The app uses it for
  `getImei()` and `Build.getSerial()` and for nothing else.
- **No remote wipe.** The protocol has no such command and this app implements
  none. Locking a financed handset is a contractual remedy; destroying the
  photographs on it is not.
- **No hiding.** The app has a launcher icon and a status screen showing what is
  owed, when it is due and who to call. Somebody paying for this phone is
  entitled to see what is on it.

---

## The offline rule

Everything else here is the server deciding and this app reporting. This is the
one decision the app makes alone, because it only ever arises when there is
nobody to ask: a customer who keeps the phone off the network would otherwise
sit out an entire plan with a lock command queued behind them forever.

**Two conditions, never one.** Silence alone is not evidence of anything. The
handset restricts itself only when it has been out of contact for the dealer's
number of days **and**, by the last schedule it was given, an installment is
genuinely past its grace period. Somebody paid up who spends a month somewhere
without signal keeps a working phone.

| | |
|---|---|
| `OfflineLockRule` | The decision. Pure, and it takes its clock as a parameter, so the whole rule is unit-tested without a device, a network or a WorkManager. |
| `OfflineWatchdogWorker` | Runs it every six hours with **no network constraint**. `CheckInWorker` is constrained to `CONNECTED`, which is right for a heartbeat and means it never runs in the one situation this rule is about. |
| `Prefs.offlineLockSince` | Stamped only if the restriction actually took hold, and cleared by any release. The next check-in carries it to the server, which is how the shop finds out. |

The number of days comes from the server, on every check-in. It is 0 — never —
unless the dealer configured it, automatic locking is on, the device has valid
consent, and the terms the customer signed actually describe the rule. The app
never reasons about any of that: it is told the answer, or it is told zero.

**What it cannot do.** It reads the system clock, and a device owner can move
that. Rolling the clock back stalls the count; it does not reverse it, and the
lock still lands the moment the phone reaches the server. The rule delays
enforcement for a determined customer rather than escaping it.

---

## Staged restrictions

A full lock at the first missed installment is heavy for a customer who is a
few days short. With staged restrictions on (the dealer's Settings), the server
sends a `restrictionLevel` on every check-in and the phone applies it:

| Level | When | What stops working |
|---|---|---|
| 0 | Nothing overdue | Nothing |
| 1 | One installment past grace | Outgoing calls and SMS (`DISALLOW_OUTGOING_CALLS`, `DISALLOW_SMS`) |
| 2 | Two past grace | Level 1, plus the apps in `restrictedApps` suspended (`setPackagesSuspended`) |
| Lock | Three past grace, or the final installment | The existing full lock |

Incoming calls and emergency calls work at every level. A suspended app keeps
its data; it just cannot be opened. `StagedRestrictions` works out the changes
without touching Android and is unit-tested. The phone remembers what it
applied (`Prefs.stageRestrictionsOn`, `Prefs.stageSuspendedApps`), so it undoes
exactly that, including in `releaseFromManagement()`.

**Why not "one SIM, then both SIMs".** Android gives a device-owner app no way
to switch off a single SIM slot. Only the carrier or the OEM firmware can. Calls
and SMS are the closest equivalent the platform allows.

The server sends level 0 unless the customer's signed contract (terms v1.2)
describes the stages and they were on when it was signed.

---

## Surviving a wipe from recovery

`DISALLOW_FACTORY_RESET` closes the reset option in Settings, and it is the
only thing it closes. A customer who holds power + volume, boots into the
recovery menu and picks *Wipe data/factory reset* still erases the phone, and
the wipe takes this app and its device-owner status with it. Ordinary reboots
were never the problem: `BootReceiver` re-applies the lock after a restart.

The answer is **Factory Reset Protection**. The dealer enters up to five
numeric Google account IDs on the dashboard's Settings page. While an
installment is still unpaid, the server sends them as `frpAccountIds` in every
policy, and the handset installs them as the only accounts that can finish
setup after a wipe. A wiped phone then stops at the setup wizard until somebody
signs in with one of the shop's accounts. In practice that means it comes back
to the counter.

| | |
|---|---|
| Android 11+ (API 30) | `DevicePolicyManager.setFactoryResetProtectionPolicy` with the dealer's accounts and FRP enabled. |
| Android 8–10 | Managed configuration on `com.google.android.gms`, key `factoryResetProtectionAdmin`, followed by the `com.google.android.gms.auth.FRP_CONFIG_CHANGED` broadcast. Merged into any restrictions Play services already has. |
| `FactoryResetProtection` | Picks the route and decides whether anything changed. Pure and unit-tested. The heartbeat makes a platform call only when the accounts or the route change. A change of route happens when the OS is upgraded from 10 to 11. |
| `Prefs.frpAppliedIds` | What the platform actually accepted. A refused call is retried at the next check-in. |
| Read-back (1.5.1) | After every apply the app reads the policy back from the OS and reports what it found as `frp` on the check-in: `ACTIVE` (Android 11+ policy in force), `LEGACY` (the Play services route, Android 8–10), `REFUSED` with the reason, or `NOT_CONFIGURED`. A firmware that accepts the call and silently drops the policy shows up as `REFUSED` on the dashboard instead of as protected. A change of status is reported straight away rather than at the next heartbeat. |

It runs at enrolment and again on every check-in, so a dealer who adds an
account after the sale still reaches phones already in the field. An empty list
removes the policy. The server sends one once nothing is owed, so a customer
who has paid off the phone never needs the dealer's account to use it.
`releaseFromManagement()` clears it too, unconditionally.

None of this touches the power menu, the recovery menu itself or emergency
calls. It only controls who can set the phone up again.

**The IDs are numbers, not emails.** FRP matches on the Google account ID (the
obfuscated GAIA ID). An email address would leave a wiped phone asking for an
account nobody can sign in with, which strands it for the dealer too. The
server rejects anything that is not 6–30 digits, and the app drops such values
rather than install them.
The dashboard has a guide, in English and Urdu, for finding that number.

### What FRP cannot do

- **It needs Google Play services.** FRP is enforced by Play services during
  setup. A handset without them (some Huawei models, de-Googled builds) has no
  FRP. The same applies to a build with no persistent data block. The platform
  refuses the call there, and the app logs it and tries again at the next
  check-in.
- **It needs a phone that has been set up.** The policy is installed after
  enrolment, once this app is device owner and has reached the server. A phone
  wiped before its first check-in has no policy to enforce.
- **It does not bring this app back.** After a wipe the phone is locked to the
  dealer's account, but it is no longer managed. There is no lock screen and no
  check-in until the shop re-provisions it from the QR. Having the app install
  itself again after a wipe needs **Android zero-touch enrolment** or **Samsung
  Knox Guard**, where the device's IMEI is registered with the manufacturer or
  carrier and setup enrols it again automatically. Neither is part of this app.
- **Someone who knows the dealer's password defeats it.** That is the point:
  the shop can always recover its own handset.

---

## Location for recovery (1.3.0)

The app reads location only when the server sets `reportLocation` in the
policy. The server sets it only when all of these hold:

- the shop turned on **Location for Phone Recovery**;
- the customer signed terms v1.3 or newer while it was on (clause 4 says so);
- the phone is locked, self-locked or has an overdue installment;
- a shop owner asked within the last 24 hours, giving a reason.

`LocationReporter` then:

1. grants itself the location permission (device owner);
2. takes one fix, waiting at most 30 s, or uses a last-known fix under 30 min old;
3. sets the permission back to denied;
4. reports the fix and shows the customer a notification, in English or Urdu.

The server stores the fix only while that request is still open and still
allowed, then closes the request. Coordinates are left out of every ordinary
device response. An owner opens them on purpose, and the server logs it
(`LOCATION_VIEWED`). Releasing the phone deletes them.

The notification reads, in English: *"Your location was shared with the shop.
An installment on this phone is overdue, so the shop asked for its location, as
your signed agreement allows. It was taken once, and only the shop owner can see
it. Pay the overdue amount or contact the shop."* The Urdu build carries the
same text in Urdu (`values-ur/strings.xml`).

**Not wired up on the heartbeat.** In 1.3.0 through 1.5.1, `DpcSync` calls
`answerLocationRequest` from `enroll()` only. `syncOnce()` — the fifteen-minute
check-in — saves the policy and never looks at `reportLocation`. A recovery
request is only ever made for a phone that is already enrolled, so in practice
the phone does not answer it. Until `syncOnce()` calls it too, treat location
for recovery as not working on real handsets.

---

## Letting the phone go

When the last installment is paid, the server marks the device INACTIVE by
itself. A shop can also do it by hand with **Release phone** on the device
page. The phone's next check-in is answered `403 no longer under management`,
and `releaseFromManagement()` undoes everything in this order:

1. staged restrictions and suspended apps
2. Factory Reset Protection, unconditionally
3. the lock, the reset and safe-mode blocks, the add-user block and the
   uninstall block
4. from 1.2.0, `stepDown()`: `clearDeviceOwnerApp` and `removeActiveAdmin`.
   It has to come last, because every step above needs device-owner rights.
   Android will not uninstall a device owner, so before 1.2.0 a paid-off
   customer could not remove the app. They could only factory reset, which
   step 3 had made possible again.

The app then opens on `ReleasedActivity` ("This phone is yours"), which offers
**Remove this app**. Nothing about a release can be undone from the dashboard.
Managing the phone again means a factory reset and a fresh QR.

---

## Hardware integrity (1.4.0) and key attestation (1.5.0)

`DeviceIntegrityCollector` reads, as device owner: the IMEI of each SIM slot,
the serial number, whether the app still holds device owner, whether an `su`
binary is present, whether the build is signed with test-keys, and the
bootloader state from `ro.boot.verifiedbootstate` / `ro.boot.flash.locked`.
`DeviceIntegrity` turns that into a report and is unit-tested. From 1.5.0 it
travels on every check-in; 1.4.0 sent it only at enrolment.

The server compares it with the sale record and raises tamper flags on the
dashboard — a different IMEI, a different serial from the one pinned after
enrolment, device owner lost, root, an unlocked bootloader.

**Key attestation.** `KeyAttestor` asks the phone's secure chip (TEE or
StrongBox) to sign a throwaway key's certificate over a challenge from the
server, with the factory IMEI(s) and serial included where the maker provisioned
them. It tries IMEI + serial, then serial, then no IDs, then plain keystore
attestation, and says which it managed. The challenge is derived from the
enrolment code the first time (`AttestationChallenge`, tested against the same
vector as the server) and issued by the server about once a day after that.

What it cannot do: root, test-keys and the bootloader properties are read from
the OS, and a rooted phone can lie about them. The attestation chain is the
part the OS cannot forge, and the server checks it against Google's roots and
revocation list — but many budget phones do not provision IDs, and then it
proves less. None of this has been tried across real handsets.

**Day-1 hardening (1.4.0).** USB debugging and installs from unknown sources are
blocked from enrolment, not only while locked, and lifted only on release.

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

For a signed release build and how it reaches a handset, see
**[RELEASE.md](../RELEASE.md)**. What follows is the local debug loop.

```bash
cd android
./gradlew testDebugUnitTest assembleDebug
```

The debug APK lands in `dpc/build/outputs/apk/debug/`. `local.properties` needs
`sdk.dir` pointing at your Android SDK; Android Studio writes it for you, and CI
gets it from `ANDROID_HOME`.

Unit tests are plain JVM tests (48 of them): the JSON parsing that decides
what a lock screen says, the URL joining that decides whether a provisioned
phone can find its server at all, the offline rule, staged restrictions, which
FRP call is due, IMEI and integrity parsing, check-in serialisation and the
attestation challenge. Nothing that calls `DevicePolicyManager` can run there.

### Pointing it at a server

The QR carries the address. `gradle.properties` only supplies the fallback that
the typed enrolment form starts with:

```properties
almassdm.defaultServerUrl=http://10.0.2.2:5000/api/dpc
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

1. Build, sign and publish the APK — [RELEASE.md](../RELEASE.md) is the runbook
   for that — and configure the server with where it lives:

   ```bash
   DPC_SERVER_URL=https://api.your-domain.pk/api/dpc
   DPC_APK_URL=https://github.com/<owner>/<repo>/releases/download/dpc-v1.5.1/almas-sdm-dpc-v1.5.1.apk
   DPC_APK_SIGNATURE_CHECKSUM=<base64url SHA-256 of the signing certificate>
   ```

   Without the last two the dashboard will print the QR **and tell you it cannot
   provision a phone** — a shop should find that out before a customer is
   standing at the counter, not after.

2. Generate the QR from the dashboard's Enrollment page.

3. On the factory-reset handset, tap the welcome screen six times to open the
   scanner, and scan it. The wizard downloads the APK, verifies its signing
   certificate against the checksum, installs it as device owner and hands the
   enrolment code to `AlmasDeviceAdminReceiver`.

4. The app redeems the code (sending its hardware snapshot and an attestation
   with it), hardens the installation — no factory reset, no safe boot, no
   added users, no USB debugging, no unknown-source installs, cannot be
   uninstalled, and FRP set to the dealer's Google accounts if any are
   configured — and starts checking in.

### The signature checksum

```bash
cd android && ./gradlew :dpc:printSigningCertChecksum
```

That prints the line to paste into the server's environment. It is computed from
the key that will sign the build rather than derived by hand, because the value
the wizard wants — the SHA-256 of the signing *certificate*, base64url encoded
without padding — is easy to confuse with the colon-separated SHA-1 fingerprint
`keytool` prints most prominently, and a wrong checksum makes the wizard refuse
the download. That refusal is the point: it is what stops a lookalike APK being
provisioned as owner of somebody's phone.

---

## Trying it without a phone

The dashboard's Simulator page has been removed — it acted on real records, and
on a live server that is a way to lock a real phone by mistake.
`/api/simulator` still exists outside production for the server's own tests.

**An emulator** running the debug build against `10.0.2.2:5000`, enrolling
through the typed form with a code from the Enrollment page, will check in,
receive commands and acknowledge them — and it will refuse every lock with
"device-owner privileges are not held", because an app installed by `adb` is
not an owner. That refusal appearing on the dashboard is the protocol working.

---

## Layout

```
admin/   AlmasDeviceAdminReceiver — provisioning hook
         LockController         — everything that actually restricts the phone
         FactoryResetProtection — which FRP call is due, if any, and the read-back report
         StagedRestrictions     — level → restrictions and suspended apps
         LocationReporter       — one fix for an approved recovery request
         DeviceIntegrity(+Collector) — IMEIs, serial, root/bootloader signals
         KeyAttestor, AttestationChallenge — the secure chip's signed word
data/    Prefs                  — credential, cached policy, enforced lock state
         PolicyView             — the server's answer, parsed
net/     DpcApi                 — the four endpoints
         Telemetry              — what a check-in reports
work/    DpcSync                — one round of the protocol, in one place
         CheckInWorker          — the heartbeat
         CheckInScheduler       — cadence
         BootReceiver           — restore after a restart
         OfflineLockRule, OfflineWatchdogWorker — the offline rule
ui/      LockActivity           — the restricted screen
         StatusActivity         — the unrestricted one
         EnrollActivity         — redeems the code
         ReleasedActivity       — "This phone is yours"
```

Every state change goes through `DpcSync`, so the periodic worker, the boot
receiver and the "check now" button cannot drift apart.
