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

  // Sin Firebase configurado: modo demo, pero igual mostramos lo que haya en localStorage
  if (!window.firebaseListo || !window.estrategiumAuth) {
    try {
      var cached = JSON.parse(localStorage.getItem('estrategium_user') || 'null');
      if (cached) pintarUsuario(cached);
    } catch (e) {}
    return;
  }

  var guard = (document.body.getAttribute('data-guard') || '').toLowerCase();

  window.estrategiumAuth.onAuthStateChanged(function (user) {
    if (user) {
      pintarUsuario(user);
      return;
    }
    // Sin usuario de Google: aceptamos una sesión de demostración guardada localmente
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem('estrategium_user') || 'null'); } catch (e) {}
    if (cached) {
      pintarUsuario(cached);
    } else if (guard) {
      // Página privada sin ninguna sesión → manda al login correspondiente
      var login = guard === 'admin' ? 'login-admin.html' : 'login-estudiantes.html';
      window.location.replace(login);
    }
  });
})();
