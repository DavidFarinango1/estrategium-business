/* =====================================================================
   Estrategium Business — Datos de cursos COMPARTIDOS
   Usa Cloud Firestore (nube) cuando Firebase está configurado, para que
   lo que sube el ADMIN se vea en el portal del ESTUDIANTE en cualquier
   dispositivo y en tiempo real. Si no hay Firebase, usa localStorage.

   Requiere antes (en este orden):
     firebase-app-compat, firebase-firestore-compat, firebase-auth-compat,
     js/firebase-config.js, js/auth.js
   API:
     Cursos.onChange(fn)  -> fn(listaCursos) ahora y en cada cambio
     Cursos.add(curso)    -> Promise(id)
     Cursos.update(id,d)  -> Promise
     Cursos.remove(id)    -> Promise
     Cursos.getCache()    -> lista actual (sincrónica, desde cache)
   ===================================================================== */
window.Cursos = (function () {
  var KEY = 'estrategium_cursos';
  var COL = 'cursos';
  var db = null, useFS = false, started = false;
  var subs = [];

  // Cursos base que se crean UNA sola vez si el catálogo está vacío.
  var DEFAULT_CURSOS = [
    {
      icon: '🚀', etapa: 'ETAPA 1', titulo: 'MARCA START',
      lead: 'Descubre el método base que puede cambiar tu negocio.',
      items: ['Workshop completo en video de por vida', 'Método M.A.R.C.A explicado paso a paso', 'Checklists y plantillas básicas', 'Formato de diagnóstico de tu negocio', 'Acceso inmediato'],
      precioLabel: 'INVERSIÓN ÚNICA', moneda: 'USD', precio: '19', consultoria: false,
      videoUrl: 'https://player.vimeo.com/video/1173025258?title=0&byline=0&portrait=0',
      modulos: [
        { nombre: 'Workshop MARCA START', lecciones: [
          { titulo: 'Bienvenida al Método MARCA™', videoUrl: 'https://player.vimeo.com/video/1173025258?title=0&byline=0&portrait=0', completado: true },
          { titulo: 'M — Margen Inteligente', videoUrl: '', completado: true },
          { titulo: 'A — Activación de Base Propia', videoUrl: '', completado: true },
          { titulo: 'R — Recompra Programada', videoUrl: '', completado: true },
          { titulo: 'C — Construcción de Experiencia', videoUrl: '', completado: true },
          { titulo: 'A — Automatización', videoUrl: '', completado: true }
        ]},
        { nombre: 'Bonus y Recursos', lecciones: [
          { titulo: 'Checklist de diagnóstico de tu restaurante', videoUrl: '', completado: true },
          { titulo: 'Calculadora de costo de receta', videoUrl: '', completado: true },
          { titulo: 'Plantillas en Notion listas para usar', videoUrl: '', completado: true },
          { titulo: 'Mini diagnóstico de tu negocio', videoUrl: '', completado: false }
        ]},
        { nombre: 'Historias de Éxito', lecciones: [
          { titulo: 'Cómo un restaurante aumentó su recompra un 30%', videoUrl: '', completado: true },
          { titulo: 'Cómo subir el ticket promedio sin descuentos', videoUrl: '', completado: true },
          { titulo: 'Caso real: fidelización con base de datos propia', videoUrl: '', completado: false },
          { titulo: 'Cómo llenar el restaurante en días de baja afluencia', videoUrl: '', completado: false }
        ]},
        { nombre: 'Recursos Descargables', lecciones: [
          { titulo: 'Guía PDF del Método MARCA™', videoUrl: '', completado: false },
          { titulo: 'Plantilla de calendario de campañas', videoUrl: '', completado: false }
        ]}
      ]
    },
    {
      icon: '📘', etapa: 'ETAPA 2', titulo: 'MARCA PROFIT',
      lead: 'Acelera tus resultados con un sistema completo y probado.',
      items: ['Todo lo de MARCA START', 'Estrategia avanzada de fidelización', 'Calendario de fidelización', 'Manual de atención y servicio al cliente', 'Aumento del ticket promedio', 'Sesiones grupales en vivo', 'Comunidad exclusiva', 'Bonos premium'],
      precioLabel: 'INVERSIÓN ÚNICA', moneda: 'USD', precio: '97', consultoria: false,
      videoUrl: '',
      modulos: [
        { nombre: 'Todo MARCA START', lecciones: [
          { titulo: 'Repaso completo del Método MARCA™', videoUrl: 'https://player.vimeo.com/video/1173025258?title=0&byline=0&portrait=0', completado: true },
          { titulo: 'Checklist y plantillas base', videoUrl: '', completado: true }
        ]},
        { nombre: 'Estrategia Avanzada de Fidelización', lecciones: [
          { titulo: 'Sistema de Recompra y Recompensas', videoUrl: 'https://player.vimeo.com/video/1173025258?title=0&byline=0&portrait=0', completado: true },
          { titulo: 'Calendario de Campañas para todo el año', videoUrl: '', completado: true },
          { titulo: 'Manual de Atención y Servicio al Cliente', videoUrl: '', completado: true },
          { titulo: 'Sistema para Aumentar el Ticket Promedio', videoUrl: '', completado: false },
          { titulo: 'Venta Sugestiva y Combos Estratégicos', videoUrl: '', completado: false }
        ]},
        { nombre: 'Sesiones Grupales y Comunidad', lecciones: [
          { titulo: 'Sesión en vivo: Implementación paso a paso', videoUrl: 'https://player.vimeo.com/video/1173025258?title=0&byline=0&portrait=0', completado: false },
          { titulo: 'Cómo activar tu Comunidad Exclusiva de clientes', videoUrl: '', completado: false },
          { titulo: 'Bonos Premium: herramientas para escalar más rápido', videoUrl: '', completado: false }
        ]},
        { nombre: 'Historias de Éxito MARCA PROFIT', lecciones: [
          { titulo: 'Cómo un restaurante duplicó su recompra en 60 días', videoUrl: '', completado: false },
          { titulo: 'Cómo aumentar el ticket promedio un 35% sin descuentos', videoUrl: '', completado: false }
        ]}
      ]
    },
    {
      icon: '⚙️', etapa: 'ETAPA 3', titulo: 'IMPLEMENTACIÓN',
      lead: 'Instalamos el sistema completo en tu negocio para resultados extraordinarios',
      items: ['Estrategia 100% personalizada adaptada a tu propio negocio, mercado y objetivos', 'Acompañamiento 1 a 1', 'Implementación guiada paso a paso', 'Resultados medibles y sostenibles: más clientes que regresan, más ventas, más rentabilidad'],
      precioLabel: 'CONSULTORÍA PERSONALIZADA', moneda: '', precio: 'AGENDA TU LLAMADA', consultoria: true,
      link: 'https://calendly.com/cristyanq20/maquina-de-clientes-fieles',
      nota: 'Ideal para dueños que quieran resultados extraordinarios con acompañamiento experto.',
      notaIcono: '🎯',
      videoUrl: '', modulos: []
    }
  ];

  function readCache() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function writeCache(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
  function sortL(list) { return list.slice().sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); }); }
  function emit(list) { list = sortL(list); writeCache(list); subs.forEach(function (fn) { try { fn(list); } catch (e) {} }); }
  function uid() { return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }

  // Crea los cursos base una sola vez si el catálogo está vacío (respeta borrados posteriores).
  // Actualiza UNA vez los cursos base (MARCA START/PROFIT) a su contenido completo
  function refreshDefaults(list) {
    if (localStorage.getItem('estrategium_defaults_v6')) return false;
    localStorage.setItem('estrategium_defaults_v6', '1');
    var changed = false;
    DEFAULT_CURSOS.forEach(function (d) {
      var ex = (list || []).filter(function (x) { return (x.titulo || '').toUpperCase() === d.titulo.toUpperCase(); })[0];
      if (ex) { ex.modulos = JSON.parse(JSON.stringify(d.modulos)); ex.items = d.items.slice(); changed = true; }
    });
    if (changed) writeCache(list);
    return changed;
  }

  function seedIfEmpty(list) {
    if (localStorage.getItem('estrategium_seed_v3')) return;
    localStorage.setItem('estrategium_seed_v3', '1');
    if (list && list.length) return; // ya hay cursos: no sembrar
    DEFAULT_CURSOS.forEach(function (c, i) {
      var copia = JSON.parse(JSON.stringify(c));
      copia.orden = i + 1;
      add(copia);
    });
  }

  // Migración: agrega el curso "Implementación" (consultoría) una sola vez si el
  // catálogo ya tenía cursos (MARCA START/PROFIT) pero todavía no incluye ninguno
  // de tipo consultoría, para que aparezca editable en el panel de administrador.
  function ensureConsultoria(list) {
    if (localStorage.getItem('estrategium_impl_seed_v1')) return;
    localStorage.setItem('estrategium_impl_seed_v1', '1');
    if (!list || !list.length) return; // catálogo vacío: seedIfEmpty ya lo incluye
    var yaExiste = list.some(function (c) { return c.consultoria; });
    if (yaExiste) return;
    var base = DEFAULT_CURSOS.filter(function (c) { return c.consultoria; })[0];
    if (!base) return;
    var copia = JSON.parse(JSON.stringify(base));
    copia.orden = (Math.max.apply(null, list.map(function (c) { return c.orden || 0; })) || 0) + 1;
    add(copia);
  }

  function start() {
    if (started) return; started = true;

    // Sincroniza en vivo entre pestañas del mismo navegador (modo local)
    window.addEventListener('storage', function (e) {
      if (e.key === KEY) { subs.forEach(function (fn) { try { fn(getCache()); } catch (x) {} }); }
    });

    var preCache = readCache(); // cursos que ya había en este navegador (antes de leer la nube)

    if (window.firebaseListo && typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        db = firebase.firestore();
        useFS = true;
        db.collection(COL).onSnapshot(function (snap) {
          var list = [];
          snap.forEach(function (d) { var o = d.data() || {}; o.id = d.id; list.push(o); });

          // Primera vez con la nube vacía: migra los cursos locales (o siembra los base)
          if (list.length === 0 && !localStorage.getItem('estrategium_fs_init')) {
            localStorage.setItem('estrategium_fs_init', '1');
            var base = preCache.length ? preCache : DEFAULT_CURSOS;
            base.forEach(function (c, i) {
              var copia = JSON.parse(JSON.stringify(c));
              delete copia.id;
              if (copia.orden == null) copia.orden = i + 1;
              db.collection(COL).add(copia).catch(function (e) { console.warn('No se pudo migrar un curso:', e && e.message); });
            });
            return; // el siguiente snapshot traerá ya los datos
          }
          emit(list);
          ensureConsultoria(list);
        }, function (err) {
          console.warn('Firestore no disponible, usando almacenamiento local:', err && err.message);
          useFS = false; emit(preCache); seedIfEmpty(preCache); ensureConsultoria(preCache);
        });
      } catch (e) { useFS = false; emit(preCache); seedIfEmpty(preCache); ensureConsultoria(preCache); }
    } else {
      refreshDefaults(preCache);
      emit(preCache); seedIfEmpty(preCache); ensureConsultoria(preCache);
    }
  }

  function add(curso) {
    if (curso.orden == null) curso.orden = Date.now();
    if (useFS) return db.collection(COL).add(curso).then(function (r) { return r.id; });
    var list = readCache(); curso.id = uid(); list.push(curso); emit(list); return Promise.resolve(curso.id);
  }
  function update(id, data) {
    if (useFS) return db.collection(COL).doc(id).set(data, { merge: true });
    var list = readCache().map(function (c) { return c.id === id ? Object.assign({}, c, data) : c; });
    emit(list); return Promise.resolve();
  }
  function remove(id) {
    if (useFS) return db.collection(COL).doc(id).delete();
    var list = readCache().filter(function (c) { return c.id !== id; });
    emit(list); return Promise.resolve();
  }
  function getCache() { return sortL(readCache()); }
  function onChange(fn) { subs.push(fn); try { fn(getCache()); } catch (e) {} }

  return {
    start: start, add: add, update: update, remove: remove,
    getCache: getCache, onChange: onChange,
    get usandoFirestore() { return useFS; }
  };
})();

// Arranca en cuanto el archivo se carga (auth.js ya corrió antes)
window.Cursos.start();
