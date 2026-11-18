(function () {
  if (window.__almasNativeBridge || !window.AlmasDocument) return;
  window.__almasNativeBridge = true;
  const pending = new Map();
  const send = value => AlmasDocument.postMessage(JSON.stringify(value));
  window.print = () => send({ action: 'print' });
  const copyText = text => new Promise((resolve, reject) => {
    const requestId = 'copy-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    pending.set(requestId, { kind: 'copy', resolve, reject });
    send({ action: 'copy', requestId, text: String(text) });
    setTimeout(() => { if (pending.has(requestId)) { pending.delete(requestId); reject(Error('Copy timed out. Please try again.')); } }, 10000);
  });
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copyText } }); } catch (_) { /* The browser's clipboard remains available. */ }
  AlmasDocument.onmessage = async event => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    if (entry.kind === 'copy') { if (message.error) entry.reject(Error(message.error)); else entry.resolve(); return; }
    if (message.error) { window.alert(message.error); return; }
    try {
      const result = await entry.blob;
      if (result.error) throw result.error;
      const blob = result.value;
      if (blob.size > 20971520) throw Error('This document is too large. Use the browser to download it.');
      const reader = new FileReader();
      reader.onload = () => send({ nonce: message.nonce, name: entry.name, mime: blob.type || 'application/octet-stream', data: reader.result });
      reader.onerror = () => send({ nonce: message.nonce, error: 'Could not read this document. Try again.' });
      reader.readAsDataURL(blob);
    } catch (error) { send({ nonce: message.nonce, error: error.message || 'Could not read the document.' }); }
  };
  document.addEventListener('click', event => {
    const anchor = event.target.closest && event.target.closest('a[download]');
    if (!anchor || typeof anchor.href !== 'string') return;
    window.__almasDownloadName = anchor.download;
    if (!anchor.href.startsWith('blob:')) return;
    try { if (new URL(anchor.href.slice(5)).origin !== location.origin) return; } catch (_) { return; }
    event.preventDefault();
    // Fetch synchronously during the click: the website revokes its Blob URL
    // immediately after click() returns. Retain the Blob before native IPC.
    const blob = fetch(anchor.href).then(response => response.blob()).then(value => ({ value }), error => ({ error }));
    const requestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    pending.set(requestId, { blob, name: anchor.download || 'Almas-SDM-document' });
    send({ action: 'requestDownload', requestId });
    setTimeout(() => pending.delete(requestId), 35000);
  }, true);
})();
