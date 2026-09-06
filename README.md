# RolaElQuiz — Quiz musical con Spotify, gratis y multijugador remoto

Juego para adivinar canciones: el anfitrión conecta su Spotify, elige
sus "Me Gusta" o una playlist (incluyendo un Blend), y crea una sala.
Cada amigo entra desde su propia compu/celular con un código de 5
letras, y todos escuchan el fragmento y responden opción múltiple al
mismo tiempo, aunque estén en países distintos.

No requiere Spotify Premium para nadie ni cobra nada: el audio de
cada fragmento sale gratis de la API pública de iTunes (clips de 30
segundos); Spotify solo se usa para leer las canciones del anfitrión.
La sincronización entre pantallas usa Firebase Realtime Database
(plan gratuito).

## Paso 1: crear tu app de Spotify (una sola vez, gratis)

1. Entra a https://developer.spotify.com/dashboard y accede con tu
   cuenta de Spotify.
2. Haz clic en "Create app".
3. Ponle el nombre que quieras (ej. "RolaElQuiz").
4. En **Redirect URIs** escribe la URL exacta donde vas a publicar
   esta app (la de Netlify, ver Paso 3). Debe coincidir letra por
   letra, incluyendo la barra final si la tiene.
5. Marca la casilla de "Web API".
6. Guarda y entra a la app creada. Copia el **Client ID**.
7. Si algún amigo también va a ser anfitrión con SU PROPIA cuenta de
   Spotify (no solo unirse como jugador), ve a **Settings → User
   Management** y agrega su correo ahí — las apps nuevas de Spotify
   quedan en "Development mode" y solo dejan entrar a las cuentas
   que agregues a mano (Spotify ha ido bajando este límite con el
   tiempo — revisa el número exacto que te muestre tu propio
   dashboard).

## Paso 2: crear tu proyecto de Firebase (una sola vez, gratis)

1. Entra a https://console.firebase.google.com y crea un proyecto
   nuevo (puedes desactivar Google Analytics, no hace falta).
2. En el menú, ve a **Compilación → Realtime Database → Crear base
   de datos**. Elige cualquier ubicación y "Iniciar en modo de
   prueba".
3. Entra a la pestaña **Reglas** de esa base de datos y reemplaza el
   contenido por esto, luego "Publicar":
   ```json
   {
     "rules": {
       "rooms": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```
   Esto deja la sala abierta para que cualquiera con el código pueda
   jugar sin loguearse — está bien para un juego entre amigos (solo
   guarda nombres, puntajes y qué canciones sonaron, nada sensible).
4. Ve a **Configuración del proyecto** (el engranaje) → pestaña
   "Tus apps" → ícono `</>` para crear una app web. Ponle un nombre
   y copia el objeto `firebaseConfig` que te muestra.

## Paso 3: pegar tus credenciales

Abre el archivo `app.js` y reemplaza:

```js
const CLIENT_ID = 'PON_AQUI_TU_CLIENT_ID';
const FIREBASE_CONFIG = {
  apiKey: 'PON_AQUI_TU_API_KEY',
  authDomain: 'PON_AQUI_TU_PROYECTO.firebaseapp.com',
  databaseURL: 'https://PON_AQUI_TU_PROYECTO-default-rtdb.firebaseio.com',
  projectId: 'PON_AQUI_TU_PROYECTO',
};
```

por tu Client ID de Spotify y el `firebaseConfig` real que copiaste.

## Paso 4: publicar en Netlify

1. Ve a https://app.netlify.com y entra a tu cuenta.
2. Arrastra esta carpeta completa al área de "Deploy manually" /
   "Add new site" → "Deploy manually" (o conéctala a tu repo de
   GitHub `RolaElQuiz` para que se actualice sola con cada push).
3. Netlify te da una URL (ej. `https://algo-random.netlify.app/`).
4. Copia esa URL exacta y pégala como Redirect URI en el Paso 1,
   punto 4 (edita la app en el Dashboard de Spotify y agrégala).
5. Abre esa URL — ya puedes jugar.

Si luego le cambias el nombre al sitio en Netlify, recuerda
actualizar también el Redirect URI en el Dashboard de Spotify.

## Cómo se juega

**El anfitrión:**
1. En la pantalla inicial, elige "Soy el anfitrión" → conecta
   Spotify.
2. Elige la fuente: Me Gusta, una playlist (o pega su link
   manualmente), cuántas rondas y qué tan largo es cada fragmento.
3. "Crear sala" — te da un código de 5 letras para compartir.
4. Espera a que tus amigos se unan (los ves aparecer en vivo), luego
   "Empezar partida".
5. En cada ronda ves quién ya respondió y, al terminar el tiempo, la
   respuesta correcta y quién acertó. Dale a "Siguiente canción".
6. Al final: "Jugar otra vez" reparte canciones nuevas en la misma
   sala (tus amigos no necesitan volver a escribir el código), o
   "Nueva configuración" para armar otra sala desde cero.

**Cada amigo (jugador):**
1. Abre el mismo link, elige "Soy jugador".
2. Escribe el código de la sala y su nombre.
3. Cuando el anfitrión empieza, el fragmento suena directo en su
   propio dispositivo y aparecen 4 opciones para tocar — la más
   rápida en marcar bien gana el punto de esa ronda.
4. Si el navegador no deja sonar el audio automáticamente, aparece
   un botón "¿No escuchas nada? Toca aquí".

## Cosas a tener en cuenta

- El inicio de sesión del anfitrión dura ~1 hora; si la partida se
  alarga mucho, puede que tenga que reconectar (y crear una sala
  nueva, ya que el código vive en su navegador).
- No todas las canciones tienen un preview disponible en iTunes — la
  app busca de más para compensar las que no encuentra; hacen falta
  al menos 4 canciones con audio para poder armar las opciones.
- El anfitrión debe mantener la pestaña abierta y en primer plano
  durante la partida — es quien controla el avance de las rondas y
  calcula los puntajes.
- Las reglas de Firebase de arriba dejan la base de datos abierta a
  quien tenga el link del proyecto; no metas ahí ninguna otra cosa
  sensible.
- Usar el "Blend" de Spotify: créalo primero desde la app oficial de
  Spotify con tus amigos, y luego selecciónalo aquí como si fuera
  una playlist normal (aparecerá en tu lista de playlists), o pega
  su link directamente en el campo manual.

## Solución de problemas

**"Error cargando playlists" / mensajes de error al crear la sala**

Ahora aparece el motivo real debajo del mensaje. Las causas más
comunes:

- **Sesión expirada (401):** el token dura ~1 hora. Dale a "Cerrar
  sesión" y vuelve a conectar.
- **Acceso bloqueado (403), la más probable si un amigo se loguea
  como anfitrión con su propia cuenta:** este es el error más
  confuso de Spotify porque **agregar el correo no siempre lo
  arregla de inmediato**. Es un problema conocido y documentado por
  muchos desarrolladores. Antes de rendirte, revisa en este orden:
  1. Que agregaste el **correo exacto** de la cuenta de Spotify de
     esa persona (no su nombre de usuario ni su nombre para
     mostrar) en Dashboard → tu app → **Settings → User Management**.
  2. Que **tu cuenta** (la del dueño de la app) sea **Spotify
     Premium** — Spotify exige esto para que el modo desarrollo
     funcione con otros usuarios además de ti.
  3. Espera unos minutos; si sigue fallando, **quita a la persona de
     la lista y vuélvela a agregar** — a varios desarrolladores esto
     les destrabó el problema.
  4. Asegúrate de que la persona inicie sesión con **esa cuenta
     exacta**: si tiene varias cuentas de Spotify o ya había iniciado
     sesión con otra en el navegador, dale a "Cerrar sesión" en
     nuestra app antes de conectar — eso fuerza el selector de
     cuentas de Spotify para que elija la correcta.
- **Demasiadas solicitudes (429):** espera unos segundos y reintenta.
- **Playlist vacía o sin audio suficiente:** prueba con otra
  playlist; hacen falta al menos 4 canciones con preview.

**"Falta configurar Firebase en app.js"**

No se pegó el `firebaseConfig` real en el Paso 3, o quedó con los
valores de ejemplo `PON_AQUI_TU_...`.

**Le doy a "Unirme" (o a "Empezar partida") y no pasa nada**

Esta versión ya muestra los errores de forma visible (un aviso rojo
arriba de la pantalla) en vez de fallar en silencio, y un indicador
"Conectando con el servidor de sincronización…" que se oculta solo
cuando realmente logra conectar. Si te quedas viendo ese mensaje
(o pasa a "🔴 Sin conexión") más de unos segundos:

- La causa más común es un **bloqueador de anuncios o rastreadores**
  (uBlock Origin, Brave Shields, Privacy Badger, AdGuard, algunos
  antivirus, o el firewall de una red corporativa/universitaria) que
  bloquea el dominio `firebaseio.com` pensando que es un rastreador
  de Google. Pruébalo desactivado para este sitio, o desde otra
  red/datos móviles.
- **Si lo abriste desde un link compartido por WhatsApp, Instagram,
  TikTok o Facebook en el celular**: esas apps abren los links en su
  propio "navegador integrado", que es conocido por romper cosas
  como el audio o el guardado de datos en el celular. Toca los tres
  puntitos (⋮) o el ícono de compartir dentro de esa mini-ventana y
  elige **"Abrir en Chrome"** / **"Abrir en Safari"** / "Abrir en el
  navegador", y prueba desde ahí.
- Si el botón "Empezar partida" aparece sin reaccionar pero no ves
  ningún aviso: revisa si el botón sigue "apagado" — se activa solo
  cuando al menos un amigo logró unirse (lo verás aparecer en la
  lista de la sala de espera). Si nadie logra unirse, revisa primero
  los dos puntos anteriores en el navegador de tus amigos.
- Si acabas de subir una actualización de estos archivos y sigue
  fallando igual que antes, el celular puede estar usando una copia
  vieja guardada en caché: cierra la pestaña por completo (no solo
  "atrás") y ábrela de nuevo, o agrega algo al final del link (como
  `?v=2`) para forzar que cargue la versión más reciente.
