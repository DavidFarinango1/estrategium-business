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
  const usuario = await buscarUsuario(env, token, email);
  if (usuario) {
    const cursos = usuario.cursos || [];
    if (!cursos.includes(curso)) cursos.push(curso);
    await actualizarDoc(env, token, 'usuarios/' + usuario.id, {
      cursos: cursos,
      estado: 'Activo',
      clave: usuario.clave || clave,
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

  return redirigir(env, 'ok', '', { curso: curso, email: email, clave: clave });
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
