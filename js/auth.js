/* =====================================================================
   Estrategium Business — Autenticación con Google (Firebase)
   Requiere antes: firebase-app-compat, firebase-auth-compat, js/firebase-config.js
   Banderas:
     window.firebaseListo  -> usar Firestore para DATOS (false en MODO_LOCAL)
     window.googleListo    -> el login con Google está disponible
   Expone window.loginConGoogle(rol) y window.cerrarSesion(destino).
   ===================================================================== */
(function () {
  var cfg = window.firebaseConfig || {};
  var realKey = !!cfg.apiKey && cfg.apiKey.indexOf('PEGA_') !== 0;

  // Datos: solo se usan en la nube (Firestore) cuando NO estamos en modo local.
  window.firebaseListo = realKey && !window.MODO_LOCAL;
  // Google: puede funcionar aunque los datos sigan en local.
  window.googleListo = false;

  if (!realKey || typeof firebase === 'undefined') return;

  try { firebase.initializeApp(cfg); } catch (e) { /* ya inicializado */ }
  var auth = firebase.auth();
  window.estrategiumAuth = auth;
  window.googleListo = true;

  // Busca al estudiante por email; si no existe (login con Google nuevo), lo registra.
  function asegurarEstudiante(u) {
    var email = u.email || '';
    var nombre = u.displayName || email.split('@')[0] || 'Estudiante';
    try {
      if (window.Usuarios && email) {
        var est = Usuarios.getAll().filter(function (x) { return (x.email || '').toLowerCase() === email.toLowerCase(); })[0];
        if (est) return { nombre: est.nombre || nombre, cursos: est.cursos || [], rol: est.rol };
        // Nuevo: lo crea como estudiante para que el admin lo vea y le asigne cursos
        Usuarios.add({ nombre: nombre, email: email, clave: '', cursos: [], rol: 'Estudiante', estado: 'Activo' });
        return { nombre: nombre, cursos: [], rol: 'Estudiante' };
      }
    } catch (e) {}
    return { nombre: nombre, cursos: [], rol: 'estudiante' };
  }

  // Administrador con Google: el primer correo "reclama" el admin; luego solo ese correo entra.
  function adminConGoogle(u) {
    var email = (u.email || '').toLowerCase();
    try {
      if (window.Usuarios) {
        var admin = Usuarios.getAll().filter(function (x) { return x.rol === 'Administrador'; })[0];
        if (!admin) { // no hay admin: este se vuelve admin
          Usuarios.add({ nombre: u.displayName || email, email: u.email, clave: '', cursos: [], rol: 'Administrador', estado: 'Activo' });
          return { ok: true, nombre: u.displayName || u.email };
        }
        var adminEmail = (admin.email || '').toLowerCase();
        var sinReclamar = !adminEmail || adminEmail === 'admin@estrategium.com';
        if (sinReclamar) { // primer login real reclama el admin con este correo
          Usuarios.update(admin.id, { email: u.email, nombre: u.displayName || admin.nombre });
          return { ok: true, nombre: u.displayName || u.email };
        }
        if (adminEmail === email) return { ok: true, nombre: admin.nombre || u.displayName };
        return { ok: false }; // otro correo: no autorizado
      }
    } catch (e) {}
    return { ok: true, nombre: u.displayName || u.email };
  }

  // Inicia sesión con Google. rol = 'admin' | 'estudiante'
  window.loginConGoogle = function (rol) {
    var destino = rol === 'admin' ? 'admin.html' : 'mis-cursos.html';
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider).then(function (res) {
      var u = res.user || {};
      var info;
      if (rol === 'admin') {
        var r = adminConGoogle(u);
        if (!r.ok) { alert('Este correo no está autorizado como administrador.'); auth.signOut(); return; }
        info = { nombre: r.nombre, cursos: [] };
      } else {
        info = asegurarEstudiante(u);
      }
      try {
        var sk = rol === 'admin' ? 'estrategium_admin' : 'estrategium_est';
        localStorage.setItem(sk, JSON.stringify({
          uid: u.uid, name: info.nombre || u.displayName, email: u.email, photo: u.photoURL,
          rol: rol, cursos: info.cursos || []
        }));
      } catch (e) {}
      window.location.href = destino;
    }).catch(function (err) {
      if (err && err.code === 'auth/popup-closed-by-user') return;
      if (err && err.code === 'auth/operation-not-allowed') {
        alert('Para entrar con Google, activa el proveedor "Google" en Firebase:\nAuthentication → Sign-in method → Google → Habilitar.');
        return;
      }
      alert('No se pudo iniciar sesión con Google:\n' + (err && err.message ? err.message : err));
    });
  };

  // Inicia sesión con EMAIL + CONTRASEÑA (usuarios creados en Firebase Authentication)
  window.loginEmailPassword = function (email, pass, rol) {
    var destino = rol === 'admin' ? 'admin.html' : 'mis-cursos.html';
    return auth.signInWithEmailAndPassword(email, pass).then(function (res) {
      var u = res.user || {};
      var nombre = u.displayName || (u.email || '').split('@')[0];
      var cursos = [];
      if (rol === 'admin') {
        var r = adminConGoogle(u); // reclama/valida al admin (mismo control que con Google)
        if (!r.ok) { auth.signOut(); var e = new Error('no-autorizado'); e.code = 'no-autorizado'; throw e; }
        nombre = r.nombre;
      } else {
        var info = asegurarEstudiante(u); nombre = info.nombre; cursos = info.cursos;
      }
      try {
        var sk = rol === 'admin' ? 'estrategium_admin' : 'estrategium_est';
        localStorage.setItem(sk, JSON.stringify({
          uid: u.uid, name: nombre, email: u.email, rol: rol, cursos: cursos || []
        }));
      } catch (e) {}
      window.location.href = destino;
    });
  };

  // Cierra sesión SOLO del rol indicado (por el destino). El estudiante NO cierra
  // Firebase, para no afectar la sesión del admin en el mismo navegador.
  window.cerrarSesion = function (destino) {
    var esAdmin = /admin/i.test(destino || '');
    try {
      localStorage.removeItem(esAdmin ? 'estrategium_admin' : 'estrategium_est');
      localStorage.removeItem('estrategium_user'); // limpia sesión antigua si existiera
    } catch (e) {}
    if (esAdmin) {
      auth.signOut().finally(function () { window.location.href = destino || 'login-admin.html'; });
    } else {
      window.location.href = destino || 'login-estudiantes.html';
    }
  };
})();
