/* =====================================================================
   Estrategium — Comentarios y sugerencias (localStorage)
   Cada mensaje: { id, n, tipo, nombre, email, mensaje, fecha }
   tipo: 'comentario' | 'sugerencia'
   ===================================================================== */
window.Mensajes = (function () {
  var KEY = 'estrategium_mensajes';
  var subs = [];
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(l) { localStorage.setItem(KEY, JSON.stringify(l)); }
  function emit() { var l = read(); subs.forEach(function (fn) { try { fn(l); } catch (e) {} }); }
  function uid() { return 'msg' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) emit(); });
  return {
    getAll: read,
    add: function (o) { var l = read(); o.id = uid(); o.n = l.length + 1; l.push(o); save(l); emit(); return o.id; },
    remove: function (id) { var l = read().filter(function (x) { return x.id !== id; }); save(l); emit(); },
    onChange: function (fn) { subs.push(fn); try { fn(read()); } catch (e) {} }
  };
})();
