/* =====================================================================
   CONFIGURACIÓN DE FIREBASE — Estrategium Business
   ---------------------------------------------------------------------
   👉 PEGA AQUÍ los datos de TU proyecto Firebase.
   Cómo obtenerlos:
     1. Entra a  https://console.firebase.google.com
     2. Elige el proyecto "estrategium-business".
     3. ⚙ (arriba a la izquierda) → "Configuración del proyecto".
     4. Baja a "Tus apps". Si no hay una app Web, crea una (icono </>).
     5. Copia el objeto "firebaseConfig" y reemplaza los valores de abajo.

   Además, en la consola de Firebase:
     • Authentication → Sign-in method → activa "Google".
     • Authentication → Settings → Dominios autorizados → agrega
       "localhost" y tu dominio (estrategium-business.web.app).
   ===================================================================== */
/* ----------------------------------------------------------------------
   MODO LOCAL:
   • true  = todo se guarda en ESTE navegador (sin nube, sin Google).
             Ideal para trabajar/probar en tu computadora.
   • false = usa Firebase (Google + Firestore) para compartir entre
             dispositivos. Requiere activar Firestore y Google en la consola.
   ---------------------------------------------------------------------- */
window.MODO_LOCAL = true;

window.firebaseConfig = {
  apiKey: "AIzaSyDErbAnHCCDTV2fo96ZUjBtUN9b5L85YNo",
  authDomain: "estrategium-business.firebaseapp.com",
  projectId: "estrategium-business",
  storageBucket: "estrategium-business.firebasestorage.app",
  messagingSenderId: "1018019313207",
  appId: "1:1018019313207:web:5965bfe19bfc14e6de31b2"
};
