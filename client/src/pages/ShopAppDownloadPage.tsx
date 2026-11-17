import { QRCodeSVG } from 'qrcode.react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, CheckCircle2, Smartphone } from 'lucide-react';
import { SHOP_RELEASE } from '../config/shopRelease.js';
import { LanguageToggle } from '../i18n/LanguageContext.js';

export function ShopAppDownloadPage() {
  return <div className="min-h-screen bg-paper-100 px-5 py-7 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4"><Link to="/login" className="flex items-center gap-2 font-black text-accent-800"><img src="/logo-mark.webp" alt="" width="36" height="36" />ALMAS SDM</Link><LanguageToggle /></header>
      <main className="surface overflow-hidden">
        <div className="bg-sun-400 px-6 py-8 sm:px-8"><span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-caption font-bold"><Smartphone className="h-4 w-4" />Android app</span><h1 className="mt-4 text-display text-ink-900">Your shop, now on your phone.</h1><p className="mt-3 text-body text-ink-700">Customers, installments, payments and phone setup — with your existing ALMAS SDM account.</p></div>
        <div className="space-y-6 p-6 sm:p-8">
          <div className="grid grid-cols-2 gap-3">{[
            ['agreement', 'New sale'], ['wallet', 'Record payment'], ['phone', 'Phone setup'], ['customer', 'Customer list'],
          ].map(([icon, title]) => <div key={icon} className="flex min-w-0 items-center gap-2 rounded-xl bg-paper-100 p-3"><img src={`/icons/3d/${icon}.png`} alt="" width="40" height="40" /><span className="text-caption font-bold">{title}</span></div>)}</div>
          <div><a href={SHOP_RELEASE.apkPath} download className="btn-primary w-full py-3 text-lede"><ArrowDownToLine className="h-5 w-5" />Download Android app</a><p className="mt-2 text-center text-caption text-ink-500" data-i18n-skip>Android 8+ · v{SHOP_RELEASE.version} · 2 MB</p></div>
          <section aria-label="Scan to download" className="flex flex-col items-center gap-5 rounded-2xl border-2 border-ink-900 bg-paper-100 p-5 sm:flex-row">
            <a href="https://app.almassdm.pro/download" aria-label="Open Android app download page" className="shrink-0 rounded-xl bg-white p-3" data-i18n-skip><QRCodeSVG value="https://app.almassdm.pro/download" size={160} level="M" marginSize={2} title="ALMAS SDM Android app download" /></a>
            <div className="min-w-0 text-center sm:text-left"><h2 className="text-title font-bold">Scan to download</h2><p className="mt-2 text-body">Open your phone camera and scan this QR code to download the Android app.</p></div>
          </section>
          <section><h2 className="text-title font-bold">Start in three steps</h2><ol className="mt-3 space-y-3 text-body"><li><strong>1.</strong> <span>Download the APK and open it on your Android phone.</span></li><li><strong>2.</strong> <span>If Android asks, allow installation from this download source.</span></li><li><strong>3.</strong> <span>Sign in with your existing account, or register your shop.</span></li></ol></section>
          <div className="flex gap-3 rounded-xl bg-mint-100 p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-positive-700" /><p className="text-body">Your saved shop records stay in your online account. Use the same account on the website or app.</p></div>
          <p className="text-caption text-ink-500">This is the shop-management app. It does not lock the phone you install it on. Customer-phone management is enrolled separately.</p>
          <div className="flex flex-wrap justify-between gap-3 text-caption font-bold"><Link to="/login" className="inline-flex items-center gap-1 underline"><ArrowLeft className="h-4 w-4" />Sign in</Link><Link to="/register" className="underline">Create account</Link><Link to="/privacy" className="underline">Privacy</Link></div>
        </div>
      </main>
    </div>
  </div>;
}
