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

  // Pide confirmar + la contraseña del ADMINISTRADOR antes de una eliminación
  // (protege contra borrados accidentales en el panel). Verifica siempre contra
  // el correo de la sesión de administrador guardada (estrategium_admin), NUNCA
  // contra "quien sea" que esté como currentUser en Firebase Auth en ese momento
  // — ese usuario podría ser un estudiante de prueba si se probaron cuentas de
  // estudiante en el mismo navegador, lo cual pedía la contraseña equivocada.
  // Si no hay sesión de Firebase para verificar la contraseña, solo pide la
  // confirmación normal.
  window.confirmarEliminar = function (mensaje, callback) {
    if (!confirm(mensaje)) return;
    var au = window.estrategiumAuth;
    if (!au || typeof firebase === 'undefined') { callback(); return; }
    var adminSesion = null;
    try { adminSesion = JSON.parse(localStorage.getItem('estrategium_admin') || 'null'); } catch (e) {}
    var adminEmail = adminSesion && adminSesion.email;
    if (!adminEmail) { callback(); return; }
    var pass = window.prompt('Por seguridad, ingresa la contraseña del administrador (' + adminEmail + ') para confirmar esta eliminación:');
    if (!pass) return;
    au.signInWithEmailAndPassword(adminEmail, pass).then(function () {
      callback();
    }).catch(function () {
      alert('Contraseña incorrecta. No se realizó la eliminación.');
    });
  };

  if (!realKey || typeof firebase === 'undefined') return;

  try { firebase.initializeApp(cfg); } catch (e) { /* ya inicializado */ }
  var auth = firebase.auth();
  window.estrategiumAuth = auth;
  window.googleListo = true;

  // Busca al estudiante por email; si no existe (login con Google nuevo), lo registra.
  // Marca haIniciadoSesion:true porque llegar aquí significa que la persona
  // realmente inició sesión (no solo llenó el Paso 1 del checkout sin terminar).
  // Devuelve una Promise para que quien llama espere a que la escritura termine
  // ANTES de navegar (si no, el navegador corta la escritura a Firestore a medias).
  function asegurarEstudiante(u) {
    var email = u.email || '';
    var nombre = u.displayName || email.split('@')[0] || 'Estudiante';
    try {
      if (window.Usuarios && email) {
        var est = Usuarios.getAll().filter(function (x) { return (x.email || '').toLowerCase() === email.toLowerCase(); })[0];
        if (est) {
          var p = est.haIniciadoSesion ? Promise.resolve() : Promise.resolve(Usuarios.update(est.id, { haIniciadoSesion: true })).catch(function () {});
          return p.then(function () { return { nombre: est.nombre || nombre, cursos: est.cursos || [], rol: est.rol }; });
        }
        // Nuevo: lo crea como estudiante para que el admin lo vea y le asigne cursos
        return Promise.resolve(Usuarios.add({ nombre: nombre, email: email, clave: '', cursos: [], rol: 'Estudiante', estado: 'Activo', haIniciadoSesion: true }))
          .catch(function () {})
          .then(function () { return { nombre: nombre, cursos: [], rol: 'Estudiante' }; });
      }
    } catch (e) {}
    return Promise.resolve({ nombre: nombre, cursos: [], rol: 'estudiante' });
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
      var infoPromesa;
      if (rol === 'admin') {
        var r = adminConGoogle(u);
        if (!r.ok) { alert('Este correo no está autorizado como administrador.'); auth.signOut(); return; }
        infoPromesa = Promise.resolve({ nombre: r.nombre, cursos: [] });
      } else {
        infoPromesa = asegurarEstudiante(u);
      }
      infoPromesa.then(function (info) {
        try {
          var sk = rol === 'admin' ? 'estrategium_admin' : 'estrategium_est';
          localStorage.setItem(sk, JSON.stringify({
            uid: u.uid, name: info.nombre || u.displayName, email: u.email, photo: u.photoURL,
            rol: rol, cursos: info.cursos || []
          }));
        } catch (e) {}
        window.location.href = destino;
      });
    }).catch(function (err) {
      if (err && err.code === 'auth/popup-closed-by-user') return;
      if (err && err.code === 'auth/operation-not-allowed') {
        alert('Para entrar con Google, activa el proveedor "Google" en Firebase:\nAuthentication → Sign-in method → Google → Habilitar.');
        return;
      }
      alert('No se pudo iniciar sesión con Google:\n' + (err && err.message ? err.message : err));
    });
  };

  // Inicia sesión de estudiante con Google SIN redirigir (para continuar dentro
  // del checkout). El correo de Google ya viene verificado, así que no hace
  // falta pasar por el paso de "verifica tu correo".
  window.loginConGoogleSinRedirigir = function () {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return auth.signInWithPopup(provider).then(function (res) {
      var u = res.user || {};
      return asegurarEstudiante(u).then(function (info) {
        try {
          localStorage.setItem('estrategium_est', JSON.stringify({
            uid: u.uid, name: info.nombre || u.displayName, email: u.email, photo: u.photoURL,
            rol: 'estudiante', cursos: info.cursos || []
          }));
        } catch (e) {}
        return { uid: u.uid, nombre: info.nombre || u.displayName, email: u.email, cursos: info.cursos || [] };
      });
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

  // Crea una cuenta de estudiante real (Firebase Auth + Firestore) y deja la
  // sesión abierta en este navegador SIN redirigir (para continuar el checkout).
  window.registrarEstudiante = function (datos) {
    var email = (datos.email || '').trim();
    var pass = datos.pass || '';
    var telefono = datos.telefono || '';
    var nombreCompleto = ((datos.nombre || '') + ' ' + (datos.apellido || '')).trim();
    return auth.createUserWithEmailAndPassword(email, pass).then(function (res) {
      var u = res.user;
      return u.updateProfile({ displayName: nombreCompleto }).then(function () { return u; });
    }).then(function (u) {
      var existente = window.Usuarios ? Usuarios.getAll().filter(function (x) {
        return (x.email || '').toLowerCase() === email.toLowerCase();
      })[0] : null;
      var campos = { nombre: nombreCompleto, email: email, telefono: telefono, clave: pass, rol: 'Estudiante', estado: 'Activo' };
      if (existente) {
        return Promise.resolve(Usuarios.update(existente.id, campos)).then(function () {
          return { uid: u.uid, nombre: nombreCompleto, email: email, telefono: telefono, cursos: existente.cursos || [] };
        });
      }
      campos.cursos = [];
      return Promise.resolve(Usuarios.add(campos)).then(function () {
        return { uid: u.uid, nombre: nombreCompleto, email: email, telefono: telefono, cursos: [] };
      });
    }).then(function (info) {
      try {
        localStorage.setItem('estrategium_est', JSON.stringify({
          uid: info.uid, name: info.nombre, email: info.email, telefono: info.telefono,
          rol: 'estudiante', cursos: info.cursos || []
        }));
      } catch (e) {}
      return info;
    });
  };

  // Inicia sesión de estudiante SIN redirigir (para continuar dentro del checkout).
  window.iniciarSesionEstudiante = function (email, pass) {
    return auth.signInWithEmailAndPassword(email, pass).then(function (res) {
      var u = res.user || {};
      return asegurarEstudiante(u).then(function (info) {
        try {
          localStorage.setItem('estrategium_est', JSON.stringify({
            uid: u.uid, name: info.nombre, email: u.email, rol: 'estudiante', cursos: info.cursos || []
          }));
        } catch (e) {}
        return { uid: u.uid, nombre: info.nombre, email: u.email, cursos: info.cursos || [] };
      });
    });
  };

  // Envía un correo de recuperación de contraseña (Firebase Auth).
  window.recuperarPassword = function (email) {
    return auth.sendPasswordResetEmail(email);
  };

  // El login "clásico" (login.html / login-estudiantes.html) solo compara la
  // contraseña contra el campo "clave" en Firestore, sin iniciar sesión real en
  // Firebase Auth. Eso impide guardar cosas que requieren "request.auth != null"
  // (progreso de lecciones, recuperar contraseña, etc.). Esta función intenta
  // autenticar a Firebase Auth en segundo plano con esas mismas credenciales,
  // creando la cuenta si aún no existe. Nunca bloquea el login clásico: si algo
  // falla (ej. contraseña muy corta para Firebase, o desincronizada), lo ignora.
  window.asegurarFirebaseAuthPlano = function (email, pass) {
    if (!email || !pass) return Promise.resolve();
    return auth.signInWithEmailAndPassword(email, pass).catch(function (err) {
      // SDKs recientes devuelven "auth/invalid-credential" (no "auth/user-not-found")
      // cuando la cuenta no existe, para no filtrar si el problema es el correo o la clave.
      var code = err && err.code;
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        return auth.createUserWithEmailAndPassword(email, pass).catch(function () {});
      }
    }).catch(function () {});
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
