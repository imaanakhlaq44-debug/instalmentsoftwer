# Long guide video — script v2 (with the IMEI chapter)

Remake of **`videos/Almas SDM - Guide (Urdu).mp4`** (12:37, Urdu, published as
`_PvSrPtr4Mg` and embedded on the home page). The 9×16 ad
(`videos/Almas SDM - Ad 9x16.mp4`) stays as it is.

The old video was screen recording cut against five voiceover files
(`audios for guide video/1.mp3` … `4.mp3`, plus `short version.mp3`). This
script keeps that workflow: the voiceover below is split into five parts, each
one a separate recording, so a part can be redone without touching the rest.

**Why remake it:** two reasons.

1. Six chapters now show screens that no longer look like that — the one-page
   sale form, the IMEI camera scan, signing on the sale screen, the new
   dashboard, reschedule / waive, and FRP read-back all landed after the
   recording.
2. The video never answers the objection every shopkeeper raises — *"IMEI
   change kara liya to?"* — and that objection is where the sale is won or
   lost. v2 gives it its own chapter, placed early, as four layers.

**Voiceover language:** Urdu, spoken. The lines are written in Roman Urdu so
they can be read (or fed to TTS) directly. Burned-in captions in Urdu, Jameel
Noori Nastaleeq — the font the dashboard uses.

**Voice:** preset voice `e2a2d2e6-9ed2-59cd-82af-feaa27f8a678` ("Grady", male),
chosen by the owner for this remake. Keep the same voice across all five parts —
a change of voice mid-video reads as a different product.

**Target length:** about 15 minutes, against 12:37 before. Trims are marked
`[trim]` if it needs to come down.

---

## 1. Before recording

**Demo data only. Never record a real customer.** A CNIC, address, phone
number or IMEI on YouTube is a permanent leak — the dashboard masks those
fields for a reason, and the video must not undo that.

- Demo dealership, demo customer ("Demo Customer", CNIC `35202-0000000-0`,
  phone `0300-0000000`).
- IMEI: a phone you own, or blur the middle digits in the edit.
- Blur the address bar if a real shop's subdomain shows.

**The build matters.** Record against the current server, otherwise half the
new chapters cannot be filmed — the one-page sale form, the Scan button and the
sign-on-sale step must all be visible (see `docs/owner-next-steps.md`, step 1).
Handset on **DPC v1.5.2** for the lock, FRP and location shots.

1920×1080, 30fps, browser zoom 110% so the text survives a phone screen.

---

## 2. Chapter map

Old timings are from the published video, so it is clear what is being replaced.

| New time | Chapter | Old | Status |
|---|---|---|---|
| 0:00 | Introduction — Almas SDM kya hai | 0:00 | re-record (new promise line) |
| 0:45 | Dukaan ki registration | 0:35 | re-record (sign-up page exists now) |
| 1:15 | Login | 1:06 | keep |
| 1:35 | Dashboard | 1:31 | re-record (new home) |
| 2:10 | Settings | 2:05 | re-record (FRP Google ID, location, SMS/WhatsApp) |
| 3:25 | Device locks — har phone ke liye 1 lock | 3:30 | keep |
| 3:50 | **Ek safe par sale — CNIC se autofill, IMEI camera scan** | — | **new** |
| 5:15 | QR code se naya phone jorein | 3:52 | re-record |
| 6:15 | Muaahida aur usi screen par dastkhat | 5:09 | re-record |
| 7:05 | **IMEI tabdeeli — chaar tehein** | — | **new, the centrepiece** |
| 9:45 | Phone lock kaise lagayein | 6:48 | re-record (staged restrictions, offline rule) |
| 10:45 | Payment aur unlock | 7:42 | re-record (customer-reported transfer) |
| 11:35 | Qistein, len-den, rasid, WhatsApp | 8:26 | re-record |
| 12:25 | **Reschedule aur late fee maafi** | — | **new** |
| 13:00 | Phone ki location | 8:51 | re-record (1.5.2) |
| 13:40 | Phone dobara jorein (wipe ke baad) + FRP | 9:48 | re-record |
| 14:10 | Aakhri qist ke baad phone release | 10:14 | keep |
| 14:40 | Security aur backup | 10:48 | shorten — the IMEI chapter now carries it |
| 15:10 | Super admin | 11:43 | `[trim]` 30s |
| 15:40 | Close | — | new CTA |

Chapter 4 is the one to get right. Everything else is a guide; that chapter is
the argument.

---

## 3. Voiceover — part 1 (`1.mp3`): intro to settings

> **Intro.** Show: the logo, then a locked handset.

"Assalam-o-alaikum. Agar aap mobile qiston par bechte hain, to yeh video aap ke
liye hai.

Aap ne phone diya, do qisten aayin, teesri par phone band, number band, bandah
ghayab. Aur jab aap kisi se poochte hain, jawab milta hai: 'IMEI change kara
liya hoga, ab kuch nahi hota'.

Almas SDM isi ke liye bana hai. Aaj main aap ko poora system dikhaunga — dukaan
banane se le kar aakhri qist tak — aur khaas tor par yeh ke IMEI badalne wali
baat ko hamara system **chaar alag tehon** mein kaise pakarta hai."

> **Registration.** Show: almassdm.pro → sign-up form.

"Shuru dukaan ki registration se. almassdm.pro par apni dukaan ka naam, apna
number aur password daal kar account ban jata hai. Pehle yeh hamein khud banana
parta tha — ab aap khud bana sakte hain."

> **Login.** Show: app.almassdm.pro sign-in.

"Login app.almassdm.pro par. Paanch ghalat koshishon ke baad account kuch der
ke liye band ho jata hai, taake koi password andaze se na khol sake."

> **Dashboard.** Show: the dashboard home.

"Yeh dashboard hai. Oopar is mahine ka paisa — kitna aana hai, kitna aaya,
kitna ruka hua hai. Niche wo kaam jo aaj aap ke intezaar mein hain: kis ki qist
aaj due hai, kaun late ho gaya, kis phone ka alert aaya hai. Jo cheez aaj karne
wali nahi, wo dikhti bhi nahi."

> **Settings.** Show: Settings, section by section.

"Settings mein dukaan ka naam, number aur late fee ka qaida. Late fee fixed bhi
ho sakti hai aur percentage bhi, aur us par had bhi lagayi ja sakti hai.

Teen cheezein khaas tor par dekhein. Pehli: dukaan ka Google Account ID — yeh
Factory Reset Protection ke liye hai, aur is ke baghair wipe ke baad wali
hifazat kaam nahi karti. Doosri: location ki ijazat, jo by default band hai.
Teesri: reminder kahan se jayein — apne SIM wale phone se, ya WhatsApp se.

Aur Urdu. Poora dashboard Urdu mein chalta hai — yahan se switch karein."

---

## 4. Voiceover — part 2 (`2.mp3`): locks, the one-page sale, enrolment, the agreement

> **Device locks.** Show: Buy locks / licences.

"Ab lock. Hamara hisab mahana fees ka nahi hai: aap lock packs mein khareedte
hain, aur **ek lock ek phone** par kharch hota hai. Phone enrol hua, lock
kharch hua. Qisten poori hone ke baad bhi wo lock wapas nahi aata — isi liye
sasta parta hai, kyunke aap har mahine kuch nahi dete."

> **The one-page sale.** Show: Customers → Add Customer & Device.

"Sale. Pehle yeh kaam teen screenon par hota tha — gaahak, phone, plan. Ab sab
ek hi safe par hai.

Purana gaahak hai? Sirf CNIC daalein — naam, number, pata khud bhar jata hai.
Dobara likhne ki zaroorat nahi.

Aur IMEI. Ab haath se likhne ki zaroorat nahi: yeh **Scan** ka button
dabayein, phone ka camera dabbe ke IMEI par rakhein, hindse khud bhar jate
hain. Ek hindsa ghalat likhne ka khatra khatam — aur yeh khatra bara hai,
kyunke poora lock usi IMEI par khara hota hai.

Phir plan: qeemat, advance, kitne mahine. Schedule khud ban jata hai, aur
hindse aakhri qist mein poore bara-bar hote hain — ek rupay ka farq bhi nahi."

> **QR enrolment.** Show: the QR, then a factory-reset handset scanning it.

"Ab phone jorna. Sale ke baad ek QR code banta hai. Naya ya reset kiya hua
Android phone — pehli screen par chhe dafa tap karein, camera khulta hai, QR
scan karein. Hamari app device owner ban kar install hoti hai.

Yeh QR ek hi dafa chalta hai. Do bandon ne ek sath scan kiya to sirf ek kamyab
hoga, doosre ko saaf jawab milega."

> **The agreement.** Show: the contract drafting itself, the customer signing.

"Aur ab wo hissa jo qanooni tor par sab se zaroori hai: muaahida.

Sale ke sath hi muaahida ban jata hai — Urdu aur English dono mein, usi plan ke
asli hindson ke sath. Gaahak wahin, isi screen par, ungli se dastkhat karta
hai. Alag safe par jane ki zaroorat nahi.

Aur yeh sirf kaghaz nahi hai. Jis phone par dastkhat nahi, system usay lock
karne se **inkaar** kar deta hai. Agar baad mein plan ke hindse badal gaye aur
naya dastkhat nahi hua, to bhi inkaar. Bina likhit ijazat koi phone lock nahi
hota — na aap ke haath se, na hamare haath se."

---

## 5. Voiceover — part 3 (`3.mp3`): IMEI tabdeeli — chaar tehein

This is the chapter the remake exists for. Record it separately and keep the
pace slow; one layer per visual, with the flag name shown on screen.

> **The objection.** Show: a text card, held a beat longer than the others.

"Ab wo sawal jo har dukaandaar poochta hai, aur jis ka jawab aksar koi nahi
deta: 'IMEI change kara liya to?'

Jawab ek nahi, chaar hain. Aur jo bandah phone le kar bhaagna chahta hai, usay
chaaron tehein toot'ni paren gi."

> **Layer 1.** Show: an enrolment attempt with a different IMEI being refused,
> and the blocked attempt on the dashboard.

"**Pehli teh: lock ek hi IMEI par.**

Jo IMEI aap ne sale ke waqt darj kiya, lock usi par kharch hota hai. Jab phone
enrol hota hai, server us ka bataya hua IMEI sale ke record se milata hai.

Na mila? Phone enrol hi nahi hota. Na lock lagta hai, na aap ki licence kharch
hoti hai — aur dashboard par likha aata hai ke koshish rok di gayi, kis phone
par aur kab. Yani dusre phone par aap ka lock chalana shuru se hi band hai."

> **Layer 2.** Show: the device timeline filling with check-ins, then a
> `IMEI_MISMATCH` tamper alert and the phone locking itself.

"**Doosri teh: har pandrah minute baad dobara jaanch.**

Enrol hone ke baad baat khatam nahi hoti. Phone har pandrah minute baad apna
IMEI, apna serial number aur apne hardware ki report bhejta hai.

Jis din IMEI badla, server usi check-in par pakar leta hai. Dukaandaar ko alert
jata hai — dekhein, yahan — aur phone **khud-ba-khud lock** ho jata hai. Kisi
ke button dabane ka intezaar nahi."

> **Layer 3.** Show: a simple diagram — phone chip → signed certificate →
> server → Google's roots — then the attestation flags.

"**Teesri teh, aur yahi sab se mazboot hai: phone ka chip khud gawahi deta
hai.**

Software ka IMEI badal dena ek baat hai. Phone ke secure chip ko jhoot bolwana
bilkul doosri baat hai.

Phone ka chip apne **factory** IMEI par dastkhat karta hai — us hi sawaal par
jo server ne khud chuna hota hai. Pehli dafa enrolment code se bana sawaal,
us ke baad roz naya. Phir server us dastkhat ko Google ki jaron se jaanchta
hai: dastkhat asli hai ya nahi, chip asli hai ya nahi, certificate radd
(revoked) hua hai ya nahi.

Chip ka IMEI darj IMEI se na mila — alert. Dastkhat jaali ya kata-pheta —
alert. Yeh teh hamari app par bharosa nahi karti; hardware par karti hai."

> **Layer 4.** Show: uninstall blocked, factory reset blocked, FRP status on the
> device page, then `DEVICE_OWNER_LOST` / `BOOTLOADER_UNLOCKED` / `ROOTED`.

"**Chauthi teh: app hatana aur reset karna dono band.**

Soch yeh hoti hai ke 'app hata denge' ya 'reset maar denge'. Dono band hain.
App device owner hoti hai — gaahak usay utaar nahi sakta, aur reset ki koshish
rok di jati hai.

Aur agar kisi tareeqe se phone wipe ho jaye, Factory Reset Protection ki wajah
se phone sirf dukaan ke Google account se chalta hai. Chori ka phone kisi aur
ke kaam ka nahi rehta.

Aur in teen cheezon par bhi nazar hai: app ne device owner khoya, bootloader
khula, ya phone root hua — teeno dashboard par darj hote hain, aur inhi par
phone lock ho jata hai."

> **Close the chapter — honestly.** Show: the four layers stacked as a graphic.

"To jawab yeh hai: chaar tehein, aur har teh alag jagah par pakarti hai.

Main yeh nahi kahunga ke IMEI badalna namumkin hai — koi bhi sach bolne wala
yeh nahi kahega. Main yeh keh raha hoon ke **pakra jata hai**: enrol hote waqt,
har pandrah minute wale check-in par, chip ki gawahi par, aur app hatane ki
koshish par.

Aur ek baat jo aap ko har system mein nahi milegi: yeh system aap se jhoot
nahi bolta. Jo phone lock nahi ho saka, dashboard us ko 'lock ho gaya' nahi
dikhata — 'lock nahi hua' hi dikhata hai, saaf saaf. Kyunke jhoota lock us
nuqsaan se zyada khatarnak hai jo aap ko pata ho."

---

## 6. Voiceover — part 4 (`4.mp3`): lock, payments, instalments, reschedule

> **Locking.** Show: an overdue device → Lock, the handset's lock screen,
> staged restrictions, then data off and the offline rule.

"Ab amli kaam. Qist ruk gayi — Devices mein phone kholein, Lock dabayein.

Phone par poora screen aa jata hai, Urdu mein, dukaan ke number ke sath.
Emergency call khula rehta hai — hum kisi ko emergency se nahi rokte.

Aur yeh ek dam nahi hota: pehle warning, phir calls aur apps band, phir poora
lock. Gaahak ko sambhalne ka mauqa milta hai.

Gaahak net band kar deta hai? Phone khud, apne andar, muqarrar waqt ke baad
lock ho jata hai — server ka intezaar nahi karta. Aur jab phone wapas net par
aata hai, dashboard par likha aata hai ke lock us waqt lag chuka tha."

> **Payment and unlock.** Show: recording a payment, the receipt, the automatic
> unlock, then a customer-reported transfer being confirmed.

"Paisa aa gaya. Payments mein qist darj karein — rasid foran nikalti hai, asal
raqam aur late fee alag alag likhi hui, thermal printer ke naap par.

Qist darj hui, phone khud khul jata hai. Aap ko dobara kuch dabane ki zaroorat
nahi.

Aur agar gaahak ne JazzCash ya Easypaisa se bheja hai, wo apne ghar se
transaction ID bhej deta hai. Wo aap ke paas 'tasdeeq ka intezaar' mein aata
hai — aur jab tak aap apne account mein paisa dekh kar tasdeeq na karein, kuch
bhi hisab mein nahi lagta."

> **Instalments, transactions, reminders.** Show: the schedule, transactions,
> the WhatsApp button.

"Qistein aur len-den. Har phone ka poora schedule — kaun si qist kab, kitni
aayi, kitni baqi. Har payment ka record, kis ne darj ki aur kab.

Yaad dehani do tareeqon se: apne SIM wale phone se SMS, ya WhatsApp. WhatsApp
ka button har gaahak ke samne hai — matn pehle se tayyar hota hai, plan ke
asli hindson ke sath, Urdu ya Roman Urdu mein. Aap bhejne se pehle parh sakte
hain."

> **Reschedule and waive.** Show: the reschedule screen, then waiving a late
> fee with a reason.

"Aur ek baat jo har software mein nahi hoti. Har rukne wala gaahak be-imaan
nahi hota — kisi ki naukri chali gayi, kisi ke ghar mein kuch ho gaya.

Aise mauqe par baqi raqam dobara tarteeb de dein: nayi qisten, usi screen se,
aur muaahide ke hindse us ke sath badal jate hain.

Late fee maaf karni ho to wajah likh kar maaf karein. Record mein rehta hai —
kis ne maaf ki, kab, aur kyun."

---

## 7. Voiceover — part 5 (`5.mp3`): location, re-enrol, release, security, close

> **Location.** Show: Settings toggle, then the request with a written reason.

"Phone ki location. Yeh feature by default band hai, aur is ke chalne ke liye
teen shartein poori honi chahiye: Settings mein aap ne khud on kiya ho, gaahak
ne usi halat mein muaahide par dastkhat kiye hon, aur phone ya lock ho ya us ki
qist late ho.

Jo gaahak waqt par de raha hai, us ka phone kabhi trace nahi hota. Request
likhit wajah ke sath hoti hai, ek dafa ka jawab hoti hai — musalsal nigrani
nahi — aur gaahak ke phone par us ki ittela aati hai.

Yeh feature app ke version 1.5.2 se theek chalta hai, is liye phone ko update
hona chahiye."

> **Re-enrol.** Show: a wiped phone going back to PENDING for a fresh QR.

"Kisi ne phone wipe kar diya? Dashboard se usay dobara jorein — naya QR banta
hai, usi lock par, aap ki nayi licence kharch nahi hoti."

> **Release.** Show: the final payment, the device released, the app offering
> removal.

"Aur aakhri qist. Phone azad ho jata hai. App device owner chhor deti hai aur
gaahak ko khud kehti hai: 'Remove this app'. Koi pabandi baqi nahi rehti, koi
nishan nahi. Phone poori tarah gaahak ka."

> **Security and backup.** Show: roles, the audit log, masked fields, the
> backup script. Keep it to 30 seconds — layer talk already happened.

"Hifazat. Har bandeh ko sirf apna kaam dikhta hai: counter wale staff ko CNIC
aur IMEI maskedh milte hain, malik ko poora. Har kaam audit log mein darj hai.
Aur database ka roz backup banta hai, jisay dukaan se bahar rakhna chahiye."

> **Super admin.** `[trim]` 30 seconds.

"Agar aap ki ek se zyada dukaanein hain, super admin se saari dukaanein ek
jagah dikhti hain — aur kisi dukaan ko kholte waqt wo read-only hoti hai, taake
ghalti se kuch badal na jaye."

> **Close.** Show: pricing, almassdm.pro, the phone number.

"Bas. Koi mahana fees nahi — ek phone, ek lock.

Pandrah minute ka muft demo milta hai: almassdm.pro par apna number chhor
dein, ya seedha call karein. Apna hi phone le aayein — usi par chala kar dikha
denge, taake aap ko meri baat par nahi, apni aankhon par bharosa ho.

Allah hafiz."

---

## 8. What may be claimed, and what may not

The IMEI chapter is the one place where an over-claim is both dishonest and
dangerous: a shop that believes a phone can never be freed will lend against
it, and the loss lands on them.

**May be said:**
- Four independent checks — at enrolment, on every check-in, from the secure
  chip's attestation, and through device owner / FRP.
- A mismatch raises an alert **and** queues an automatic lock.
- The dashboard never claims a lock it did not apply.

**Must not be said:**
- "IMEI change karna namumkin hai." It is not. The line is *pakra jata hai*,
  never *ho hi nahi sakta* — the script above is written that way on purpose.
- "Har phone par." Key attestation falls back — first without an IMEI, then
  without hardware IDs at all — on handsets whose maker never provisioned it,
  which is common on budget phones. There, layers 1, 2 and 4 still work and
  layer 3 proves less.
- "Rooted phone hamesha pakra jata hai." The root, bootloader and test-key
  signals are read by the app from the OS, and a rooted phone can lie about
  them. Attestation is the answer to that, with the fallback above.
- Any claim about a fleet of phones being proven. **No recorded pass across
  real handsets exists yet.** Until the phone tests are filled in, the honest
  claim is what the demo does on the phone in the room — which is why the close
  invites the shopkeeper to bring their own handset.

---

## 9. New YouTube description — chapters to paste

Replaces the chapter block in the old video's upload notes. **Those notes are
not in the repository at all** — the only copy is an untracked file at
`E:\Almas\almas_app\installment softwer\.claude\worktrees\awesome-lovelace-675ad5\docs\youtube-guide-video.md`,
on one disk, never committed or pushed. Copy it into `docs/video/` and commit it
before anything happens to that worktree. Its title, tags and upload settings
still hold; add "IMEI" to the title:

**Installment Mobile Lock Software | IMEI Change Protection | Almas SDM Full Urdu Guide**

```
⏱️ Chapters
0:00 Introduction – Almas SDM kya hai
0:45 Dukaan ki registration
1:15 Login
1:35 Dashboard
2:10 Settings (FRP, location, reminders)
3:25 Device locks – har phone ke liye 1 lock
3:50 Ek safe par sale – CNIC autofill aur IMEI camera scan
5:15 QR code se naya phone jorein
6:15 Muaahida aur dastkhat
7:05 IMEI change ho jaye to? – chaar tehein
9:45 Phone lock kaise lagayein
10:45 Payment aur unlock
11:35 Qistein, len-den, WhatsApp yaad dehani
12:25 Reschedule aur late fee maafi
13:00 Phone ki location
13:40 Wipe ke baad phone dobara jorein
14:10 Aakhri qist ke baad phone release
14:40 Security aur backup
15:10 Super admin
15:40 Demo kaise lein
```

---

## 10. Record / publish checklist

- [ ] Demo dealership and demo customer created; no real customer data on screen.
- [ ] Server on the current build (one-page sale form, Scan button,
      sign-on-sale step all visible).
- [ ] Handset on DPC v1.5.2.
- [ ] Five voiceover parts recorded into `audios for guide video/` as
      `1.mp3` … `5.mp3` (the old part 4 becomes parts 4 and 5).
- [ ] Captions burned in; Urdu in Jameel Noori Nastaleeq.
- [ ] Chapter timestamps checked against the final cut before pasting.
- [ ] New file saved beside the old one — keep
      `videos/Almas SDM - Guide (Urdu).mp4` until the new one is published.
- [ ] After publishing, update `data-yt` in `site/src/pages/index.html` to the
      new video id; the home-page thumbnail follows it automatically.
- [ ] `videos/` and `audios for guide video/` are untracked and live on one
      disk only — copy them somewhere else before re-editing.
- [ ] Leave the 9×16 ad as it is.
