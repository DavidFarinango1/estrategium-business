# Estrategium Business — Landing

Sitio web (landing page) para **Estrategium Business**: sistema de fidelización y rentabilidad para restaurantes con el **Método MARCA™**.

## Estructura

```
Estrategium/
├── index.html                 # Página principal (hero + 3 etapas + precios)
├── workshop-marca-start.html  # Página del Workshop MARCA START (Etapa 1)
├── css/
│   └── styles.css             # Estilos compartidos
├── js/
│   └── main.js                # FAQ acordeón + placeholder de video
└── README.md
```

## Cómo verlo en local

No requiere instalación ni compilación. Opciones:

1. **Doble clic** en `index.html` para abrirlo en el navegador.
2. O servirlo con un servidor local (recomendado para rutas y video):
   ```bash
   # Con Python instalado
   python -m http.server 8000
   ```
   Luego abre http://localhost:8000

## Pendientes / personalización

- Reemplazar las imágenes (actualmente usan fotos de Unsplash por URL) por las imágenes oficiales en `assets/`.
- Conectar el botón **WhatsApp** a tu número real: cambia `href="#whatsapp"` por `https://wa.me/NUMERO`.
- Activar el video del workshop pegando el ID de YouTube en `js/main.js`.
- Enlazar los botones de pago (MARCA START $19, MARCA PROFIT $97).

> Proyecto multi-parte: se irá ampliando a medida que lleguen nuevas secciones del diseño.
