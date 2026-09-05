# Adivina la Canción — Quiz musical con Spotify (gratis)

Juego de fiesta en una sola pantalla: conectas tu Spotify, eliges tus
canciones "Me Gusta" o una playlist (incluyendo una playlist de Blend),
y tus amigos/familia adivinan la canción antes de que se acabe el
fragmento. Tú marcas quién acertó y al final sale el marcador.

No requiere Spotify Premium para nadie, ni cobra nada: el audio de
cada fragmento se obtiene gratis de la API pública de iTunes (clips
de 30 segundos), y Spotify solo se usa para leer tus canciones.

## Paso 1: crear tu app de Spotify (una sola vez, gratis)

1. Entra a https://developer.spotify.com/dashboard y accede con tu
   cuenta de Spotify.
2. Haz clic en "Create app".
3. Ponle el nombre que quieras (ej. "Quiz Rinconcito").
4. En **Redirect URIs** escribe la URL exacta donde vas a publicar
   esta app (la de Netlify, ver Paso 3). Debe coincidir letra por
   letra, incluyendo la barra final si la tiene.
5. Marca la casilla de "Web API".
6. Guarda y entra a la app creada. Copia el **Client ID**.

## Paso 2: pegar tu Client ID

Abre el archivo `app.js` y reemplaza esta línea:

```js
const CLIENT_ID = 'PON_AQUI_TU_CLIENT_ID';
```

por tu Client ID real, entre comillas.

## Paso 3: publicar en Netlify

Igual que hiciste con el cotizador:

1. Ve a https://app.netlify.com y entra a tu cuenta.
2. Arrastra esta carpeta completa (`spotify-quiz`) al área de
   "Deploy manually" / "Add new site" → "Deploy manually".
3. Netlify te da una URL (ej. `https://algo-random.netlify.app/`).
4. Copia esa URL exacta y pégala como Redirect URI en el Paso 1,
   punto 4 (edita la app en el Dashboard de Spotify y agrégala).
5. Abre esa URL — ya puedes jugar.

Si luego le cambias el nombre al sitio en Netlify, recuerda
actualizar también el Redirect URI en el Dashboard de Spotify.

## Cómo se usa

1. "Conectar con Spotify" (solo lo hace quien organiza el juego).
2. Elige la fuente: tus Me Gusta, o una playlist tuya (ahí también
   aparecerá cualquier Blend que hayas creado, se ve como una
   playlist más).
3. Agrega los nombres de los jugadores.
4. Elige cuántas rondas y qué tan largo es cada fragmento.
5. En cada ronda: reproduces el fragmento, tus amigos gritan la
   respuesta, tú marcas quién acertó y pasas a la siguiente.
6. Al final se muestra el marcador con el ganador.

## Cosas a tener en cuenta

- El inicio de sesión dura ~1 hora; si la partida se alarga mucho,
  puede que tengas que volver a conectar.
- No todas las canciones tienen un preview disponible en iTunes —
  la app busca de más para compensar las que no encuentra.
- Usar el "Blend" de Spotify: créalo primero desde la app oficial de
  Spotify con tus amigos, y luego selecciónalo aquí como si fuera
  una playlist normal (aparecerá en tu lista de playlists).
