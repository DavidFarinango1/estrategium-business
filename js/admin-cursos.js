/* =========================================================
   ESTRATEGIUM Admin — Gestión de cursos (localStorage)
   Renderiza, edita, elimina y agrega cursos.
   ========================================================= */
(function () {
  // Los cursos viven en el módulo compartido Cursos (Firestore/localStorage).

  // ---- Utilidades ----
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function uid() { return 'c' + (Date.now().toString(36)) + Math.floor(Math.random() * 1000); }
  function toEmbed(url) {
    url = (url || '').trim();
    if (!url) return '';
    let m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (m) return 'https://player.vimeo.com/video/' + m[1] + '?title=0&byline=0&portrait=0';
    m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/i);
    if (m) return 'https://www.youtube.com/embed/' + m[1];
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }

  // ---- Render ----
  const grid = document.getElementById('cursosGrid');

  function render() {
    const cursos = Cursos.getCache();
    grid.innerHTML = '';
    if (!cursos.length) {
      grid.innerHTML = '<p style="color:var(--a-muted);grid-column:1/-1;text-align:center;padding:40px;">No hay cursos. Usa “+ Agregar curso” o sube uno desde “Subir archivo”.</p>';
      return;
    }
    cursos.forEach(c => {
      const card = document.createElement('div');
      card.className = 'adm-curso';

      // Portada (imagen cambiable) — separada de los videos
      const cover = c.imagen
        ? `<img src="${esc(c.imagen)}" alt="${esc(c.titulo || '')}" />`
        : esc(c.icon || '🎓');

      // Recolecta TODOS los videos del curso (principal + lecciones), sin repetir
      const seen = {};
      const vids = [];
      function addV(t, u) { if (u && !seen[u]) { seen[u] = 1; vids.push({ t: t, u: u }); } }
      addV('Video principal', c.videoUrl);
      (c.modulos || []).forEach(m => (m.lecciones || []).forEach(l => addV(l.titulo, l.videoUrl)));

      const videosHtml = vids.length
        ? vids.map(v => `
            <div class="adm-video">
              <div class="vbox"><iframe src="${esc(v.u)}" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>
              <div class="vtitle">${esc(v.t || 'Video')}</div>
            </div>`).join('')
        : '<p class="adm-no-video">Aún no hay videos. Súbelos en “Subir archivo” o agrégalos en ✏️ Editar.</p>';

      const precioTxt = c.consultoria
        ? `<span style="color:var(--a-gold);">${esc(c.precio || 'AGENDA TU LLAMADA')}</span>`
        : `<small>${esc(c.moneda || '')}</small>${esc(c.precio || '')}`;

      card.innerHTML = `
        <div class="adm-curso-actions">
          <button class="icon-btn" title="Editar" data-edit="${c.id}">✏️</button>
          <button class="icon-btn del" title="Eliminar" data-del="${c.id}">🗑️</button>
        </div>
        ${c.etapa ? `<span class="badge-etapa">${esc(c.etapa)}</span>` : ''}
        <h2>${esc(c.titulo || 'Curso')}</h2>
        <p class="lead">${esc(c.lead || '')}</p>
        <div class="adm-curso-cover">
          ${cover}
          <button class="cover-edit" data-edit="${c.id}">✎ Cambiar imagen</button>
        </div>
        <hr class="adm-divider" />
        <div class="adm-videos-label">Videos del curso (${vids.length})</div>
        <div class="adm-videos">${videosHtml}</div>
        <div class="adm-curso-price">${precioTxt}</div>`;
      grid.appendChild(card);
    });

    grid.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(b.getAttribute('data-edit'))));
    grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => removeCurso(b.getAttribute('data-del'))));
  }

  function removeCurso(id) {
    const c = Cursos.getCache().find(x => x.id === id);
    if (!c) return;
    if (confirm('¿Eliminar el curso "' + c.titulo + '"? Esta acción no se puede deshacer.')) {
      Cursos.remove(id); // el re-render ocurre solo al actualizarse los datos
    }
  }

  // ---- Modal de edición / creación ----
  const overlay = document.getElementById('cursoModal');
  const f = {
    title: document.getElementById('mTitle'),
    icon: document.getElementById('mIcon'),
    etapa: document.getElementById('mEtapa'),
    titulo: document.getElementById('mTitulo'),
    lead: document.getElementById('mLead'),
    items: document.getElementById('mItems'),
    precioLabel: document.getElementById('mPrecioLabel'),
    moneda: document.getElementById('mMoneda'),
    precio: document.getElementById('mPrecio'),
    consultoria: document.getElementById('mConsult'),
    video: document.getElementById('mVideo'),
    imagen: document.getElementById('mImagen'),
    imagenFile: document.getElementById('mImagenFile'),
    imagenPrev: document.getElementById('mImagenPrev')
  };
  let editingId = null;

  // Imagen: subir archivo → se guarda como dataURL en el campo de imagen
  function pintarImagenPrev() {
    f.imagenPrev.innerHTML = f.imagen.value
      ? `<img src="${esc(f.imagen.value)}" alt="" style="max-width:160px;border-radius:10px;border:1px solid var(--a-border);" />`
      : '';
  }
  f.imagenFile.addEventListener('change', function () {
    const file = f.imagenFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () { f.imagen.value = reader.result; pintarImagenPrev(); };
    reader.readAsDataURL(file);
  });
  f.imagen.addEventListener('input', pintarImagenPrev);

  // ---- Editor de estructura (módulos / lecciones) ----
  const estBox = document.getElementById('mEstructura');
  let estructura = []; // estado de trabajo mientras el modal está abierto

  function renderEstructura() {
    estBox.innerHTML = '';
    estructura.forEach((m, mi) => {
      const wrap = document.createElement('div');
      wrap.className = 'est-mod';
      const lessons = (m.lecciones || []).map((l, li) => `
        <div class="est-row est-les" data-li="${li}">
          <input class="est-les-name" value="${esc(l.titulo || '')}" placeholder="Nombre de la lección" />
          <input class="est-les-video" value="${esc(l.videoUrl || '')}" placeholder="video (opcional)" style="flex:.7;" />
          <button type="button" class="icon-btn del sm" data-rmles="${mi}:${li}" title="Quitar lección">✕</button>
        </div>`).join('');
      wrap.innerHTML = `
        <div class="est-mod-title">MÓDULO ${mi + 1}</div>
        <div class="est-row">
          <input class="est-mod-name" value="${esc(m.nombre || '')}" placeholder="Nombre del módulo" />
          <button type="button" class="icon-btn del sm" data-rmmod="${mi}" title="Eliminar módulo">🗑️</button>
        </div>
        <div class="est-les-list">${lessons}</div>
        <button type="button" class="est-mini-btn" data-addles="${mi}">+ Agregar lección</button>`;
      estBox.appendChild(wrap);
    });

    estBox.querySelectorAll('[data-addles]').forEach(b => b.addEventListener('click', () => {
      syncEstructuraFromDom();
      estructura[+b.getAttribute('data-addles')].lecciones.push({ titulo: 'Nueva lección', videoUrl: '' });
      renderEstructura();
    }));
    estBox.querySelectorAll('[data-rmmod]').forEach(b => b.addEventListener('click', () => {
      syncEstructuraFromDom();
      estructura.splice(+b.getAttribute('data-rmmod'), 1);
      renderEstructura();
    }));
    estBox.querySelectorAll('[data-rmles]').forEach(b => b.addEventListener('click', () => {
      syncEstructuraFromDom();
      const p = b.getAttribute('data-rmles').split(':');
      estructura[+p[0]].lecciones.splice(+p[1], 1);
      renderEstructura();
    }));
  }

  function syncEstructuraFromDom() {
    const mods = [];
    estBox.querySelectorAll('.est-mod').forEach(modEl => {
      const nombre = (modEl.querySelector('.est-mod-name').value || '').trim();
      const lecciones = [];
      modEl.querySelectorAll('.est-les').forEach(lesEl => {
        const titulo = (lesEl.querySelector('.est-les-name').value || '').trim();
        const videoUrl = toEmbed(lesEl.querySelector('.est-les-video').value);
        if (titulo) lecciones.push({ titulo: titulo, videoUrl: videoUrl });
      });
      mods.push({ nombre: nombre || 'Módulo', lecciones: lecciones });
    });
    estructura = mods;
  }

  function openModal(id) {
    editingId = id || null;
    const c = id ? Cursos.getCache().find(x => x.id === id) : null;
    f.title.textContent = c ? 'Editar curso' : 'Agregar curso';
    f.icon.value = c ? c.icon : '🎓';
    f.etapa.value = c ? c.etapa : '';
    f.titulo.value = c ? c.titulo : '';
    f.lead.value = c ? c.lead : '';
    f.items.value = c ? (c.items || []).join('\n') : '';
    f.precioLabel.value = c ? c.precioLabel : 'INVERSIÓN ÚNICA';
    f.moneda.value = c ? c.moneda : 'USD';
    f.precio.value = c ? c.precio : '';
    f.consultoria.checked = c ? !!c.consultoria : false;
    f.video.value = c ? (c.videoUrl || '') : '';
    f.imagen.value = c ? (c.imagen || '') : '';
    f.imagenFile.value = '';
    pintarImagenPrev();
    estructura = c && c.modulos ? JSON.parse(JSON.stringify(c.modulos)) : [];
    renderEstructura();
    overlay.classList.add('open');
  }
  function closeModal() { overlay.classList.remove('open'); editingId = null; }

  function saveModal() {
    const data = {
      icon: f.icon.value.trim() || '🎓',
      etapa: f.etapa.value.trim(),
      titulo: f.titulo.value.trim() || 'Curso sin título',
      lead: f.lead.value.trim(),
      items: f.items.value.split('\n').map(s => s.trim()).filter(Boolean),
      precioLabel: f.precioLabel.value.trim(),
      moneda: f.moneda.value.trim(),
      precio: f.precio.value.trim(),
      consultoria: f.consultoria.checked,
      videoUrl: toEmbed(f.video.value),
      imagen: (f.imagen.value || '').trim()
    };
    syncEstructuraFromDom();
    data.modulos = estructura;
    if (editingId) {
      Cursos.update(editingId, data);
    } else {
      Cursos.add(data);
    }
    closeModal();
  }

  // listeners
  document.getElementById('addCurso').addEventListener('click', () => openModal(null));
  document.getElementById('mAddModulo').addEventListener('click', () => {
    syncEstructuraFromDom();
    estructura.push({ nombre: 'Nuevo módulo', lecciones: [{ titulo: 'Nueva lección', videoUrl: '' }] });
    renderEstructura();
  });
  document.getElementById('mSave').addEventListener('click', saveModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // Re-renderiza ahora y cada vez que cambien los cursos (incluye sync en tiempo real desde la nube)
  Cursos.onChange(render);
})();
