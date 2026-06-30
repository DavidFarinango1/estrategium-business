/* =====================================================================
   Estrategium — Datos de usuarios (localStorage, compartido)
   API: Usuarios.getAll() / add(u) / update(id,d) / remove(id) / onChange(fn)
   ===================================================================== */
window.Usuarios = (function () {
  var KEY = 'estrategium_usuarios';
  var subs = [];
  // Sin estudiantes de ejemplo: solo el administrador único.
  var DEFAULTS = [
    { id: 'admin1', nombre: 'Administrador', email: 'admin@estrategium.com', cursos: [], rol: 'Administrador', estado: 'Activo' }
  ];

  function read() {
    try {
      var r = localStorage.getItem(KEY);
      if (!r) { save(DEFAULTS); return DEFAULTS.slice(); }
      var list = JSON.parse(r);

      // Migración: "Usuario" → "Estudiante"
      if (!localStorage.getItem('estrategium_usuarios_v2')) {
        list.forEach(function (u) { if (u.rol === 'Usuario') u.rol = 'Estudiante'; });
        save(list); localStorage.setItem('estrategium_usuarios_v2', '1');
      }
      // Garantiza UN administrador
      if (!localStorage.getItem('estrategium_admin_seed')) {
        localStorage.setItem('estrategium_admin_seed', '1');
        if (!list.some(function (u) { return u.rol === 'Administrador'; })) {
          list.push({ id: 'admin1', nombre: 'Administrador', email: 'admin@estrategium.com', cursos: [], rol: 'Administrador', estado: 'Activo' });
          save(list);
        }
      }
      // Elimina los estudiantes de ejemplo (una sola vez)
      if (!localStorage.getItem('estrategium_students_clear_v1')) {
        localStorage.setItem('estrategium_students_clear_v1', '1');
        list = list.filter(function (u) { return ['u1', 'u2', 'u3', 'u4'].indexOf(u.id) === -1; });
        save(list);
      }
      // Soporte de varios cursos: convierte "curso" (texto) → "cursos" (lista)
      var changed = false;
      list.forEach(function (u) {
        if (!Array.isArray(u.cursos)) { u.cursos = u.curso ? [u.curso] : []; changed = true; }
      });
      if (changed) save(list);

      return list;
    } catch (e) { return DEFAULTS.slice(); }
  }
  function save(l) { localStorage.setItem(KEY, JSON.stringify(l)); }
  function emit() { var l = read(); subs.forEach(function (fn) { try { fn(l); } catch (e) {} }); }
  function uid() { return 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }

  // Sincroniza entre pestañas
  window.addEventListener('storage', function (e) { if (e.key === KEY) emit(); });

  return {
    getAll: read,
    add: function (u) { var l = read(); u.id = uid(); l.push(u); save(l); emit(); return u.id; },
    update: function (id, d) { var l = read().map(function (x) { return x.id === id ? Object.assign({}, x, d) : x; }); save(l); emit(); },
    remove: function (id) { var l = read().filter(function (x) { return x.id !== id; }); save(l); emit(); },
    onChange: function (fn) { subs.push(fn); try { fn(read()); } catch (e) {} }
  };
})();
