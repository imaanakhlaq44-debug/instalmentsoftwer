// Inside the shop app, the sale form's "Scan CNIC" button uses the phone's own
// card reader (ML Kit, offline) instead of the in-browser one, which downloads
// ~8 MB and is slow on most shop phones. Fills the CNIC and the name.
(function () {
  if (window.__almasCnicShim || !window.AlmasCnic) return;
  window.__almasCnicShim = true;

  const LABELS = {
    'Scan CNIC': 'en',
    'ID card scan karein': 'ru',
    'شناختی کارڈ اسکین کریں': 'ur',
  };
  const TEXT = {
    en: {
      reading: 'Camera is opening. Hold the FRONT of the card inside the frame.',
      filled: 'Filled from the card. Check before saving.',
      onlyCnic: 'Only the CNIC number could be read. Please type the name.',
      onlyName: 'Only the name could be read. Please type the CNIC number.',
      father: 'Father / husband: ',
      expired: 'This CNIC has expired. Expiry on the card: ',
      unreadable: 'Could not read the card. Put the front side flat, in good light, fill the photo with it, and try again.',
      permission: 'Camera permission was not allowed. Please type the CNIC.',
      camera: 'Could not open the camera. Please type the CNIC.',
      busy: 'A card scan is already open.',
      close: 'Close',
    },
    ru: {
      reading: 'Camera khul raha hai. Card ka SAAMNE wala hissa frame ke andar rakhein.',
      filled: 'Card se bhar diya. Save karne se pehle aik dafa dekh lein.',
      onlyCnic: 'Sirf CNIC number parha ja saka. Naam khud likh dein.',
      onlyName: 'Sirf naam parha ja saka. CNIC number khud likh dein.',
      father: 'Walid / shohar: ',
      expired: 'Is CNIC ki muddat khatam ho chuki hai. Card par expiry: ',
      unreadable: 'Card parha nahi ja saka. Saamne wala hissa seedha rakhein, achhi roshni mein, poori photo mein card ho, phir dobara koshish karein.',
      permission: 'Camera ki ijazat nahi mili. CNIC khud likh dein.',
      camera: 'Camera nahi khula. CNIC khud likh dein.',
      busy: 'Card scan pehle se khula hai.',
      close: 'Band karein',
    },
    ur: {
      reading: 'کیمرہ کھل رہا ہے۔ کارڈ کا سامنے والا حصہ فریم کے اندر رکھیں۔',
      filled: 'کارڈ سے بھر دیا۔ محفوظ کرنے سے پہلے ایک دفعہ دیکھ لیں۔',
      onlyCnic: 'صرف CNIC نمبر پڑھا جا سکا۔ نام خود لکھ دیں۔',
      onlyName: 'صرف نام پڑھا جا سکا۔ CNIC نمبر خود لکھ دیں۔',
      father: 'والد / شوہر: ',
      expired: 'اس CNIC کی مدت ختم ہو چکی ہے۔ کارڈ پر میعاد: ',
      unreadable: 'کارڈ پڑھا نہیں جا سکا۔ سامنے والا حصہ سیدھا رکھیں، اچھی روشنی میں، پوری تصویر میں کارڈ ہو، پھر دوبارہ کوشش کریں۔',
      permission: 'کیمرے کی اجازت نہیں ملی۔ CNIC خود لکھ دیں۔',
      camera: 'کیمرہ نہیں کھلا۔ CNIC خود لکھ دیں۔',
      busy: 'کارڈ اسکین پہلے سے کھلا ہے۔',
      close: 'بند کریں',
    },
  };

  let pending = null; // the language of the scan this page asked for

  const setValue = (id, value) => {
    const input = document.getElementById(id);
    if (!input || input.readOnly || input.disabled) return false;
    // React keeps its own copy of the value; the native setter plus an input event updates it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  const show = (lang, lines, warning) => {
    document.getElementById('almas-cnic-note')?.remove();
    const box = document.createElement('div');
    box.id = 'almas-cnic-note';
    box.setAttribute('role', 'status');
    box.setAttribute('data-i18n-skip', 'true');
    box.dir = lang === 'ur' ? 'rtl' : 'ltr';
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:200;' +
      'background:#fffdf6;border:2px solid #0f1419;border-radius:16px;padding:14px 16px;box-shadow:4px 4px 0 #0f1419;' +
      'font:600 15px/1.45 system-ui,sans-serif;color:#0f1419;display:flex;gap:12px;align-items:flex-start';
    const body = document.createElement('div');
    body.style.flex = '1';
    for (const line of lines) {
      const p = document.createElement('p');
      p.style.margin = '0 0 4px';
      p.textContent = line;
      body.appendChild(p);
    }
    if (warning) {
      const p = document.createElement('p');
      p.style.cssText = 'margin:6px 0 0;padding:6px 8px;border:2px solid #f2c48d;background:#fff4e5;border-radius:8px;color:#9a4b00';
      p.textContent = warning;
      body.appendChild(p);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', TEXT[lang].close);
    close.style.cssText = 'border:2px solid #0f1419;border-radius:10px;background:#fff;font:700 16px system-ui;padding:4px 10px';
    close.onclick = () => box.remove();
    box.append(body, close);
    document.body.appendChild(box);
  };

  window.AlmasCnic.addEventListener('message', (event) => {
    const lang = pending;
    if (!lang) return;
    pending = null;
    const t = TEXT[lang];
    let reply;
    try { reply = JSON.parse(event.data); } catch (_) { reply = { ok: false, reason: 'unreadable' }; }
    if (!reply.ok) {
      if (reply.reason === 'cancelled') { document.getElementById('almas-cnic-note')?.remove(); return; }
      show(lang, [t[reply.reason] || t.unreadable]);
      return;
    }
    const cnic = /^\d{5}-\d{7}-\d$/.test(reply.cnic || '') ? reply.cnic : null;
    if (cnic) setValue('sale-customerCnic', cnic);
    // A customer already on file keeps the name on record (the box is read-only then).
    if (reply.name) setValue('sale-customerName', reply.name);
    const lines = [cnic && reply.name ? t.filled : cnic ? t.onlyCnic : t.onlyName];
    if (cnic) lines.push('CNIC: ' + cnic);
    if (reply.name) lines.push(reply.name);
    if (reply.fatherName) lines.push(t.father + reply.fatherName);
    const today = new Date().toISOString().slice(0, 10);
    const expired = !reply.lifetime && reply.dateOfExpiry && reply.dateOfExpiry < today;
    show(lang, lines, expired ? t.expired + reply.dateOfExpiry.split('-').reverse().join('.') : null);
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('button');
    if (!button) return;
    const lang = LABELS[button.textContent.replace(/\s+/g, ' ').trim()];
    if (!lang || !document.getElementById('sale-customerCnic')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pending = lang;
    show(lang, [TEXT[lang].reading]);
    window.AlmasCnic.postMessage('scan:' + lang);
  }, true);
})();
