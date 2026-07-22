/* =====================================================================
   Estrategium — Servidor de pagos PayPhone (Cloudflare Worker)
   ---------------------------------------------------------------------
   ¿Por qué existe este servidor?
   PayPhone EXIGE que la confirmación del pago se haga desde un servidor,
   y dentro de los 5 MINUTOS siguientes al pago. Si no, PayPhone reversa
   la transacción y el dinero se le devuelve al cliente. Además, el token
   de PayPhone NUNCA debe viajar al navegador: aquí vive seguro.

   Dos rutas:
     POST /payphone/prepare  → prepara el cobro y devuelve el link de PayPhone
     GET  /payphone/confirm  → PayPhone manda aquí al cliente tras pagar.
                               Confirmamos con PayPhone y, si el pago es real,
                               damos el acceso al curso. Nada de esto se puede
                               falsificar desde el navegador.

   Secretos que necesita (se cargan con `wrangler secret put`):
     PAYPHONE_TOKEN            token de la app WEB en PayPhone Developer
     PAYPHONE_STORE_ID         StoreId de tu comercio
     FIREBASE_SERVICE_ACCOUNT  JSON de la cuenta de servicio de Firebase
   Variables normales (en wrangler.toml):
     SITE_URL                  a dónde devolvemos al cliente tras pagar
     FIREBASE_PROJECT_ID       estrategium-business
   ===================================================================== */

const PP_PREPARE = 'https://pay.payphonetodoesposible.com/api/button/Prepare';
const PP_CONFIRM = 'https://pay.payphonetodoesposible.com/api/button/V2/Confirm';

// PayPhone: 3 = aprobado, 2 = cancelado
const PP_APROBADO = 3;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env);

    try {
      if (url.pathname === '/payphone/prepare' && request.method === 'POST') {
        return cors(await prepare(request, env), env);
      }
      if (url.pathname === '/payphone/confirm') {
        return await confirmar(url, env); // redirige al navegador, no necesita CORS
      }
      if (url.pathname === '/email/credenciales' && request.method === 'POST') {
        return cors(await enviarCredencialesAdmin(request, env), env);
      }
      if (url.pathname === '/contacto' && request.method === 'POST') {
        return cors(await recibirContacto(request, env), env);
      }
      if (url.pathname === '/salud') {
        return cors(json({ ok: true, servicio: 'pagos-estrategium' }), env);
      }
    } catch (e) {
      return cors(json({ error: String((e && e.message) || e) }, 500), env);
    }

    return cors(json({ error: 'Ruta no encontrada' }, 404), env);
  },
};

/* ---------------------------------------------------------------------
   PASO 1 — Preparar el cobro
   El checkout nos manda los datos de la compra. Creamos la inscripción en
   Firestore como "pendiente" y le pedimos a PayPhone el enlace de pago.
   Devolvemos ese enlace para que el navegador lleve al cliente a PayPhone.
   --------------------------------------------------------------------- */
async function prepare(request, env) {
  const d = await request.json();

  const monto = Number(d.monto);
  if (!monto || monto <= 0) return json({ error: 'Monto inválido' }, 400);
  if (!d.email || !d.curso) return json({ error: 'Faltan datos de la compra' }, 400);

  // PayPhone trabaja en CENTAVOS y con enteros: $49.00 → 4900
  const centavos = Math.round(monto * 100);

  // Identificador único nuestro para casar el pago con la inscripción
  const clientTransactionId = 'EST-' + Date.now() + '-' + aleatorio(6);

  // Clave de acceso que se le entregará al aprobarse el pago
  const clave = aleatorio(8);

  const token = await tokenFirestore(env);

  // La inscripción nace "pendiente". Solo /confirm la aprueba, y solo si
  // PayPhone confirma que el pago fue real.
  await crearDoc(env, token, 'inscripciones', {
    nombre: d.nombre || '',
    email: String(d.email).toLowerCase(),
    telefono: d.telefono || '',
    cedula: '',
    clave: clave,
    direccion: d.direccion || '',
    ciudad: d.ciudad || '',
    pais: d.pais || '',
    provincia: d.provincia || '',
    codigoPostal: d.codigoPostal || '',
    metodoPago: 'payphone',
    curso: d.curso,
    monto: monto,
    comprobante: '',
    estado: 'pendiente',
    clientTransactionId: clientTransactionId,
    fecha: new Date().toISOString(),
  });

  // PayPhone nos devolverá al cliente a ESTA url con ?id=..&clientTransactionId=..
  const responseUrl = new URL(request.url).origin + '/payphone/confirm';

  const r = await fetch(PP_PREPARE, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.PAYPHONE_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: centavos,
      amountWithoutTax: centavos, // los cursos no llevan IVA desglosado
      clientTransactionId: clientTransactionId,
      currency: 'USD',
      storeId: env.PAYPHONE_STORE_ID,
      reference: d.curso,
      responseUrl: responseUrl,
      email: d.email,
    }),
  });

  const pp = await r.json();
  if (!r.ok || (!pp.payWithCard && !pp.payWithPayPhone)) {
    return json({ error: 'PayPhone rechazó la preparación', detalle: pp }, 502);
  }

  return json({
    clientTransactionId: clientTransactionId,
    payWithCard: pp.payWithCard,         // pagar con tarjeta
    payWithPayPhone: pp.payWithPayPhone, // pagar con la app PayPhone
  });
}

/* ---------------------------------------------------------------------
   PASO 2 — Confirmar el pago (¡dentro de los 5 minutos!)
   PayPhone trae aquí al cliente después de pagar. Le preguntamos a PayPhone
   si el pago fue real. Solo si PayPhone dice "aprobado" damos el acceso.
   Como la respuesta viene de PayPhone a nuestro servidor, el cliente no
   puede falsificarla.
   --------------------------------------------------------------------- */
async function confirmar(url, env) {
  const id = url.searchParams.get('id');
  const clientTxId = url.searchParams.get('clientTransactionId');

  if (!id || !clientTxId) return redirigir(env, 'fallo', 'Faltan datos de la transacción');

  // Le preguntamos a PayPhone. Esta es la única fuente de verdad.
  const r = await fetch(PP_CONFIRM, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.PAYPHONE_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: Number(id), clientTxId: clientTxId }),
  });

  const pago = await r.json().catch(() => ({}));

  if (!r.ok || pago.statusCode !== PP_APROBADO) {
    // Pago cancelado, rechazado o reversado: la inscripción queda negada.
    await marcarInscripcion(env, clientTxId, { estado: 'negado' }).catch(() => {});
    return redirigir(env, 'fallo', pago.message || 'El pago no fue aprobado');
  }

  // ---- Pago REAL y aprobado. Damos el acceso. ----
  const token = await tokenFirestore(env);
  const ins = await buscarInscripcion(env, token, clientTxId);
  if (!ins) return redirigir(env, 'fallo', 'No encontramos tu inscripción');

  const email = (ins.email || '').toLowerCase();
  const curso = ins.curso;
  const clave = ins.clave || aleatorio(8);

  // 1) La inscripción queda aprobada, con la referencia de PayPhone
  await actualizarDoc(env, token, 'inscripciones/' + ins.id, {
    estado: 'aprobado',
    referenciaPayphone: String(pago.transactionId || id),
    codigoAutorizacion: String(pago.authorizationCode || ''),
  });

  // 2) El estudiante recibe el curso
  let claveFinal = clave; // la clave con la que realmente entrará el estudiante
  const usuario = await buscarUsuario(env, token, email);
  if (usuario) {
    const cursos = usuario.cursos || [];
    if (!cursos.includes(curso)) cursos.push(curso);
    claveFinal = usuario.clave || clave; // si ya tenía cuenta, conserva su clave
    await actualizarDoc(env, token, 'usuarios/' + usuario.id, {
      cursos: cursos,
      estado: 'Activo',
      clave: claveFinal,
    });
  } else {
    await crearDoc(env, token, 'usuarios', {
      nombre: ins.nombre || email,
      email: email,
      clave: clave,
      cursos: [curso],
      rol: 'Estudiante',
      estado: 'Activo',
      haIniciadoSesion: false,
    });
  }

  // 3) Le enviamos por correo sus credenciales de acceso. Si el correo fallara,
  //    NO rompemos el flujo: el pago ya está aprobado y el acceso ya está dado.
  try {
    await correoCredenciales(env, {
      tipo: 'aprobado', nombre: ins.nombre || email, email: email, clave: claveFinal, curso: curso,
    });
  } catch (e) { /* el correo es un extra; el pago y el acceso ya quedaron */ }

  return redirigir(env, 'ok', '', { curso: curso, email: email, clave: claveFinal });
}

/* ---------------------------------------------------------------------
   Formulario de CONTACTO (público)
   Lo llama la página contacto.html. Guarda el mensaje en Firestore
   (colección "mensajes", que el admin ve en su bandeja) y además envía
   un correo de aviso a CORREO_CONTACTO. Así el mensaje nunca se pierde:
   aunque el correo fallara, queda guardado en el panel.
   Anti-spam: campo trampa "web" (honeypot); si viene lleno, es un bot.
   --------------------------------------------------------------------- */
async function recibirContacto(request, env) {
  const d = await request.json().catch(() => ({}));

  if (d.web) return json({ ok: true }); // honeypot: bot → fingimos éxito y no hacemos nada

  const nombre = String(d.nombre || '').trim();
  const email = String(d.email || '').trim();
  const mensaje = String(d.mensaje || '').trim();
  if (!nombre || !email || !mensaje) return json({ error: 'Faltan datos (nombre, correo y mensaje).' }, 400);
  if (nombre.length > 120 || email.length > 150 || mensaje.length > 2000) return json({ error: 'Datos demasiado largos.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Correo inválido.' }, 400);

  const telefono = String(d.telefono || '').trim().slice(0, 40);
  const empresa = String(d.empresa || '').trim().slice(0, 120);
  const pais = String(d.pais || '').trim().slice(0, 60);
  const tipo = String(d.tipo || '').trim().slice(0, 60);

  // 1) Guardar en Firestore (siempre). El admin lo ve en su bandeja de mensajes.
  const token = await tokenFirestore(env);
  await crearDoc(env, token, 'mensajes', {
    tipo: 'contacto',
    asunto: tipo,
    nombre: nombre,
    email: email,
    telefono: telefono,
    empresa: empresa,
    pais: pais,
    mensaje: mensaje,
    fecha: new Date().toISOString(),
  }).catch(() => {});

  // 2) Enviar aviso por correo (puede fallar durante el trial de MailerSend; no rompe nada).
  const destino = env.CORREO_CONTACTO || 'cristyanq20@gmail.com';
  const filas =
    '<tr><td style="padding:4px 8px;color:#555;">Nombre</td><td style="padding:4px 8px;font-weight:700;">' + escHtml(nombre) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;color:#555;">Correo</td><td style="padding:4px 8px;font-weight:700;">' + escHtml(email) + '</td></tr>' +
    (telefono ? '<tr><td style="padding:4px 8px;color:#555;">Teléfono</td><td style="padding:4px 8px;">' + escHtml(telefono) + '</td></tr>' : '') +
    (empresa ? '<tr><td style="padding:4px 8px;color:#555;">Empresa</td><td style="padding:4px 8px;">' + escHtml(empresa) + '</td></tr>' : '') +
    (pais ? '<tr><td style="padding:4px 8px;color:#555;">País</td><td style="padding:4px 8px;">' + escHtml(pais) + '</td></tr>' : '') +
    (tipo ? '<tr><td style="padding:4px 8px;color:#555;">Motivo</td><td style="padding:4px 8px;">' + escHtml(tipo) + '</td></tr>' : '');
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">' +
      '<h2 style="color:#001f4d;">Nuevo mensaje de contacto</h2>' +
      '<table style="width:100%;border-collapse:collapse;background:#f7f9fc;border-radius:8px;">' + filas + '</table>' +
      '<p style="margin:16px 0 4px;color:#555;">Mensaje:</p>' +
      '<div style="background:#fff;border:1px solid #e6e8ec;border-radius:8px;padding:14px;white-space:pre-wrap;">' + escHtml(mensaje) + '</div>' +
      '<p style="color:#888;font-size:12px;margin-top:16px;">Responde este correo para contestarle directamente a ' + escHtml(email) + '.</p>' +
    '</div>';
  const text = 'Nuevo mensaje de contacto\n\nNombre: ' + nombre + '\nCorreo: ' + email +
    (telefono ? '\nTeléfono: ' + telefono : '') + (empresa ? '\nEmpresa: ' + empresa : '') +
    (pais ? '\nPaís: ' + pais : '') + (tipo ? '\nMotivo: ' + tipo : '') + '\n\nMensaje:\n' + mensaje;

  try {
    await enviarCorreo(env, {
      to: destino, nombre: 'Estrategium', subject: 'Nuevo contacto — ' + nombre,
      html: html, text: text, replyTo: email,
    });
  } catch (e) { /* el mensaje ya quedó guardado en Firestore */ }

  return json({ ok: true });
}

/* --------------------------- Utilidades ---------------------------- */

function redirigir(env, estado, mensaje, extra) {
  const u = new URL((env.SITE_URL || 'https://estrategium-business.web.app') + '/pago-resultado.html');
  u.searchParams.set('pago', estado);
  if (mensaje) u.searchParams.set('msg', mensaje);
  if (extra) {
    if (extra.curso) u.searchParams.set('curso', extra.curso);
    if (extra.email) u.searchParams.set('email', extra.email);
    if (extra.clave) u.searchParams.set('clave', extra.clave);
  }
  return Response.redirect(u.toString(), 302);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(res, env) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', env.CORS_ORIGIN || '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return r;
}

function aleatorio(n) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += abc[b[i] % abc.length];
  return s;
}

/* --------------- Firestore vía REST con cuenta de servicio ---------------
   El Worker no puede usar el SDK de Firebase, así que firma un JWT con la
   clave privada de la cuenta de servicio, lo cambia por un token de acceso
   de Google y habla con la API REST de Firestore. Así el Worker escribe con
   permisos de administrador y nadie puede suplantarlo desde el navegador.
   ----------------------------------------------------------------------- */
let cacheToken = null; // { token, expira }

async function tokenFirestore(env) {
  if (cacheToken && cacheToken.expira > Date.now() + 60000) return cacheToken.token;

  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const ahora = Math.floor(Date.now() / 1000);

  const jwt = await firmarJWT(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: ahora,
      exp: ahora + 3600,
    },
    sa.private_key
  );

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('No se pudo autenticar con Firestore: ' + JSON.stringify(d));

  cacheToken = { token: d.access_token, expira: Date.now() + (d.expires_in - 120) * 1000 };
  return cacheToken.token;
}

async function firmarJWT(header, claims, privateKeyPem) {
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const cuerpo = enc(header) + '.' + enc(claims);

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemABuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(cuerpo));
  return cuerpo + '.' + b64url(new Uint8Array(firma));
}

function pemABuffer(pem) {
  const limpio = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(limpio);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function baseFirestore(env) {
  return 'https://firestore.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID +
    '/databases/(default)/documents';
}

// Firestore REST usa tipos explícitos; estas dos funciones traducen a/desde JS.
function aValor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValor) } };
  if (typeof v === 'object') {
    const f = {};
    for (const k of Object.keys(v)) f[k] = aValor(v[k]);
    return { mapValue: { fields: f } };
  }
  return { stringValue: String(v) };
}
function deValor(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor);
  if ('mapValue' in v) {
    const o = {};
    const f = v.mapValue.fields || {};
    for (const k of Object.keys(f)) o[k] = deValor(f[k]);
    return o;
  }
  return null;
}
function aDoc(campos) {
  const f = {};
  for (const k of Object.keys(campos)) f[k] = aValor(campos[k]);
  return { fields: f };
}
function deDoc(doc) {
  const o = deValor({ mapValue: { fields: doc.fields || {} } }) || {};
  o.id = (doc.name || '').split('/').pop();
  return o;
}

async function crearDoc(env, token, coleccion, campos) {
  const r = await fetch(baseFirestore(env) + '/' + coleccion, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(aDoc(campos)),
  });
  if (!r.ok) throw new Error('Firestore no pudo crear en ' + coleccion + ': ' + (await r.text()));
  return deDoc(await r.json());
}

async function actualizarDoc(env, token, ruta, campos) {
  const máscara = Object.keys(campos).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(baseFirestore(env) + '/' + ruta + '?' + máscara, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(aDoc(campos)),
  });
  if (!r.ok) throw new Error('Firestore no pudo actualizar ' + ruta + ': ' + (await r.text()));
  return deDoc(await r.json());
}

async function consultar(env, token, coleccion, campo, valor) {
  const r = await fetch(baseFirestore(env) + ':runQuery', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: coleccion }],
        where: {
          fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: valor } },
        },
        limit: 1,
      },
    }),
  });
  const filas = await r.json();
  const fila = (Array.isArray(filas) ? filas : []).find((x) => x.document);
  return fila ? deDoc(fila.document) : null;
}

async function buscarInscripcion(env, token, clientTxId) {
  return consultar(env, token, 'inscripciones', 'clientTransactionId', clientTxId);
}
async function buscarUsuario(env, token, email) {
  return consultar(env, token, 'usuarios', 'email', email);
}
async function marcarInscripcion(env, clientTxId, campos) {
  const token = await tokenFirestore(env);
  const ins = await buscarInscripcion(env, token, clientTxId);
  if (ins) await actualizarDoc(env, token, 'inscripciones/' + ins.id, campos);
}
async function buscarAdmin(env, token) {
  return consultar(env, token, 'usuarios', 'rol', 'Administrador');
}

/* =====================================================================
   ENVÍO DE CORREOS (MailerSend)
   ---------------------------------------------------------------------
   Le mandamos al estudiante sus credenciales de acceso en 3 momentos:
     - Pagó en línea (PayPhone)  → desde /payphone/confirm (servidor).
     - El admin aprueba un pago  → desde /email/credenciales.
     - El admin cambia la clave  → desde /email/credenciales.
   El token de MailerSend es SECRETO y vive solo aquí (nunca en el navegador).
   ===================================================================== */

// Envía un correo con MailerSend. Requiere el secreto MAILERSEND_TOKEN.
async function enviarCorreo(env, m) {
  if (!env.MAILERSEND_TOKEN) throw new Error('Falta el secreto MAILERSEND_TOKEN');
  const remitente = env.CORREO_REMITENTE || 'soporte@estrategiumbusiness.com';
  const payload = {
    from: { email: remitente, name: 'Estrategium Business' },
    to: [{ email: m.to, name: m.nombre || m.to }],
    subject: m.subject,
    html: m.html,
    text: m.text,
  };
  // "Responder a": al contestar el correo, la respuesta va al visitante que escribió.
  if (m.replyTo) payload.reply_to = { email: m.replyTo };
  const r = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.MAILERSEND_TOKEN,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(payload),
  });
  // MailerSend responde 202 (Accepted) cuando encola el correo correctamente.
  if (!r.ok) throw new Error('MailerSend rechazó el envío (' + r.status + '): ' + (await r.text()));
  return true;
}

// Construye y envía el correo de credenciales según el momento (pago/aprobado o clave nueva).
async function correoCredenciales(env, info) {
  const loginUrl = (env.SITE_URL || 'https://www.estrategiumbusiness.com') + '/login-estudiantes.html';
  const nombre = info.nombre || info.email;
  const tieneClave = !!(info.clave && String(info.clave).trim());

  let subject, titulo, intro;
  if (info.tipo === 'clave') {
    subject = 'Tu contraseña de Estrategium Business fue actualizada';
    titulo = 'Actualizamos tu contraseña';
    intro = 'Tu contraseña de acceso fue actualizada. Estos son tus datos para ingresar:';
  } else {
    subject = '¡Bienvenido a Estrategium Business! Tu acceso ya está activo';
    titulo = '¡Tu acceso está listo!';
    intro = 'Tu pago fue confirmado y tu acceso ya está activo' +
      (info.curso ? ' para el curso <b>' + escHtml(info.curso) + '</b>' : '') +
      '. Estos son tus datos para ingresar:';
  }

  const filaClave = tieneClave
    ? '<tr><td style="padding:6px 0;color:#555;">Contraseña:</td><td style="padding:6px 0;font-weight:700;color:#111;">' + escHtml(info.clave) + '</td></tr>'
    : '';
  const notaSinClave = tieneClave ? ''
    : '<p style="margin:14px 0 0;color:#555;font-size:14px;">Ingresa con el mismo correo y la contraseña que elegiste al registrarte (o con el botón <b>Continuar con Google</b>).</p>';

  const html =
    '<div style="background:#f4f5f7;padding:28px 0;font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ec;">' +
        '<div style="background:#0f172a;padding:22px 28px;">' +
          '<div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:1px;">ESTRATEGIUM</div>' +
          '<div style="color:#9fb0d0;font-size:12px;letter-spacing:3px;">BUSINESS</div>' +
        '</div>' +
        '<div style="padding:28px;">' +
          '<h1 style="margin:0 0 12px;font-size:20px;color:#111;">' + escHtml(titulo) + '</h1>' +
          '<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.5;">Hola ' + escHtml(nombre) + ', ' + intro + '</p>' +
          '<table style="width:100%;border-collapse:collapse;background:#f7f9fc;border-radius:8px;padding:10px;">' +
            '<tr><td style="padding:6px 0 6px 12px;color:#555;">Correo:</td><td style="padding:6px 12px 6px 0;font-weight:700;color:#111;">' + escHtml(info.email) + '</td></tr>' +
            (tieneClave ? '<tr><td style="padding:6px 0 6px 12px;color:#555;">Contraseña:</td><td style="padding:6px 12px 6px 0;font-weight:700;color:#111;">' + escHtml(info.clave) + '</td></tr>' : '') +
          '</table>' +
          notaSinClave +
          '<div style="text-align:center;margin:26px 0 8px;">' +
            '<a href="' + loginUrl + '" style="background:#c9a227;color:#111;text-decoration:none;font-weight:700;padding:12px 26px;border-radius:8px;display:inline-block;">Ingresar a mis cursos</a>' +
          '</div>' +
          '<p style="margin:18px 0 0;color:#888;font-size:12px;line-height:1.5;">Si no reconoces este mensaje, ignóralo o escríbenos a soporte@estrategiumbusiness.com.</p>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:center;color:#9aa4b2;font-size:12px;margin-top:16px;">© 2026 Estrategium Business</div>' +
    '</div>';

  const text =
    'Hola ' + nombre + ',\n\n' +
    (info.tipo === 'clave' ? 'Tu contraseña de acceso fue actualizada.' : 'Tu pago fue confirmado y tu acceso ya está activo' + (info.curso ? ' para el curso ' + info.curso : '') + '.') + '\n\n' +
    'Datos para ingresar:\n' +
    'Correo: ' + info.email + '\n' +
    (tieneClave ? 'Contraseña: ' + info.clave + '\n' : 'Ingresa con la contraseña que elegiste al registrarte (o con Continuar con Google).\n') +
    '\nIngresa aquí: ' + loginUrl + '\n\n© 2026 Estrategium Business';

  return enviarCorreo(env, { to: info.email, nombre: nombre, subject: subject, html: html, text: text });
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* ---------------------------------------------------------------------
   Endpoint PROTEGIDO: /email/credenciales
   Lo llama el PANEL DE ADMIN (navegador) para enviarle al estudiante sus
   credenciales cuando el admin APRUEBA un pago o CAMBIA una clave.
   Como el navegador no puede tener el token de MailerSend, aquí verificamos
   que quien pide es EL ADMINISTRADOR de verdad: comprobamos el ID token de
   Firebase que envía el navegador (firma real de Google) y que ese correo
   sea el del Administrador en Firestore. Nadie más puede disparar correos.
   --------------------------------------------------------------------- */
async function enviarCredencialesAdmin(request, env) {
  const d = await request.json().catch(() => ({}));

  let payload;
  try {
    payload = await verificarIdToken(env, d.idToken);
  } catch (e) {
    return json({ error: 'No autorizado: ' + (e && e.message || e) }, 401);
  }

  const emailToken = (payload.email || '').toLowerCase();
  const token = await tokenFirestore(env);
  const admin = await buscarAdmin(env, token);
  if (!admin || (admin.email || '').toLowerCase() !== emailToken) {
    return json({ error: 'Solo el administrador puede enviar credenciales.' }, 403);
  }

  const email = (d.email || '').toLowerCase();
  if (!email) return json({ error: 'Falta el correo del estudiante' }, 400);

  await correoCredenciales(env, {
    tipo: d.tipo === 'clave' ? 'clave' : 'aprobado',
    nombre: d.nombre || email,
    email: email,
    clave: d.clave || '',
    curso: d.curso || '',
  });
  return json({ ok: true });
}

/* --------- Verificación del ID token de Firebase (sin SDK) ---------
   Firebase firma los ID tokens con RS256. Google publica las claves
   públicas en formato JWK; con ellas verificamos la firma y las fechas.
   Así confirmamos que el token es auténtico y no fue falsificado.
   ------------------------------------------------------------------- */
let cacheJwks = null; // { keys, expira }

async function clavesFirebase() {
  if (cacheJwks && cacheJwks.expira > Date.now()) return cacheJwks.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const d = await r.json();
  const keys = {};
  (d.keys || []).forEach(function (k) { keys[k.kid] = k; });
  cacheJwks = { keys: keys, expira: Date.now() + 3600 * 1000 };
  return keys;
}

async function verificarIdToken(env, idToken) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw new Error('token mal formado');

  const header = jsonDeB64url(partes[0]);
  const payload = jsonDeB64url(partes[1]);
  const proj = env.FIREBASE_PROJECT_ID;
  const ahora = Math.floor(Date.now() / 1000);

  if (payload.aud !== proj) throw new Error('proyecto incorrecto');
  if (payload.iss !== 'https://securetoken.google.com/' + proj) throw new Error('emisor incorrecto');
  if (!payload.exp || payload.exp < ahora) throw new Error('token expirado');
  if (!payload.sub) throw new Error('sin usuario');

  const keys = await clavesFirebase();
  const jwk = keys[header.kid];
  if (!jwk) throw new Error('clave de firma no encontrada');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const firmado = new TextEncoder().encode(partes[0] + '.' + partes[1]);
  const firma = bytesDeB64url(partes[2]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, firma, firmado);
  if (!ok) throw new Error('firma inválida');

  return payload;
}

function bytesDeB64url(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function jsonDeB64url(s) {
  return JSON.parse(new TextDecoder().decode(bytesDeB64url(s)));
}
