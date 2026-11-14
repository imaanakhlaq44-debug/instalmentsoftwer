# Voice over — English

The same narration as `script-urdu.md`, paragraph for paragraph, for an English
cut of the guide video or for an English voice over the same pictures.

It is written to be **spoken**, not read: short sentences, no clause stacked on
clause, and the shopkeeper addressed directly. Prices, screens and claims match
the Urdu exactly — where the Urdu says a tampered phone is *caught*, this says
caught, never *impossible*.

**One mp3 per numbered paragraph**, named `01.mp3`, `02.mp3` … inside a folder
per part (`p1`, `p2`, …). The numbering must not change: every shot in
`scripts/video/build.mjs` is tied to the paragraph it illustrates, and that is
what keeps the picture with the voice.

---

## Part 1 — Introduction, registration, dashboard

**1.**
Hello. If you sell mobile phones on installments, this video is for you.

**2.**
You handed over the phone. Two installments came in. On the third, the phone is
off, the number is dead, the man is gone. And when you ask around, you are told:
he must have got the IMEI changed — nothing can be done now.

**3.**
Almas SDM was built for exactly this. Today I will show you the whole system,
from opening your shop to the last installment — and above all, how this system
catches the IMEI problem in four separate layers.

**4.**
Start with registering your shop. At almassdm.pro, enter your shop's name, your
number and a password, and the account is created. We used to have to create it
for you. Now you create it yourself.

**5.**
Log in at app.almassdm.pro. After five wrong attempts the account locks for a
while, so nobody can guess their way into a password.

**6.**
This is the dashboard. At the top, this month's money — what is due, what came
in, what is stuck. Below it, the work waiting for you today: whose installment
is due, who has gone late, which phone raised an alert. Anything that is not
for today does not appear at all.

**7.**
Now Settings. Your shop's name, your number, and your late fee rule. The late
fee can be a fixed amount or a percentage, and you can cap it.

**8.**
Three things here deserve a careful look. First, your shop's Google account ID
— this is for Factory Reset Protection, and without it the protection that
survives a wipe does not work. Second, the location permission, which is off by
default. Third, where reminders go out from: a phone with your own SIM, or
WhatsApp.

**9.**
And Urdu. The whole dashboard runs in Urdu — switch it here.

---

## Part 2 — Locks, the sale, QR, the agreement

**1.**
Now the locks. We do not charge a monthly fee. You buy locks in packs, and one
lock is spent on one phone. The phone enrols, the lock is spent. It does not
come back when the installments finish — and that is exactly why it works out
cheaper, because you pay nothing every month.

**2.**
Now the sale. This used to take three screens — the customer, the phone, the
plan. It is all one page now.

**3.**
An existing customer? Just type the CNIC number. Name, number and address fill
themselves in. Nothing to type twice.

**4.**
And the IMEI. You no longer type it by hand. Press Scan, point the phone's
camera at the IMEI on the box, and the digits fill themselves in. One mistyped
digit is no longer possible — and that mistake matters, because the whole lock
stands on this IMEI.

**5.**
Then the plan: price, down payment, how many months. The schedule builds itself,
and the arithmetic comes out exact on the last installment — not one rupee off.

**6.**
Now enrolling the phone. The sale produces a QR code. On a new or freshly reset
Android phone, tap the first screen six times, the camera opens, scan the QR.
Our app installs itself as device owner.

**7.**
That QR works once. If two people scan it at the same moment, only one succeeds
— the other gets a clear answer, not a silent failure.

**8.**
And now the part that matters most in law: the agreement.

**9.**
The agreement is created with the sale — in Urdu and English both, carrying that
plan's real figures. The customer signs it right there on the same screen, with
a finger. No separate page to go to.

**10.**
And it is not just paper. A phone with no signature on it, the system refuses to
lock. If the plan's figures change later and no new signature is taken, it
refuses again. Without a signed agreement no phone gets locked — not by your
hand, and not by ours.

---

## Part 3 — The IMEI, and four layers

**1.**
Now the question every shopkeeper asks, and the one nobody usually answers:
what if he gets the IMEI changed?

**2.**
There is not one answer. There are four. Four separate layers — and the man
walking off with your phone has to break all four.

**3.**
Layer one: the lock is bound to one IMEI.

**4.**
The IMEI you registered at the time of sale is the IMEI the lock is spent on.
When the phone enrols, the server matches the IMEI it reports against the sale
record.

**5.**
No match? The phone does not enrol at all. No lock is applied, no licence of
yours is spent — and the dashboard records that an attempt was stopped, on which
phone, and when. Running your lock on a different handset is closed off from the
start.

**6.**
Layer two: it is checked again every fifteen minutes.

**7.**
Enrolment is not the end of it. Every fifteen minutes the phone reports its
IMEI, its serial number and what its hardware looks like.

**8.**
The day the IMEI changes, the server catches it on that very check-in. An alert
goes to the shop — look, here, the registered IMEI and the reported IMEI side by
side — and the phone locks itself. It does not wait for anyone to press a
button.

**9.**
Layer three, and this is the strongest: the phone's own secure chip gives
evidence.

**10.**
Changing an IMEI in software is one thing. Making the phone's secure chip lie is
another thing entirely.

**11.**
The chip signs its factory IMEI — against a challenge the server chose itself.
The first time, a challenge built from the enrolment code; after that, a new one
every day. The server then verifies that signature against Google's root
certificates: is the signature genuine, is the chip genuine, has the certificate
been revoked.

**12.**
The chip's IMEI does not match the registered IMEI — alert. The signature is
forged or broken — alert. This layer does not trust our app. It trusts the
hardware.

**13.**
Layer four: removing the app and resetting the phone are both closed.

**14.**
The idea is usually to uninstall the app, or to factory reset. Both are closed.
The app is device owner — the customer cannot uninstall it, and the reset
attempt is blocked.

**15.**
And if the phone is wiped somehow anyway, Factory Reset Protection means it will
only come back up on your shop's Google account. A stolen phone is of no use to
anyone else.

**16.**
Three more things are watched: the app losing device owner, an unlocked
bootloader, and a rooted phone. All three are recorded on the dashboard, and all
three lock the phone.

**17.**
So the answer is four layers — and each one catches it somewhere different.

**18.**
I will not tell you that changing an IMEI is impossible. Nobody honest will tell
you that. What I am telling you is that it gets caught: at enrolment, on the
fifteen-minute check-in, on the chip's evidence, and on the attempt to remove
the app.

**19.**
And one thing you will not find in every system: this one does not lie to you.
A phone that could not be locked is never shown as locked. The dashboard says
plainly that it did not lock — because a lock you only believe in is more
dangerous than a loss you know about.

---

## Part 4 — Locking, payment, installments

**1.**
Now the day-to-day. An installment has stopped. Open the phone under Devices,
press Lock.

**2.**
A full screen comes up on the phone, in Urdu, with your shop's number on it.
Emergency calls stay open — we do not stand between anyone and an emergency.

**3.**
And it does not happen all at once: first a warning, then calls and apps
restricted, then the full lock. The customer is given room to catch up.

**4.**
What if he turns off the internet? The phone locks itself, on its own, after the
set time — it does not wait for the server. And when it comes back online, the
dashboard shows that the lock had already taken effect at that time.

**5.**
The money has come in. Record the installment under Payments — the receipt
prints straight away, the principal and the late fee written separately, sized
for a thermal printer.

**6.**
Once the installment is recorded, the phone unlocks itself. You do not press
anything a second time.

**7.**
And if the customer paid by JazzCash or Easypaisa, he sends the transaction ID
from home. It arrives for you to confirm — and until you have seen the money in
your own account and confirmed it, none of it counts.

**8.**
Installments and transactions. Every phone's full schedule — which installment
when, how much came in, how much is left. Every payment on record, who entered
it and when.

**9.**
Reminders go out two ways: SMS from a phone with your own SIM, or WhatsApp. The
WhatsApp button sits beside every customer — the message is written for you,
with that plan's real figures, in Urdu or Roman Urdu. You can read it before it
goes.

**10.**
And something not every software will do. Not every customer who falls behind is
dishonest — one has lost his job, another has had something happen at home.

**11.**
For those cases, set the remaining amount again: new installments, from this
same screen, and the agreement's figures change along with it.

**12.**
To waive a late fee, write the reason and waive it. It stays on record — who
waived it, when, and why.

---

## Part 5 — Location, release, security

**1.**
Locating a phone. This feature is off by default, and three conditions must all
hold before it will run: you turned it on yourself in Settings, the customer
signed the agreement while it was on, and the phone is either locked or behind
on an installment.

**2.**
A customer who is paying on time is never traced. The request is made with a
written reason, it answers once — it is not continuous tracking — and a
notification appears on the customer's phone.

**3.**
This works properly from app version 1.5.2 onward, so the phone does need to be
updated.

**4.**
Someone wiped the phone? Enrol it again from the dashboard — a new QR is issued
against the same lock, and it does not cost you another licence.

**5.**
And the last installment. The phone goes free. The app gives up device owner and
tells the customer itself: remove this app. Nothing is left behind, no
restriction and no trace. The phone is entirely his.

**6.**
Security. Each person sees only their own work: staff at the counter get the
CNIC and the IMEI masked, the owner sees them in full. Every action is on the
audit log. And the database is backed up daily — keep that backup somewhere
outside the shop.

**7.**
If you have more than one shop, super admin shows them all in one place — and a
shop you open from there is read-only, so nothing gets changed by accident.

**8.**
That is all of it. No monthly fee — one phone, one lock.

**9.**
There is a free fifteen-minute demo: leave your number at almassdm.pro, or call
us directly. Bring your own phone — we will run it on that one, so that you
trust your own eyes rather than my word.

**10.**
Thank you.
