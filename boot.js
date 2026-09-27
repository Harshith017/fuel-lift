/* MaxxTempo boot: runs before the page draws. Kept out of index.html so the
   content security policy can forbid inline scripts. */
(function () {
  // Never run inside someone else's frame (clickjacking).
  if (window.top !== window.self) { try { window.top.location = window.location.href; } catch (e) { document.documentElement.style.display = 'none'; } }
  try { var t = localStorage.getItem('mt:theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
