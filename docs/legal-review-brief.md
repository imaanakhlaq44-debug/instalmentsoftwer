# Brief for legal review — Almas SDM customer agreement and phone lock

**Status: engineers' drafting, awaiting legal review. This document is not legal advice.**

Everything here — the agreement's wording, the descriptions of the law we *think* may be relevant,
and the questions — was written by software engineers. Nobody legally qualified has read the
agreement yet. Its purpose is to let a Pakistani lawyer see quickly what the product does to a
customer's phone, which clauses carry the risk, and what we need answered. Where this brief names a
statute it is a pointer for the lawyer to check, not a statement of what the law says.

Terms version described: **v1.4** (current). Source of truth for the wording:
`server/src/services/contractTerms.ts`. The full text in both languages is in
[section 5](#5-the-full-current-terms-v14), generated from that file.

اردو خلاصہ اس دستاویز کے آخر میں ہے — [سیکشن 6](#6-اردو-خلاصہ).

---

## 1. What the business is

A mobile-phone shop in Pakistan sells a handset on monthly instalments. The customer pays a down
payment, takes the phone home, and pays the rest over some months. The shop uses this software to
record the sale and, if instalments are not paid, to restrict the phone remotely until they are.

The parties:

- **The shop (dealer)** — the seller and the creditor. It is the other party to the agreement and
  the one that decides to lock a phone.
- **The customer** — signs the agreement on the shop's screen (a finger or stylus on a tablet).
- **Almas SDM (the platform)** — supplies the software to the shop and hosts the server. It is
  *not* a party to the customer agreement as currently drafted.

The agreement is bilingual (English and Urdu side by side), is generated per sale with that sale's
real figures, and is signed electronically at the counter. The shop is charged per handset for the
software; the customer is not charged for it.

## 2. What the software does to the customer's phone

At the counter the phone is factory-reset and set up with the shop's management app installed as
**"device owner"** — Android's highest management privilege, intended for company-owned phones. The
customer cannot remove the app. From then on the app does the following. The third column says
which version of the agreement first tells the customer about it; **the server refuses each item
for a customer whose signed version is older than that.**

| # | What the app does | When | In the agreement since |
|---|---|---|---|
| 1 | **Full lock.** The phone shows only a lock screen with the amount owed and the shop's number. Emergency calls still work. Nothing is erased. | An instalment is unpaid after its grace period and the shop (or the nightly automatic job, if the shop enabled it) locks it. Lifts when payment is recorded. | v1.0 |
| 2 | **Offline self-lock.** The phone locks *itself*, with no instruction from anyone. | It has not reached the server for N days in a row (N is chosen by the shop, minimum 3, and printed on the agreement) **and** by the schedule stored on the phone an instalment is past its grace period. Off unless the shop turns it on. | v1.1 |
| 3 | **Staged restrictions.** Stage 1: outgoing calls and SMS blocked. Stage 2: also WhatsApp, Facebook, Messenger, Instagram, TikTok, YouTube, Snapchat, imo and Telegram suspended. Stage 3: full lock. Incoming and emergency calls always work. | 1, 2 and 3 instalments overdue respectively (or the final instalment overdue → full lock). Off unless the shop turns it on. | v1.2 |
| 4 | **Location for recovery.** One GPS/network location reading, sent to the server; the customer sees a notification each time. Not continuous. | Only if: the shop enabled it; the phone is locked or an instalment is overdue; and the shop *owner* requests it with a written reason. Request expires in 24 h or when the customer pays. Only the latest reading is stored; only the owner can view it; each request and view is logged. | v1.3 |
| 5 | **Hardware checks.** Reads the phone's IMEI(s) and serial number; checks for root, unlocked bootloader and unofficial firmware; about once a day asks the phone's secure chip to sign a statement of the same facts. Sent to the server and shown to the shop owner. | Every contact with the server (about every 15 minutes when online). | v1.4 |
| 6 | **Tamper lock.** Full lock (as item 1) **even though nothing is overdue.** | The checks in item 5 show the IMEI or serial no longer matches the sale, the phone is rooted, or the bootloader is unlocked. Lifted by the shop after inspection, not by payment. | v1.4 |
| 7 | **Reset protection (Google FRP).** After the phone is erased from the recovery menu, it will not complete setup until the *shop's* Google account signs in. | Only if the shop configured its account. Removed automatically when the last instalment is paid. | v1.4 |
| 8 | **Hardening.** Factory reset from Settings disabled; the app cannot be uninstalled; safe-mode boot, adding users, USB debugging and installing apps from outside the app store disabled. | From the moment the phone is set up until it is released. Always on; not a shop setting. | v1.4 (see gap G2) |
| 9 | **Routine reporting.** Battery level, Android version, security-patch date, mobile network name, app version; the server also records time of contact and IP address. | Every contact. | v1.4 (partly; see G5) |

What the app does **not** do: read SMS, call logs, contacts, photos or files; record audio or use
the camera; track location continuously; erase the phone (there is no wipe command).

When the last instalment is paid, or the shop releases the phone, the app removes every
restriction and its own management of the phone, and the server deletes the stored location,
hardware reports and tamper record for that phone.

### What the software refuses the shop

A lock is refused unless there is a signed, un-voided agreement whose stored record still matches
its signature hash **and** whose figures still match the repayment plan in force (so a plan cannot
be raised after signing and then enforced). A lock before the grace period has run out is refused
by the automatic job. Every lock, unlock, payment, edit, location request and location view is
written to an audit log naming the person.

## 3. The clauses we need an opinion on

In priority order. For each: what it says, why we are unsure, and what we are asking.

### 3.1 The offline self-lock — clause 4, fourth paragraph (first priority)

**What it says.** "If it is unable to [contact the shop's system] for *N* days in a row while an
instalment is overdue, it will restrict itself until it can. Turning off mobile data, removing the
SIM or keeping the phone offline therefore does not prevent a restriction."

**Why we are unsure.** Every other lock is a decision by a person at the shop, made on current
information, and recorded. This one is made by the phone, alone, from the schedule it last
downloaded. A customer who paid in cash at the counter on day 2 of being offline is, on the phone's
information, still unpaid; the phone will lock on day *N* and only release when it next gets a
connection. The phone's clock can also be wrong. The customer may be somewhere with no signal for
reasons that have nothing to do with avoiding payment.

**Questions.**

1. Is a contractual term under which the buyer's phone disables itself without any act or notice
   from the seller enforceable in Pakistan, or is it open to challenge (for example as
   unconscionable, as a penalty, or under provincial consumer-protection law)?
2. Does it matter that the trigger is "could not contact us" rather than "did not pay"? Should the
   clause be reworded so the trigger is non-payment and the offline period is only the mechanism?
3. Is prior notice required before a self-lock (the phone does show the reason once locked)? If
   so, what form — a warning on the phone some days before, an SMS, something in writing?
4. If a customer who had in fact paid is locked out by this rule and suffers loss (misses work,
   cannot reach family), who is liable — the shop, the platform, both? Can the agreement limit
   that, and should it?
5. Is the 3-day minimum we enforce a defensible floor, or should the agreement fix a longer one?
6. Does the customer need to initial or separately acknowledge this paragraph, given that it is
   the most surprising term in the document?

### 3.2 Location — clause 4, sixth paragraph

**What it says.** Only while the phone is restricted or an instalment is overdue, the shop may ask
the phone for its current location "in order to recover it"; once per request, never continuously,
with a notice to the customer each time; only the shop's owner sees it; every request and view is
recorded; never while instalments are up to date; stops for good once paid.

**Why we are unsure.** Location is personal data about where a person is, obtained through a
device the person carries. Consent is given once, at signing, as part of a contract they must
accept to get the phone. "Recover it" implies the shop may go and take the phone back, which the
agreement does not otherwise provide for.

**Questions.**

1. Is consent given inside the financing agreement sufficient for the shop to obtain the phone's
   location later, or does it need to be separate, specific, or renewable? Can the customer
   withdraw it while money is still owed, and what happens if they do?
2. Does obtaining location this way engage the Prevention of Electronic Crimes Act 2016 (for
   example unauthorised access to data or an information system), and does the customer's
   signed consent answer that?
3. What is the current status of personal-data-protection legislation in Pakistan, and what would
   it require of (a) the shop and (b) the platform that hosts the data, for location in particular?
4. What may the shop lawfully *do* with a location? The agreement says "recover" the phone. Does
   the shop have any right to repossess the handset on default without a court order? If not,
   should the word "recover" be removed and the purpose restated (for example, to contact the
   customer)? Should the agreement expressly forbid staff going to the address?
5. Should the agreement limit how long a location is kept? Today the latest reading is kept until
   the phone is released or paid off.
6. Is a notification on the phone adequate notice, given that a locked phone may not be looked at?

### 3.3 Staged restrictions — clause 4, fifth paragraph

**What it says.** One instalment overdue: no outgoing calls or SMS. Two: social media, messaging
and video apps "(such as WhatsApp, Facebook, TikTok and YouTube)" paused. Three, or the final
instalment overdue: full lock. Incoming and emergency calls always work.

**Why we are unsure.** Blocking outgoing calls on a person's only phone is a serious step for one
missed instalment. The clause names four apps as examples; the software suspends twelve (listed in
section 2, item 3) and that list can change with a software update.

**Questions.**

1. Is restricting outgoing calls and SMS proportionate and lawful as a remedy for one missed
   instalment? Is there any telecom-regulatory (PTA) rule about a retailer interfering with a
   subscriber's ability to make calls on a network it does not operate?
2. Emergency numbers stay reachable and incoming calls work, but at stage 1 no other outgoing
   call can be made — not even to the shop to arrange payment. Is that enough, or must some calls
   be exempt?
3. Must the agreement list every app that can be suspended, rather than "such as"? If the list
   changes later, does that need a new signature?
4. Does suspending a third party's app (WhatsApp, etc.) create any exposure for the shop or the
   platform?

### 3.4 Factory-reset protection and hardening — clause 4, last paragraph

**What it says.** While money is owed the phone cannot be factory-reset from its settings, the
management software cannot be removed, and USB debugging and installing apps from outside the app
store are off. If the phone is erased by other means, "it may refuse to be set up again until
[the shop] signs in to it with the shop's own account." Removed once the final instalment is paid.

**Why we are unsure.** After a recovery-menu reset the phone is unusable by anyone but the shop.
If the shop closes, loses access to that Google account, or refuses to cooperate, a customer who
is up to date — or even one who has paid in full but whose phone had not yet received the release
— could be left with a phone that cannot be set up.

**Questions.**

1. The agreement says ownership passes to the customer on delivery with the shop keeping a
   "security interest" (clause 5). Is tying the customer's own phone to the shop's Google account
   consistent with that, or does it only make sense if the shop retains title until paid?
2. What must the agreement promise about releasing the phone — a time limit after final payment,
   and a remedy if the shop does not or cannot do it?
3. What should happen to these phones if the shop ceases trading or the platform shuts down? Does
   the agreement (or the shop's contract with the platform) need a provision for that?
4. Disabling installation of apps from outside the app store and USB debugging for the whole term,
   for a customer who is not in default: is that an acceptable condition of sale if disclosed?

### 3.5 Hardware checks and the tamper lock — clause 4, seventh paragraph (new in v1.4)

**What it says.** The software reads the IMEI and serial numbers and checks whether system software
has been modified, and reports this on each contact with battery level, Android version and
network name. "If the handset is found to have been tampered with, or its IMEI or serial number no
longer matches this agreement, it may be restricted even when the instalments are up to date, until
[the shop] has inspected it."

**Why we are unsure.** This is the only lock that does not depend on a missed payment, and it is
triggered automatically by software detection that can be wrong (a repair that replaces the main
board changes the serial; some legitimate firmware reports unusual states). The customer must
bring the phone to the shop to have it lifted.

**Questions.**

1. Can a seller lawfully disable a phone whose buyer is not in default, on the ground that the
   buyer modified it? Does it depend on title (see 3.4 Q1)?
2. Should the lock require a human decision at the shop rather than being automatic, and should
   the customer get notice and a chance to explain first?
3. Should the agreement list what counts as tampering, and exclude authorised repair?
4. Changing an IMEI is, we understand, itself unlawful in Pakistan. Does detecting it create any
   reporting duty for the shop or the platform?
5. Is collecting the IMEI and serial number on every contact a personal-data question, given that
   the IMEI is already printed on the agreement?

### 3.6 Late fees — clause 3

**What it says.** One of five forms, depending on the shop's settings at signing: no late fee; a
fixed amount once; a fixed amount per day; a percentage of the overdue instalment once; or a
percentage per day — each optionally capped per instalment. The agreement prints the actual
figures. Late fees are collected before principal when a payment is allocated.

**Questions.**

1. Is a late fee on an instalment sale by a retailer enforceable, or is it a penalty the court
   would reduce to reasonable compensation (we understand the Contract Act 1872 addresses this)?
2. Does a *daily* or *percentage* late fee amount to interest (riba)? Is that a legal problem for
   an unlicensed retailer, as opposed to a religious objection the shop may wish to avoid anyway?
   Would describing it differently (for example a fixed administrative charge) change the answer?
3. Must there be a cap? The software lets a shop set a daily fee with no cap.
4. Does selling on instalments with charges make the shop a lender needing a licence or
   registration (SECP / State Bank), or is a retailer's own instalment sale outside those rules?
   Does a higher instalment price than the cash price change that?
5. Is it lawful to keep a phone locked for unpaid *late fees alone* once the instalment itself is
   paid? (Today the software treats the instalment as unpaid until fees are cleared or waived.)

### 3.7 Data retention and who is responsible for the data

**What happens today.** The server holds the customer's name, phone, CNIC number, address,
emergency contact; the handset's details; the payment history; the signed agreement including an
image of the signature and the IP address it was signed from; and an audit log. On release or
payoff the location, hardware reports and tamper record are deleted. **Nothing else is ever
deleted automatically** — there is no retention period in the software. The agreement's only words
on the subject are clause 7: a copy "is held by [the shop] and is available to the customer on
request."

**Questions.**

1. How long must, and how long may, a shop keep a customer's CNIC, address and signed agreement
   after the plan is paid off? Is there a tax or limitation period that sets a minimum?
2. Should the agreement state a retention period and the customer's right to a copy, to
   correction, and to deletion afterwards?
3. Who is legally responsible for this data — the shop, the platform that hosts it, or both? What
   should the contract between the platform and each shop say about that?
4. The server may be hosted outside Pakistan. Is there any restriction on storing CNIC numbers or
   location data abroad?
5. Staff at the shop see masked CNIC and IMEI; the owner sees them in full. Is anything more
   required?

### 3.8 Other points we would like looked at

1. **Electronic signature.** The customer signs with a finger on the shop's screen; a shop
   employee operates it and ticks "the customer has read the declaration." We store the image,
   name, time, IP address and a SHA-256 hash over the terms version and the sale's figures. Is
   that a valid signature under the Electronic Transactions Ordinance 2002 for this kind of
   agreement? Is a witness, a thumb impression, a CNIC copy or a stamp paper needed?
2. **Language.** Both languages are printed. Which prevails if they differ? Should the agreement
   say so? What is required if the customer cannot read either?
3. **Ownership (clause 5).** "Handed over today… [the shop] retains a security interest… may not
   sell, pawn or transfer." Is "security interest" the right concept for movable goods sold by a
   retailer, or should this be a sale with retention of title / hire-purchase? Which gives the
   shop the powers the software exercises?
4. **Changing the plan.** If the schedule is restructured, the software refuses to lock until a
   new agreement is signed. Is a fresh signed agreement the right instrument, or an addendum?
5. **Voiding.** A shop can void an agreement (sale cancelled). What should happen to money paid?
6. **Minors and guarantors.** Nothing in the software checks the signer's age or takes a guarantor.
7. **Consumer-protection law.** Does the relevant provincial Consumer Protection Act treat any of
   clause 4 as an unfair term or a defective service? Does it require specific disclosures at
   sale (for example a statement of total price versus cash price)?
8. **The platform's own exposure.** The platform supplies the tool and hosts the server but is not
   a party. Should it be named in the agreement, and what should its terms with shops require of
   them (for example: no locking outside the agreement, no visiting customers using location)?
9. **Dispute route.** The agreement has no clause on complaints, governing law or forum.

## 4. Gaps the engineers already know about

Stated plainly so the lawyer does not have to find them.

- **G1 — v1.3 contradicts itself.** Agreements signed under v1.3 with location enabled say both
  "does not track the handset's location" and, two paragraphs later, that the shop may ask for it.
  v1.4 qualifies the first sentence. Published versions are never edited, so v1.3 agreements still
  read that way. *Question: does that contradiction weaken the location consent of anyone who
  signed v1.3, and should the shop stop relying on it until they re-sign?*
- **G2 — Hardening cannot be withheld by the server.** Item 8 in section 2 is applied by the app
  itself on every managed phone, whichever version the customer signed; only a new app release
  could change that. It is disclosed from v1.4. Customers on v1.0–v1.3 were told that "management
  software" is installed and cannot use the phone normally when restricted, but not these specifics.
- **G3 — Checks at the counter.** When the phone is first set up in the shop, the app reports its
  IMEI/serial so the server can refuse to enrol the wrong phone. This happens before the customer
  has signed, on the shop's premises, and is not gated on a terms version.
- **G4 — No way to re-sign yet.** The software drafts an agreement only when a sale is registered.
  There is no screen to issue a fresh agreement on current terms to an existing customer. Until
  there is, a customer on v1.3 or earlier simply does not get the tamper lock or reset protection
  (the server withholds them), and a customer whose plan was restructured cannot be locked at all.
- **G5 — Routine reporting.** Battery level, Android version and network name are named in v1.4.
  Security-patch date, app version, time of contact and IP address are not named in any version.
- **G6 — The phone's own clock** decides the offline self-lock and can be changed by the user or be
  wrong.
- **G7 — "The restriction is lifted as soon as the overdue payment is recorded."** True of payment
  locks. Not true of the tamper lock, which the shop lifts by hand; v1.4 says "until [the shop] has
  inspected it" but the earlier sentence is unqualified.
- **G8 — The declaration** (above the signature) mentions clause 4 as a whole. It does not
  separately call out the offline rule, location or reset protection.

## 5. The full current terms (v1.4)

Generated from `server/src/services/contractTerms.ts` with every optional paragraph switched on.
Figures (Rs. 60,000, 6 instalments, 3 days' grace, 7 days offline, Rs. 200 a day capped at
Rs. 1,000) are examples — each agreement prints that sale's real ones. `[SHOP NAME]`, `[BRAND]`,
`[MODEL]`, `[IMEI]` and `[SHOP PHONE]` are filled in per sale. The printed agreement also carries
the customer's name, CNIC, phone and address, the handset details, and the full dated schedule.

Paragraphs 4 (offline rule), 5 (stages) and 6 (location) of clause 4 are printed only if the shop
had that feature switched on when the customer signed. Where location is off, the third paragraph
reads "…does not track the handset's location, and cannot erase…" without the exception. Clause 3
is one of the five late-fee forms described in 3.6.

### English

**1. What is being financed**

> [SHOP NAME] is selling a [BRAND] [MODEL] (IMEI [IMEI]) at a total price of Rs. 60,000. A down payment of Rs. 12,000 has been received, leaving Rs. 48,000 to be paid in installments.

**2. The repayment schedule**

> 6 monthly installments of approximately Rs. 8,000, the first falling due on 2026-12-05. The exact amount of each installment is listed in the schedule attached to this agreement; the final installment may differ slightly so that the total matches Rs. 48,000 exactly. A grace period of 3 day(s) applies after each due date.

**3. Late payment**

> A late fee of Rs. 200 applies for each day an installment remains unpaid after the grace period, capped at Rs. 1,000 per installment.

**4. Consent to restriction of the device**

> The customer consents to management software being installed on this handset by [SHOP NAME]. If an installment remains unpaid after its grace period, the software may restrict the handset so that it cannot be used for ordinary purposes until the overdue amount is paid.
>
> While restricted, the handset will continue to allow emergency calls, and will display the amount owed and the shop's contact number. The restriction is lifted as soon as the overdue payment is recorded.
>
> The software does not read the customer's messages, calls, photographs or contacts, does not track the handset's location except as stated below in this clause, and cannot erase any data on it. Once the final installment is paid, management is removed and the handset is the customer's without restriction.
>
> This handset contacts [SHOP NAME]'s system automatically from time to time. If it is unable to do so for 7 days in a row while an installment is overdue, it will restrict itself until it can. Turning off mobile data, removing the SIM or keeping the phone offline therefore does not prevent a restriction. It lifts as soon as the handset reaches the system again and the installment has been paid.
>
> Restrictions are applied in stages. With one installment unpaid after its grace period, the handset cannot make outgoing calls or send SMS. With two, social media, messaging and video apps (such as WhatsApp, Facebook, TikTok and YouTube) are also paused. With three, or if the final installment is unpaid after its grace period, the handset is restricted as described above. At every stage incoming calls and emergency calls keep working, and each stage is lifted as soon as the overdue payment is recorded.
>
> Only while this handset is restricted, or an installment is unpaid after its grace period, [SHOP NAME] may ask the handset for its current location in order to recover it. It is taken once for each request, never continuously, the handset shows a notice each time it is shared, and only the shop's owner can see it. Every request and every view is recorded. Location is never asked for while the installments are up to date, and stops for good once the plan is paid in full.
>
> So that the handset securing this agreement cannot be swapped or altered, the software reads the handset's IMEI and serial numbers and checks whether its system software has been modified (for example rooted, or its bootloader unlocked). It reports this to [SHOP NAME]'s system each time it makes contact, together with the battery level, Android version and mobile network name. If the handset is found to have been tampered with, or its IMEI or serial number no longer matches this agreement, it may be restricted even when the installments are up to date, until [SHOP NAME] has inspected it.
>
> While any amount is owed, the handset cannot be factory-reset from its settings, the management software cannot be removed, and USB debugging and installing apps from outside the app store are switched off. If the handset is erased by any other means, it may refuse to be set up again until [SHOP NAME] signs in to it with the shop's own account. These protections are removed once the final installment is paid.

**5. Ownership**

> The handset is handed over to the customer today. [SHOP NAME] retains a security interest in it until the financed amount of Rs. 48,000 is paid in full. The customer may not sell, pawn or transfer the handset before then.

**6. Early settlement, and if circumstances change**

> The customer may settle the remaining balance at any time and have the restriction software removed. If the customer is unable to pay on time, they should contact [SHOP NAME] on [SHOP PHONE] before the due date; the schedule can be restructured by agreement.

**7. Records**

> A copy of this agreement, with the signature below, is held by [SHOP NAME] and is available to the customer on request. Every payment is receipted.

**Declaration (above the signature)**

> I have read and understood the terms above, including clause 4, which permits this handset to be restricted if my installments fall overdue or if the handset is tampered with, and which describes what the software reads from the handset. I accept them.

### اردو (Urdu)

**۱۔ کس چیز کی مالی معاونت ہو رہی ہے**

> [SHOP NAME] [BRAND] [MODEL] (آئی ایم ای آئی [IMEI]) کل Rs. 60,000 میں فروخت کر رہا ہے۔ Rs. 12,000 ایڈوانس وصول ہو چکا ہے، باقی Rs. 48,000 اقساط میں ادا کرنا ہے۔

**۲۔ اقساط کا شیڈول**

> 6 ماہانہ اقساط، تقریباً Rs. 8,000 فی قسط، پہلی قسط 2026-12-05 کو واجب الادا ہے۔ ہر قسط کی درست رقم اس معاہدے کے ساتھ منسلک شیڈول میں درج ہے؛ آخری قسط تھوڑی مختلف ہو سکتی ہے تاکہ کل رقم Rs. 48,000 کے برابر رہے۔ ہر تاریخ کے بعد 3 دن کی مہلت دی جائے گی۔

**۳۔ تاخیر سے ادائیگی**

> مہلت کے بعد قسط ادا نہ ہونے پر Rs. 200 جرمانہ روزانہ عائد ہوگا، فی قسط زیادہ سے زیادہ Rs. 1,000۔

**۴۔ موبائل بند کرنے کی اجازت**

> گاہک اس بات کی اجازت دیتا ہے کہ [SHOP NAME] اس موبائل پر مینجمنٹ سافٹ ویئر انسٹال کرے۔ اگر کوئی قسط مہلت گزرنے کے بعد بھی ادا نہ ہو، تو یہ سافٹ ویئر موبائل کو محدود کر سکتا ہے، یعنی بقایا رقم کی ادائیگی تک موبائل عام استعمال کے لیے نہیں کھلے گا۔
>
> بند ہونے کی حالت میں بھی موبائل سے ایمرجنسی کال کی جا سکے گی، اور اسکرین پر بقایا رقم اور دکان کا نمبر دکھایا جائے گا۔ ادائیگی درج ہوتے ہی پابندی ختم ہو جائے گی۔
>
> یہ سافٹ ویئر گاہک کے پیغامات، کالیں، تصاویر یا رابطے نہیں پڑھتا، موبائل کی لوکیشن ٹریک نہیں کرتا سوائے اس صورت کے جو اسی شق میں نیچے بیان ہے، اور اس کا کوئی ڈیٹا مٹا نہیں سکتا۔ آخری قسط کی ادائیگی کے بعد مینجمنٹ ہٹا دی جائے گی اور موبائل مکمل طور پر گاہک کا ہو جائے گا۔
>
> یہ موبائل وقتاً فوقتاً خود بخود [SHOP NAME] کے سسٹم سے رابطہ کرتا ہے۔ اگر قسط بقایا ہونے کی حالت میں مسلسل 7 دن تک یہ رابطہ نہ ہو سکے، تو موبائل خود کو محدود کر دے گا جب تک رابطہ بحال نہ ہو۔ اس لیے موبائل ڈیٹا بند کرنے، سم نکالنے یا فون کو آف لائن رکھنے سے پابندی سے بچا نہیں جا سکتا۔ رابطہ بحال ہوتے ہی اور قسط ادا ہو جانے پر پابندی ختم ہو جائے گی۔
>
> پابندیاں مرحلہ وار لگیں گی۔ ایک قسط مہلت کے بعد بھی بقایا ہو تو موبائل سے باہر کال اور SMS نہیں ہو سکیں گے۔ دو اقساط بقایا ہوں تو سوشل میڈیا، میسجنگ اور ویڈیو ایپس (جیسے واٹس ایپ، فیس بک، ٹک ٹاک، یوٹیوب) بھی بند ہو جائیں گی۔ تین اقساط بقایا ہوں، یا آخری قسط مہلت کے بعد ادا نہ ہو، تو موبائل اوپر بیان کردہ طریقے سے بند ہو جائے گا۔ ہر مرحلے میں آنے والی کالیں اور ایمرجنسی کال چلتی رہیں گی، اور بقایا ادائیگی درج ہوتے ہی پابندی ختم ہو جائے گی۔
>
> صرف اس وقت جب یہ موبائل بند ہو، یا کوئی قسط مہلت کے بعد بھی ادا نہ ہوئی ہو، [SHOP NAME] موبائل واپس حاصل کرنے کے لیے اس کی موجودہ لوکیشن منگوا سکتا ہے۔ ہر درخواست پر صرف ایک بار لوکیشن لی جائے گی، مسلسل نہیں، ہر بار موبائل پر اطلاع دکھائی جائے گی، اور اسے صرف دکان کا مالک دیکھ سکے گا۔ ہر درخواست اور ہر بار دیکھنا ریکارڈ ہوگا۔ اقساط وقت پر ادا ہوں تو لوکیشن کبھی نہیں منگوائی جائے گی، اور پوری رقم ادا ہونے پر یہ ہمیشہ کے لیے بند ہو جائے گی۔
>
> اس لیے کہ اس معاہدے کی ضمانت والا موبائل بدلا یا تبدیل نہ کیا جا سکے، یہ سافٹ ویئر موبائل کا آئی ایم ای آئی اور سیریل نمبر پڑھتا ہے اور یہ جانچتا ہے کہ اس کے سسٹم سافٹ ویئر میں کوئی چھیڑ چھاڑ تو نہیں ہوئی (مثلاً روٹ کرنا یا بوٹ لوڈر کھولنا)۔ ہر رابطے پر یہ معلومات، بیٹری کی سطح، اینڈرائیڈ ورژن اور موبائل نیٹ ورک کے نام کے ساتھ، [SHOP NAME] کے سسٹم کو بھیجی جاتی ہیں۔ اگر موبائل میں چھیڑ چھاڑ پائی جائے، یا اس کا آئی ایم ای آئی یا سیریل نمبر اس معاہدے سے نہ ملے، تو اقساط وقت پر ادا ہونے کے باوجود موبائل محدود کیا جا سکتا ہے، جب تک [SHOP NAME] اس کا معائنہ نہ کر لے۔
>
> جب تک کوئی رقم واجب الادا ہے، موبائل کو سیٹنگز سے فیکٹری ری سیٹ نہیں کیا جا سکتا، مینجمنٹ سافٹ ویئر ہٹایا نہیں جا سکتا، اور یو ایس بی ڈی بگنگ اور ایپ اسٹور کے باہر سے ایپس انسٹال کرنا بند رہتا ہے۔ اگر موبائل کسی اور طریقے سے مٹا دیا جائے تو ممکن ہے وہ دوبارہ سیٹ اپ نہ ہو جب تک [SHOP NAME] دکان کے اپنے اکاؤنٹ سے اس میں سائن اِن نہ کرے۔ آخری قسط کی ادائیگی کے بعد یہ تمام حفاظتی پابندیاں ختم کر دی جاتی ہیں۔

**۵۔ ملکیت**

> موبائل آج گاہک کے حوالے کیا جا رہا ہے۔ Rs. 48,000 کی مکمل ادائیگی تک [SHOP NAME] کا اس پر حقِ ضمانت برقرار رہے گا۔ اس سے پہلے گاہک موبائل فروخت، گروی یا منتقل نہیں کر سکتا۔

**۶۔ قبل از وقت ادائیگی، اور حالات بدلنے کی صورت میں**

> گاہک کسی بھی وقت باقی رقم ادا کر کے پابندی والا سافٹ ویئر ہٹوا سکتا ہے۔ اگر گاہک وقت پر ادائیگی نہ کر سکے تو تاریخ سے پہلے [SHOP NAME] سے [SHOP PHONE] پر رابطہ کرے؛ باہمی رضامندی سے شیڈول دوبارہ ترتیب دیا جا سکتا ہے۔

**۷۔ ریکارڈ**

> اس معاہدے کی نقل، نیچے دیے گئے دستخط سمیت، [SHOP NAME] کے پاس محفوظ ہے اور گاہک کے مطالبے پر فراہم کی جائے گی۔ ہر ادائیگی کی رسید دی جاتی ہے۔

**اقرار نامہ (دستخط کے اوپر)**

> میں نے اوپر دی گئی تمام شرائط پڑھ اور سمجھ لی ہیں، بشمول شق نمبر ۴، جس کے تحت اقساط بقایا ہونے یا موبائل میں چھیڑ چھاڑ کی صورت میں یہ موبائل بند کیا جا سکتا ہے، اور جس میں بتایا گیا ہے کہ سافٹ ویئر موبائل سے کیا معلومات پڑھتا ہے۔ مجھے یہ شرائط منظور ہیں۔

---

## 6. اردو خلاصہ

**حیثیت: یہ مسودہ انجینئروں نے لکھا ہے اور ابھی کسی وکیل نے اسے نہیں دیکھا۔ یہ قانونی مشورہ نہیں ہے۔**
اس دستاویز کا مقصد صرف یہ ہے کہ پاکستانی وکیل جلدی سمجھ سکے کہ یہ سافٹ ویئر گاہک کے فون کے ساتھ کیا کرتا ہے، معاہدے کی
کون سی شقیں خطرے والی ہیں، اور ہمیں کن سوالوں کے جواب چاہییں۔

### کاروبار کیا ہے

موبائل کی دکان فون قسطوں پر بیچتی ہے۔ گاہک ایڈوانس دے کر فون لے جاتا ہے اور باقی رقم ماہانہ قسطوں میں دیتا ہے۔ گاہک دکان کی
اسکرین پر اردو اور انگریزی دونوں زبانوں میں لکھے معاہدے پر دستخط کرتا ہے۔ قسط ادا نہ ہو تو دکان اس سافٹ ویئر سے فون کو
دور سے محدود کر سکتی ہے۔

### سافٹ ویئر فون کے ساتھ کیا کرتا ہے

1. **مکمل لاک** — قسط مہلت کے بعد بھی ادا نہ ہو تو فون بند ہو جاتا ہے؛ اسکرین پر بقایا رقم اور دکان کا نمبر آتا ہے۔ ایمرجنسی
   کال چلتی ہے۔ کوئی ڈیٹا نہیں مٹتا۔
2. **آف لائن خود کار لاک** — اگر فون مسلسل اتنے دن (جو معاہدے پر لکھے ہیں) انٹرنیٹ سے دور رہے **اور** قسط بھی بقایا ہو، تو فون
   کسی کے حکم کے بغیر خود بند ہو جاتا ہے۔
3. **مرحلہ وار پابندیاں** — ایک قسط بقایا: باہر جانے والی کال اور ایس ایم ایس بند۔ دو: واٹس ایپ، فیس بک، ٹک ٹاک، یوٹیوب وغیرہ
   بند۔ تین: مکمل لاک۔
4. **لوکیشن** — صرف تب جب فون بند ہو یا قسط بقایا ہو، اور دکان کا مالک وجہ لکھ کر مانگے: ایک بار کی لوکیشن، گاہک کو ہر بار
   اطلاع۔ مسلسل نگرانی نہیں۔
5. **ہارڈویئر کی جانچ** — فون کا آئی ایم ای آئی، سیریل نمبر، اور یہ کہ فون روٹ تو نہیں یا بوٹ لوڈر کھلا تو نہیں، ہر رابطے پر
   سرور کو بتایا جاتا ہے۔
6. **چھیڑ چھاڑ پر لاک** — اگر جانچ میں چھیڑ چھاڑ نکلے تو فون بند ہو سکتا ہے **چاہے قسطیں وقت پر ہوں**، جب تک دکان معائنہ نہ کرے۔
7. **ری سیٹ سے حفاظت** — فون سیٹنگز سے ری سیٹ نہیں ہوتا؛ کسی اور طریقے سے مٹایا جائے تو دکان کے گوگل اکاؤنٹ کے بغیر دوبارہ
   چالو نہیں ہوتا۔ آخری قسط کے بعد یہ سب ختم۔

سافٹ ویئر یہ **نہیں** کرتا: پیغامات، کالوں کا ریکارڈ، رابطے، تصاویر پڑھنا؛ مسلسل لوکیشن؛ فون کا ڈیٹا مٹانا۔

جو بات گاہک کے دستخط شدہ معاہدے کے ورژن میں نہیں لکھی، سرور اُس گاہک کے فون پر وہ کام نہیں ہونے دیتا۔ نمبر 5، 6 اور 7 صرف
ورژن 1.4 (موجودہ) میں لکھے ہیں۔

### وکیل سے کن شقوں پر رائے چاہیے (ترتیب کے ساتھ)

1. **آف لائن خود کار لاک (سب سے پہلے)** — کیا ایسی شرط قابلِ نفاذ ہے کہ فون دکان کے کسی عمل یا نوٹس کے بغیر خود بند ہو جائے؟
   اگر گاہک نے قسط دے دی ہو مگر فون کو خبر نہ ہو اور وہ بند ہو جائے تو ذمہ دار کون؟ کیا پہلے نوٹس ضروری ہے؟
2. **لوکیشن** — کیا معاہدے کے اندر دی گئی اجازت کافی ہے؟ پیکا 2016 اور ڈیٹا کے تحفظ کے قانون کا کیا تقاضا ہے؟ دکان لوکیشن سے
   کیا کر سکتی ہے — کیا وہ عدالت کے بغیر فون واپس لے سکتی ہے؟
3. **مرحلہ وار پابندیاں** — کیا ایک قسط پر باہر کی کال بند کرنا جائز اور مناسب ہے؟ کیا پی ٹی اے کا کوئی اصول آڑے آتا ہے؟
4. **فیکٹری ری سیٹ سے حفاظت** — فون گاہک کی ملکیت ہے مگر دکان کے اکاؤنٹ سے بندھا ہے؛ کیا یہ درست ہے؟ دکان بند ہو جائے تو کیا ہوگا؟
5. **چھیڑ چھاڑ پر لاک** — کیا ایسے گاہک کا فون بند کیا جا سکتا ہے جس کی کوئی قسط بقایا نہیں؟
6. **تاخیر کا جرمانہ** — کیا یہ قابلِ نفاذ ہے یا "پینلٹی"؟ کیا روزانہ یا فیصد جرمانہ سود (ربا) شمار ہوگا؟ کیا دکان کو قرض دینے
   کا لائسنس چاہیے؟
7. **ڈیٹا کب تک رکھا جائے** — شناختی کارڈ نمبر، پتہ اور دستخط شدہ معاہدہ کتنی مدت رکھنا لازم یا جائز ہے؟ ڈیٹا کا ذمہ دار
   دکان ہے یا پلیٹ فارم؟
8. **دیگر** — اسکرین پر انگلی کے دستخط کی قانونی حیثیت؛ اردو اور انگریزی میں فرق ہو تو کون سا متن معتبر؛ ملکیت اور "حقِ ضمانت"
   کی شق؛ صارف کے تحفظ کا قانون؛ شکایت اور عدالت کے دائرۂ اختیار کی شق (جو ابھی معاہدے میں نہیں)۔

ہر شق کے تفصیلی سوالات اوپر انگریزی حصے (سیکشن 3) میں ہیں، اور معاہدے کا مکمل اردو متن سیکشن 5 میں ہے۔
