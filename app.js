/* =========================================================
   CONFIGURA ESTO ANTES DE USAR LA APP
   1. Crea una app gratis en https://developer.spotify.com/dashboard
   2. Copia el "Client ID" y pégalo abajo.
   3. En la configuración de tu app de Spotify, agrega como
      Redirect URI la URL exacta donde vayas a publicar esta
      página (ej: https://tu-app.netlify.app/), sin nada extra.
   ========================================================= */
const CLIENT_ID = 'PON_AQUI_TU_CLIENT_ID';

const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

let accessToken = null;
let players = [];
let selectedSource = 'liked';
let previewPool = [];
let quizTracks = [];
let roundIndex = 0;
let roundsCount = 10;
let snippetLength = 10;
let scores = {};
let snippetTimer = null;
let selectedThisRound = new Set();

// ---------- Elementos ----------
const btnLogin = document.getElementById('btn-login');
const loginError = document.getElementById('login-error');

const tabs = document.querySelectorAll('.tab');
const playlistSelect = document.getElementById('playlist-select');
const playersList = document.getElementById('players-list');
const playerNameInput = document.getElementById('player-name-input');
const btnAddPlayer = document.getElementById('btn-add-player');
const roundsSelect = document.getElementById('rounds-select');
const snippetSelect = document.getElementById('snippet-select');
const btnStartQuiz = document.getElementById('btn-start-quiz');
const setupStatus = document.getElementById('setup-status');

const roundCounter = document.getElementById('round-counter');
const btnQuitGame = document.getElementById('btn-quit-game');
const disc = document.getElementById('disc');
const discArt = document.getElementById('disc-art');
const revealCard = document.getElementById('reveal-card');
const revealTitle = document.getElementById('reveal-title');
const revealArtist = document.getElementById('reveal-artist');
const gameControls = document.getElementById('game-controls');
const btnPlaySnippet = document.getElementById('btn-play-snippet');
const scoreControls = document.getElementById('score-controls');
const scorePlayers = document.getElementById('score-players');
const btnConfirmRound = document.getElementById('btn-confirm-round');
const audioPlayer = document.getElementById('audio-player');

const resultsList = document.getElementById('results-list');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnBackSetup = document.getElementById('btn-back-setup');

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
  const challenge = base64UrlEncode(await sha256(verifier));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
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

// ---------- Spotify Web API ----------
async function spotifyGet(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('Spotify API error ' + res.status);
  return res.json();
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
  }
}
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
  const playlistId = playlistSelect.value;
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

// ---------- Setup: jugadores y tabs ----------
function renderPlayers() {
  playersList.innerHTML = '';
  players.forEach((name, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const span = document.createElement('span');
    span.textContent = name;
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.onclick = () => { players.splice(i, 1); renderPlayers(); };
    chip.appendChild(span);
    chip.appendChild(rm);
    playersList.appendChild(chip);
  });
}
btnAddPlayer.onclick = () => {
  const val = playerNameInput.value.trim();
  if (val && !players.includes(val)) {
    players.push(val);
    playerNameInput.value = '';
    renderPlayers();
  }
};
playerNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); btnAddPlayer.click(); }
});
tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    selectedSource = tab.dataset.source;
    document.getElementById('source-liked').classList.toggle('active', selectedSource === 'liked');
    document.getElementById('source-playlist').classList.toggle('active', selectedSource === 'playlist');
  };
});

// ---------- Empezar partida ----------
btnStartQuiz.onclick = async () => {
  if (players.length === 0) { setupStatus.textContent = 'Agrega al menos un jugador.'; return; }
  if (selectedSource === 'playlist' && !playlistSelect.value) {
    setupStatus.textContent = 'Elige una playlist.';
    return;
  }
  btnStartQuiz.disabled = true;
  roundsCount = parseInt(roundsSelect.value, 10);
  snippetLength = parseInt(snippetSelect.value, 10);
  try {
    setupStatus.textContent = 'Cargando tus canciones…';
    const rawPool = await fetchSourcePool();
    let normalized = rawPool.map(normalizeTrack).filter(Boolean);
    const seen = new Set();
    normalized = normalized.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    if (normalized.length === 0) throw new Error('empty pool');
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
    if (previewPool.length === 0) {
      setupStatus.textContent = 'No se encontró audio para estas canciones. Prueba con otra playlist.';
      return;
    }
    if (previewPool.length < roundsCount) roundsCount = previewPool.length;
    setupStatus.textContent = '';
    startGame();
  } catch (e) {
    console.error(e);
    setupStatus.textContent = 'Ocurrió un error cargando las canciones.';
  } finally {
    btnStartQuiz.disabled = false;
  }
};

// ---------- Juego ----------
function startGame() {
  quizTracks = shuffle(previewPool).slice(0, roundsCount);
  scores = {};
  players.forEach(p => (scores[p] = 0));
  roundIndex = 0;
  showScreen('game');
  loadRound();
}
function loadRound() {
  if (roundIndex >= quizTracks.length) { showResults(); return; }
  roundCounter.textContent = `Ronda ${roundIndex + 1}/${quizTracks.length}`;
  revealCard.classList.add('hidden');
  scoreControls.classList.add('hidden');
  gameControls.classList.remove('hidden');
  discArt.classList.add('hidden');
  disc.classList.remove('spinning');
  btnPlaySnippet.disabled = false;
  btnPlaySnippet.textContent = '▶ Reproducir fragmento';
  audioPlayer.src = quizTracks[roundIndex].previewUrl;
}
btnPlaySnippet.onclick = () => {
  btnPlaySnippet.disabled = true;
  audioPlayer.currentTime = 0;
  audioPlayer.play().catch(() => {});
  disc.classList.add('spinning');
  clearTimeout(snippetTimer);
  snippetTimer = setTimeout(revealAnswer, snippetLength * 1000);
};
function revealAnswer() {
  audioPlayer.pause();
  disc.classList.remove('spinning');
  const track = quizTracks[roundIndex];
  if (track.image) {
    discArt.src = track.image;
    discArt.classList.remove('hidden');
  }
  revealTitle.textContent = track.name;
  revealArtist.textContent = track.artists.join(', ');
  revealCard.classList.remove('hidden');
  gameControls.classList.add('hidden');
  renderScorePlayers();
  scoreControls.classList.remove('hidden');
}
function renderScorePlayers() {
  selectedThisRound = new Set();
  scorePlayers.innerHTML = '';
  players.forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = name;
    chip.onclick = () => {
      if (selectedThisRound.has(name)) {
        selectedThisRound.delete(name);
        chip.classList.remove('selected');
      } else {
        selectedThisRound.add(name);
        chip.classList.add('selected');
      }
    };
    scorePlayers.appendChild(chip);
  });
}
btnConfirmRound.onclick = () => {
  selectedThisRound.forEach(name => (scores[name] = (scores[name] || 0) + 1));
  roundIndex++;
  loadRound();
};
btnQuitGame.onclick = () => {
  clearTimeout(snippetTimer);
  audioPlayer.pause();
  showScreen('setup');
};

// ---------- Resultados ----------
function showResults() {
  showScreen('results');
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topScore = sorted.length ? sorted[0][1] : 0;
  resultsList.innerHTML = '';
  sorted.forEach(([name, score]) => {
    const row = document.createElement('div');
    row.className = 'result-row' + (score === topScore && topScore > 0 ? ' winner' : '');
    row.innerHTML = `<span class="name">${escapeHtml(name)}</span><span class="score">${score}</span>`;
    resultsList.appendChild(row);
  });
}
btnPlayAgain.onclick = () => startGame();
btnBackSetup.onclick = () => showScreen('setup');

// ---------- Arranque ----------
btnLogin.onclick = redirectToSpotify;
(async function init() {
  const loggedIn = await handleRedirectIfPresent();
  if (loggedIn) {
    showScreen('setup');
    loadPlaylists();
  }
})();
