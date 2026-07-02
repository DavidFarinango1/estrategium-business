/* =====================================================================
   Estrategium — Datos de usuarios (Firestore en la nube o localStorage)
   Usa Cloud Firestore cuando firebaseListo === true (MODO_LOCAL = false);
   si no, guarda en localStorage (por navegador).
   API: Usuarios.getAll() / add(u) / update(id,d) / remove(id) / onChange(fn)
   ===================================================================== */
window.Usuarios = (function () {
  var KEY = 'estrategium_usuarios';
  var COL = 'usuarios';
  var db = null, useFS = false, started = false;
  var subs = [];
  var DEFAULT_ADMIN = { nombre: 'Administrador', email: 'admin@estrategium.com', cursos: [], rol: 'Administrador', estado: 'Activo' };

  function readCache() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function writeCache(l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} }
  function normaliza(list) {
    (list || []).forEach(function (u) { if (!Array.isArray(u.cursos)) u.cursos = u.curso ? [u.curso] : []; });
    return list || [];
  }
  function emit(l) { l = normaliza(l); writeCache(l); subs.forEach(function (fn) { try { fn(l); } catch (e) {} }); }
  function uid() { return 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }

  function seedAdmin(list) {
    if (!list.some(function (u) { return u.rol === 'Administrador'; })) {
      list.push(Object.assign({ id: 'admin1' }, DEFAULT_ADMIN));
      writeCache(list);
    }
    return list;
  }

  function start() {
    if (started) return; started = true;
    window.addEventListener('storage', function (e) { if (e.key === KEY) subs.forEach(function (fn) { try { fn(readCache()); } catch (x) {} }); });
    var preCache = normaliza(readCache());

    if (window.firebaseListo && typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        db = firebase.firestore(); useFS = true;
        db.collection(COL).onSnapshot(function (snap) {
          var list = []; snap.forEach(function (d) { var o = d.data() || {}; o.id = d.id; list.push(o); });
          // Primera vez con la nube vacía: sube lo local (o al menos el admin)
          if (list.length === 0 && !localStorage.getItem('estrategium_fs_init_usuarios')) {
            localStorage.setItem('estrategium_fs_init_usuarios', '1');
            // Inicio limpio: solo el administrador (los estudiantes se registran solos)
            db.collection(COL).add(Object.assign({}, DEFAULT_ADMIN)).catch(function () {});
            return;
          }
          emit(list);
        }, function (err) {
          console.warn('Firestore usuarios no disponible, uso local:', err && err.message);
          useFS = false; emit(seedAdmin(preCache));
        });
      } catch (e) { useFS = false; emit(seedAdmin(preCache)); }
    } else {
      emit(seedAdmin(preCache));
    }
  }

  function add(u) {
    u = Object.assign({}, u); if (!Array.isArray(u.cursos)) u.cursos = u.curso ? [u.curso] : [];
    if (useFS) { var c = Object.assign({}, u); delete c.id; return db.collection(COL).add(c).then(function (r) { return r.id; }); }
    var l = readCache(); u.id = uid(); l.push(u); emit(l); return Promise.resolve(u.id);
  }
  function update(id, d) {
    if (useFS) return db.collection(COL).doc(id).set(d, { merge: true });
    var l = readCache().map(function (x) { return x.id === id ? Object.assign({}, x, d) : x; }); emit(l); return Promise.resolve();
  }
  function remove(id) {
    if (useFS) return db.collection(COL).doc(id).delete();
    var l = readCache().filter(function (x) { return x.id !== id; }); emit(l); return Promise.resolve();
  }
  function getAll() { return normaliza(readCache()); }
  function onChange(fn) { subs.push(fn); try { fn(getAll()); } catch (e) {} }

  return { getAll: getAll, add: add, update: update, remove: remove, onChange: onChange, start: start };
})();

// Arranca en cuanto se carga (auth.js ya definió firebaseListo)
window.Usuarios.start();
