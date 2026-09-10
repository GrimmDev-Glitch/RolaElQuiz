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

## ⚠️ Requisito importante desde 2026: Spotify Premium para el anfitrión

Spotify cambió las reglas de las apps en "modo desarrollo" en 2026:
**la cuenta con la que creas la app (la del anfitrión) necesita tener
Spotify Premium activo**. Sin eso, TODAS las llamadas a la API fallan
con error 403 — incluso algo tan básico como listar tus propias
playlists. Si vas a probar esto y no tienes Premium, es la primera
causa a descartar antes que cualquier otra cosa de las de abajo.

Además, desde ese mismo cambio, Spotify **solo permite leer las
canciones de playlists que sean tuyas o donde colabores** — ya no
importa si son públicas o no. El "Extended Quota Mode" que sí deja
leer la playlist de cualquiera ahora exige ser una empresa registrada
con 250,000 usuarios activos al mes, así que no es una opción real
para un proyecto entre amigos. Por eso el buscador de playlists de
esta app (que te ayuda a encontrarlas por nombre) deja claro que solo
vas a poder usar el resultado si es tuya o si te agregan como
colaborador — no hay forma de rodear esta regla de Spotify con código.
Ni siquiera usando un método de autenticación distinto (como "Client
Credentials", sin login de usuario): en el foro oficial de
desarrolladores de Spotify alguien probó exactamente eso y la
respuesta fue "necesitas 250,000 usuarios, no es broma" — confirmado,
no hay atajo técnico posible para una app pequeña.

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
   propio dispositivo (con control de volumen y un contador de
   tiempo) y aparecen 4 opciones para tocar.
4. Si el navegador no deja sonar el audio automáticamente, aparece
   un botón "¿No escuchas nada? Toca aquí".
5. Al terminar cada ronda ve si acertó, cuántos puntos ganó y el
   leaderboard. Puede quedarse en la sala entre partidas — no hace
   falta volver a escribir el código si el anfitrión da "Jugar otra
   vez"; para irse de verdad está el botón "Salir de la sala".

## Modos de juego

Al preparar la sala puedes elegir entre cuatro modos:

- **Normal** — puntos por velocidad, como se explica abajo (100 a 50).
- **Muerte súbita** — cada ronda vale igual: solo quien acierta
  primero se lleva 1 punto; a nadie más le suma esa ronda, aunque
  también haya acertado. Si al final del juego dos o más quedan
  empatados en primer lugar, se juega automáticamente una ronda
  extra SOLO entre los empatados para desempatar (quien acierte
  primero ahí, gana).
- **Progresivo** — cada canción empieza sonando solo 1 segundo. Si no
  la reconoces todavía, cada jugador tiene su propio botón "Escuchar
  más" para que le suene un poco más — pero entre más escuchas, menos
  vale acertar:

  | Escuchaste hasta... | Vale si aciertas |
  |---|---|
  | 1 segundo | 100 pts |
  | 3 segundos | 80 pts |
  | 6 segundos | 60 pts |
  | 10 segundos | 40 pts |
  | 15 segundos | 20 pts |

  Cada jugador avanza a su propio ritmo — no está sincronizado como
  en los otros modos. La portada del álbum también se ve borrosa al
  principio y se va aclarando con cada "Escuchar más", como pista
  visual extra. Después de la última etapa (15s) se deja sonar el
  resto del fragmento completo en vez de cortarlo en seco, por si
  todavía no la reconoces. También hay un botón "▶ Escuchar de
  nuevo" para repetir el fragmento actual sin avanzar de etapa (no
  baja los puntos, solo te deja volver a oír lo mismo).
- **Eliminación** — puntaje normal por velocidad, pero cada cierto
  número de rondas (elegible: cada 2, 3 o 4) el jugador con menos
  puntos entre los que siguen en pie queda eliminado — puede seguir
  viendo la partida, pero ya no responde. Si hay empate en último
  lugar, quedan eliminados todos los empatados (a menos que eso
  dejara la sala sin nadie). Gana quien quede de último en pie, o
  quien tenga más puntos cuando se acaben las rondas.
- **Apuesta doble o nada** — antes de responder cada ronda, cada
  jugador puede apostar. Si apuestas y aciertas, te llevas el
  DOBLE de los puntos de esa ronda; si apuestas y fallas, pierdes
  100 puntos de tu marcador (nunca baja de 0). No apostar es la
  opción seguro-de-siempre, con el puntaje normal por velocidad.
- **Contrarreloj** — todos corren contra el mismo reloj (elegible:
  30/60/90/120 segundos). Cada jugador escucha canciones una tras
  otra a su propio ritmo (6 segundos cada una, opción múltiple) y
  suma un acierto por cada una que adivine bien — no espera a los
  demás. Gana quien más adivine antes de que se acabe el tiempo. El
  anfitrión ve un leaderboard en vivo mientras todos juegan a la vez.
- **Supervivencia** — empiezas con un reloj corto (elegible: 10/15/20
  segundos) que no para de bajar. Cada acierto te suma segundos
  (elegible: 3/5/7) para seguir con vida; en cuanto el reloj llega a
  cero, se acabó tu partida — pero puedes seguir viendo cómo les va a
  los demás. Como cada quien aguanta un tiempo distinto, el anfitrión
  termina la partida cuando quiera con el botón "Terminar" para ver
  los resultados finales.
- **Solo** — para practicar sin crear una sala ni necesitar amigos:
  eliges tu fuente de canciones normal, le das "Empezar a practicar"
  y juegas tú mismo desde el mismo dispositivo, viendo tu puntaje al
  final. No usa Firebase para nada, así que funciona incluso sin
  configurar ese paso. (Los modos Progresivo, Eliminación, Apuesta,
  Contrarreloj y Supervivencia todavía no están disponibles en
  solitario, solo en salas con
  amigos — ahí no tendría con quién competir.)

## Otras mejoras

- **Racha de aciertos** 🔥 — si vas encadenando respuestas correctas,
  tu nombre muestra "🔥N" en el leaderboard.
- **Emoji por jugador** — cada quien recibe un emoji al azar al
  unirse (se mantiene igual si recarga o vuelve a entrar), para
  identificarse rápido a simple vista.
- **Datos curiosos al final** — la pantalla de resultados agrega
  automáticamente cosas como la ronda que se resolvió más rápido, la
  canción que nadie adivinó, y quién fue el más veloz en general.
- **Confeti y sonidos** — al ganar la partida cae confeti en pantalla,
  y hay pitidos cortos de acierto/error/avance (generados en el
  propio navegador, no son archivos de audio).
- **Leaderboard animado** — las barras de puntaje se llenan con una
  animación cada vez que se actualiza, como una pequeña carrera.

## Puntaje

Por cada ronda del modo **Normal**, quienes responden correcto se
ordenan por qué tan rápido contestaron (no por tiempo absoluto, sino
por quién fue primero, segundo, tercero...):

| Orden en acertar | Puntos |
|---|---|
| 1º | 100 |
| 2º | 90 |
| 3º | 80 |
| 4º | 70 |
| 5º | 60 |
| 6º en adelante | 50 |

Fallar la respuesta o no alcanzar a responder da 0 puntos esa ronda.
El anfitrión es quien calcula esto al cerrar cada ronda (no cada
jugador por su cuenta), así que no depende de que el reloj de cada
celular esté perfectamente sincronizado.

## Cosas a tener en cuenta

- El inicio de sesión del anfitrión dura ~1 hora; si la partida se
  alarga mucho, puede que tenga que reconectar (y crear una sala
  nueva, ya que el código vive en su navegador).
- No todas las canciones tienen un preview disponible en iTunes — la
  app busca de más para compensar las que no encuentra; hacen falta
  al menos 4 canciones con audio para poder armar las opciones. Desde
  hace poco, además, la app verifica que el título Y el artista del
  resultado de iTunes coincidan de verdad con la canción de Spotify
  antes de usarlo — si no encuentra un artista que coincida, prefiere
  no ponerle audio a esa canción en vez de arriesgarse a poner la de
  otro artista con el mismo título (esto pasaba antes con títulos
  cortos o genéricos, tipo canciones que comparten nombre con algo de
  otro artista mucho más popular).
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

**403 en una playlist que confirmaste que SÍ es tuya (no Blend), tanto
por el link como por el desplegable**

Este es el caso más difícil de diagnosticar porque descarta las
causas obvias (cuenta, Premium, playlist ajena). Con la evidencia que
tengo hasta ahora, sospecho que es un bug del lado de Spotify en su
endpoint nuevo (`/playlists/{id}/items`) — hay bastantes reportes de
otros desarrolladores con problemas similares justo desde la
migración de 2026. Cosas para probar, en orden:

1. Cierra sesión en esta app y vuelve a conectar (renueva el token
   por si acaso).
2. Cambia esa playlist de privada a pública (o viceversa) desde la
   app oficial de Spotify, y vuelve a intentar.
3. Prueba con una playlist nueva, chiquita (2-3 canciones), creada
   desde cero, a ver si el problema es con playlists viejas
   específicamente.
4. Abre las herramientas de desarrollador del navegador (F12 →
   pestaña "Console" o "Network"), repite la acción, y busca la
   respuesta real que da Spotify — a veces trae más detalle del que
   nos deja ver el mensaje genérico "Forbidden".

**"Error cargando playlists" con un mensaje de fallo de conexión, aun
con buen internet, sin extensiones, en incógnito y desde otra red**

Esto es un **bug confirmado del lado de Spotify**, no algo de tu
configuración — ya lo probamos a fondo (Chrome nuevo, incógnito, otra
red, sin VPN/adblock/antivirus) y sigue igual, lo cual apunta
exactamente a esto. Spotify tiene un problema activo con el
"preflight" de CORS de `api.spotify.com`: a veces su servidor responde
al permiso previo que pide el navegador sin los encabezados
necesarios, y el navegador entonces bloquea la solicitud real — se ve
igual que un fallo de red, en cualquier navegador, cualquier red.
Reportado en su foro de desarrolladores en julio de 2026, aún sin
resolver:
https://community.spotify.com/t5/Spotify-for-Developers/api-spotify-com-CORS-preflight-broken/td-p/7508125

Como es intermitente (no le pasa a todas las llamadas, ni todo el
tiempo), la app ahora reintenta hasta 6 veces con más espera entre
cada intento — puede que en otro intento le toque un servidor de
Spotify que sí responda bien. Mientras tanto, el mejor camino es
pegar el link de cada playlist/Blend directamente (Compartir → Copiar
link en la app de Spotify) — esa es una llamada distinta que no
depende de este endpoint en particular.



**"Error cargando playlists" incluso teniendo Spotify Premium**

Si ya confirmaste que la cuenta anfitriona tiene Premium y sigue
fallando, el mensaje ahora aparece justo debajo del selector de
playlists (antes quedaba escondido más abajo, difícil de ver — ya
corregido). Con ese mensaje real a la vista, revisa además:

- **¿La cuenta con la que creaste la app en el Dashboard de Spotify
  es la MISMA con la que te conectas como anfitrión en esta app?**
  Si son cuentas distintas, la segunda cuenta cuenta como "otro
  usuario" y necesita estar en User Management aunque sea tuya
  también.
- **Revoca el acceso y reconecta desde cero:** ve a
  https://www.spotify.com/account/apps/ , busca tu app y dale
  "Quitar acceso", luego vuelve a "Conectar con Spotify" en esta app
  para forzar una autorización nueva con los permisos actuales.
- Confirma que el **Redirect URI** en el Dashboard de Spotify sea
  EXACTAMENTE igual a la URL donde tienes publicada la app (mayúsculas,
  barra final, `https://` — todo debe coincidir letra por letra).



**Creé una playlist y no aparece en la lista desplegable**

Le agregué un botón 🔄 al lado de la lista para recargarla sin tener
que reconectar todo, y un texto que muestra cuántas playlists
encontró. Si sigue sin aparecer:

- Confirma que iniciaste sesión con la cuenta de Spotify donde
  realmente está esa playlist (puede que tengas más de una cuenta).
- Dale a 🔄 — Spotify a veces tarda un poco en reflejar una playlist
  recién creada.
- Como alternativa que siempre funciona: pégala manualmente con su
  link en el campo de abajo del selector.
- Si nada de esto funciona, prueba "Cerrar sesión" y volver a
  conectar — a veces refresca los permisos.


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
- **403 justo al pegar el link de una playlist y darle "Crear
  sala", incluso con TU PROPIA cuenta de anfitrión:** esto es un
  problema distinto al de arriba (el de "User Management" es solo
  quien pueda *iniciar sesión*, no aplica al dueño de la app). Aquí
  la causa casi segura es que **la playlist es privada o no es
  tuya** — Spotify solo deja leer las canciones de playlists
  públicas ajenas, o de cualquiera tuya (privada o pública). Si es
  un Blend, comprueba que su link sea realmente público abriéndolo
  en una ventana de incógnito sin sesión iniciada; si no carga ahí,
  Spotify tampoco lo va a dejar leer por la API. Mejor alternativa:
  elígela directo de la lista desplegable "Mis playlists" en vez de
  pegar el link — esa lista sí incluye tus playlists privadas y
  Blends propios.

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
