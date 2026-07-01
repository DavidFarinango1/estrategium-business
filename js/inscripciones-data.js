/* =====================================================================
   Estrategium — Inscripciones por transferencia (localStorage)
   Cada inscripción: { id, n, nombre, email, telefono, cedula, clave,
   curso, monto, comprobante(dataURL), estado, fecha }
   estado: 'pendiente' | 'aprobado' | 'negado'
   ===================================================================== */
window.Inscripciones = (function () {
  var KEY = 'estrategium_inscripciones';
  var subs = [];
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(l) { localStorage.setItem(KEY, JSON.stringify(l)); }
  function emit() { var l = read(); subs.forEach(function (fn) { try { fn(l); } catch (e) {} }); }
  function uid() { return 'ins' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) emit(); });
  return {
    getAll: read,
    add: function (o) { var l = read(); o.id = uid(); o.n = l.length + 1; l.push(o); save(l); emit(); return o.id; },
    update: function (id, d) { var l = read().map(function (x) { return x.id === id ? Object.assign({}, x, d) : x; }); save(l); emit(); },
    remove: function (id) { var l = read().filter(function (x) { return x.id !== id; }); save(l); emit(); },
    onChange: function (fn) { subs.push(fn); try { fn(read()); } catch (e) {} }
  };
})();
