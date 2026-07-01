/* Rellena el menú desplegable "MIS CURSOS" (#misCursosMenu) con los cursos
   asignados al estudiante. Requiere cursos-data.js y usuarios-data.js. */
(function () {
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function misInscritos() {
    try {
      var s = JSON.parse(localStorage.getItem('estrategium_user') || 'null');
      if (!s) return null;
      if (window.Usuarios && s.email) {
        var u = Usuarios.getAll().filter(function (x) { return x.rol === 'Estudiante' && (x.email || '').toLowerCase() === (s.email || '').toLowerCase(); })[0];
        if (u) return u.cursos || [];
      }
      return Array.isArray(s.cursos) ? s.cursos : null;
    } catch (e) { return null; }
  }
  function llenar() {
    var menu = document.getElementById('misCursosMenu');
    if (!menu || !window.Cursos) return;
    var mis = misInscritos();
    var cursos = Cursos.getCache().filter(function (c) { return c.precioLabel !== 'BORRADOR' && (!mis || mis.indexOf(c.titulo) >= 0); });
    menu.innerHTML = (cursos.length
      ? cursos.map(function (c) { return '<a href="curso.html?id=' + encodeURIComponent(c.id) + '">' + esc(c.titulo || 'Curso') + '</a>'; }).join('')
      : '<a href="mis-cursos.html" style="color:var(--gray-500)">Sin cursos asignados</a>') +
      '<a href="mis-cursos.html">Ver todos</a>';
  }
  function init() {
    if (window.Cursos) Cursos.onChange(llenar);
    if (window.Usuarios) Usuarios.onChange(llenar);
    llenar();
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
