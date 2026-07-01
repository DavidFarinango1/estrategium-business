/* =====================================================================
   Estrategium Business — Sesión en páginas privadas
   Requiere antes: firebase-app-compat, firebase-auth-compat,
   js/firebase-config.js, js/auth.js
   Funciones:
     • Protege la página (atributo data-guard="admin"|"estudiante" en <body>).
     • Muestra nombre/foto/inicial del usuario en hooks del DOM.
     • Enlaza el cierre de sesión (elementos con data-logout="destino.html").
   Si Firebase NO está configurado, todo queda inerte (modo demo): la
   página se muestra igual y los enlaces de logout siguen su href.
   ===================================================================== */
(function () {
  // Enlazar logout siempre (funciona en demo siguiendo el href, o con Firebase)
  function wireLogout() {
    document.querySelectorAll('[data-logout]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        var destino = el.getAttribute('data-logout') || 'login-estudiantes.html';
        if (window.cerrarSesion) {
          e.preventDefault();
          window.cerrarSesion(destino);
        } else {
          // sin Firebase: limpia la sesión local y sigue el enlace
          try { localStorage.removeItem('estrategium_user'); } catch (x) {}
        }
      });
    });
  }

  function pintarUsuario(user) {
    var nombre = (user && (user.displayName || user.name)) || '';
    var email = (user && user.email) || '';
    var foto = (user && (user.photoURL || user.photo)) || '';
    var inicial = (nombre || email || 'U').trim().charAt(0).toUpperCase();

    document.querySelectorAll('[data-user-name]').forEach(function (el) {
      if (nombre) el.textContent = nombre;
    });
    document.querySelectorAll('[data-user-email]').forEach(function (el) {
      if (email) el.textContent = email;
    });
    document.querySelectorAll('[data-user-initial]').forEach(function (el) {
      el.textContent = inicial;
    });
    document.querySelectorAll('[data-user-photo]').forEach(function (el) {
      if (foto) { el.style.backgroundImage = 'url(' + foto + ')'; el.style.backgroundSize = 'cover'; el.textContent = ''; }
    });
  }

  document.addEventListener('DOMContentLoaded', wireLogout);
  if (document.readyState !== 'loading') wireLogout();

  var guard = ((document.body && document.body.getAttribute('data-guard')) || '').toLowerCase();
  function loginPara(g) { return g === 'admin' ? 'login-admin.html' : 'login-estudiantes.html'; }
  function usuarioLocal() { try { return JSON.parse(localStorage.getItem('estrategium_user') || 'null'); } catch (e) { return null; } }
  function haySesionFirebase() { try { return !!(window.estrategiumAuth && window.estrategiumAuth.currentUser); } catch (e) { return false; } }

  // Expulsa al login si la página es privada y NO hay ninguna sesión
  function protegerSiSinSesion() {
    if (!guard) return false;
    if (usuarioLocal() || haySesionFirebase()) return false;
    window.location.replace(loginPara(guard));
    return true;
  }

  // Al volver con el botón "atrás" (bfcache): revalida la sesión
  window.addEventListener('pageshow', function () { protegerSiSinSesion(); });

  // Sin Firebase (modo local): valida con la sesión local
  if (!window.firebaseListo || !window.estrategiumAuth) {
    var cached = usuarioLocal();
    if (cached) pintarUsuario(cached);
    else if (guard) window.location.replace(loginPara(guard));
    return;
  }

  // Con Firebase:
  window.estrategiumAuth.onAuthStateChanged(function (user) {
    if (user) { pintarUsuario(user); return; }
    var cached = usuarioLocal();
    if (cached) pintarUsuario(cached);
    else if (guard) window.location.replace(loginPara(guard));
  });
})();
