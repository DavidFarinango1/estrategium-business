# Servidor de pagos PayPhone — Estrategium

Este pequeño servidor (Cloudflare Worker) existe por una razón concreta:
**PayPhone obliga a confirmar el pago desde un servidor, dentro de los 5 minutos
siguientes al cobro.** Si no se confirma a tiempo, PayPhone reversa la transacción
y el dinero vuelve al cliente. Además, el token de PayPhone nunca debe llegar al
navegador: aquí vive seguro.

---

## Qué hace

| Ruta | Quién la llama | Para qué |
|---|---|---|
| `POST /payphone/prepare` | El checkout de la web | Crea la inscripción como *pendiente* y pide a PayPhone el enlace de pago |
| `GET /payphone/confirm` | **PayPhone**, al terminar el pago | Confirma con PayPhone. Si el pago es real, activa el acceso al curso |
| `GET /salud` | Tú, para probar | Responde `{ok:true}` |

La seguridad está en que **solo PayPhone puede decir que un pago fue aprobado**.
El navegador del cliente nunca decide eso, así que no hay nada que falsificar.

---

## Puesta en marcha (una sola vez)

### 1. Credenciales de PayPhone

Entra a **[PayPhone Developer](https://appdeveloper.payphonetodoesposible.com)** con tu
cuenta Business (tu usuario necesita **rol de Desarrollador**; si no lo tienes, pídelo
al soporte de PayPhone).

- Crea una aplicación de tipo **WEB**
- Anota el **Token** y el **StoreId**
- Registra la **URL de respuesta**: la dirección de este Worker + `/payphone/confirm`
  (la sabrás después del paso 3)

### 2. Cuenta de servicio de Firebase

Sirve para que este servidor pueda escribir en la base de datos con permisos de
administrador (activar el curso del estudiante).

1. Consola de Firebase → ⚙️ **Configuración del proyecto** → **Cuentas de servicio**
2. **Generar nueva clave privada** → se descarga un archivo `.json`
3. **Guárdalo bien y NO lo subas a GitHub.** Solo lo usarás en el paso 4.

### 3. Publicar el Worker

```bash
cd worker
npm install
npx wrangler login        # abre el navegador, entra con tu cuenta de Cloudflare
npx wrangler deploy
```

Te dará una dirección HTTPS gratuita, del tipo:

```
https://estrategium-pagos.TU-USUARIO.workers.dev
```

**Esa dirección + `/payphone/confirm` es la URL de respuesta** que debes registrar
en PayPhone (paso 1).

### 4. Cargar los secretos

```bash
npx wrangler secret put PAYPHONE_TOKEN
npx wrangler secret put PAYPHONE_STORE_ID
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT   # pega TODO el contenido del .json
```

Quedan cifrados en Cloudflare. No aparecen en el código ni en GitHub.

### 5. Comprobar que vive

```bash
curl https://estrategium-pagos.TU-USUARIO.workers.dev/salud
# {"ok":true,"servicio":"pagos-estrategium"}
```

---

## Probar en local

**Sí se puede**, y sin ngrok. El truco:

- El Worker vive en internet (`workers.dev`, con HTTPS) → PayPhone lo acepta
- Tu web puede correr en `http://localhost:5050` y llamar al Worker sin problema
- Al terminar el pago, el Worker **redirige el navegador de vuelta a tu local**

Para eso, en `wrangler.toml` cambia:

```toml
SITE_URL = "http://localhost:5050"
```

y vuelve a publicar (`npx wrangler deploy`). Cuando termines de probar, devuélvelo a
`https://estrategium-business.web.app`.

---

## Ver qué está pasando

```bash
npx wrangler tail        # registros en vivo del Worker
```

---

## Ojo con esto

- **Los montos van en centavos.** $49.00 → `4900`. El Worker ya hace la conversión.
- **Los 5 minutos son reales.** Si el cliente cierra el navegador antes de volver,
  PayPhone reversa el cobro. Es el comportamiento correcto: nadie paga por algo que
  no recibió.
- **La transferencia bancaria no pasa por aquí.** Ese flujo sigue igual: el cliente
  sube el comprobante y tú apruebas a mano desde el panel.
