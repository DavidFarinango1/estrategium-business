/* =====================================================================
   Estrategium — Comentarios y sugerencias (Firestore o localStorage)
   Cada mensaje: { id, n, tipo, nombre, email, mensaje, fecha }
   tipo: 'comentario' | 'sugerencia'
   ===================================================================== */
window.Mensajes = (function () {
  var KEY = 'estrategium_mensajes';
  var COL = 'mensajes';
  var db = null, useFS = false, started = false;
  var subs = [];

  function readCache() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function writeCache(l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} }
  function sortN(l) { return l.slice().sort(function (a, b) { return (a.n || 0) - (b.n || 0); }); }
  function emit(l) { l = sortN(l); writeCache(l); subs.forEach(function (fn) { try { fn(l); } catch (e) {} }); }
  function uid() { return 'msg' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }

  function start() {
    if (started) return; started = true;
    window.addEventListener('storage', function (e) { if (e.key === KEY) subs.forEach(function (fn) { try { fn(readCache()); } catch (x) {} }); });
    var preCache = readCache();

    if (window.firebaseListo && typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        db = firebase.firestore(); useFS = true;
        if (!localStorage.getItem('estrategium_cloud_clean_mensajes')) { localStorage.setItem('estrategium_cloud_clean_mensajes', '1'); writeCache([]); }
        db.collection(COL).onSnapshot(function (snap) {
          var list = []; snap.forEach(function (d) { var o = d.data() || {}; o.id = d.id; list.push(o); });
          emit(list);
        }, function (err) {
          // Los visitantes anónimos no pueden LEER los mensajes (solo crearlos): mantén la nube
          // activa para que el comentario/sugerencia sí se guarde; solo el admin los lista.
          console.warn('Firestore mensajes (solo escritura para visitantes):', err && err.message);
          emit(preCache);
        });
      } catch (e) { useFS = false; emit(preCache); }
    } else {
      emit(preCache);
    }
  }

  function add(o) {
    o = Object.assign({}, o);
    o.n = (readCache().length) + 1;
    if (useFS) { var c = Object.assign({}, o); delete c.id; return db.collection(COL).add(c).then(function (r) { return r.id; }); }
    var l = readCache(); o.id = uid(); l.push(o); emit(l); return Promise.resolve(o.id);
  }
  function remove(id) {
    if (useFS) return db.collection(COL).doc(id).delete();
    var l = readCache().filter(function (x) { return x.id !== id; }); emit(l); return Promise.resolve();
  }
  function getAll() { return sortN(readCache()); }
  function onChange(fn) { subs.push(fn); try { fn(getAll()); } catch (e) {} }

  return { getAll: getAll, add: add, remove: remove, onChange: onChange, start: start };
})();

window.Mensajes.start();
