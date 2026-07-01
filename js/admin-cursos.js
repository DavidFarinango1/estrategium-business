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
    grid.style.display = 'flex';
    grid.style.flexDirection = 'row';
    grid.style.flexWrap = 'wrap';
    grid.style.justifyContent = 'flex-start';
    grid.style.gap = '22px';
    grid.style.alignItems = 'stretch';
    grid.innerHTML = '';
    if (!cursos.length) {
      grid.innerHTML = '<p style="color:var(--a-muted);width:100%;text-align:center;padding:40px;">No hay cursos. Usa “+ Agregar curso”.</p>';
      return;
    }
    cursos.forEach(c => {
      const card = document.createElement('article');
      card.style.cssText = 'position:relative;background:#0a1f44;border:1px solid rgba(201,162,75,.35);border-radius:16px;padding:28px 22px 22px;color:#fff;flex:1 1 320px;max-width:380px;display:flex;flex-direction:column;';

      const itemsHtml = (c.items || []).map(it => `
        <li style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;font-size:.9rem;color:#dce4f2;">
          <span style="flex:none;width:20px;height:20px;border-radius:50%;background:#c9a24b;color:#0a1f44;display:grid;place-items:center;font-size:.68rem;font-weight:900;">✓</span>
          <span>${esc(it)}</span>
        </li>`).join('') || '<li style="color:#7f8db0;font-size:.85rem;list-style:none;">Sin puntos. Edita el curso para agregarlos.</li>';

      const precioBox = c.consultoria
        ? `<a href="#" style="display:block;text-decoration:none;border:1px solid rgba(201,162,75,.55);border-radius:12px;padding:20px;text-align:center;margin-top:18px;color:#fff;">
             <div style="font-size:1.7rem;">${esc(c.icon || '👥')}</div>
             <div style="font-weight:800;letter-spacing:.5px;margin-top:8px;">${esc(c.precioLabel || 'CONSULTORÍA PERSONALIZADA')}</div>
             <div style="color:#c9a24b;font-weight:700;margin-top:6px;letter-spacing:1px;">${esc(c.precio || 'AGENDA TU LLAMADA')}</div>
           </a>`
        : `<div style="background:#08152e;border:1px solid rgba(201,162,75,.35);border-radius:12px;padding:18px;text-align:center;margin-top:18px;">
             <div style="color:#c9a24b;font-size:.72rem;letter-spacing:1.5px;font-weight:700;">${esc(c.precioLabel || 'INVERSIÓN ÚNICA')}</div>
             <div style="font-size:1.9rem;font-weight:300;margin:4px 0 12px;">${esc(c.moneda || '')} <b style="font-weight:800;">${esc(c.precio || '')}</b></div>
             <span style="display:block;background:#c9a24b;color:#0a1f44;font-weight:800;border-radius:8px;padding:11px;font-size:.82rem;letter-spacing:.5px;">QUIERO EMPEZAR AHORA</span>
           </div>`;

      const foot = c.nota
        ? `<div style="display:flex;gap:8px;align-items:flex-start;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);font-size:.82rem;color:#aebbd4;"><span>${esc(c.icon || '★')}</span><span>${esc(c.nota)}</span></div>`
        : '';

      card.innerHTML = `
        <div style="position:absolute;top:12px;right:12px;display:flex;gap:6px;">
          <button class="icon-btn" title="Editar" data-edit="${c.id}">✏️</button>
          <button class="icon-btn del" title="Eliminar" data-del="${c.id}">🗑️</button>
        </div>
        <div style="width:62px;height:62px;border-radius:50%;border:2px solid #c9a24b;display:grid;place-items:center;font-size:1.7rem;margin:6px auto 14px;">${esc(c.icon || '🎓')}</div>
        ${c.etapa ? `<div style="text-align:center;margin-bottom:8px;"><span style="background:#08152e;border:1px solid rgba(201,162,75,.5);color:#c9a24b;font-size:.7rem;font-weight:700;letter-spacing:1px;padding:4px 12px;border-radius:6px;">${esc(c.etapa)}</span></div>` : ''}
        <h2 style="text-align:center;margin:0 0 6px;font-size:1.3rem;line-height:1.25;">${esc(c.titulo || 'Curso')}</h2>
        <p style="text-align:center;color:#aebbd4;font-size:.9rem;margin:0 0 18px;">${esc(c.lead || '')}</p>
        <ul style="list-style:none;padding:0;margin:0;flex:1;">${itemsHtml}</ul>
        ${precioBox}
        ${foot}`;
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
    titulo: document.getElementById('mTitulo'),
    lead: document.getElementById('mLead'),
    items: document.getElementById('mItems'),
    precioLabel: document.getElementById('mPrecioLabel'),
    moneda: document.getElementById('mMoneda'),
    precio: document.getElementById('mPrecio'),
    consultoria: document.getElementById('mConsult'),
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

  function openModal(id) {
    editingId = id || null;
    const c = id ? Cursos.getCache().find(x => x.id === id) : null;
    f.title.textContent = c ? 'Editar curso' : 'Agregar curso';
    f.titulo.value = c ? c.titulo : '';
    f.lead.value = c ? c.lead : '';
    f.items.value = c ? (c.items || []).join('\n') : '';
    f.precioLabel.value = c ? c.precioLabel : 'INVERSIÓN ÚNICA';
    f.moneda.value = c ? c.moneda : 'USD';
    f.precio.value = c ? c.precio : '';
    f.consultoria.checked = c ? !!c.consultoria : false;
    f.imagen.value = c ? (c.imagen || '') : '';
    f.imagenFile.value = '';
    pintarImagenPrev();
    overlay.classList.add('open');
  }
  function closeModal() { overlay.classList.remove('open'); editingId = null; }

  function saveModal() {
    const data = {
      titulo: f.titulo.value.trim() || 'Curso sin título',
      lead: f.lead.value.trim(),
      items: f.items.value.split('\n').map(s => s.trim()).filter(Boolean),
      precioLabel: f.precioLabel.value.trim(),
      moneda: f.moneda.value.trim(),
      precio: f.precio.value.trim(),
      consultoria: f.consultoria.checked,
      imagen: (f.imagen.value || '').trim()
    };
    if (editingId) {
      Cursos.update(editingId, data); // conserva módulos/videos (se editan en "Gestionar cursos")
    } else {
      data.icon = '🎓';
      data.modulos = [{ nombre: 'Módulo 1', lecciones: [{ titulo: 'Lección 1', videoUrl: '', descripcion: '', completado: false }] }];
      Cursos.add(data);
    }
    closeModal();
  }

  // listeners
  document.getElementById('addCurso').addEventListener('click', () => openModal(null));
  document.getElementById('mSave').addEventListener('click', saveModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // Re-renderiza ahora y cada vez que cambien los cursos (incluye sync en tiempo real desde la nube)
  Cursos.onChange(render);
})();
