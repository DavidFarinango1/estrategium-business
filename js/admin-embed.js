/* Cuando una página de admin se muestra DENTRO del marco (admin.html),
   oculta su propio menú lateral para no duplicarlo. */
(function () {
  if (window.self !== window.top) {
    var s = document.createElement('style');
    s.textContent = '.admin-sidebar{display:none !important;} .admin-shell{grid-template-columns:1fr !important;}';
    (document.head || document.documentElement).appendChild(s);
  }
})();
