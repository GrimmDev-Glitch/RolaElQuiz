/* =========================================================
   CONFIGURA ESTO ANTES DE USAR LA APP

   1) SPOTIFY (solo lo usa el anfitrión):
      - Crea una app gratis en https://developer.spotify.com/dashboard
      - Copia el "Client ID" y pégalo abajo en CLIENT_ID.
      - En la configuración de tu app de Spotify, agrega como
        Redirect URI la URL exacta donde vayas a publicar esta
        página (ej: https://tu-app.netlify.app/), sin nada extra.
      - Si un amigo va a iniciar sesión también como anfitrión con
        SU PROPIA cuenta, agrégalo en Settings → User Management
        del Dashboard (las apps nuevas quedan en "Development mode").

   2) FIREBASE (sincroniza a todos los jugadores en tiempo real):
      - Crea un proyecto gratis en https://console.firebase.google.com
      - Ve a "Compilación" → "Realtime Database" → "Crear base de
        datos" (elige cualquier región, modo prueba está bien para
        empezar).
      - En las reglas de esa base de datos, pon esto y publica
        (es una app entre amigos, no maneja datos sensibles):
          {
            "rules": { "rooms": { ".read": true, ".write": true } }
          }
      - Ve a "Configuración del proyecto" → en "Tus apps" crea una
        app web (ícono </>) y copia el objeto de configuración que
        te da (apiKey, authDomain, databaseURL, projectId, etc.)
        y pégalo abajo en FIREBASE_CONFIG.
   ========================================================= */
const CLIENT_ID = 'PON_AQUI_TU_CLIENT_ID';
const FIREBASE_CONFIG = {
  apiKey: 'PON_AQUI_TU_API_KEY',
  authDomain: 'PON_AQUI_TU_PROYECTO.firebaseapp.com',
  databaseURL: 'https://PON_AQUI_TU_PROYECTO-default-rtdb.firebaseio.com',
  projectId: 'PON_AQUI_TU_PROYECTO',
};

const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

let accessToken = null;
let selectedSource = 'liked';
let manualPlaylistId = null;
let previewPool = [];
let roundsCount = 10;
let snippetLength = 10;

let db = null;
let serverTimeOffset = 0;
let currentRoomCode = null;
let roomRef = null;
let playerId = null;
let playerName = null;
let hostRoundTimer = null;
let lastPlayedRoundHost = -1;
let lastRenderedRound = -1;
let lastRenderedStatus = null;
let answered = false;
let localSnippetTimer = null;

// ---------- Elementos ----------
const btnRoleHost = document.getElementById('btn-role-host');
const btnRolePlayer = document.getElementById('btn-role-player');
const btnBackRoleLogin = document.getElementById('btn-back-role-login');
const btnBackRolePlayer = document.getElementById('btn-back-role-player');

const btnLogin = document.getElementById('btn-login');
const loginError = document.getElementById('login-error');

const btnLogout = document.getElementById('btn-logout');
const tabs = document.querySelectorAll('.tab');
const playlistSelect = document.getElementById('playlist-select');
const playlistUrlInput = document.getElementById('playlist-url-input');
const btnUsePlaylistUrl = document.getElementById('btn-use-playlist-url');
const playlistUrlStatus = document.getElementById('playlist-url-status');
const roundsSelect = document.getElementById('rounds-select');
const snippetSelect = document.getElementById('snippet-select');
const btnCreateRoom = document.getElementById('btn-create-room');
const setupStatus = document.getElementById('setup-status');

const roomCodeDisplay = document.getElementById('room-code-display');
const hostPlayersList = document.getElementById('host-players-list');
const btnStartGame = document.getElementById('btn-start-game');
const btnCancelRoom = document.getElementById('btn-cancel-room');

const hostRoundCounter = document.getElementById('host-round-counter');
const btnQuitHostGame = document.getElementById('btn-quit-host-game');
const hostDisc = document.getElementById('host-disc');
const hostDiscArt = document.getElementById('host-disc-art');
const hostGameStatus = document.getElementById('host-game-status');
const hostAnswerCount = document.getElementById('host-answer-count');
const hostRevealCard = document.getElementById('host-reveal-card');
const hostRevealTitle = document.getElementById('host-reveal-title');
const hostRevealArtist = document.getElementById('host-reveal-artist');
const btnNextRound = document.getElementById('btn-next-round');
const hostAudioPlayer = document.getElementById('host-audio-player');

const hostResultsList = document.getElementById('host-results-list');
const btnPlayAgainHost = document.getElementById('btn-play-again-host');
const btnNewSetupHost = document.getElementById('btn-new-setup-host');

const joinCodeInput = document.getElementById('join-code-input');
const joinNameInput = document.getElementById('join-name-input');
const btnJoinRoom = document.getElementById('btn-join-room');
const joinError = document.getElementById('join-error');

const playerLobbyList = document.getElementById('player-lobby-list');

const playerRoundCounter = document.getElementById('player-round-counter');
const playerStatusText = document.getElementById('player-status-text');
const btnManualPlay = document.getElementById('btn-manual-play');
const playerAnswerGrid = document.getElementById('player-answer-grid');
const playerReveal = document.getElementById('player-reveal');
const playerRevealBanner = document.getElementById('player-reveal-banner');
const playerRevealArt = document.getElementById('player-reveal-art');
const playerRevealTitle = document.getElementById('player-reveal-title');
const playerRevealArtist = document.getElementById('player-reveal-artist');
const playerScoreText = document.getElementById('player-score-text');
const audioPlayer = document.getElementById('audio-player');

const playerResultsList = document.getElementById('player-results-list');
const btnPlayerBackJoin = document.getElementById('btn-player-back-join');

// ---------- Utilidades ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function getServerNow() {
  return Date.now() + serverTimeOffset;
}
function initFirebase() {
  if (db) return true;
  if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'PON_AQUI_TU_API_KEY') {
    return false;
  }
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.database();
  db.ref('.info/serverTimeOffset').on('value', snap => { serverTimeOffset = snap.val() || 0; });
  return true;
}

// ---------- Login con Spotify (Authorization Code + PKCE) ----------
function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  let text = '';
  randomValues.forEach(v => (text += possible[v % possible.length]));
  return text;
}
async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}
function base64UrlEncode(buffer) {
  let str = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function redirectToSpotify() {
  if (!CLIENT_ID || CLIENT_ID === 'PON_AQUI_TU_CLIENT_ID') {
    loginError.textContent = 'Falta configurar el Client ID de Spotify en app.js.';
    loginError.classList.remove('hidden');
    return;
  }
  const verifier = generateRandomString(64);
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('rq_role', 'host');
  const challenge = base64UrlEncode(await sha256(verifier));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    // Fuerza el selector de cuenta en vez de reusar la última sesión
    // (necesario para "Cerrar sesión" / cambiar de cuenta).
    show_dialog: 'true',
  });
  window.location = `${AUTH_ENDPOINT}?${params.toString()}`;
}
async function handleRedirectIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const errorParam = params.get('error');
  if (errorParam) {
    window.history.replaceState({}, document.title, REDIRECT_URI);
    loginError.textContent = 'Acceso a Spotify cancelado.';
    loginError.classList.remove('hidden');
    return false;
  }
  if (!code) return false;
  const verifier = sessionStorage.getItem('pkce_verifier');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  window.history.replaceState({}, document.title, REDIRECT_URI);
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    if (data.access_token) {
      accessToken = data.access_token;
      return true;
    }
  } catch (e) {
    console.error(e);
  }
  loginError.textContent = 'No se pudo iniciar sesión con Spotify.';
  loginError.classList.remove('hidden');
  return false;
}
function logout() {
  accessToken = null;
  manualPlaylistId = null;
  sessionStorage.removeItem('pkce_verifier');
  playlistUrlInput.value = '';
  playlistUrlStatus.classList.add('hidden');
  loginError.classList.add('hidden');
  showScreen('login');
}

// ---------- Spotify Web API ----------
async function spotifyGet(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = (body && body.error && body.error.message) || '';
    } catch (_) { /* respuesta sin JSON, ignorar */ }
    const err = new Error(detail || ('Spotify API error ' + res.status));
    err.status = res.status;
    throw err;
  }
  return res.json();
}
function describeSpotifyError(e) {
  if (e && e.status === 401) {
    return 'Tu sesión de Spotify expiró. Dale a "Cerrar sesión" y vuelve a conectar.';
  }
  if (e && e.status === 403) {
    return 'Spotify bloqueó el acceso (403). Si tu app está en "Development mode", ve al Dashboard de Spotify → tu app → "User Management" y agrega el correo de esta cuenta como usuario permitido.';
  }
  if (e && e.status === 429) {
    return 'Spotify está limitando las solicitudes (demasiadas seguidas). Espera unos segundos y vuelve a intentar.';
  }
  if (e instanceof TypeError) {
    return 'No se pudo conectar con Spotify (revisa tu internet o si algo está bloqueando la solicitud).';
  }
  return (e && e.message) || 'Ocurrió un error inesperado.';
}
async function fetchAllPages(url) {
  let items = [];
  let next = url;
  while (next) {
    const data = await spotifyGet(next);
    items = items.concat(data.items || []);
    next = data.next;
  }
  return items;
}
async function loadPlaylists() {
  try {
    const items = await fetchAllPages('https://api.spotify.com/v1/me/playlists?limit=50');
    playlistSelect.innerHTML = '';
    if (!items.length) {
      playlistSelect.innerHTML = '<option value="">No se encontraron playlists</option>';
      return;
    }
    items.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.tracks.total})`;
      playlistSelect.appendChild(opt);
    });
  } catch (e) {
    console.error(e);
    playlistSelect.innerHTML = '<option value="">Error cargando playlists</option>';
    setupStatus.textContent = describeSpotifyError(e);
  }
}
// Acepta un link (https://open.spotify.com/playlist/ID?si=...),
// un URI (spotify:playlist:ID) o el ID solo.
function extractPlaylistId(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  let m = raw.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]{10,}$/.test(raw)) return raw;
  return null;
}
btnUsePlaylistUrl.onclick = () => {
  const id = extractPlaylistId(playlistUrlInput.value);
  playlistUrlStatus.classList.remove('hidden');
  if (!id) {
    manualPlaylistId = null;
    playlistUrlStatus.textContent = 'No reconozco ese link. Cópialo desde "Compartir → Copiar link" en Spotify.';
    return;
  }
  manualPlaylistId = id;
  playlistUrlStatus.textContent = 'Playlist lista para usar (se prioriza sobre la lista de arriba).';
};
function normalizeTrack(t) {
  if (!t || !t.id || !t.name) return null;
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map(a => a.name),
    image: t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : '',
  };
}
async function fetchSourcePool() {
  if (selectedSource === 'liked') {
    const items = await fetchAllPages('https://api.spotify.com/v1/me/tracks?limit=50');
    return items.map(i => i.track).filter(Boolean);
  }
  const playlistId = manualPlaylistId || playlistSelect.value;
  const fields = encodeURIComponent('items(track(id,name,artists(name),album(images))),next');
  const items = await fetchAllPages(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=${fields}`
  );
  return items.map(i => i.track).filter(Boolean);
}

// ---------- Preview de audio vía iTunes Search (JSONP) ----------
function itunesSearch(term) {
  return new Promise(resolve => {
    const cbName = 'itunesCb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let done = false;
    const cleanup = () => { delete window[cbName]; script.remove(); };
    window[cbName] = data => {
      if (done) return;
      done = true;
      resolve(data);
      cleanup();
    };
    script.src = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=5&callback=${cbName}`;
    script.onerror = () => { if (!done) { done = true; resolve(null); cleanup(); } };
    document.body.appendChild(script);
    setTimeout(() => { if (!done) { done = true; resolve(null); cleanup(); } }, 6000);
  });
}
async function findPreview(track) {
  const term = `${track.artists[0] || ''} ${track.name}`.trim();
  const data = await itunesSearch(term);
  if (data && data.results) {
    const hit = data.results.find(r => r.previewUrl);
    if (hit) return hit.previewUrl;
  }
  return null;
}

// ---------- Tabs de fuente ----------
tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    selectedSource = tab.dataset.source;
    document.getElementById('source-liked').classList.toggle('active', selectedSource === 'liked');
    document.getElementById('source-playlist').classList.toggle('active', selectedSource === 'playlist');
  };
});

// ---------- Construcción de rondas (multiple choice) ----------
function buildRoundsFromPool() {
  const tracks = shuffle(previewPool).slice(0, roundsCount);
  const rounds = {};
  tracks.forEach((track, i) => {
    const others = previewPool.filter(t => t.id !== track.id && t.name !== track.name);
    let distractors = shuffle(others).slice(0, 3).map(t => t.name);
    while (distractors.length < 3) distractors.push('(otra canción)');
    const options = shuffle([track.name, ...distractors]);
    const correctIndex = options.indexOf(track.name);
    rounds[i] = {
      trackName: track.name,
      trackArtist: track.artists.join(', '),
      trackImage: track.image || '',
      previewUrl: track.previewUrl,
      options,
      correctIndex,
    };
  });
  return rounds;
}
function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin O/0/I/1 para evitar confusiones
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
async function createUniqueRoomCode() {
  for (let i = 0; i < 5; i++) {
    const code = generateRoomCode();
    const snap = await db.ref('rooms/' + code).once('value');
    if (!snap.exists()) return code;
  }
  return generateRoomCode();
}

// ---------- Crear sala (anfitrión) ----------
btnCreateRoom.onclick = async () => {
  if (!initFirebase()) {
    setupStatus.textContent = 'Falta configurar Firebase en app.js (ver instrucciones arriba del archivo).';
    return;
  }
  if (selectedSource === 'playlist' && !manualPlaylistId && !playlistSelect.value) {
    setupStatus.textContent = 'Elige una playlist o pega un link.';
    return;
  }
  btnCreateRoom.disabled = true;
  roundsCount = parseInt(roundsSelect.value, 10);
  snippetLength = parseInt(snippetSelect.value, 10);
  try {
    setupStatus.textContent = 'Cargando tus canciones…';
    const rawPool = await fetchSourcePool();
    let normalized = rawPool.map(normalizeTrack).filter(Boolean);
    const seen = new Set();
    normalized = normalized.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    if (normalized.length < 4) {
      throw new Error('Necesitas al menos 4 canciones distintas para armar las opciones de respuesta.');
    }
    normalized = shuffle(normalized);

    const target = Math.max(roundsCount * 2, Math.min(normalized.length, 30));
    previewPool = [];
    setupStatus.textContent = `Buscando audio: 0/${target}`;
    for (const track of normalized) {
      if (previewPool.length >= target) break;
      const url = await findPreview(track);
      if (url) {
        previewPool.push({ ...track, previewUrl: url });
        setupStatus.textContent = `Buscando audio: ${previewPool.length}/${target}`;
      }
    }
    if (previewPool.length < 4) {
      setupStatus.textContent = 'No se encontró suficiente audio (mínimo 4 canciones). Prueba con otra playlist.';
      return;
    }
    if (previewPool.length < roundsCount) roundsCount = previewPool.length;

    setupStatus.textContent = 'Creando sala…';
    currentRoomCode = await createUniqueRoomCode();
    const rounds = buildRoundsFromPool();
    roomRef = db.ref('rooms/' + currentRoomCode);
    await roomRef.set({
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      status: 'lobby',
      currentRound: 0,
      settings: { roundsCount, snippetLength },
      rounds,
      players: {},
    });
    setupStatus.textContent = '';
    listenAsHost();
    showScreen('host-lobby');
  } catch (e) {
    console.error(e);
    setupStatus.textContent = describeSpotifyError(e);
  } finally {
    btnCreateRoom.disabled = false;
  }
};

// ---------- Anfitrión: escuchar la sala ----------
function renderHostPlayerList(players) {
  hostPlayersList.innerHTML = '';
  const names = Object.values(players || {});
  if (!names.length) {
    hostPlayersList.innerHTML = '<p class="hint">Todavía no se une nadie…</p>';
  } else {
    names.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = `${p.name} — ${p.score || 0} pts`;
      hostPlayersList.appendChild(chip);
    });
  }
  btnStartGame.disabled = names.length === 0;
}
function renderHostGame(room) {
  showScreen('host-game');
  const idx = room.currentRound || 0;
  const round = room.rounds[idx];
  hostRoundCounter.textContent = `Ronda ${idx + 1}/${room.settings.roundsCount}`;
  const totalPlayers = Object.keys(room.players || {}).length;
  const answers = round.answers || {};
  const answeredCount = Object.keys(answers).length;

  if (room.status === 'playing') {
    hostDisc.classList.add('spinning');
    hostDiscArt.classList.add('hidden');
    hostGameStatus.textContent = '🔊 Sonando en el celular/compu de cada jugador…';
    hostAnswerCount.textContent = `${answeredCount}/${totalPlayers} ya respondieron`;
    hostRevealCard.classList.add('hidden');
    btnNextRound.classList.add('hidden');
    if (lastPlayedRoundHost !== idx) {
      lastPlayedRoundHost = idx;
      const delay = Math.max(0, room.playAt - getServerNow());
      hostAudioPlayer.src = round.previewUrl;
      setTimeout(() => { hostAudioPlayer.currentTime = 0; hostAudioPlayer.play().catch(() => {}); }, delay);
      setTimeout(() => { hostAudioPlayer.pause(); }, delay + snippetLengthFromRoom(room) * 1000);
    }
  } else if (room.status === 'reveal') {
    hostDisc.classList.remove('spinning');
    hostAudioPlayer.pause();
    if (round.trackImage) { hostDiscArt.src = round.trackImage; hostDiscArt.classList.remove('hidden'); }
    hostGameStatus.textContent = '';
    hostAnswerCount.textContent = `${answeredCount}/${totalPlayers} respondieron esta ronda`;
    hostRevealTitle.textContent = round.trackName;
    hostRevealArtist.textContent = round.trackArtist;
    hostRevealCard.classList.remove('hidden');
    btnNextRound.classList.remove('hidden');
    btnNextRound.textContent = (idx + 1 >= room.settings.roundsCount) ? 'Ver resultados' : 'Siguiente canción';
  }
}
function snippetLengthFromRoom(room) {
  return (room.settings && room.settings.snippetLength) || snippetLength;
}
function renderHostResults(room) {
  const players = room.players || {};
  const sorted = Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0));
  const topScore = sorted.length ? (sorted[0].score || 0) : 0;
  hostResultsList.innerHTML = '';
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'result-row' + ((p.score || 0) === topScore && topScore > 0 ? ' winner' : '');
    row.innerHTML = `<span class="name">${escapeHtml(p.name)}</span><span class="score">${p.score || 0}</span>`;
    hostResultsList.appendChild(row);
  });
}
function listenAsHost() {
  roomCodeDisplay.textContent = currentRoomCode;
  lastPlayedRoundHost = -1;
  roomRef.on('value', snap => {
    const room = snap.val();
    if (!room) return;
    if (room.status === 'lobby') {
      renderHostPlayerList(room.players || {});
      if (!document.getElementById('screen-host-lobby').classList.contains('active') &&
          !document.getElementById('screen-host-game').classList.contains('active')) {
        showScreen('host-lobby');
      }
      if (document.getElementById('screen-host-results').classList.contains('active')) {
        showScreen('host-lobby');
      }
    } else if (room.status === 'playing' || room.status === 'reveal') {
      renderHostGame(room);
    } else if (room.status === 'finished') {
      renderHostResults(room);
      showScreen('host-results');
    }
  });
}
btnStartGame.onclick = () => startRound(0);
async function startRound(index) {
  const playAt = getServerNow() + 3000;
  await roomRef.update({ status: 'playing', currentRound: index, playAt });
  scheduleFinalize(index, playAt);
}
function scheduleFinalize(index, playAt) {
  clearTimeout(hostRoundTimer);
  const delay = Math.max(0, playAt - getServerNow()) + snippetLength * 1000 + 600;
  hostRoundTimer = setTimeout(() => finalizeRound(index), delay);
}
async function finalizeRound(index) {
  try {
    const answersSnap = await roomRef.child('rounds/' + index + '/answers').once('value');
    const answers = answersSnap.val() || {};
    const playersSnap = await roomRef.child('players').once('value');
    const playersVal = playersSnap.val() || {};
    const updates = {};
    Object.entries(answers).forEach(([pid, a]) => {
      if (a && a.correct) {
        const cur = (playersVal[pid] && playersVal[pid].score) || 0;
        updates['players/' + pid + '/score'] = cur + 1;
      }
    });
    updates['status'] = 'reveal';
    await roomRef.update(updates);
  } catch (e) {
    console.error(e);
  }
}
btnNextRound.onclick = async () => {
  btnNextRound.disabled = true;
  try {
    const snap = await roomRef.once('value');
    const room = snap.val();
    const next = (room.currentRound || 0) + 1;
    if (next >= room.settings.roundsCount) {
      await roomRef.update({ status: 'finished' });
    } else {
      await startRound(next);
    }
  } finally {
    btnNextRound.disabled = false;
  }
};
btnQuitHostGame.onclick = async () => {
  clearTimeout(hostRoundTimer);
  hostAudioPlayer.pause();
  if (roomRef) await roomRef.update({ status: 'finished' });
};
btnCancelRoom.onclick = () => {
  if (roomRef) roomRef.off();
  currentRoomCode = null;
  roomRef = null;
  showScreen('host-setup');
};
btnPlayAgainHost.onclick = async () => {
  btnPlayAgainHost.disabled = true;
  try {
    const rounds = buildRoundsFromPool();
    const playersSnap = await roomRef.child('players').once('value');
    const playersVal = playersSnap.val() || {};
    const resetPlayers = {};
    Object.keys(playersVal).forEach(pid => { resetPlayers[pid] = { ...playersVal[pid], score: 0 }; });
    lastPlayedRoundHost = -1;
    await roomRef.update({ rounds, players: resetPlayers, status: 'lobby', currentRound: 0, playAt: null });
    showScreen('host-lobby');
  } finally {
    btnPlayAgainHost.disabled = false;
  }
};
btnNewSetupHost.onclick = () => {
  if (roomRef) roomRef.off();
  currentRoomCode = null;
  roomRef = null;
  showScreen('host-setup');
};

// ---------- Jugador: unirse ----------
btnJoinRoom.onclick = async () => {
  if (!initFirebase()) {
    joinError.textContent = 'Falta configurar Firebase en app.js.';
    joinError.classList.remove('hidden');
    return;
  }
  const code = (joinCodeInput.value || '').trim().toUpperCase();
  const name = (joinNameInput.value || '').trim().slice(0, 20);
  joinError.classList.add('hidden');
  if (!code || !name) {
    joinError.textContent = 'Escribe tu nombre y el código de la sala.';
    joinError.classList.remove('hidden');
    return;
  }
  // Desbloquea el audio para reproducir más tarde sin otro clic
  // (los navegadores exigen un gesto del usuario para permitir audio).
  try {
    audioPlayer.muted = true;
    await audioPlayer.play().catch(() => {});
    audioPlayer.pause();
  } finally {
    audioPlayer.muted = false;
  }
  btnJoinRoom.disabled = true;
  try {
    const snap = await db.ref('rooms/' + code).once('value');
    if (!snap.exists()) {
      joinError.textContent = 'No existe una sala con ese código.';
      joinError.classList.remove('hidden');
      return;
    }
    currentRoomCode = code;
    playerName = name;
    playerId = sessionStorage.getItem('rq_player_id_' + code) || ('p_' + Math.random().toString(36).slice(2, 10));
    sessionStorage.setItem('rq_player_id_' + code, playerId);
    roomRef = db.ref('rooms/' + code);
    await roomRef.child('players/' + playerId).update({
      name: playerName,
      score: (snap.val().players && snap.val().players[playerId] && snap.val().players[playerId].score) || 0,
      joinedAt: firebase.database.ServerValue.TIMESTAMP,
    });
    lastRenderedRound = -1;
    lastRenderedStatus = null;
    listenAsPlayer();
  } catch (e) {
    console.error(e);
    joinError.textContent = 'No se pudo unir a la sala. Revisa tu conexión.';
    joinError.classList.remove('hidden');
  } finally {
    btnJoinRoom.disabled = false;
  }
};

// ---------- Jugador: escuchar la sala ----------
function renderPlayerLobby(players) {
  playerLobbyList.innerHTML = '';
  Object.values(players || {}).forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = p.name;
    playerLobbyList.appendChild(chip);
  });
}
function setupPlayerRound(room, index) {
  answered = false;
  const round = room.rounds[index];
  playerRoundCounter.textContent = `Ronda ${index + 1}/${room.settings.roundsCount}`;
  playerReveal.classList.add('hidden');
  playerAnswerGrid.classList.remove('hidden');
  playerAnswerGrid.innerHTML = '';
  btnManualPlay.classList.add('hidden');
  playerStatusText.textContent = 'Prepárate…';

  round.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = opt;
    btn.onclick = () => submitAnswer(index, i, round.correctIndex, btn);
    playerAnswerGrid.appendChild(btn);
  });

  audioPlayer.src = round.previewUrl;
  audioPlayer.load();
  btnManualPlay.onclick = () => { audioPlayer.play().catch(() => {}); };

  const snippetSecs = snippetLengthFromRoom(room);
  const delay = Math.max(0, room.playAt - getServerNow());
  clearTimeout(localSnippetTimer);
  setTimeout(() => {
    playerStatusText.textContent = '🔊 ¡Escucha con atención!';
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => { btnManualPlay.classList.remove('hidden'); });
    localSnippetTimer = setTimeout(() => {
      audioPlayer.pause();
      lockAnswerButtons();
      if (!answered) playerStatusText.textContent = 'Tiempo agotado, esperando al anfitrión…';
    }, snippetSecs * 1000);
  }, delay);
}
function lockAnswerButtons(selectedIndex) {
  const buttons = playerAnswerGrid.querySelectorAll('.answer-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === selectedIndex) b.classList.add('selected');
  });
}
function submitAnswer(index, optionIndex, correctIndex, btnEl) {
  if (answered) return;
  answered = true;
  lockAnswerButtons(optionIndex);
  playerStatusText.textContent = 'Respuesta enviada. Esperando a los demás…';
  const correct = optionIndex === correctIndex;
  roomRef.child(`rounds/${index}/answers/${playerId}`).set({ optionIndex, correct, name: playerName });
}
function showPlayerReveal(room, index) {
  const round = room.rounds[index];
  playerAnswerGrid.classList.add('hidden');
  playerReveal.classList.remove('hidden');
  const myAnswer = round.answers && round.answers[playerId];
  const gotIt = myAnswer && myAnswer.correct;
  playerRevealBanner.textContent = gotIt ? '✅ ¡Correcto!' : (myAnswer ? '❌ Fallaste' : '⌛ No respondiste a tiempo');
  playerRevealTitle.textContent = round.trackName;
  playerRevealArtist.textContent = round.trackArtist;
  if (round.trackImage) {
    playerRevealArt.src = round.trackImage;
    playerRevealArt.classList.remove('hidden');
  } else {
    playerRevealArt.classList.add('hidden');
  }
  const myScore = (room.players[playerId] && room.players[playerId].score) || 0;
  playerScoreText.textContent = `Tu puntaje: ${myScore}`;
}
function renderPlayerResults(room) {
  const players = room.players || {};
  const sorted = Object.entries(players).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  const topScore = sorted.length ? (sorted[0][1].score || 0) : 0;
  playerResultsList.innerHTML = '';
  sorted.forEach(([pid, p]) => {
    const row = document.createElement('div');
    let cls = 'result-row';
    if ((p.score || 0) === topScore && topScore > 0) cls += ' winner';
    row.className = cls;
    const isMe = pid === playerId ? ' (tú)' : '';
    row.innerHTML = `<span class="name">${escapeHtml(p.name)}${isMe}</span><span class="score">${p.score || 0}</span>`;
    playerResultsList.appendChild(row);
  });
}
function listenAsPlayer() {
  showScreen('player-lobby');
  roomRef.on('value', snap => {
    const room = snap.val();
    if (!room) return;
    if (room.status === 'lobby') {
      renderPlayerLobby(room.players || {});
      showScreen('player-lobby');
      lastRenderedRound = -1;
      lastRenderedStatus = 'lobby';
    } else if (room.status === 'playing') {
      showScreen('player-game');
      if (room.currentRound !== lastRenderedRound || lastRenderedStatus !== 'playing') {
        setupPlayerRound(room, room.currentRound);
        lastRenderedRound = room.currentRound;
      }
      lastRenderedStatus = 'playing';
    } else if (room.status === 'reveal') {
      showScreen('player-game');
      if (lastRenderedStatus !== 'reveal') {
        showPlayerReveal(room, room.currentRound);
      }
      lastRenderedStatus = 'reveal';
    } else if (room.status === 'finished') {
      renderPlayerResults(room);
      showScreen('player-results');
      lastRenderedStatus = 'finished';
    }
  });
}
btnPlayerBackJoin.onclick = () => {
  if (roomRef) roomRef.off();
  roomRef = null;
  currentRoomCode = null;
  showScreen('player-join');
};

// ---------- Navegación de rol ----------
btnRoleHost.onclick = () => showScreen('login');
btnRolePlayer.onclick = () => { initFirebase(); showScreen('player-join'); };
btnBackRoleLogin.onclick = () => showScreen('role');
btnBackRolePlayer.onclick = () => showScreen('role');

// ---------- Arranque ----------
btnLogin.onclick = redirectToSpotify;
btnLogout.onclick = logout;
(async function init() {
  initFirebase();
  const wasHostLogin = sessionStorage.getItem('rq_role') === 'host';
  const loggedIn = wasHostLogin ? await handleRedirectIfPresent() : false;
  if (loggedIn) {
    showScreen('host-setup');
    loadPlaylists();
  } else {
    showScreen('role');
  }
})();
