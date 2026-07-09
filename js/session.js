/* =====================================================================
   Estrategium Business — Sesión en páginas privadas
   Requiere antes: firebase-app-compat, firebase-auth-compat,
   js/firebase-config.js, js/auth.js
   - Sesiones SEPARADAS por rol: 'estrategium_admin' y 'estrategium_est'.
     Así cerrar sesión de estudiante NO afecta al admin (y viceversa), y una
     sesión de estudiante NO sirve para entrar al panel de admin.
   - Protege la página (atributo data-guard="admin"|"estudiante" en <body>).
   ===================================================================== */
(function () {
  var guard = ((document.body && document.body.getAttribute('data-guard')) || '').toLowerCase();
  function sessionKey() {
    return guard === 'admin' ? 'estrategium_admin'
         : guard === 'estudiante' ? 'estrategium_est'
         : 'estrategium_user';
  }
  function loginPara(g) { return g === 'admin' ? 'login-admin.html' : 'login-estudiantes.html'; }
  function usuarioLocal() { try { return JSON.parse(localStorage.getItem(sessionKey()) || 'null'); } catch (e) { return null; } }

  // Enlazar logout (borra solo la sesión del rol de esta página)
  function wireLogout() {
    document.querySelectorAll('[data-logout]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        var destino = el.getAttribute('data-logout') || 'login-estudiantes.html';
        if (window.cerrarSesion) { e.preventDefault(); window.cerrarSesion(destino); }
        else { try { localStorage.removeItem(sessionKey()); } catch (x) {} }
      });
    });
  }

  function pintarUsuario(user) {
    var nombre = (user && (user.displayName || user.name)) || '';
    var email = (user && user.email) || '';
    var foto = (user && (user.photoURL || user.photo)) || '';
    var inicial = (nombre || email || 'U').trim().charAt(0).toUpperCase();

    document.querySelectorAll('[data-user-name]').forEach(function (el) { if (nombre) el.textContent = nombre; });
    document.querySelectorAll('[data-user-email]').forEach(function (el) { if (email) el.textContent = email; });
    document.querySelectorAll('[data-user-initial]').forEach(function (el) { el.textContent = inicial; });
    document.querySelectorAll('[data-user-photo]').forEach(function (el) {
      if (foto) { el.style.backgroundImage = 'url(' + foto + ')'; el.style.backgroundSize = 'cover'; el.textContent = ''; }
    });
  }

  document.addEventListener('DOMContentLoaded', wireLogout);
  if (document.readyState !== 'loading') wireLogout();

  // Expulsa al login si la página es privada y NO hay sesión válida para SU rol.
  // OJO: NO basta con "hay alguien en Firebase Auth" para dejar pasar al admin —
  // un ESTUDIANTE que entró con Google también tiene sesión de Firebase, y con
  // ese atajo podía abrir el panel de administración. La única llave válida es
  // la sesión local del rol correcto (que solo crea el login de ese rol).
  function protegerSiSinSesion() {
    if (!guard) return false;
    if (usuarioLocal()) return false;                       // sesión local del rol correcto
    window.location.replace(loginPara(guard));
    return true;
  }

  // Botón "atrás" (bfcache): revalida la sesión
  window.addEventListener('pageshow', function () { protegerSiSinSesion(); });

  // Sin Firebase (modo local): valida con la sesión local del rol
  if (!window.firebaseListo || !window.estrategiumAuth) {
    var cached = usuarioLocal();
    if (cached) pintarUsuario(cached);
    else if (guard) window.location.replace(loginPara(guard));
    return;
  }

  // Con Firebase: la sesión válida sigue siendo la local del rol (ver arriba).
  window.estrategiumAuth.onAuthStateChanged(function (user) {
    var cached = usuarioLocal();
    if (cached) { pintarUsuario(cached); return; }
    if (guard) window.location.replace(loginPara(guard));
  });
})();
