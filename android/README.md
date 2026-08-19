# EMI Shield — the Android side

Two apps, on two different phones. They share this Gradle build and nothing
else, which is deliberate: the relay must never end up on a financed handset,
nor the DPC on a shop's counter phone.

| Module | Phone | Job |
|---|---|---|
| [`dpc/`](dpc/README.md) | The customer's financed handset | Enrols, checks in, applies and honestly acknowledges the lock |
| `sms-relay/` | The shop's own counter phone | Sends the queued payment reminders from its SIM |

```bash
./gradlew testDebugUnitTest assembleDebug
```

APKs land in `dpc/build/outputs/apk/debug/` and
`sms-relay/build/outputs/apk/debug/`. `local.properties` needs `sdk.dir`;
Android Studio writes it, and CI takes it from `ANDROID_HOME`.

---

## The SMS relay

### Why it exists

No SMS aggregator is connected to this system. Reminders were being written to
the database and left there — `QUEUED` forever, with a dashboard that at least
had the decency to say so. This app is what gets them moving on a shop's own SIM
while a proper operator account is arranged.

### How it behaves

- **Pulls, never listens.** A counter phone on mobile data has no address anyone
  can reach. It asks for work every minute or so; the server names the interval,
  so the cadence can change without shipping a new APK to a shop.
- **Waits for the real outcome.** `sendTextMessage` returns immediately and tells
  the caller nothing, so a naive relay reports every message as sent — including
  the ones a dead SIM silently swallowed. Each send carries a `PendingIntent`
  the platform fires with the actual result, and the app waits for it.
- **Reports failure as failure.** No balance, no service, radio off: the reason
  goes back to the server, the message returns to the queue, and it is retried
  until an attempt cap. A reminder that quietly evaporated is how a customer
  ends up locked out having never been told.
- **Foreground service.** A reminder the OS batched until four hours later is a
  reminder that did not do its job. The persistent notification is also the
  honest arrangement — whoever holds the phone can see it is sending on the
  shop's behalf.
- **Survives a reboot**, but only if it was switched on. A phone deliberately
  stopped stays stopped.

### Permissions

`SEND_SMS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`,
`FOREGROUND_SERVICE`, `POST_NOTIFICATIONS`.

`SEND_SMS` is not a permission to hold lightly, so the boundaries are worth
stating: the app sends only the text the server hands it, to the number the
server names. It has no `READ_SMS` and no `RECEIVE_SMS` — it cannot read
anything on the phone it is installed on. Google Play restricts SMS permissions,
and this is not a Play app: it is sideloaded onto a shop's own counter phone.

### Pairing

1. Dashboard → Notifications → **Pair a phone**. Name it something you will
   recognise on a list ("Counter phone").
2. The pairing code appears once. Only its SHA-256 hash is stored, so it cannot
   be retrieved later — if it is lost, unpair and pair again.
3. In the relay app: paste the server address and the code, grant SMS
   permission, press start.

The dashboard then shows that phone as connected, with its sent and failed
counts, once it has actually polled.

### Cost, and the honest caveat

Every reminder is an ordinary SMS charged to that SIM's package. Pair a phone
whose bundle covers the volume.

At any real volume this is the wrong tool. Bulk commercial SMS in Pakistan goes
through an operator with a PTA-approved sender mask, and a reminder arriving from
an unrecognised mobile number is one customers learn to ignore. Use this for
testing, and for a small shop messaging its own customers.

### Trying it on an emulator

Two emulators can text each other: the emulator's port number is its phone
number. Start the server, point the app at `http://10.0.2.2:5000/api/sms-relay`,
pair it, and queue a message to a customer whose number is the other emulator's
port. `adb emu sms send` also injects messages if you only want to watch the
receiving side.

---

## Layout

```
dpc/         the customer's handset — see dpc/README.md
sms-relay/
  RelayApi      the two endpoints
  RelayPrefs    credential, running state, counts
  SmsSender     one message, and waiting to learn whether it went
  RelayService  the loop: poll, send, report
  MainActivity  pair, start, stop, see what this phone has done
  BootReceiver  resume after a restart, if it was running
```
