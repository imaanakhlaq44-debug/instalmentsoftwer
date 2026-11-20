import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, MessageCircle, Phone, UserRoundMinus } from 'lucide-react';

export function AccountPrivacyPage({ deletion = false }: { deletion?: boolean }) {
  return <main className="mx-auto min-h-screen max-w-2xl px-5 py-8 sm:py-12">
    <Link to="/" className="mb-7 inline-flex min-h-11 items-center gap-2 font-bold text-ink-900"><ArrowLeft className="h-4 w-4" />Back to Almas SDM</Link>
    <div className="mb-7 flex items-center gap-3"><img src="/logo-mark.webp" alt="" className="h-12 w-12 object-contain" /><span className="text-title font-black text-accent-800">ALMAS SDM</span></div>
    <section className="surface space-y-5 p-6 sm:p-8">
      {deletion ? <UserRoundMinus className="h-9 w-9 text-accent-800" /> : <ShieldCheck className="h-9 w-9 text-accent-800" />}
      <h1 className="text-display text-ink-900">{deletion ? 'Delete your account' : 'Your privacy'}</h1>
      {deletion ? <>
        <p>Request deletion of your ALMAS SDM account and associated personal data using the contact options below. You can make this request from this website without installing the app.</p>
        <ol className="list-decimal space-y-3 ps-5"><li>Send “Delete my ALMAS SDM account” with your registered email and shop name. Do not send your password or a customer’s CNIC.</li><li>Our support team verifies that you own the account and explains any open shop or installment obligations.</li><li>Support confirms closure and deletion of account data that is no longer needed. A request is not completed merely by opening WhatsApp or making a call.</li></ol>
        <p className="rounded-lg bg-sun-100 p-4 text-caption">Existing installment agreements, receipts, security/audit records and information needed to resolve active obligations may need to be retained. Support will explain the affected records and retention before completing your request. Closing a login does not automatically erase a customer’s debt or release financed phones.</p>
        <a className="btn-primary w-full" href="https://wa.me/923211144477?text=Delete%20my%20ALMAS%20SDM%20account.%20My%20registered%20email%20and%20shop%20name%20are%3A" target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" />Send deletion request on WhatsApp</a>
        <a className="btn-secondary w-full" href="tel:+923211144477"><Phone className="h-4 w-4" />Call 0321 1144477</a>
        <Link className="block text-center font-bold underline" to="/privacy">Read privacy information</Link>
      </> : <>
        <p>ALMAS SDM helps mobile shops manage customers, installment sales, payments and financed devices. The shop management app connects to the same account and server as app.almassdm.pro.</p>
        <h2 className="text-title">Information used</h2><p>Your account and shop profile include your name, contact details and login credentials. Authorized shop users can manage customer identity/contact details, agreements, payments and device identifiers needed for the installment business. Access depends on your account role and shop.</p>
        <h2 className="text-title">Camera and documents</h2><p>The camera is optional and is requested when you choose a scan or photo. CNIC OCR reads the selected card photo in your browser; the scanner does not upload the card photo. Review the extracted name, CNIC and address before submitting the form. Other attachments are uploaded only through the corresponding feature when you choose to submit them.</p>
        <h2 className="text-title">Storage and connection</h2><p>The app keeps its sign-in session in private app storage and connects over HTTPS. Documents are saved to a location you select. App backup is disabled. The shop app does not request SMS, contacts, call-log, background location or device-administrator access. Financed-phone management uses a separate enrolled handset app.</p>
        <h2 className="text-title">Sharing and external services</h2><p>The shop app includes no advertising or analytics SDK. The website may load interface fonts from Google. Messaging, payment and support features may use the services configured for your shop. Opening WhatsApp or another external link is your choice and that service’s privacy terms apply.</p>
        <h2 className="text-title">Your choices</h2><p>You can deny camera access and type the details, sign out, or request account/data deletion. Financial and contractual records needed for active obligations are handled during the closure process.</p>
        <Link className="btn-secondary w-full" to="/account-deletion"><UserRoundMinus className="h-4 w-4" />Request account deletion</Link>
        <p className="text-caption">Contact ALMAS SDM: <a className="font-bold underline" href="tel:+923211144477">0321 1144477</a>. Updated 17 November 2026.</p>
      </>}
    </section>
  </main>;
}
