// Estrategium Business — interacciones básicas

// Acordeón de FAQ
document.querySelectorAll('.faq-q').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var item = btn.closest('.faq-item');
    var alreadyOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function (el) {
      el.classList.remove('open');
    });
    if (!alreadyOpen) item.classList.add('open');
  });
});

// Placeholder de video (reemplazar por el embed real de YouTube cuando se tenga el enlace)
var video = document.getElementById('video');
if (video) {
  video.addEventListener('click', function () {
    // Ejemplo de cómo insertar el video real:
    // var id = 'TU_ID_DE_YOUTUBE';
    // video.innerHTML = '<iframe width="100%" height="100%" src="https://www.youtube.com/embed/' + id +
    //   '?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>';
    alert('Aquí se reproducirá el video del Workshop. Pega el enlace de YouTube en js/main.js para activarlo.');
  });
}

// Contador de caracteres del campo Comentarios (formulario de implementación)
var comentarios = document.getElementById('comentarios');
if (comentarios) {
  comentarios.addEventListener('input', function () {
    var c = document.getElementById('cc-count');
    if (c) c.textContent = comentarios.value.length;
  });
}

// Acordeón de "MARCA PROFIT INCLUYE" (checkout) — se despliega hacia abajo
document.querySelectorAll('.inc-acc .inc-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var item = btn.closest('.inc-item');
    var alreadyOpen = item.classList.contains('open');
    document.querySelectorAll('.inc-acc .inc-item.open').forEach(function (el) {
      el.classList.remove('open');
    });
    if (!alreadyOpen) item.classList.add('open');
  });
});

// Lecciones del curso: al hacer clic, ir a la página del reproductor
document.querySelectorAll('.lesson-row').forEach(function (row) {
  row.addEventListener('click', function (e) {
    e.preventDefault();
    var titleEl = row.querySelector('.l-title');
    var title = titleEl ? titleEl.textContent.replace(/^[\s▶✔►✅]+/, '').trim() : '';
    var current = location.pathname.split('/').pop() || '';
    var page = current.indexOf('curso-') === 0 ? current.replace('curso-', 'leccion-') : 'leccion-marca-start.html';
    window.location.href = page + '?l=' + encodeURIComponent(title);
  });
});

// Construye la barra lateral de la lección desde la estructura definida en el ADMIN
(function () {
  var side = document.getElementById('lpSide');
  var box = document.getElementById('lpVideo');
  if (!side || !box) return;
  var key = (box.getAttribute('data-curso') || '').toUpperCase();
  var course;
  try {
    var list = JSON.parse(localStorage.getItem('estrategium_cursos')) || [];
    course = list.filter(function (x) { return (x.titulo || '').toUpperCase().indexOf(key) >= 0; })[0];
  } catch (e) {}
  if (!course || !course.modulos || !course.modulos.length) return; // usa el HTML por defecto

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  var back = side.querySelector('.lp-back');
  var h2 = side.querySelector('h2');
  var html = (back ? back.outerHTML : '') + (h2 ? h2.outerHTML : '');
  course.modulos.forEach(function (m, mi) {
    html += '<div class="lp-mod' + (mi === 0 ? ' open' : '') + '">';
    html += '<div class="lp-mod-head"><span class="ic">' + (mi === 0 ? '－' : '＋') + '</span> ' + esc(m.nombre || 'Módulo') + '</div>';
    html += '<div class="lp-lessons">';
    (m.lecciones || []).forEach(function (l) {
      var t = esc(l.titulo || 'Lección');
      html += '<div class="lp-lesson" data-title="' + t + '"' + (l.videoUrl ? ' data-video="' + esc(l.videoUrl) + '"' : '') + '><span class="check">✔</span> ' + t + '</div>';
    });
    html += '</div></div>';
  });
  side.innerHTML = html;
})();

// Página del reproductor de lección
(function () {
  var lpTitle = document.getElementById('lpTitle');
  if (!lpTitle) return;
  // Acordeón de módulos en la barra lateral
  document.querySelectorAll('.lp-mod-head').forEach(function (h) {
    h.addEventListener('click', function () { h.parentElement.classList.toggle('open'); });
  });
  function activate(lesson) {
    document.querySelectorAll('.lp-lesson').forEach(function (l) { l.classList.remove('active'); });
    lesson.classList.add('active');
    var mod = lesson.closest('.lp-mod'); if (mod) mod.classList.add('open');
    lpTitle.textContent = lesson.getAttribute('data-title');
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.lp-lesson').forEach(function (l) {
    l.addEventListener('click', function () { activate(l); });
  });
  // Lección pedida desde el curso (?l=Título)
  var want = new URLSearchParams(location.search).get('l');
  var target = null;
  if (want) {
    document.querySelectorAll('.lp-lesson').forEach(function (l) {
      if (l.getAttribute('data-title') === want) target = l;
    });
  }
  if (!target) target = document.querySelector('.lp-lesson');
  if (target) activate(target);
})();

// Reproductor de lección: muestra el video asignado al curso en el ADMIN
(function () {
  var box = document.getElementById('lpVideo');
  if (!box) return;
  var key = (box.getAttribute('data-curso') || '').toUpperCase();

  function courseVideo() {
    try {
      var list = JSON.parse(localStorage.getItem('estrategium_cursos')) || [];
      var c = list.filter(function (x) { return (x.titulo || '').toUpperCase().indexOf(key) >= 0 && x.videoUrl; })[0];
      return c ? c.videoUrl : '';
    } catch (e) { return ''; }
  }
  function setVideo(url) {
    if (!url) return; // sin video asignado: deja el contenido por defecto
    box.innerHTML = '<iframe src="' + url + '" style="width:100%;height:100%;border:0;border-radius:6px;" ' +
      'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Video del curso"></iframe>';
  }

  var defaultVid = courseVideo();
  setVideo(defaultVid);

  // Si una lección tiene su propio video (data-video), úsalo al seleccionarla
  document.querySelectorAll('.lp-lesson').forEach(function (l) {
    l.addEventListener('click', function () {
      setVideo(l.getAttribute('data-video') || defaultVid);
    });
  });
})();

// Menú desplegable "CUENTA" del portal de estudiantes
document.querySelectorAll('.portal-dropdown > .portal-pill').forEach(function (pill) {
  pill.addEventListener('click', function (e) {
    e.stopPropagation();
    pill.parentElement.classList.toggle('open');
  });
});
document.addEventListener('click', function () {
  document.querySelectorAll('.portal-dropdown.open').forEach(function (el) {
    el.classList.remove('open');
  });
});

/* =====================================================================
   Imágenes en el celular
   Los infográficos traen el texto dibujado DENTRO de la imagen; al encogerlos
   para que entren en un móvil, ese texto queda ilegible. Aquí hacemos dos cosas
   con cada <img class="img-zoom">:
     1) Si declara data-movil y ESE archivo existe, en pantallas chicas se carga
        esa versión vertical (diseñada para leerse sin ampliar).
     2) Si no existe, se deja la imagen ancha y se añade debajo un botón que la
        abre a pantalla completa, a tamaño legible y desplazable con el dedo.
   ===================================================================== */
(function () {
  var imagenes = document.querySelectorAll('img.img-zoom');
  if (!imagenes.length) return;

  var visor = document.createElement('div');
  visor.className = 'img-visor';
  visor.innerHTML =
    '<button type="button" class="img-visor-close" aria-label="Cerrar">✕</button>' +
    '<div class="img-visor-scroll"><img alt="" /></div>';
  document.body.appendChild(visor);

  var visorImg = visor.querySelector('img');
  var scroll = visor.querySelector('.img-visor-scroll');

  function abrir(src, alt) {
    visorImg.src = src;
    visorImg.alt = alt || '';
    visor.classList.add('open');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      scroll.scrollLeft = Math.max(0, (visorImg.scrollWidth - scroll.clientWidth) / 2);
      scroll.scrollTop = 0;
    });
  }
  function cerrar() {
    visor.classList.remove('open');
    document.body.style.overflow = '';
    visorImg.removeAttribute('src');
  }

  var esPantallaChica = window.matchMedia('(max-width: 900px)');

  imagenes.forEach(function (im) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'img-zoom-btn';
    btn.textContent = '🔍 Toca para ampliar y leer';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      abrir(im.currentSrc || im.src, im.alt);
    });
    // Si la imagen va dentro de un enlace, el botón se pone FUERA para no dispararlo.
    var ancla = im.closest('a') || im;
    if (ancla.parentNode) ancla.parentNode.insertBefore(btn, ancla.nextSibling);

    var srcMovil = im.getAttribute('data-movil');
    var srcOriginal = im.getAttribute('src');
    if (!srcMovil) return;

    function elegirVersion() {
      if (!esPantallaChica.matches) {          // escritorio: siempre la ancha
        if (im.src !== srcOriginal) im.src = srcOriginal;
        btn.style.display = '';
        return;
      }
      var prueba = new Image();
      prueba.onload = function () {            // existe la vertical → úsala
        im.src = srcMovil;
        btn.style.display = 'none';           // ya se lee: no hace falta ampliar
      };
      prueba.onerror = function () {           // aún no existe → deja todo igual
        im.src = srcOriginal;
        btn.style.display = '';
      };
      prueba.src = srcMovil;
    }

    elegirVersion();
    if (esPantallaChica.addEventListener) esPantallaChica.addEventListener('change', elegirVersion);
    else if (esPantallaChica.addListener) esPantallaChica.addListener(elegirVersion);
  });
})();
