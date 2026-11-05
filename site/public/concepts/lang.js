/* Shared English/Urdu toggle for the concept pages — same rule as the live
   site: English is the element's own text, Urdu lives in data-ur, and the
   two are never shown mixed. */
(function () {
  var KEY = 'almas-sdm-lang';
  var root = document.documentElement;
  var fontLoaded = false;
  function apply(lang) {
    var ur = lang === 'ur';
    if (ur && !fontLoaded) {
      fontLoaded = true;
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600;700&display=swap';
      document.head.appendChild(l);
    }
    document.querySelectorAll('[data-ur]').forEach(function (el) {
      if (!el.hasAttribute('data-en')) el.setAttribute('data-en', el.textContent.trim());
      el.textContent = ur ? el.getAttribute('data-ur') : el.getAttribute('data-en');
    });
    root.lang = ur ? 'ur' : 'en';
    root.dir = ur ? 'rtl' : 'ltr';
    root.classList.toggle('lang-ur', ur);
    document.querySelectorAll('[data-lang-label]').forEach(function (b) {
      b.textContent = ur ? 'English' : 'اردو';
    });
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }
  var saved = 'en';
  try { saved = localStorage.getItem(KEY) || 'en'; } catch (e) {}
  if (saved === 'ur') apply('ur');
  document.querySelectorAll('[data-lang-toggle]').forEach(function (b) {
    b.addEventListener('click', function () { apply(root.lang === 'ur' ? 'en' : 'ur'); });
  });
})();
