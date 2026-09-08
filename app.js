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
const CLIENT_ID = '0b5042ba77d74d2898f0c229ecffa3ea';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD3TGqbPWtlEU8lRK0PEOxfCCuL3Q1Cvs4',
  authDomain: 'rolaelquiz.firebaseapp.com',
  databaseURL: 'https://rolaelquiz-default-rtdb.firebaseio.com',
  projectId: 'rolaelquiz',
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
let gameMode = 'normal'; // 'normal' | 'sudden' | 'solo'

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
let roundPlayAt = 0;
let roundSnippetSecs = 10;
let playerTimerInterval = null;
let hostTimerInterval = null;

// Puntos por orden de acierto: quien responde bien primero se lleva más,
// bajando de a 10 hasta un piso de 50. Fallar o no responder = 0.
const RANK_POINTS_START = 100;
const RANK_POINTS_STEP = 10;
const RANK_POINTS_FLOOR = 50;
function computeRankPoints(rank) {
  return Math.max(RANK_POINTS_FLOOR, RANK_POINTS_START - rank * RANK_POINTS_STEP);
}
function winnerMessage(players) {
  const vals = Object.values(players || {});
  if (!vals.length) return '';
  const topScore = Math.max(...vals.map(p => p.score || 0));
  if (topScore <= 0) return '🎧 Nadie se llevó puntos esta vez — ¡a afinar el oído para la próxima!';
  const winners = vals.filter(p => (p.score || 0) === topScore).map(p => p.name);
  return winners.length === 1
    ? `🏆 ¡Felicidades, ${winners[0]}, eres el más rolo!`
    : `🏆 ¡Felicidades, ${winners.join(' y ')}, son los más rolos!`;
}
function renderLeaderboardInto(container, players, highlightId, roundAnswers) {
  const sorted = Object.entries(players || {}).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  container.innerHTML = '';
  sorted.forEach(([pid, p], i) => {
    const row = document.createElement('div');
    row.className = 'result-row' + (pid === highlightId ? ' me' : '');
    const isMe = pid === highlightId ? ' (tú)' : '';
    let deltaHtml = '';
    if (roundAnswers) {
      const pts = (roundAnswers[pid] && roundAnswers[pid].points) || 0;
      deltaHtml = `<span class="delta ${pts > 0 ? 'pos' : 'zero'}">+${pts}</span>`;
    }
    row.innerHTML = `<span class="name"><span class="rank">${i + 1}.</span> ${escapeHtml(p.name)}${isMe}</span><span class="score">${p.score || 0}${deltaHtml}</span>`;
    container.appendChild(row);
  });
}

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
const btnReloadPlaylists = document.getElementById('btn-reload-playlists');
const playlistCountStatus = document.getElementById('playlist-count-status');
const playlistUrlInput = document.getElementById('playlist-url-input');
const btnUsePlaylistUrl = document.getElementById('btn-use-playlist-url');
const playlistUrlStatus = document.getElementById('playlist-url-status');
const roundsSelect = document.getElementById('rounds-select');
const snippetSelect = document.getElementById('snippet-select');
const modeTabs = document.querySelectorAll('.mode-tab');
const modeHint = document.getElementById('mode-hint');
const playlistSearchInput = document.getElementById('playlist-search-input');
const btnSearchPlaylists = document.getElementById('btn-search-playlists');
const playlistSearchResults = document.getElementById('playlist-search-results');
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
const hostPlayingOptions = document.getElementById('host-playing-options');
const hostRoundLeaderboard = document.getElementById('host-round-leaderboard');
const hostRevealOptions = document.getElementById('host-reveal-options');
const hostRoundAnswers = document.getElementById('host-round-answers');
const hostTimerWrap = document.getElementById('host-timer-wrap');
const hostTimerBar = document.getElementById('host-timer-bar');
const hostTimerText = document.getElementById('host-timer-text');
const hostVolumeSlider = document.getElementById('host-volume');
const btnNextRound = document.getElementById('btn-next-round');
const hostAudioPlayer = document.getElementById('host-audio-player');

const hostResultsList = document.getElementById('host-results-list');
const hostWinnerBanner = document.getElementById('host-winner-banner');
const btnPlayAgainHost = document.getElementById('btn-play-again-host');
const btnNewSetupHost = document.getElementById('btn-new-setup-host');

const joinCodeInput = document.getElementById('join-code-input');
const joinNameInput = document.getElementById('join-name-input');
const btnJoinRoom = document.getElementById('btn-join-room');
const joinError = document.getElementById('join-error');

const playerLobbyList = document.getElementById('player-lobby-list');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');

const playerRoundCounter = document.getElementById('player-round-counter');
const playerStatusText = document.getElementById('player-status-text');
const btnManualPlay = document.getElementById('btn-manual-play');
const playerTimerWrap = document.getElementById('player-timer-wrap');
const playerTimerBar = document.getElementById('player-timer-bar');
const playerTimerText = document.getElementById('player-timer-text');
const playerVolumeSlider = document.getElementById('player-volume');
const playerAnswerGrid = document.getElementById('player-answer-grid');
const playerReveal = document.getElementById('player-reveal');
const playerRevealBanner = document.getElementById('player-reveal-banner');
const playerPointsText = document.getElementById('player-points-text');
const playerRevealArt = document.getElementById('player-reveal-art');
const playerRevealTitle = document.getElementById('player-reveal-title');
const playerRevealArtist = document.getElementById('player-reveal-artist');
const playerRoundLeaderboard = document.getElementById('player-round-leaderboard');
const audioPlayer = document.getElementById('audio-player');

const playerResultsList = document.getElementById('player-results-list');
const playerWinnerBanner = document.getElementById('player-winner-banner');
const btnPlayerBackJoin = document.getElementById('btn-player-back-join');

// ---------- Elementos: modo Solo ----------
const soloRoundCounter = document.getElementById('solo-round-counter');
const btnQuitSolo = document.getElementById('btn-quit-solo');
const soloDisc = document.getElementById('solo-disc');
const soloDiscArt = document.getElementById('solo-disc-art');
const soloTimerWrap = document.getElementById('solo-timer-wrap');
const soloTimerBar = document.getElementById('solo-timer-bar');
const soloTimerText = document.getElementById('solo-timer-text');
const soloVolumeSlider = document.getElementById('solo-volume');
const soloStatusText = document.getElementById('solo-status-text');
const soloScoreText = document.getElementById('solo-score-text');
const btnSoloManualPlay = document.getElementById('btn-solo-manual-play');
const soloAnswerGrid = document.getElementById('solo-answer-grid');
const soloReveal = document.getElementById('solo-reveal');
const soloRevealBanner = document.getElementById('solo-reveal-banner');
const soloRevealArt = document.getElementById('solo-reveal-art');
const soloRevealTitle = document.getElementById('solo-reveal-title');
const soloRevealArtist = document.getElementById('solo-reveal-artist');
const btnSoloNext = document.getElementById('btn-solo-next');
const soloAudioPlayer = document.getElementById('solo-audio-player');
const soloFinalScore = document.getElementById('solo-final-score');
const btnSoloPlayAgain = document.getElementById('btn-solo-play-again');
const btnSoloNewSetup = document.getElementById('btn-solo-new-setup');

soloVolumeSlider.oninput = () => { soloAudioPlayer.volume = parseFloat(soloVolumeSlider.value); };
soloAudioPlayer.volume = parseFloat(soloVolumeSlider.value);

let soloRounds = [];
let soloIndex = 0;
let soloScore = 0;
let soloAnswered = false;
let soloTimerInterval = null;

function startSoloGame() {
  soloRounds = Object.values(buildRoundsFromPool());
  soloIndex = 0;
  soloScore = 0;
  soloScoreText.textContent = 'Puntaje: 0';
  showScreen('solo-game');
  setupSoloRound();
}
function setupSoloRound() {
  soloAnswered = false;
  const round = soloRounds[soloIndex];
  soloRoundCounter.textContent = `Ronda ${soloIndex + 1}/${soloRounds.length}`;
  soloReveal.classList.add('hidden');
  soloAnswerGrid.classList.remove('hidden');
  soloAnswerGrid.innerHTML = '';
  btnSoloManualPlay.classList.add('hidden');
  soloTimerWrap.classList.add('hidden');
  clearInterval(soloTimerInterval);
  soloDisc.classList.add('spinning');
  soloDiscArt.classList.add('hidden');
  soloStatusText.textContent = '🔊 ¡Escucha con atención!';

  round.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = opt;
    btn.onclick = () => submitSoloAnswer(i, round.correctIndex, round);
    soloAnswerGrid.appendChild(btn);
  });

  soloAudioPlayer.src = round.previewUrl;
  soloAudioPlayer.load();
  btnSoloManualPlay.onclick = () => { soloAudioPlayer.play().catch(() => {}); };
  soloAudioPlayer.currentTime = 0;
  soloAudioPlayer.play().catch(() => { btnSoloManualPlay.classList.remove('hidden'); });

  soloTimerWrap.classList.remove('hidden');
  const endAt = Date.now() + snippetLength * 1000;
  soloTimerInterval = setInterval(() => {
    const remaining = Math.max(0, (endAt - Date.now()) / 1000);
    soloTimerBar.style.width = Math.max(0, (remaining / snippetLength) * 100) + '%';
    soloTimerBar.classList.toggle('urgent', remaining <= 3);
    soloTimerText.textContent = Math.ceil(remaining) + 's';
    if (remaining <= 0) clearInterval(soloTimerInterval);
  }, 100);
  clearTimeout(localSnippetTimer);
  localSnippetTimer = setTimeout(() => {
    if (!soloAnswered) submitSoloAnswer(-1, round.correctIndex, round);
  }, snippetLength * 1000);
}
function submitSoloAnswer(optionIndex, correctIndex, round) {
  if (soloAnswered) return;
  soloAnswered = true;
  clearInterval(soloTimerInterval);
  clearTimeout(localSnippetTimer);
  soloAudioPlayer.pause();
  soloDisc.classList.remove('spinning');
  soloTimerWrap.classList.add('hidden');
  const buttons = soloAnswerGrid.querySelectorAll('.answer-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === correctIndex) b.classList.add('correct');
    else if (i === optionIndex) b.classList.add('wrong');
  });
  const correct = optionIndex === correctIndex;
  if (correct) soloScore += 1;
  soloScoreText.textContent = `Puntaje: ${soloScore}`;
  soloAnswerGrid.classList.add('hidden');
  soloReveal.classList.remove('hidden');
  soloRevealBanner.textContent = correct ? '✅ ¡Correcto!' : (optionIndex === -1 ? '⌛ Se acabó el tiempo' : '❌ Fallaste');
  soloRevealTitle.textContent = round.trackName;
  soloRevealArtist.textContent = round.trackArtist;
  if (round.trackImage) { soloRevealArt.src = round.trackImage; soloRevealArt.classList.remove('hidden'); }
  else soloRevealArt.classList.add('hidden');
  btnSoloNext.textContent = (soloIndex + 1 >= soloRounds.length) ? 'Ver resultado' : 'Siguiente canción';
}
btnSoloNext.onclick = () => {
  soloIndex += 1;
  if (soloIndex >= soloRounds.length) {
    soloFinalScore.textContent = `🎧 Terminaste con ${soloScore}/${soloRounds.length} aciertos.`;
    showScreen('solo-results');
  } else {
    setupSoloRound();
  }
};
btnQuitSolo.onclick = () => {
  clearInterval(soloTimerInterval);
  clearTimeout(localSnippetTimer);
  soloAudioPlayer.pause();
  soloFinalScore.textContent = `🎧 Terminaste con ${soloScore}/${soloRounds.length} aciertos.`;
  showScreen('solo-results');
};
btnSoloPlayAgain.onclick = () => startSoloGame();
btnSoloNewSetup.onclick = () => showScreen('host-setup');

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
// Control de volumen: se aplica de inmediato y se mantiene entre rondas
// (cambiar audioPlayer.src no resetea audioPlayer.volume).
playerVolumeSlider.oninput = () => { audioPlayer.volume = parseFloat(playerVolumeSlider.value); };
audioPlayer.volume = parseFloat(playerVolumeSlider.value);
hostVolumeSlider.oninput = () => { hostAudioPlayer.volume = parseFloat(hostVolumeSlider.value); };
hostAudioPlayer.volume = parseFloat(hostVolumeSlider.value);
function showGlobalError(msg) {
  const el = document.getElementById('global-error-banner');
  el.textContent = '⚠️ ' + msg;
  el.classList.remove('hidden');
}
// Los navegadores integrados de apps de chat/redes sociales (Instagram,
// Facebook, TikTok, WeChat, LINE...) son conocidos por bloquear o romper
// audio, almacenamiento local y conexiones en tiempo real — a veces sin
// mostrar ningún error, simplemente sin hacer nada. Avisamos apenas carga.
function detectInAppBrowser() {
  const ua = navigator.userAgent || '';
  const patterns = [
    { re: /FBAN|FBAV|FB_IAB/i, name: 'Facebook' },
    { re: /Instagram/i, name: 'Instagram' },
    { re: /\bLine\//i, name: 'LINE' },
    { re: /MicroMessenger/i, name: 'WeChat' },
    { re: /KAKAOTALK/i, name: 'KakaoTalk' },
    { re: /musical_ly|BytedanceWebview|TikTok/i, name: 'TikTok' },
    { re: /Twitter/i, name: 'Twitter/X' },
    { re: /\bWhatsApp\//i, name: 'WhatsApp' },
  ];
  for (const p of patterns) {
    if (p.re.test(ua)) return p.name;
  }
  return null;
}
(function warnIfInAppBrowser() {
  const appName = detectInAppBrowser();
  if (!appName) return;
  const el = document.getElementById('inapp-browser-warning');
  el.textContent = `⚠️ Parece que abriste este link desde el navegador integrado de ${appName}. Esta app necesita un navegador normal para funcionar (audio, guardar datos, conexión en tiempo real). Toca ⋮ o el ícono de compartir arriba de la pantalla y elige "Abrir en Chrome" / "Abrir en Safari" / "Abrir en el navegador", y prueba desde ahí.`;
  el.classList.remove('hidden');
})();
function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}
const TIMEOUT_MSG = 'Se tardó demasiado en responder el servidor de sincronización. Si tienes un bloqueador de anuncios o rastreadores (uBlock, Brave Shields, Privacy Badger, o un firewall de tu red), puede estar bloqueando "firebaseio.com" — pruébalo desactivado para este sitio, o desde otra red.';
function initFirebase() {
  if (db) return true;
  if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'PON_AQUI_TU_API_KEY') {
    return false;
  }
  try {
    if (typeof firebase === 'undefined') {
      throw new Error('No se pudo cargar la librería de Firebase (revisa tu internet o un bloqueador de scripts).');
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    db.ref('.info/serverTimeOffset').on('value', snap => { serverTimeOffset = snap.val() || 0; });
    const connStatus = document.getElementById('conn-status');
    let everConnected = false;
    db.ref('.info/connected').on('value', snap => {
      const connected = !!snap.val();
      if (connected) everConnected = true;
      connStatus.textContent = connected
        ? ''
        : (everConnected
          ? '🔴 Se perdió la conexión en tiempo real — reconectando…'
          : '🔴 Sin conexión en tiempo real. Si tarda más de unos segundos, revisa si un bloqueador de anuncios/rastreadores (uBlock, AdGuard, Brave Shields...) está bloqueando "firebaseio.com", o prueba con otra red / datos móviles.');
      connStatus.classList.toggle('hidden', connected);
    });
    return true;
  } catch (e) {
    console.error(e);
    showGlobalError('No se pudo iniciar la sincronización en tiempo real: ' + e.message);
    db = null;
    return false;
  }
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
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function spotifyGet(url, attempt) {
  attempt = attempt || 1;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (networkErr) {
    // Fallo de RED (no llegó a responder Spotify) — casi siempre es algo
    // pasajero (wifi inestable, un bloqueador de extensión, un hipo de
    // conexión). Reintenta un par de veces antes de rendirse.
    if (attempt < 3) {
      await sleep(600 * attempt);
      return spotifyGet(url, attempt + 1);
    }
    throw networkErr;
  }
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
  if (e && e.customMessage) return e.message;
  if (e && e.status === 401) {
    return 'Tu sesión de Spotify expiró. Dale a "Cerrar sesión" y vuelve a conectar.';
  }
  if (e && e.status === 403) {
    const real = (e.message && e.message !== 'Spotify API error 403') ? e.message : '(Spotify no envió más detalle)';
    return `Spotify bloqueó el acceso (403). Mensaje real de Spotify: "${real}". Spotify cambió las reglas del modo desarrollo en 2026 — antes de revisar otra cosa: (1) la cuenta con la que creaste la app DEBE tener Spotify Premium activo, si no, TODAS las llamadas fallan con 403 incluso para listar tus propias playlists; (2) si ya tienes Premium, confirma que el correo agregado en User Management sea el exacto de esa cuenta; (3) espera unos minutos tras agregar/quitar usuarios y reintenta.`;
  }
  if (e && e.status === 429) {
    return 'Spotify está limitando las solicitudes (demasiadas seguidas). Espera unos segundos y vuelve a intentar.';
  }
  if (e instanceof TypeError) {
    return 'No se pudo conectar con Spotify después de varios intentos. Esto normalmente es la conexión (wifi inestable, datos móviles débiles) o una extensión del navegador bloqueando la solicitud — no tu cuenta ni el modo desarrollo. Prueba: 1) dale a 🔄 para reintentar, 2) revisa si tienes uBlock/AdGuard/una VPN activa y desactívala para este sitio, 3) prueba desde otra red (datos móviles en vez de wifi, o viceversa).';
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
  playlistCountStatus.classList.remove('error-text');
  playlistCountStatus.textContent = 'Buscando tus playlists…';
  try {
    const items = await fetchAllPages('https://api.spotify.com/v1/me/playlists?limit=50');
    playlistSelect.innerHTML = '';
    if (!items.length) {
      playlistSelect.innerHTML = '<option value="">No se encontraron playlists</option>';
      playlistCountStatus.textContent = 'No se encontró ninguna playlist en esta cuenta.';
      return;
    }
    items.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.tracks.total})`;
      playlistSelect.appendChild(opt);
    });
    playlistCountStatus.textContent = `Se encontraron ${items.length} playlist(s). ¿No ves la que buscas? Dale a 🔄 para recargar, o pégala manualmente abajo (debe ser pública si no es tuya).`;
  } catch (e) {
    console.error(e);
    playlistSelect.innerHTML = '<option value="">Error — revisa el mensaje de abajo</option>';
    playlistCountStatus.textContent = describeSpotifyError(e);
    playlistCountStatus.classList.add('error-text');
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
  playlistUrlStatus.textContent = 'Playlist lista para usar (se prioriza sobre la lista de arriba). Debe ser pública si no es tuya, o Spotify la rechazará con un error 403.';
};
btnReloadPlaylists.onclick = () => loadPlaylists();
function normalizeTrack(t) {
  if (!t || !t.id || !t.name) return null;
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map(a => a.name),
    image: t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : '',
  };
}
// Desde 2026 Spotify renombró el endpoint de canciones de una playlist:
// /playlists/{id}/tracks (viejo, ahora da 403 siempre) pasó a ser
// /playlists/{id}/items, y el campo "track" de cada elemento pasó a
// llamarse "item". Además, para playlists que NO son tuyas ni donde
// colaboras, Spotify ya solo devuelve los metadatos (sin canciones),
// sin importar si son públicas o no.
async function fetchPlaylistTracks(playlistId) {
  // Ojo: dejamos de usar el parámetro "fields" a propósito — el filtro
  // de este endpoint nuevo (/items) tiene reportes de bugs (devuelve
  // vacío o falla con ciertos filtros anidados). Pedimos la respuesta
  // completa y sacamos lo que necesitamos nosotros mismos en el
  // navegador; cuesta un poco más de datos pero es mucho más confiable.
  const first = await spotifyGet(`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100`);
  if (!('items' in first)) {
    const err = new Error(
      'Esta playlist no es tuya ni eres colaborador, así que Spotify ya no permite leer sus canciones desde la API — así sea pública. Esto cambió con una actualización de Spotify de 2026: ahora solo se pueden leer canciones de playlists propias o donde colabores. Pídele a quien la creó que te agregue como colaborador, o usa una playlist tuya (o tus Me Gusta).'
    );
    err.status = 403;
    err.customMessage = true;
    throw err;
  }
  let items = first.items || [];
  let next = first.next;
  while (next) {
    const data = await spotifyGet(next);
    items = items.concat(data.items || []);
    next = data.next;
  }
  // "item" es el nombre nuevo del campo; "track" es el viejo, que
  // Spotify todavía manda en paralelo durante su ventana de transición
  // — aceptamos cualquiera de los dos por si acaso.
  return items.map(i => i.item || i.track).filter(Boolean);
}
async function fetchSourcePool() {
  if (selectedSource === 'liked') {
    const items = await fetchAllPages('https://api.spotify.com/v1/me/tracks?limit=50');
    return items.map(i => i.track).filter(Boolean);
  }
  const playlistId = manualPlaylistId || playlistSelect.value;
  try {
    return await fetchPlaylistTracks(playlistId);
  } catch (e) {
    if (e && e.status === 403 && !e.customMessage) {
      const isManual = !!manualPlaylistId;
      const err = new Error(
        isManual
          ? 'No se pudo leer esa playlist (403). Prueba eligiéndola directo de la lista desplegable "Mis playlists" en vez de pegar el link, o revisa que tu cuenta de anfitrión tenga Spotify Premium (obligatorio desde 2026 para apps en modo desarrollo — sin eso, TODAS las llamadas fallan con 403).'
          : 'No se pudo leer esa playlist (403). Revisa que tu cuenta de anfitrión tenga Spotify Premium (obligatorio desde 2026 para apps en modo desarrollo), o dale a 🔄 para recargar la lista de playlists.'
      );
      err.status = 403;
      err.customMessage = true;
      throw err;
    }
    throw e;
  }
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

// ---------- Tabs de modo de juego ----------
const MODE_HINTS = {
  normal: 'El primero en acertar se lleva 100 puntos, bajando hasta un piso de 50 para los siguientes.',
  sudden: 'Solo el primero en acertar cada canción se lleva 1 punto — nadie más suma esa ronda. Si al final hay empate, se juega una ronda extra solo entre los empatados.',
  solo: 'Practica tú solo, sin sala ni amigos: escuchas, adivinas y ves tu puntaje al final.',
};
modeTabs.forEach(tab => {
  tab.onclick = () => {
    modeTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    gameMode = tab.dataset.mode;
    modeHint.textContent = MODE_HINTS[gameMode] || '';
    btnCreateRoom.textContent = gameMode === 'solo' ? 'Empezar a practicar' : 'Crear sala';
  };
});

// ---------- Buscador de playlists por nombre ----------
btnSearchPlaylists.onclick = async () => {
  const q = playlistSearchInput.value.trim();
  if (!q) return;
  playlistSearchResults.innerHTML = '<p class="hint">Buscando…</p>';
  try {
    const data = await spotifyGet(`https://api.spotify.com/v1/search?type=playlist&q=${encodeURIComponent(q)}&limit=10`);
    const items = (data.playlists && data.playlists.items) ? data.playlists.items.filter(Boolean) : [];
    playlistSearchResults.innerHTML = '';
    if (!items.length) {
      playlistSearchResults.innerHTML = '<p class="hint">No se encontró nada con ese nombre.</p>';
      return;
    }
    items.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.style.cursor = 'pointer';
      const ownerName = (p.owner && p.owner.display_name) || 'alguien';
      chip.textContent = `${p.name} — de ${ownerName} (${(p.tracks && p.tracks.total) || '?'} canciones)`;
      chip.onclick = () => {
        manualPlaylistId = p.id;
        playlistUrlInput.value = (p.external_urls && p.external_urls.spotify) || p.id;
        playlistUrlStatus.classList.remove('hidden');
        playlistUrlStatus.textContent = `Elegiste "${p.name}". Solo va a funcionar si es tuya o colaboras en ella — si no, Spotify la rechazará con un 403 al crear la sala.`;
      };
      playlistSearchResults.appendChild(chip);
    });
  } catch (e) {
    console.error(e);
    playlistSearchResults.innerHTML = `<p class="hint error-text">${escapeHtml(describeSpotifyError(e))}</p>`;
  }
};

// ---------- Construcción de rondas (multiple choice) ----------
function buildRoundsFromPool() {
  const tracks = shuffle(previewPool).slice(0, roundsCount);
  // Reparte mejor las opciones incorrectas: prioriza las canciones que
  // menos se han usado como distractor en rondas anteriores, para no
  // repetir siempre las mismas 3-4 opciones cuando el pool es chico.
  const usageCount = new Map(previewPool.map(t => [t.id, 0]));
  const rounds = {};
  tracks.forEach((track, i) => {
    const others = previewPool.filter(t => t.id !== track.id && t.name !== track.name);
    const ranked = shuffle(others).sort((a, b) => (usageCount.get(a.id) || 0) - (usageCount.get(b.id) || 0));
    const distractorTracks = ranked.slice(0, 3);
    distractorTracks.forEach(t => usageCount.set(t.id, (usageCount.get(t.id) || 0) + 1));
    let names = distractorTracks.map(t => t.name);
    while (names.length < 3) names.push('(otra canción)');
    const options = shuffle([track.name, ...names]);
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
    const snap = await withTimeout(db.ref('rooms/' + code).once('value'), 8000, TIMEOUT_MSG);
    if (!snap.exists()) return code;
  }
  return generateRoomCode();
}

async function buildPreviewPoolFromSource() {
  setupStatus.textContent = 'Cargando tus canciones…';
  const rawPool = await fetchSourcePool();
  let normalized = rawPool.map(normalizeTrack).filter(Boolean);
  const seen = new Set();
  normalized = normalized.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  if (normalized.length < 4) {
    throw new Error('Necesitas al menos 4 canciones distintas para armar las opciones de respuesta.');
  }
  normalized = shuffle(normalized);

  const target = Math.max(roundsCount * 3, Math.min(normalized.length, 40));
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
    throw new Error('No se encontró suficiente audio (mínimo 4 canciones). Prueba con otra playlist.');
  }
  if (previewPool.length < roundsCount) roundsCount = previewPool.length;
}

// ---------- Crear sala (anfitrión) ----------
btnCreateRoom.onclick = async () => {
  if (selectedSource === 'playlist' && !manualPlaylistId && !playlistSelect.value) {
    setupStatus.textContent = 'Elige una playlist o pega un link.';
    return;
  }
  if (gameMode !== 'solo' && !initFirebase()) {
    setupStatus.textContent = 'Falta configurar Firebase en app.js (ver instrucciones arriba del archivo).';
    return;
  }
  btnCreateRoom.disabled = true;
  roundsCount = parseInt(roundsSelect.value, 10);
  snippetLength = parseInt(snippetSelect.value, 10);
  try {
    await buildPreviewPoolFromSource();

    if (gameMode === 'solo') {
      startSoloGame();
      return;
    }

    setupStatus.textContent = 'Creando sala…';
    currentRoomCode = await createUniqueRoomCode();
    const rounds = buildRoundsFromPool();
    roomRef = db.ref('rooms/' + currentRoomCode);
    await withTimeout(roomRef.set({
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      status: 'lobby',
      currentRound: 0,
      settings: { roundsCount, snippetLength, mode: gameMode },
      rounds,
      players: {},
    }), 8000, TIMEOUT_MSG);
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
  hostRoundCounter.textContent = round.isTiebreak ? '🔥 Ronda de desempate' : `Ronda ${idx + 1}/${room.settings.roundsCount}`;
  const totalPlayers = Object.keys(room.players || {}).length;
  const answers = round.answers || {};
  const answeredCount = Object.keys(answers).length;
  const snippetSecs = snippetLengthFromRoom(room);

  if (room.status === 'playing') {
    hostDisc.classList.add('spinning');
    hostDiscArt.classList.add('hidden');
    hostGameStatus.textContent = '🔊 Sonando en el celular/compu de cada jugador…';
    hostAnswerCount.textContent = `${answeredCount}/${totalPlayers} ya respondieron`;
    hostRevealCard.classList.add('hidden');
    btnNextRound.classList.add('hidden');
    hostPlayingOptions.classList.remove('hidden');
    hostPlayingOptions.innerHTML = '';
    round.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn';
      btn.textContent = opt;
      btn.disabled = true;
      hostPlayingOptions.appendChild(btn);
    });
    if (lastPlayedRoundHost !== idx) {
      lastPlayedRoundHost = idx;
      const delay = Math.max(0, room.playAt - getServerNow());
      hostAudioPlayer.src = round.previewUrl;
      hostTimerWrap.classList.add('hidden');
      clearInterval(hostTimerInterval);
      setTimeout(() => {
        hostAudioPlayer.currentTime = 0;
        hostAudioPlayer.play().catch(() => {});
        hostTimerWrap.classList.remove('hidden');
        const endAt = room.playAt + snippetSecs * 1000;
        hostTimerInterval = setInterval(() => {
          const remaining = Math.max(0, (endAt - getServerNow()) / 1000);
          hostTimerBar.style.width = Math.max(0, (remaining / snippetSecs) * 100) + '%';
          hostTimerBar.classList.toggle('urgent', remaining <= 3);
          hostTimerText.textContent = Math.ceil(remaining) + 's';
          if (remaining <= 0) clearInterval(hostTimerInterval);
        }, 100);
      }, delay);
      setTimeout(() => { hostAudioPlayer.pause(); clearInterval(hostTimerInterval); hostTimerWrap.classList.add('hidden'); }, delay + snippetSecs * 1000);
    }
  } else if (room.status === 'reveal') {
    hostDisc.classList.remove('spinning');
    hostAudioPlayer.pause();
    clearInterval(hostTimerInterval);
    hostTimerWrap.classList.add('hidden');
    hostPlayingOptions.classList.add('hidden');
    if (round.trackImage) { hostDiscArt.src = round.trackImage; hostDiscArt.classList.remove('hidden'); }
    hostGameStatus.textContent = '';
    hostAnswerCount.textContent = `${answeredCount}/${totalPlayers} respondieron esta ronda`;
    hostRevealTitle.textContent = round.trackName;
    hostRevealArtist.textContent = round.trackArtist;

    hostRevealOptions.innerHTML = '';
    round.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn' + (i === round.correctIndex ? ' correct' : '');
      btn.textContent = opt;
      btn.disabled = true;
      hostRevealOptions.appendChild(btn);
    });

    hostRoundAnswers.innerHTML = '';
    const rows = Object.entries(room.players || {}).map(([pid, p]) => {
      const a = answers[pid];
      return { name: p.name, answered: !!a, correct: !!(a && a.correct), points: (a && a.points) || 0 };
    }).sort((a, b) => b.points - a.points);
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const icon = r.correct ? '✅' : (r.answered ? '❌' : '⌛');
      row.innerHTML = `<span class="name">${icon} ${escapeHtml(r.name)}</span><span class="delta ${r.points > 0 ? 'pos' : 'zero'}">+${r.points}</span>`;
      hostRoundAnswers.appendChild(row);
    });

    renderLeaderboardInto(hostRoundLeaderboard, room.players || {}, null, answers);
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
  hostWinnerBanner.textContent = winnerMessage(players);
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
    const roundSnap = await roomRef.child('rounds/' + index).once('value');
    const round = roundSnap.val() || {};
    const answersSnap = await roomRef.child('rounds/' + index + '/answers').once('value');
    const answers = answersSnap.val() || {};
    const playersSnap = await roomRef.child('players').once('value');
    const playersVal = playersSnap.val() || {};
    const settingsSnap = await roomRef.child('settings').once('value');
    const settings = settingsSnap.val() || {};
    const updates = {};

    if (round.isTiebreak) {
      // Ronda de desempate: solo cuenta el primero en acertar ENTRE los
      // jugadores empatados; el resto (aunque acierte) no suma nada.
      const eligible = new Set(round.tiebreakIds || []);
      const correctEligible = Object.entries(answers)
        .filter(([pid, a]) => a && a.correct && eligible.has(pid))
        .sort((a, b) => (a[1].answeredAt || 0) - (b[1].answeredAt || 0));
      Object.keys(answers).forEach(pid => { updates['rounds/' + index + '/answers/' + pid + '/points'] = 0; });
      if (correctEligible.length) {
        const winnerId = correctEligible[0][0];
        updates['rounds/' + index + '/answers/' + winnerId + '/points'] = 1;
        const cur = (playersVal[winnerId] && playersVal[winnerId].score) || 0;
        updates['players/' + winnerId + '/score'] = cur + 1;
      }
    } else if (settings.mode === 'sudden') {
      // Muerte súbita: solo el primero en acertar se lleva 1 punto esa
      // ronda; nadie más suma, aunque también haya acertado.
      const correctEntries = Object.entries(answers)
        .filter(([, a]) => a && a.correct)
        .sort((a, b) => (a[1].answeredAt || 0) - (b[1].answeredAt || 0));
      Object.keys(answers).forEach(pid => { updates['rounds/' + index + '/answers/' + pid + '/points'] = 0; });
      if (correctEntries.length) {
        const [winnerId] = correctEntries[0];
        updates['rounds/' + index + '/answers/' + winnerId + '/points'] = 1;
        const cur = (playersVal[winnerId] && playersVal[winnerId].score) || 0;
        updates['players/' + winnerId + '/score'] = cur + 1;
      }
    } else {
      // Modo normal: orden por velocidad, quien respondió correcto más
      // rápido se lleva más puntos (100, 90, 80… hasta un piso de 50).
      const correctEntries = Object.entries(answers)
        .filter(([, a]) => a && a.correct)
        .sort((a, b) => (a[1].answeredAt || 0) - (b[1].answeredAt || 0));
      correctEntries.forEach(([pid], rank) => {
        const pts = computeRankPoints(rank);
        updates['rounds/' + index + '/answers/' + pid + '/points'] = pts;
        const cur = (playersVal[pid] && playersVal[pid].score) || 0;
        updates['players/' + pid + '/score'] = cur + pts;
      });
      Object.entries(answers).forEach(([pid, a]) => {
        if (!a || !a.correct) {
          updates['rounds/' + index + '/answers/' + pid + '/points'] = 0;
        }
      });
    }
    updates['status'] = 'reveal';
    await roomRef.update(updates);
  } catch (e) {
    console.error(e);
  }
}
// Si el modo es "muerte súbita" y al terminar hay empate en el primer
// lugar, arma una ronda extra solo para desempatar entre los
// empatados en vez de terminar el juego de una.
async function finishGameOrTiebreak(room) {
  if (room.settings && room.settings.mode === 'sudden') {
    const players = room.players || {};
    const vals = Object.entries(players);
    const topScore = vals.length ? Math.max(...vals.map(([, p]) => p.score || 0)) : 0;
    const tied = vals.filter(([, p]) => (p.score || 0) === topScore && topScore > 0);
    if (tied.length > 1) {
      const usedNames = new Set(Object.values(room.rounds || {}).map(r => r.trackName));
      const candidate = previewPool.find(t => !usedNames.has(t.name));
      if (candidate) {
        const newIndex = Object.keys(room.rounds || {}).length;
        const others = previewPool.filter(t => t.id !== candidate.id && t.name !== candidate.name);
        let names = shuffle(others).slice(0, 3).map(t => t.name);
        while (names.length < 3) names.push('(otra canción)');
        const options = shuffle([candidate.name, ...names]);
        const correctIndex = options.indexOf(candidate.name);
        await roomRef.child('rounds/' + newIndex).set({
          trackName: candidate.name,
          trackArtist: candidate.artists.join(', '),
          trackImage: candidate.image || '',
          previewUrl: candidate.previewUrl,
          options,
          correctIndex,
          isTiebreak: true,
          tiebreakIds: tied.map(([pid]) => pid),
        });
        await roomRef.child('settings/roundsCount').set(newIndex + 1);
        await startRound(newIndex);
        return;
      }
    }
  }
  await roomRef.update({ status: 'finished' });
}
btnNextRound.onclick = async () => {
  btnNextRound.disabled = true;
  try {
    const snap = await roomRef.once('value');
    const room = snap.val();
    const next = (room.currentRound || 0) + 1;
    if (next >= room.settings.roundsCount) {
      await finishGameOrTiebreak(room);
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
    await roomRef.update({
      rounds,
      players: resetPlayers,
      status: 'lobby',
      currentRound: 0,
      playAt: null,
      settings: { roundsCount, snippetLength, mode: gameMode },
    });
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
  joinError.classList.add('hidden');
  if (!initFirebase()) {
    joinError.textContent = 'Falta configurar Firebase en app.js.';
    joinError.classList.remove('hidden');
    return;
  }
  const code = (joinCodeInput.value || '').trim().toUpperCase();
  const name = (joinNameInput.value || '').trim().slice(0, 20);
  if (!code || !name) {
    joinError.textContent = 'Escribe tu nombre y el código de la sala.';
    joinError.classList.remove('hidden');
    return;
  }
  const originalLabel = btnJoinRoom.textContent;
  btnJoinRoom.disabled = true;
  btnJoinRoom.textContent = 'Uniéndote…';
  // Seguro general: pase lo que pase, el botón no se queda pegado
  // para siempre (respaldo por si algo inesperado se cuelga).
  const safetyTimer = setTimeout(() => {
    if (btnJoinRoom.disabled) {
      btnJoinRoom.disabled = false;
      btnJoinRoom.textContent = originalLabel;
      joinError.textContent = 'Se tardó demasiado y no hubo respuesta. Intenta de nuevo, revisa tu conexión, o si tienes un bloqueador de anuncios, desactívalo para este sitio.';
      joinError.classList.remove('hidden');
    }
  }, 15000);
  // Desbloquea el audio para reproducir más tarde sin otro clic
  // (los navegadores exigen un gesto del usuario para permitir audio).
  // Es un "mejor esfuerzo" con su propio límite de tiempo: en algunos
  // navegadores el play() puede quedarse esperando para siempre sin
  // resolver ni rechazar, y eso NO debe bloquear la unión a la sala.
  try {
    audioPlayer.muted = true;
    const p = audioPlayer.play();
    if (p && typeof p.then === 'function') {
      await withTimeout(p.catch(() => {}), 1500, 'audio unlock timeout').catch(() => {});
    }
    audioPlayer.pause();
  } catch (e) {
    console.warn('No se pudo pre-desbloquear el audio:', e);
  } finally {
    audioPlayer.muted = false;
  }
  try {
    const snap = await withTimeout(db.ref('rooms/' + code).once('value'), 8000, TIMEOUT_MSG);
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
    await withTimeout(roomRef.child('players/' + playerId).update({
      name: playerName,
      score: (snap.val().players && snap.val().players[playerId] && snap.val().players[playerId].score) || 0,
      joinedAt: firebase.database.ServerValue.TIMESTAMP,
    }), 8000, TIMEOUT_MSG);
    lastRenderedRound = -1;
    lastRenderedStatus = null;
    listenAsPlayer();
  } catch (e) {
    console.error(e);
    joinError.textContent = e.message || 'No se pudo unir a la sala. Revisa tu conexión.';
    joinError.classList.remove('hidden');
  } finally {
    clearTimeout(safetyTimer);
    btnJoinRoom.disabled = false;
    btnJoinRoom.textContent = originalLabel;
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
  playerRoundCounter.textContent = round.isTiebreak ? '🔥 Ronda de desempate' : `Ronda ${index + 1}/${room.settings.roundsCount}`;
  playerReveal.classList.add('hidden');
  playerAnswerGrid.classList.remove('hidden');
  playerAnswerGrid.innerHTML = '';
  btnManualPlay.classList.add('hidden');
  playerTimerWrap.classList.add('hidden');
  clearInterval(playerTimerInterval);
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
  roundPlayAt = room.playAt;
  roundSnippetSecs = snippetSecs;
  const delay = Math.max(0, room.playAt - getServerNow());
  clearTimeout(localSnippetTimer);
  setTimeout(() => {
    playerStatusText.textContent = '🔊 ¡Escucha con atención!';
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => { btnManualPlay.classList.remove('hidden'); });

    playerTimerWrap.classList.remove('hidden');
    const endAt = room.playAt + snippetSecs * 1000;
    clearInterval(playerTimerInterval);
    playerTimerInterval = setInterval(() => {
      const remaining = Math.max(0, (endAt - getServerNow()) / 1000);
      playerTimerBar.style.width = Math.max(0, (remaining / snippetSecs) * 100) + '%';
      playerTimerBar.classList.toggle('urgent', remaining <= 3);
      playerTimerText.textContent = Math.ceil(remaining) + 's';
      if (remaining <= 0) clearInterval(playerTimerInterval);
    }, 100);

    localSnippetTimer = setTimeout(() => {
      audioPlayer.pause();
      clearInterval(playerTimerInterval);
      playerTimerWrap.classList.add('hidden');
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
  const correct = optionIndex === correctIndex;
  const answeredAt = getServerNow();
  playerStatusText.textContent = correct
    ? '¡Correcto! Esperando a los demás…'
    : 'Respuesta enviada. Esperando a los demás…';
  roomRef.child(`rounds/${index}/answers/${playerId}`).set({ optionIndex, correct, answeredAt, name: playerName });
}
function showPlayerReveal(room, index) {
  const round = room.rounds[index];
  playerAnswerGrid.classList.add('hidden');
  playerReveal.classList.remove('hidden');
  const myAnswer = round.answers && round.answers[playerId];
  const gotIt = myAnswer && myAnswer.correct;
  playerRevealBanner.textContent = gotIt ? '✅ ¡Correcto!' : (myAnswer ? '❌ Fallaste' : '⌛ No respondiste a tiempo');
  playerPointsText.textContent = `+${(myAnswer && myAnswer.points) || 0} pts esta ronda`;
  playerRevealTitle.textContent = round.trackName;
  playerRevealArtist.textContent = round.trackArtist;
  if (round.trackImage) {
    playerRevealArt.src = round.trackImage;
    playerRevealArt.classList.remove('hidden');
  } else {
    playerRevealArt.classList.add('hidden');
  }
  renderLeaderboardInto(playerRoundLeaderboard, room.players || {}, playerId, round.answers || {});
}
function renderPlayerResults(room) {
  const players = room.players || {};
  playerWinnerBanner.textContent = winnerMessage(players);
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
function leaveRoom() {
  if (roomRef) roomRef.off();
  roomRef = null;
  currentRoomCode = null;
  showScreen('player-join');
}
btnPlayerBackJoin.onclick = leaveRoom;
btnLeaveLobby.onclick = leaveRoom;

// ---------- Navegación de rol ----------
btnRoleHost.onclick = () => showScreen('login');
btnRolePlayer.onclick = () => { initFirebase(); showScreen('player-join'); };
btnBackRoleLogin.onclick = () => showScreen('role');
btnBackRolePlayer.onclick = () => showScreen('role');

// ---------- Arranque ----------
window.addEventListener('error', e => showGlobalError(e.message || 'Ocurrió un error inesperado.'));
window.addEventListener('unhandledrejection', e => {
  const msg = (e.reason && e.reason.message) || String(e.reason);
  showGlobalError(msg);
});
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
