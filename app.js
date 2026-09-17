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
let gameMode = 'normal'; // 'normal' | 'sudden' | 'progressive' | 'elimination' | 'bet' | 'blitz' | 'survival'
let entryContext = 'multiplayer'; // 'solo' | 'multiplayer' — por dónde entró a la pantalla de preparar

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
// Modo progresivo: cada canción empieza sonando 1 segundo; cada vez que
// el jugador le da "escuchar más" avanza a la siguiente etapa (y baja
// el puntaje posible que puede ganar si acierta).
const PROGRESSIVE_STAGES = [0.1, 0.5, 2, 8, 10]; // segundos acumulados desde el inicio
const PROGRESSIVE_POINTS = [100, 80, 50, 25, 10];
// Después de la última etapa (15s) se deja sonar el resto del preview
// completo (hasta ~30s) en vez de cortarlo en seco — así quien ya usó
// todos los "escuchar más" y sigue sin saberla, al menos tiene la
// canción completa para intentarlo, con el puntaje mínimo como precio.
const PROGRESSIVE_ROUND_BUDGET_SECS = 35;
// Actualiza la etiqueta del botón de modo con los valores reales de
// arriba, para que nunca vuelva a quedar desactualizada si se
// cambian los tiempos.
(function updateProgressiveTabLabel() {
  const tab = document.querySelector('.mode-tab[data-mode="progressive"]');
  if (tab) tab.textContent = `Progresivo (${PROGRESSIVE_STAGES.slice(0, 3).join('s, ')}s…)`;
})();

const PLAYER_EMOJIS = ['🦊', '🐼', '🐸', '🐵', '🦁', '🐨', '🐯', '🦄', '🐙', '🦖', '🐳', '🦋', '🐺', '🦉', '🐝'];
function pickPlayerEmoji() {
  return PLAYER_EMOJIS[Math.floor(Math.random() * PLAYER_EMOJIS.length)];
}
function playerLabel(p, isMe) {
  const emoji = p.eliminated ? '💀 ' : (p.emoji ? p.emoji + ' ' : '');
  const streak = (p.streak || 0) >= 2 ? ` <span class="streak-badge">🔥${p.streak}</span>` : '';
  return `${emoji}${escapeHtml(p.name)}${isMe ? ' (tú)' : ''}${streak}`;
}
function winnerMessage(players) {
  const vals = Object.values(players || {});
  if (!vals.length) return '';
  const topScore = Math.max(...vals.map(p => p.score || 0));
  if (topScore <= 0) return '🎧 Nadie se llevó puntos esta vez — ¡a afinar el oído para la próxima!';
  const winners = vals.filter(p => (p.score || 0) === topScore).map(p => (p.emoji ? p.emoji + ' ' : '') + p.name);
  return winners.length === 1
    ? `🏆 ¡Felicidades, ${winners[0]}, eres el más rolo!`
    : `🏆 ¡Felicidades, ${winners.join(' y ')}, son los más rolos!`;
}
// Datos curiosos del final de la partida, calculados a partir de las
// rondas ya jugadas (no necesita nada nuevo del servidor).
function computeFunFactsHtml(room) {
  const rounds = room.rounds || {};
  const players = room.players || {};
  let fastestRound = null;
  let fastestMs = Infinity;
  let noOneGotIt = null;
  const firstCorrectCount = {};
  Object.values(rounds).forEach(round => {
    if (round.isTiebreak) return;
    const answers = round.answers || {};
    const answerEntries = Object.entries(answers);
    if (!answerEntries.length) return;
    const correct = answerEntries
      .filter(([, a]) => a && a.correct)
      .sort((a, b) => (a[1].answeredAt || 0) - (b[1].answeredAt || 0));
    if (!correct.length) {
      noOneGotIt = round.trackName;
      return;
    }
    if (round.playAt) {
      const elapsed = correct[0][1].answeredAt - round.playAt;
      if (elapsed >= 0 && elapsed < fastestMs) { fastestMs = elapsed; fastestRound = round.trackName; }
    }
    const winnerId = correct[0][0];
    firstCorrectCount[winnerId] = (firstCorrectCount[winnerId] || 0) + 1;
  });
  const facts = [];
  if (fastestRound) {
    facts.push(`⚡ La ronda que se resolvió más rápido fue <b>"${escapeHtml(fastestRound)}"</b> (~${(fastestMs / 1000).toFixed(1)}s).`);
  }
  if (noOneGotIt) {
    facts.push(`🤔 Nadie adivinó <b>"${escapeHtml(noOneGotIt)}"</b>.`);
  }
  let topSpeedster = null;
  let topCount = 0;
  Object.entries(firstCorrectCount).forEach(([pid, count]) => {
    if (count > topCount) { topCount = count; topSpeedster = pid; }
  });
  if (topSpeedster && players[topSpeedster]) {
    facts.push(`🚀 <b>${escapeHtml(players[topSpeedster].name)}</b> fue el primero en acertar más veces (${topCount} ${topCount === 1 ? 'ronda' : 'rondas'}).`);
  }
  if (!facts.length) return '';
  return facts.map(f => `<div class="fun-fact-row">${f}</div>`).join('');
}
function renderLeaderboardInto(container, players, highlightId, roundAnswers) {
  const sorted = Object.entries(players || {}).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  const maxScore = Math.max(1, ...sorted.map(([, p]) => p.score || 0));
  container.innerHTML = '';
  sorted.forEach(([pid, p], i) => {
    const row = document.createElement('div');
    row.className = 'result-row bar-row' + (pid === highlightId ? ' me' : '');
    let deltaHtml = '';
    if (roundAnswers) {
      const pts = (roundAnswers[pid] && roundAnswers[pid].points) || 0;
      deltaHtml = `<span class="delta ${pts > 0 ? 'pos' : 'zero'}">+${pts}</span>`;
    }
    const pct = (p.score || 0) > 0 ? Math.max(4, ((p.score || 0) / maxScore) * 100) : 0;
    row.innerHTML = `<div class="bar-fill" style="width:0%"></div><span class="name"><span class="rank">${i + 1}.</span> ${playerLabel(p, pid === highlightId)}</span><span class="score">${p.score || 0}${deltaHtml}</span>`;
    container.appendChild(row);
    requestAnimationFrame(() => {
      const fill = row.querySelector('.bar-fill');
      if (fill) fill.style.width = pct + '%';
    });
  });
}
// ---------- Confeti (sin librerías) ----------
function fireConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#FFD166', '#FF5D73', '#6FCF97', '#9C93C7', '#FFFFFF'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    r: 4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    vy: 2 + Math.random() * 3,
    vx: -1.5 + Math.random() * 3,
    rot: Math.random() * Math.PI,
    vr: -0.2 + Math.random() * 0.4,
  }));
  let frame = 0;
  const maxFrames = 200;
  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6);
      ctx.restore();
    });
    if (frame < maxFrames) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  tick();
}
// ---------- Sonidos cortos (Web Audio, sin archivos) ----------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}
function beep(freq, durationMs, type) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch (_) { /* si el navegador bloquea audio, simplemente no suena */ }
}
function playCorrectSound() { beep(880, 180, 'sine'); setTimeout(() => beep(1180, 220, 'sine'), 120); }
function playWrongSound() { beep(180, 300, 'sawtooth'); }
function playTickSound() { beep(1000, 60, 'square'); }

// ---------- Elementos ----------
const btnRoleSolo = document.getElementById('btn-role-solo');
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
const eliminationField = document.getElementById('elimination-field');
const eliminationEverySelect = document.getElementById('elimination-every-select');
const blitzField = document.getElementById('blitz-field');
const blitzSecondsSelect = document.getElementById('blitz-seconds-select');
const survivalField = document.getElementById('survival-field');
const survivalStartSelect = document.getElementById('survival-start-select');
const survivalAddSelect = document.getElementById('survival-add-select');
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
const hostRunLive = document.getElementById('host-run-live');
const hostRunLeaderboard = document.getElementById('host-run-leaderboard');
const hostRevealCard = document.getElementById('host-reveal-card');
const hostRevealTitle = document.getElementById('host-reveal-title');
const hostRevealArtist = document.getElementById('host-reveal-artist');
const hostPlayingOptions = document.getElementById('host-playing-options');
const hostRoundLeaderboard = document.getElementById('host-round-leaderboard');
const hostRevealOptions = document.getElementById('host-reveal-options');
const hostEliminatedBanner = document.getElementById('host-eliminated-banner');
const hostRoundAnswers = document.getElementById('host-round-answers');
const hostTimerWrap = document.getElementById('host-timer-wrap');
const hostTimerBar = document.getElementById('host-timer-bar');
const hostTimerText = document.getElementById('host-timer-text');
const hostVolumeSlider = document.getElementById('host-volume');
const btnNextRound = document.getElementById('btn-next-round');
const hostAudioPlayer = document.getElementById('host-audio-player');

const hostResultsList = document.getElementById('host-results-list');
const hostWinnerBanner = document.getElementById('host-winner-banner');
const hostFunFacts = document.getElementById('host-fun-facts');
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
const playerDiscArt = document.getElementById('player-disc-art');
const playerTimerWrap = document.getElementById('player-timer-wrap');
const playerTimerBar = document.getElementById('player-timer-bar');
const playerTimerText = document.getElementById('player-timer-text');
const playerVolumeSlider = document.getElementById('player-volume');
const progressiveControls = document.getElementById('progressive-controls');
const progressivePointsLabel = document.getElementById('progressive-points-label');
const btnProgressiveSkip = document.getElementById('btn-progressive-skip');
const btnProgressiveReplay = document.getElementById('btn-progressive-replay');
const betControls = document.getElementById('bet-controls');
const btnPlaceBet = document.getElementById('btn-place-bet');
const betStatus = document.getElementById('bet-status');
const eliminatedNotice = document.getElementById('eliminated-notice');
const playerAnswerGrid = document.getElementById('player-answer-grid');
const runScoreText = document.getElementById('run-score-text');
const playerReveal = document.getElementById('player-reveal');
const playerRevealBanner = document.getElementById('player-reveal-banner');
const playerPointsText = document.getElementById('player-points-text');
const playerRevealArt = document.getElementById('player-reveal-art');
const playerRevealTitle = document.getElementById('player-reveal-title');
const playerRevealArtist = document.getElementById('player-reveal-artist');
const playerRoundLeaderboard = document.getElementById('player-round-leaderboard');
const playerEliminatedBanner = document.getElementById('player-eliminated-banner');
const audioPlayer = document.getElementById('audio-player');

const playerResultsList = document.getElementById('player-results-list');
const playerWinnerBanner = document.getElementById('player-winner-banner');
const playerFunFacts = document.getElementById('player-fun-facts');
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
const soloBetControls = document.getElementById('solo-bet-controls');
const btnSoloPlaceBet = document.getElementById('btn-solo-place-bet');
const soloProgressiveControls = document.getElementById('solo-progressive-controls');
const soloProgressivePointsLabel = document.getElementById('solo-progressive-points-label');
const btnSoloProgressiveReplay = document.getElementById('btn-solo-progressive-replay');
const btnSoloProgressiveSkip = document.getElementById('btn-solo-progressive-skip');
const soloProgressiveGuessInput = document.getElementById('solo-progressive-guess-input');
const btnSoloProgressiveGuess = document.getElementById('btn-solo-progressive-guess');
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
let soloBet = false;
let soloTimerInterval = null;

function startSoloGame() {
  soloRounds = Object.values(buildRoundsFromPool());
  soloIndex = 0;
  soloScore = 0;
  soloScoreText.textContent = 'Puntaje: 0';
  showScreen('solo-game');
  setupSoloRound();
}
// ---------- Contrarreloj / Supervivencia en solitario ----------
let soloRunMode = null;
let soloRunTimeLeft = 0;
let soloRunInterval = null;
let soloRunSongTimer = null;
let soloRunAnswered = false;
let soloRunQueueIndex = 0;
const SOLO_RUN_SNIPPET_SECS = 6;
function startSoloRunMode(mode) {
  soloRunMode = mode;
  soloRounds = Object.values(buildRoundsFromPool());
  soloRunQueueIndex = 0;
  soloScore = 0;
  soloRunAnswered = false;
  soloRunTimeLeft = mode === 'survival' ? (parseInt(survivalStartSelect.value, 10) || 15) : (parseInt(blitzSecondsSelect.value, 10) || 60);
  soloScoreText.textContent = 'Aciertos: 0';
  soloProgressiveControls.classList.add('hidden');
  soloBetControls.classList.add('hidden');
  soloReveal.classList.add('hidden');
  soloDiscArt.classList.add('hidden');
  soloRoundCounter.textContent = mode === 'survival' ? '🏃 Supervivencia' : '⏱ Contrarreloj';
  showScreen('solo-game');
  startSoloRunClock();
  playNextSoloRunSong();
}
function startSoloRunClock() {
  clearInterval(soloRunInterval);
  const maxForBar = soloRunMode === 'survival'
    ? (parseInt(survivalStartSelect.value, 10) || 15) + (parseInt(survivalAddSelect.value, 10) || 5) * 3
    : soloRunTimeLeft;
  soloTimerWrap.classList.remove('hidden');
  const updateBar = () => {
    soloTimerText.textContent = Math.ceil(soloRunTimeLeft) + 's';
    const pct = Math.max(0, Math.min(100, (soloRunTimeLeft / maxForBar) * 100));
    soloTimerBar.style.width = pct + '%';
    soloTimerBar.classList.toggle('urgent', soloRunTimeLeft <= 5);
  };
  updateBar();
  soloRunInterval = setInterval(() => {
    soloRunTimeLeft -= 1;
    updateBar();
    if (soloRunTimeLeft <= 0) endSoloRunMode();
  }, 1000);
}
function playNextSoloRunSong() {
  if (soloRunTimeLeft <= 0) return;
  soloRunAnswered = false;
  const round = soloRounds[soloRunQueueIndex % soloRounds.length];
  soloRunQueueIndex += 1;

  soloAnswerGrid.classList.remove('hidden');
  soloAnswerGrid.innerHTML = '';
  btnSoloManualPlay.classList.add('hidden');
  round.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = opt;
    btn.onclick = () => submitSoloRunAnswer(i, round.correctIndex);
    soloAnswerGrid.appendChild(btn);
  });

  soloAudioPlayer.src = round.previewUrl;
  soloAudioPlayer.load();
  soloAudioPlayer.currentTime = 0;
  soloAudioPlayer.play().catch(() => { btnSoloManualPlay.classList.remove('hidden'); });
  btnSoloManualPlay.onclick = () => { soloAudioPlayer.play().catch(() => {}); };
  soloDisc.classList.add('spinning');
  soloStatusText.textContent = '🔊 ¡Adivina rápido!';

  clearTimeout(soloRunSongTimer);
  soloRunSongTimer = setTimeout(() => {
    if (!soloRunAnswered) submitSoloRunAnswer(-1, round.correctIndex);
  }, SOLO_RUN_SNIPPET_SECS * 1000);
}
function submitSoloRunAnswer(optionIndex, correctIndex) {
  if (soloRunAnswered || soloRunTimeLeft <= 0) return;
  soloRunAnswered = true;
  clearTimeout(soloRunSongTimer);
  soloAudioPlayer.pause();
  const buttons = soloAnswerGrid.querySelectorAll('.answer-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === correctIndex) b.classList.add('correct');
    else if (i === optionIndex) b.classList.add('wrong');
  });
  const correct = optionIndex === correctIndex;
  if (correct) {
    soloScore += 1;
    playCorrectSound();
    soloScoreText.textContent = `Aciertos: ${soloScore}`;
    if (soloRunMode === 'survival') soloRunTimeLeft += (parseInt(survivalAddSelect.value, 10) || 5);
  } else {
    playWrongSound();
  }
  setTimeout(() => {
    if (soloRunTimeLeft > 0) playNextSoloRunSong();
  }, 400);
}
function endSoloRunMode() {
  clearInterval(soloRunInterval);
  clearTimeout(soloRunSongTimer);
  soloAudioPlayer.pause();
  soloDisc.classList.remove('spinning');
  soloTimerWrap.classList.add('hidden');
  soloAnswerGrid.classList.add('hidden');
  soloFinalScore.textContent = `🏁 ¡Se acabó tu tiempo! Terminaste con ${soloScore} aciertos.`;
  showScreen('solo-results');
}
function setupSoloRound() {
  soloAnswered = false;
  const round = soloRounds[soloIndex];
  if (round.isProgressive) {
    setupSoloProgressiveRound(round);
    return;
  }
  soloProgressiveControls.classList.add('hidden');
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
  soloBet = false;
  if (gameMode === 'bet') {
    soloBetControls.classList.remove('hidden');
    btnSoloPlaceBet.disabled = false;
    btnSoloPlaceBet.textContent = '💰 Apostar doble o nada esta ronda';
    btnSoloPlaceBet.onclick = () => {
      if (soloAnswered) return;
      soloBet = true;
      btnSoloPlaceBet.disabled = true;
      btnSoloPlaceBet.textContent = '💰 Apostado — doble si aciertas, -100 si fallas';
    };
  } else {
    soloBetControls.classList.add('hidden');
  }

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
  soloBetControls.classList.add('hidden');
  const buttons = soloAnswerGrid.querySelectorAll('.answer-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === correctIndex) b.classList.add('correct');
    else if (i === optionIndex) b.classList.add('wrong');
  });
  const correct = optionIndex === correctIndex;
  let pointsText = '';
  if (gameMode === 'bet') {
    let pts;
    if (correct) { pts = soloBet ? RANK_POINTS_START * 2 : RANK_POINTS_START; playCorrectSound(); }
    else { pts = soloBet ? -RANK_POINTS_START : 0; playWrongSound(); }
    soloScore = Math.max(0, soloScore + pts);
    pointsText = ` (${pts >= 0 ? '+' : ''}${pts} pts)`;
  } else {
    if (correct) soloScore += 1;
    if (correct) playCorrectSound(); else playWrongSound();
  }
  soloScoreText.textContent = gameMode === 'bet' ? `Puntaje: ${soloScore}` : `Puntaje: ${soloScore}`;
  soloAnswerGrid.classList.add('hidden');
  soloReveal.classList.remove('hidden');
  const baseMsg = correct ? '✅ ¡Correcto!' : (optionIndex === -1 ? '⌛ Se acabó el tiempo' : '❌ Fallaste');
  soloRevealBanner.textContent = baseMsg + pointsText;
  soloRevealTitle.textContent = round.trackName;
  soloRevealArtist.textContent = round.trackArtist;
  if (round.trackImage) { soloRevealArt.src = round.trackImage; soloRevealArt.classList.remove('hidden'); }
  else soloRevealArt.classList.add('hidden');
  btnSoloNext.textContent = (soloIndex + 1 >= soloRounds.length) ? 'Ver resultado' : 'Siguiente canción';
}
// ---------- Modo Progresivo en solitario ----------
let soloProgressiveStageIndex = 0;
// Llena el <datalist> de sugerencias del modo progresivo con "Artista -
// Canción" de cada canción del pool — así al escribir el nombre de la
// canción O el del artista, el navegador sugiere coincidencias.
function populateProgressiveDatalist() {
  const datalist = document.getElementById('solo-progressive-song-list');
  if (!datalist) return;
  datalist.innerHTML = '';
  const seen = new Set();
  previewPool.forEach(t => {
    const label = `${(t.artists && t.artists[0]) || ''} - ${t.name}`;
    if (seen.has(label)) return;
    seen.add(label);
    const opt = document.createElement('option');
    opt.value = label;
    datalist.appendChild(opt);
  });
}
function setupSoloProgressiveRound(round) {
  soloAnswered = false;
  soloProgressiveStageIndex = 0;
  soloRoundCounter.textContent = `Ronda ${soloIndex + 1}/${soloRounds.length}`;
  soloReveal.classList.add('hidden');
  soloAnswerGrid.classList.add('hidden');
  soloProgressiveControls.classList.remove('hidden');
  btnSoloManualPlay.classList.add('hidden');
  soloTimerWrap.classList.add('hidden');
  clearInterval(soloTimerInterval);
  soloDisc.classList.add('spinning');
  if (round.trackImage) {
    soloDiscArt.src = round.trackImage;
    soloDiscArt.classList.remove('hidden');
    soloDiscArt.style.filter = 'blur(20px)';
  } else {
    soloDiscArt.classList.add('hidden');
  }
  soloProgressivePointsLabel.textContent = `Vale ${PROGRESSIVE_POINTS[0]} pts`;
  soloProgressiveGuessInput.value = '';
  soloProgressiveGuessInput.disabled = false;
  btnSoloProgressiveGuess.disabled = false;
  btnSoloProgressiveSkip.classList.remove('hidden');
  soloStatusText.textContent = '🔊 ¡Escucha!';

  soloAudioPlayer.src = round.previewUrl;
  soloAudioPlayer.load();
  btnSoloManualPlay.onclick = () => { soloAudioPlayer.play().catch(() => {}); };
  btnSoloProgressiveReplay.onclick = () => replaySoloProgressiveStage();
  btnSoloProgressiveSkip.onclick = () => {
    soloProgressiveGuessInput.value = '';
    advanceSoloProgressiveStage();
    soloProgressiveGuessInput.focus();
  };
  btnSoloProgressiveGuess.onclick = () => submitSoloProgressiveGuess(round);
  soloProgressiveGuessInput.onkeydown = (e) => { if (e.key === 'Enter') submitSoloProgressiveGuess(round); };

  soloAudioPlayer.currentTime = 0;
  soloAudioPlayer.play().catch(() => { btnSoloManualPlay.classList.remove('hidden'); });
  clearTimeout(localSnippetTimer);
  scheduleSoloProgressivePause(0, PROGRESSIVE_STAGES[0]);
  soloProgressiveGuessInput.focus();
}
function scheduleSoloProgressivePause(fromSeconds, toSeconds) {
  clearTimeout(localSnippetTimer);
  const ms = Math.max(0, (toSeconds - fromSeconds) * 1000);
  localSnippetTimer = setTimeout(() => { soloAudioPlayer.pause(); }, ms);
}
function replaySoloProgressiveStage() {
  if (soloAnswered) return;
  soloAudioPlayer.currentTime = 0;
  soloAudioPlayer.play().catch(() => {});
  const isLastStage = soloProgressiveStageIndex >= PROGRESSIVE_STAGES.length - 1;
  if (isLastStage) clearTimeout(localSnippetTimer);
  else scheduleSoloProgressivePause(0, PROGRESSIVE_STAGES[soloProgressiveStageIndex]);
}
function advanceSoloProgressiveStage() {
  if (soloAnswered) return;
  if (soloProgressiveStageIndex >= PROGRESSIVE_STAGES.length - 1) return;
  const fromSeconds = PROGRESSIVE_STAGES[soloProgressiveStageIndex];
  soloProgressiveStageIndex += 1;
  const isLastStage = soloProgressiveStageIndex >= PROGRESSIVE_STAGES.length - 1;
  soloProgressivePointsLabel.textContent = `Vale ${PROGRESSIVE_POINTS[soloProgressiveStageIndex]} pts`;
  if (!soloDiscArt.classList.contains('hidden')) {
    const blurAmount = Math.max(0, 20 - soloProgressiveStageIndex * 5);
    soloDiscArt.style.filter = `blur(${blurAmount}px)`;
  }
  playTickSound();
  soloAudioPlayer.play().catch(() => {});
  if (isLastStage) {
    clearTimeout(localSnippetTimer);
    soloStatusText.textContent = '🔊 Última oportunidad — suena hasta el final del fragmento.';
    btnSoloProgressiveSkip.classList.add('hidden');
  } else {
    scheduleSoloProgressivePause(fromSeconds, PROGRESSIVE_STAGES[soloProgressiveStageIndex]);
    soloStatusText.textContent = `No era esa — sigue escuchando (${PROGRESSIVE_STAGES[soloProgressiveStageIndex]}s)...`;
  }
}
function submitSoloProgressiveGuess(round) {
  if (soloAnswered) return;
  const guess = soloProgressiveGuessInput.value.trim();
  const correct = isGuessCorrect(guess, round.trackName);
  if (correct) {
    finishSoloProgressiveRound(true, round);
    return;
  }
  soloProgressiveGuessInput.value = '';
  const isLastStage = soloProgressiveStageIndex >= PROGRESSIVE_STAGES.length - 1;
  if (isLastStage) {
    finishSoloProgressiveRound(false, round);
  } else {
    playWrongSound();
    advanceSoloProgressiveStage();
    soloProgressiveGuessInput.focus();
  }
}
function finishSoloProgressiveRound(correct, round) {
  if (soloAnswered) return;
  soloAnswered = true;
  clearTimeout(localSnippetTimer);
  soloAudioPlayer.pause();
  soloDisc.classList.remove('spinning');
  soloProgressiveGuessInput.disabled = true;
  btnSoloProgressiveGuess.disabled = true;
  const points = correct ? PROGRESSIVE_POINTS[soloProgressiveStageIndex] : 0;
  if (correct) { soloScore += points; playCorrectSound(); } else { playWrongSound(); }
  soloScoreText.textContent = `Puntaje: ${soloScore}`;
  soloProgressiveControls.classList.add('hidden');
  soloReveal.classList.remove('hidden');
  soloRevealBanner.textContent = correct ? `✅ ¡Correcto! +${points} pts` : '❌ No la adivinaste';
  soloRevealTitle.textContent = round.trackName;
  soloRevealArtist.textContent = round.trackArtist;
  if (round.trackImage) { soloRevealArt.src = round.trackImage; soloRevealArt.classList.remove('hidden'); }
  else soloRevealArt.classList.add('hidden');
  btnSoloNext.textContent = (soloIndex + 1 >= soloRounds.length) ? 'Ver resultado' : 'Siguiente canción';
}
function soloFinalScoreText() {
  if (gameMode === 'progressive' || gameMode === 'bet') return `🎧 Terminaste con ${soloScore} puntos.`;
  return `🎧 Terminaste con ${soloScore}/${soloRounds.length} aciertos.`;
}
btnSoloNext.onclick = () => {
  soloIndex += 1;
  if (soloIndex >= soloRounds.length) {
    soloFinalScore.textContent = soloFinalScoreText();
    showScreen('solo-results');
  } else {
    setupSoloRound();
  }
};
btnQuitSolo.onclick = () => {
  clearInterval(soloTimerInterval);
  clearInterval(soloRunInterval);
  clearTimeout(localSnippetTimer);
  clearTimeout(soloRunSongTimer);
  soloAudioPlayer.pause();
  soloFinalScore.textContent = (soloRunMode === 'blitz' || soloRunMode === 'survival')
    ? `🏁 Terminaste con ${soloScore} aciertos.`
    : soloFinalScoreText();
  soloRunMode = null;
  showScreen('solo-results');
};
btnSoloPlayAgain.onclick = () => {
  if (gameMode === 'blitz' || gameMode === 'survival') startSoloRunMode(gameMode);
  else startSoloGame();
};
btnSoloNewSetup.onclick = () => { soloRunMode = null; showScreen('host-setup'); };

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
  sessionStorage.setItem('rq_entry_context', entryContext);
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
async function spotifyGet(url, attempt, onRetry) {
  attempt = attempt || 1;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (networkErr) {
    // Fallo de RED (el navegador nunca recibió respuesta). A veces es
    // la conexión, pero Spotify también tiene un bug confirmado de su
    // lado (preflight de CORS que a veces no responde con los permisos
    // correctos) que se ve exactamente igual e intermitente — por eso
    // insistimos varias veces con más espera entre cada intento, ya
    // que en otro intento puede tocarle un servidor de Spotify que sí
    // responda bien.
    const MAX_ATTEMPTS = 6;
    if (attempt < MAX_ATTEMPTS) {
      if (onRetry) onRetry(attempt, MAX_ATTEMPTS);
      await sleep(Math.min(12000, 400 * Math.pow(2, attempt)));
      return spotifyGet(url, attempt + 1, onRetry);
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
    return 'No se pudo conectar con Spotify después de varios intentos. Esto puede ser tu conexión, pero también hay un bug confirmado y actualmente activo del lado de Spotify (falla intermitente en el "preflight" de CORS de api.spotify.com — reportado en su foro de desarrolladores en julio 2026, todavía sin resolver). No es algo que puedas arreglar tú: si sigue pasando, dale a 🔄 cada rato, o copia el link de la playlist con "Compartir → Copiar link" y pégalo abajo — ese camino usa una llamada distinta que suele funcionar aunque esta falle.';
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
// Igual que fetchAllPages, pero muestra el progreso de los reintentos
// en pantalla — se usa donde ya sabemos que Spotify puede tardar en
// responder bien (ver el bug de CORS explicado arriba de spotifyGet).
async function fetchAllPagesWithRetryStatus(url) {
  let items = [];
  let next = url;
  while (next) {
    const data = await spotifyGet(next, 1, (attempt, max) => {
      playlistCountStatus.textContent = `Spotify no respondió a la primera (intento ${attempt}/${max})… reintentando.`;
    });
    items = items.concat(data.items || []);
    next = data.next;
  }
  return items;
}
async function loadPlaylists() {
  playlistCountStatus.classList.remove('error-text');
  playlistCountStatus.textContent = 'Buscando tus playlists…';
  try {
    const items = await fetchAllPagesWithRetryStatus('https://api.spotify.com/v1/me/playlists?limit=50');
    playlistSelect.innerHTML = '';
    // Spotify a veces manda "null" en vez de un objeto de playlist para
    // ciertas playlists algorítmicas/editoriales (Blends incluidos) —
    // es un bug conocido de su lado. Si no se filtran, rompen el resto
    // de la lista.
    const validItems = items.filter(Boolean);
    const skipped = items.length - validItems.length;
    if (!validItems.length) {
      playlistSelect.innerHTML = '<option value="">No se encontraron playlists</option>';
      playlistCountStatus.textContent = 'No se encontró ninguna playlist en esta cuenta.';
      return;
    }
    validItems.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${(p.tracks && p.tracks.total) || 0})`;
      opt.dataset.url = (p.external_urls && p.external_urls.spotify) || '';
      opt.dataset.name = p.name;
      playlistSelect.appendChild(opt);
    });
    playlistCountStatus.textContent = `Se encontraron ${validItems.length} playlist(s). ¿No ves la que buscas? Dale a 🔄 para recargar, o pégala manualmente abajo (debe ser pública si no es tuya).`
      + (skipped > 0 ? ` (${skipped} playlist(s) algorítmica(s)/editorial(es), como Blends, no las manda Spotify en esta lista por un bug de su lado — pégalas manualmente con su link.)` : '');
  } catch (e) {
    console.error(e);
    playlistSelect.innerHTML = '<option value="">No se pudo cargar — usa el link manual</option>';
    let msg = describeSpotifyError(e);
    if (e instanceof TypeError) {
      msg = 'No se pudo cargar la lista (bug conocido de Spotify, sin resolver por ahora). Usa el buscador o pega el link de tu playlist/Blend abajo (Compartir → Copiar link en Spotify) — eso sí funciona.';
    }
    playlistCountStatus.textContent = msg;
    playlistCountStatus.classList.add('error-text');
    setupStatus.textContent = '';
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
// Al elegir una playlist del desplegable, rellena también el campo de
// link de abajo con su URL — así queda claro cuál se va a usar, y se
// puede confirmar con el mismo botón "Usar" del link manual.
playlistSelect.onchange = () => {
  const opt = playlistSelect.selectedOptions[0];
  if (!opt || !opt.value) return;
  selectPlaylistSource();
  manualPlaylistId = opt.value;
  playlistUrlInput.value = opt.dataset.url || opt.value;
  playlistUrlStatus.classList.remove('hidden');
  playlistUrlStatus.textContent = `Elegiste "${opt.dataset.name || opt.textContent}" desde tu lista — lista para usar.`;
};
btnUsePlaylistUrl.onclick = () => {
  const id = extractPlaylistId(playlistUrlInput.value);
  playlistUrlStatus.classList.remove('hidden');
  if (!id) {
    manualPlaylistId = null;
    playlistUrlStatus.textContent = 'No reconozco ese link. Cópialo desde "Compartir → Copiar link" en Spotify.';
    return;
  }
  selectPlaylistSource();
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
          ? 'No se pudo leer esa playlist (403). Prueba eligiéndola directo de la lista desplegable "Mis playlists" en vez de pegar el link. Si YA confirmaste que es tuya y de todos modos falla: (1) cierra sesión y vuelve a conectar para renovar el token, por si quedó viejo; (2) prueba cambiando la playlist de privada a pública (o viceversa) y vuelve a intentar — hay bugs reportados de Spotify justo en este endpoint desde su migración de 2026; (3) revisa la consola del navegador (F12) por si el mensaje de error trae más detalle.'
          : 'No se pudo leer esa playlist (403), lo cual es raro tratándose de una playlist tuya de la lista desplegable. Prueba: (1) cerrar sesión y volver a conectar para renovar el token; (2) cambiar la playlist de privada a pública (o viceversa) y reintentar — hay bugs reportados de Spotify en este endpoint desde su migración de 2026; (3) recargar la lista (🔄).'
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
    script.src = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=10&callback=${cbName}`;
    script.onerror = () => { if (!done) { done = true; resolve(null); cleanup(); } };
    document.body.appendChild(script);
    setTimeout(() => { if (!done) { done = true; resolve(null); cleanup(); } }, 6000);
  });
}
// Normaliza títulos/artistas para comparar: minúsculas, sin acentos,
// sin sufijos de "(feat. X)", "- Remix", "- Live", etc.
function normalizeForMatch(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\((feat|ft|with)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s*-\s*(remix|live|radio edit|re-?master(ed)?( \d{2,4})?|mono|stereo|single|deluxe( edition)?|version|edit|acoustic|instrumental)\b.*$/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
// Compara lo que escribió la persona contra el título real, tolerando
// pequeños errores de tipeo, acentos, mayúsculas, "feat.", etc. — no
// exige una coincidencia exacta letra por letra.
function isGuessCorrect(guess, correctName) {
  const g = normalizeForMatch(guess);
  const c = normalizeForMatch(correctName);
  if (!g || !c) return false;
  if (g === c) return true;
  if (c.includes(g) && g.length >= Math.max(3, Math.floor(c.length * 0.6))) return true;
  if (g.includes(c)) return true;
  const dist = levenshteinDistance(g, c);
  const threshold = Math.max(1, Math.floor(c.length * 0.25));
  return dist <= threshold;
}
// Entre los resultados de iTunes, elige el que de verdad corresponde a
// la canción y artista que buscamos — no solo el primero con audio.
// Esto evita que, por ejemplo, buscar "Telescope" de un rapero termine
// devolviendo una canción sin relación solo porque también se llama
// "Telescope" y tenía preview disponible.
function findBestItunesMatch(results, targetName, targetArtist) {
  const normName = normalizeForMatch(targetName);
  const normArtist = normalizeForMatch(targetArtist);
  const candidates = (results || []).filter(r => r.previewUrl);

  // Exige que el artista coincida al menos parcialmente — esto es lo
  // que evita el caso "Telescope": nunca devolvemos la canción de
  // OTRO artista solo porque el título es igual. Si ningún resultado
  // tiene un artista parecido, preferimos no usar audio para esa
  // canción antes que arriesgarnos a poner la equivocada.
  const artistMatches = candidates.filter(r => {
    const rArtist = normalizeForMatch(r.artistName);
    if (!normArtist || !rArtist) return false;
    return rArtist === normArtist || rArtist.includes(normArtist) || normArtist.includes(rArtist);
  });
  if (!artistMatches.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const r of artistMatches) {
    const rName = normalizeForMatch(r.trackName);
    let score = 0;
    if (rName === normName) score += 10;
    else if (normName && (rName.includes(normName) || normName.includes(rName))) score += 5;
    else {
      const a = new Set(normName.split(' ').filter(Boolean));
      const b = new Set(rName.split(' ').filter(Boolean));
      const shared = [...a].filter(w => b.has(w)).length;
      score += shared - Math.max(a.size, b.size, 1);
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  // El artista ya coincidió (filtro de arriba); con algo de similitud
  // razonable en el título alcanza.
  return bestScore >= 2 ? best : null;
}
async function findPreview(track) {
  const artist = track.artists[0] || '';
  const term = `${artist} ${track.name}`.trim();
  await throttleItunes();
  const data = await itunesSearch(term);
  const best = findBestItunesMatch(data && data.results, track.name, artist);
  if (best) return best.previewUrl;
  // Si la búsqueda combinada no encontró una coincidencia confiable,
  // prueba solo con el nombre de la canción (a veces el nombre del
  // artista no viene escrito igual en Spotify que en iTunes).
  await throttleItunes();
  const data2 = await itunesSearch(track.name);
  const best2 = findBestItunesMatch(data2 && data2.results, track.name, artist);
  if (best2) return best2.previewUrl;
  return null;
}

// ---------- Tabs de fuente ----------
// ---------- Fuente de canciones: chip "Mis Me Gusta" + selección de playlist ----------
// selectedSource arranca en 'liked'. En cuanto la persona interactúa
// con cualquier forma de elegir playlist (desplegable, link, buscador),
// pasamos automáticamente a 'playlist' y se desmarca el chip.
const sourceChipLiked = document.getElementById('source-chip-liked');
function selectLikedSource() {
  selectedSource = 'liked';
  manualPlaylistId = null;
  sourceChipLiked.classList.add('selected');
}
function selectPlaylistSource() {
  selectedSource = 'playlist';
  sourceChipLiked.classList.remove('selected');
}
sourceChipLiked.onclick = () => selectLikedSource();

// ---------- Tabs de modo de juego ----------
const MODE_HINTS = {
  normal: 'El primero en acertar se lleva 100 puntos, bajando hasta un piso de 50 para los siguientes.',
  sudden: 'Solo el primero en acertar cada canción se lleva 1 punto — nadie más suma esa ronda. Si al final hay empate, se juega una ronda extra solo entre los empatados.',
  progressive: `Modo de un jugador (no crea sala, sin esperar a nadie): escribes el nombre de la canción. Empieza sonando solo ${PROGRESSIVE_STAGES[0]}s; si fallas, pasa sola a los siguientes segundos (${PROGRESSIVE_STAGES.slice(1).join('s, ')}s) para seguir escuchando e intentar de nuevo — pero cada vez que avanza, bajan los puntos posibles (${PROGRESSIVE_POINTS.join(' → ')}).`,
  elimination: 'Puntaje normal por velocidad, pero cada cierto número de rondas el de menor puntaje queda eliminado (sigue mirando, ya no responde). Gana quien quede de último en pie.',
  bet: 'Antes de responder puedes apostar "doble o nada": si apuestas y aciertas, te llevas el DOBLE de puntos de esa ronda; si apuestas y fallas, pierdes 100 puntos de tu marcador. No apostar es la opción segura de siempre.',
  blitz: 'Todos corren contra el mismo reloj: adivina tantas canciones como puedas antes de que se acabe el tiempo. Cada jugador escucha a su propio ritmo — no espera a los demás.',
  survival: 'Empiezas con un reloj corto que no para de bajar. Cada acierto te suma segundos para seguir vivo; si el reloj llega a cero, se acabó tu partida. Cada quien juega a su ritmo, tratando de aguantar lo más posible.',
  solo: 'Practica tú solo, sin sala ni amigos: escuchas, adivinas y ves tu puntaje al final.',
};
modeTabs.forEach(tab => {
  tab.onclick = () => {
    modeTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    gameMode = tab.dataset.mode;
    modeHint.textContent = MODE_HINTS[gameMode] || '';
    btnCreateRoom.textContent = entryContext === 'solo' ? 'Empezar a practicar' : 'Crear sala';
    const isRunMode = gameMode === 'blitz' || gameMode === 'survival';
    document.getElementById('snippet-field').style.display = (gameMode === 'progressive' || isRunMode) ? 'none' : '';
    document.getElementById('rounds-select').closest('.field-group').style.display = isRunMode ? 'none' : '';
    eliminationField.classList.toggle('hidden', gameMode !== 'elimination');
    blitzField.classList.toggle('hidden', gameMode !== 'blitz');
    survivalField.classList.toggle('hidden', gameMode !== 'survival');
  };
});

// ---------- Buscador de playlists por nombre (con paginación) ----------
let playlistSearchQuery = '';
async function runPlaylistSearch(offset) {
  playlistSearchResults.innerHTML = '<p class="hint">Buscando…</p>';
  try {
    const data = await spotifyGet(`https://api.spotify.com/v1/search?type=playlist&q=${encodeURIComponent(playlistSearchQuery)}&limit=10&offset=${offset}`);
    const items = (data.playlists && data.playlists.items) ? data.playlists.items.filter(Boolean) : [];
    const total = (data.playlists && data.playlists.total) || 0;
    playlistSearchResults.innerHTML = '';
    if (!items.length) {
      playlistSearchResults.innerHTML = `<p class="hint">No se encontró nada${offset > 0 ? ' en esta página' : ' con ese nombre'}.</p>`;
      return;
    }
    items.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.style.cursor = 'pointer';
      const ownerName = (p.owner && p.owner.display_name) || 'alguien';
      chip.textContent = `${p.name} — de ${ownerName} (${(p.tracks && p.tracks.total) || '?'} canciones)`;
      chip.onclick = () => {
        selectPlaylistSource();
        manualPlaylistId = p.id;
        playlistUrlInput.value = (p.external_urls && p.external_urls.spotify) || p.id;
        playlistUrlStatus.classList.remove('hidden');
        playlistUrlStatus.textContent = `Elegiste "${p.name}". Solo va a funcionar si es tuya o colaboras en ella — si no, Spotify la rechazará con un 403 al crear la sala.`;
      };
      playlistSearchResults.appendChild(chip);
    });
    const pager = document.createElement('div');
    pager.className = 'pager';
    const btnPrev = document.createElement('button');
    btnPrev.className = 'btn btn--ghost btn--sm';
    btnPrev.textContent = '← Anterior';
    btnPrev.disabled = offset === 0;
    btnPrev.onclick = () => runPlaylistSearch(Math.max(0, offset - 10));
    const pageLabel = document.createElement('span');
    pageLabel.className = 'hint';
    pageLabel.textContent = `Página ${Math.floor(offset / 10) + 1}`;
    const btnNext = document.createElement('button');
    btnNext.className = 'btn btn--ghost btn--sm';
    btnNext.textContent = 'Siguiente →';
    btnNext.disabled = items.length < 10 || (offset + 10) >= total;
    btnNext.onclick = () => runPlaylistSearch(offset + 10);
    pager.appendChild(btnPrev);
    pager.appendChild(pageLabel);
    pager.appendChild(btnNext);
    playlistSearchResults.appendChild(pager);
  } catch (e) {
    console.error(e);
    playlistSearchResults.innerHTML = `<p class="hint error-text">${escapeHtml(describeSpotifyError(e))}</p>`;
  }
}
btnSearchPlaylists.onclick = () => {
  const q = playlistSearchInput.value.trim();
  if (!q) return;
  playlistSearchQuery = q;
  runPlaylistSearch(0);
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
      isProgressive: gameMode === 'progressive',
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

// Control de velocidad para las búsquedas en iTunes: sin esto, pedir
// muchas canciones seguidas (sobre todo con la búsqueda doble que
// evita el bug de "canción equivocada") puede disparar el límite de
// peticiones de iTunes y hacer que deje de responder por completo.
let lastItunesCallAt = 0;
async function throttleItunes() {
  const wait = Math.max(0, lastItunesCallAt + 220 - Date.now());
  if (wait > 0) await sleep(wait);
  lastItunesCallAt = Date.now();
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

  const target = Math.max(roundsCount * 2, Math.min(normalized.length, 30));
  previewPool = [];
  let checked = 0;
  let consecutiveMisses = 0;
  setupStatus.textContent = `Buscando audio: 0/${target}`;
  for (const track of normalized) {
    if (previewPool.length >= target) break;
    checked++;
    const url = await findPreview(track);
    if (url) {
      previewPool.push({ ...track, previewUrl: url });
      consecutiveMisses = 0;
      setupStatus.textContent = `Buscando audio: ${previewPool.length}/${target}`;
    } else {
      consecutiveMisses++;
    }
    // Si llevamos muchos intentos seguidos sin encontrar NADA, lo más
    // probable es que iTunes esté bloqueando/limitando las peticiones
    // en este momento — mejor avisar claro que quedarse congelado
    // revisando cientos de canciones una por una.
    if (previewPool.length === 0 && consecutiveMisses >= 25) {
      throw new Error('iTunes no está devolviendo resultados de audio en este momento (puede ser un límite de peticiones temporal de su parte). Espera un minuto y vuelve a intentar.');
    }
  }
  if (previewPool.length < 4) {
    throw new Error('No se encontró suficiente audio (mínimo 4 canciones). Prueba con otra playlist.');
  }
  if (previewPool.length < roundsCount) roundsCount = previewPool.length;
  populateProgressiveDatalist();
}

// ---------- Crear sala (anfitrión) ----------
btnCreateRoom.onclick = async () => {
  if (selectedSource === 'playlist' && !manualPlaylistId && !playlistSelect.value) {
    setupStatus.textContent = 'Elige una playlist o pega un link.';
    return;
  }
  const isSoloFlow = entryContext === 'solo';
  if (!isSoloFlow && !initFirebase()) {
    setupStatus.textContent = 'Falta configurar Firebase en app.js (ver instrucciones arriba del archivo).';
    return;
  }
  btnCreateRoom.disabled = true;
  const isRunMode = gameMode === 'blitz' || gameMode === 'survival';
  roundsCount = isRunMode ? 60 : parseInt(roundsSelect.value, 10);
  snippetLength = parseInt(snippetSelect.value, 10);
  try {
    await buildPreviewPoolFromSource();

    if (isSoloFlow) {
      if (gameMode === 'blitz' || gameMode === 'survival') {
        startSoloRunMode(gameMode);
      } else {
        startSoloGame();
      }
      return;
    }

    setupStatus.textContent = 'Creando sala…';
    currentRoomCode = await createUniqueRoomCode();
    const rounds = buildRoundsFromPool();
    roomRef = db.ref('rooms/' + currentRoomCode);
    const settings = { roundsCount, snippetLength, mode: gameMode };
    if (gameMode === 'elimination') settings.eliminationEvery = parseInt(eliminationEverySelect.value, 10);
    if (gameMode === 'blitz') settings.blitzSeconds = parseInt(blitzSecondsSelect.value, 10);
    if (gameMode === 'survival') {
      settings.survivalStart = parseInt(survivalStartSelect.value, 10);
      settings.survivalAdd = parseInt(survivalAddSelect.value, 10);
    }
    await withTimeout(roomRef.set({
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      status: 'lobby',
      currentRound: 0,
      settings,
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
      chip.innerHTML = `${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)} — ${p.score || 0} pts`;
      hostPlayersList.appendChild(chip);
    });
  }
  btnStartGame.disabled = names.length === 0;
}
let hostRunTickInterval = null;
function renderHostRunLive(room) {
  hostDisc.classList.remove('spinning');
  hostDiscArt.classList.add('hidden');
  hostTimerWrap.classList.add('hidden');
  hostPlayingOptions.classList.add('hidden');
  hostRevealCard.classList.add('hidden');
  btnNextRound.classList.add('hidden');
  hostRunLive.classList.remove('hidden');
  const mode = room.settings.mode;
  clearInterval(hostRunTickInterval);
  if (mode === 'blitz') {
    const blitzSeconds = room.settings.blitzSeconds || 60;
    const endAt = room.playAt + blitzSeconds * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.round((endAt - getServerNow()) / 1000));
      hostRoundCounter.textContent = `⏱ ${remaining}s restantes`;
      if (remaining <= 0) clearInterval(hostRunTickInterval);
    };
    tick();
    hostRunTickInterval = setInterval(tick, 1000);
    hostGameStatus.textContent = 'Cada quien adivina a su propio ritmo — el leaderboard se actualiza solo.';
  } else {
    hostRoundCounter.textContent = '🏃 Supervivencia en curso';
    hostGameStatus.textContent = 'Dale a "Terminar" cuando quieras cerrar la partida y ver los resultados.';
  }
  hostAnswerCount.textContent = '';
  renderLeaderboardInto(hostRunLeaderboard, room.players || {}, null);
}
function renderHostGame(room) {
  showScreen('host-game');
  const isRunMode = room.settings && (room.settings.mode === 'blitz' || room.settings.mode === 'survival');
  if (isRunMode) {
    renderHostRunLive(room);
    return;
  }
  hostRunLive.classList.add('hidden');
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
      if (round.isProgressive) {
        hostGameStatus.textContent = '🔊 Cada jugador escucha a su propio ritmo (modo progresivo) — 1s, 3s, 6s, 10s, 15s…';
        hostTimerWrap.classList.add('hidden');
      } else {
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
      return { p, answered: !!a, correct: !!(a && a.correct), points: (a && a.points) || 0 };
    }).sort((a, b) => b.points - a.points);
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const icon = r.correct ? '✅' : (r.answered ? '❌' : '⌛');
      row.innerHTML = `<span class="name">${icon} ${playerLabel(r.p, false)}</span><span class="delta ${r.points > 0 ? 'pos' : 'zero'}">+${r.points}</span>`;
      hostRoundAnswers.appendChild(row);
    });

    const eliminatedThisRound = round.eliminatedThisRound;
    if (eliminatedThisRound && eliminatedThisRound.length) {
      hostEliminatedBanner.textContent = `💀 Quedaron eliminados: ${eliminatedThisRound.join(', ')}`;
      hostEliminatedBanner.classList.remove('hidden');
    } else {
      hostEliminatedBanner.classList.add('hidden');
    }
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
  hostFunFacts.innerHTML = computeFunFactsHtml(room);
  const sorted = Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0));
  const topScore = sorted.length ? (sorted[0].score || 0) : 0;
  hostResultsList.innerHTML = '';
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'result-row' + ((p.score || 0) === topScore && topScore > 0 ? ' winner' : '');
    row.innerHTML = `<span class="name">${playerLabel(p, false)}</span><span class="score">${p.score || 0}</span>`;
    hostResultsList.appendChild(row);
  });
  if (topScore > 0) fireConfetti();
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
btnStartGame.onclick = () => {
  if (gameMode === 'blitz' || gameMode === 'survival') {
    startRunModeHost();
  } else {
    startRound(0);
  }
};
async function startRunModeHost() {
  const playAt = getServerNow() + 3000;
  await roomRef.update({ status: 'playing', currentRound: 0, playAt });
  if (gameMode === 'blitz') {
    const snap = await roomRef.child('settings/blitzSeconds').once('value');
    const blitzSeconds = snap.val() || 60;
    clearTimeout(hostRoundTimer);
    const delay = Math.max(0, playAt - getServerNow()) + blitzSeconds * 1000 + 2000;
    hostRoundTimer = setTimeout(() => { roomRef.update({ status: 'finished' }); }, delay);
  }
  // En modo Supervivencia no se agenda un final automático — cada
  // quien juega a su propio ritmo hasta que se queda sin tiempo; el
  // anfitrión termina la partida cuando quiera con el botón "Terminar".
}
async function startRound(index) {
  const playAt = getServerNow() + 3000;
  await roomRef.update({
    status: 'playing',
    currentRound: index,
    playAt,
    ['rounds/' + index + '/playAt']: playAt,
  });
  const roundSnap = await roomRef.child('rounds/' + index).once('value');
  scheduleFinalize(index, playAt, roundSnap.val());
}
function scheduleFinalize(index, playAt, round) {
  clearTimeout(hostRoundTimer);
  const totalSecs = (round && round.isProgressive)
    ? PROGRESSIVE_ROUND_BUDGET_SECS
    : snippetLength;
  const delay = Math.max(0, playAt - getServerNow()) + totalSecs * 1000 + 600;
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
    } else if (settings.mode === 'bet') {
      // Normal por velocidad, pero duplicado si apostaste y acertaste,
      // o -100 puntos de tu marcador si apostaste y fallaste.
      const correctEntries = Object.entries(answers)
        .filter(([, a]) => a && a.correct)
        .sort((a, b) => (a[1].answeredAt || 0) - (b[1].answeredAt || 0));
      const rankByPid = {};
      correctEntries.forEach(([pid], rank) => { rankByPid[pid] = rank; });
      Object.entries(answers).forEach(([pid, a]) => {
        const bet = !!(a && a.bet);
        let pts = 0;
        if (a && a.correct) {
          pts = computeRankPoints(rankByPid[pid]);
          if (bet) pts *= 2;
        } else if (bet) {
          pts = -RANK_POINTS_START;
        }
        updates['rounds/' + index + '/answers/' + pid + '/points'] = pts;
        const cur = (playersVal[pid] && playersVal[pid].score) || 0;
        updates['players/' + pid + '/score'] = Math.max(0, cur + pts);
      });
    } else if (round.isProgressive) {
      // Modo progresivo: cada jugador ya calculó y envió sus propios
      // puntos según en qué etapa acertó (o 0 si falló) — el anfitrión
      // solo suma, no hay que recalcular nada.
      Object.entries(answers).forEach(([pid, a]) => {
        const pts = (a && typeof a.points === 'number') ? a.points : 0;
        if (pts > 0) {
          const cur = (playersVal[pid] && playersVal[pid].score) || 0;
          updates['players/' + pid + '/score'] = cur + pts;
        }
      });
    } else {
      // Modo normal (y Eliminación, que reutiliza este mismo cálculo):
      // orden por velocidad, quien respondió correcto más rápido se
      // lleva más puntos (100, 90, 80… hasta un piso de 50).
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

      // Modo Eliminación: cada cierto número de rondas, el de menor
      // puntaje (entre los que siguen vivos) queda eliminado. Si hay
      // empate en último lugar, quedan eliminados todos los empatados
      // — a menos que eso dejara la sala sin nadie, en cuyo caso se
      // salta esa eliminación.
      const eliminationEvery = settings.eliminationEvery || 3;
      if (settings.mode === 'elimination' && (index + 1) % eliminationEvery === 0) {
        const alive = Object.keys(playersVal).filter(pid => !playersVal[pid].eliminated);
        if (alive.length > 1) {
          const scoreAfter = pid => {
            const base = (playersVal[pid] && playersVal[pid].score) || 0;
            const delta = updates['players/' + pid + '/score'] !== undefined ? (updates['players/' + pid + '/score'] - base) : 0;
            return base + delta;
          };
          const minScore = Math.min(...alive.map(scoreAfter));
          const toEliminate = alive.filter(pid => scoreAfter(pid) === minScore);
          if (toEliminate.length < alive.length) {
            toEliminate.forEach(pid => { updates['players/' + pid + '/eliminated'] = true; });
            updates['rounds/' + index + '/eliminatedThisRound'] = toEliminate.map(pid => playersVal[pid].name);
          }
        }
      }
    }

    // Racha de aciertos (independiente del modo y de cuántos puntos dio
    // la ronda): sube si acertaste, se resetea si fallaste o no
    // respondiste.
    Object.keys(playersVal).forEach(pid => {
      const a = answers[pid];
      const wasCorrect = !!(a && a.correct);
      const curStreak = playersVal[pid].streak || 0;
      const newStreak = wasCorrect ? curStreak + 1 : 0;
      updates['players/' + pid + '/streak'] = newStreak;
      const bestStreak = Math.max(playersVal[pid].bestStreak || 0, newStreak);
      updates['players/' + pid + '/bestStreak'] = bestStreak;
    });

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
    Object.keys(playersVal).forEach(pid => { resetPlayers[pid] = { ...playersVal[pid], score: 0, streak: 0, bestStreak: 0, eliminated: false }; });
    lastPlayedRoundHost = -1;
    const settings = { roundsCount, snippetLength, mode: gameMode };
    if (gameMode === 'elimination') settings.eliminationEvery = parseInt(eliminationEverySelect.value, 10);
    if (gameMode === 'blitz') settings.blitzSeconds = parseInt(blitzSecondsSelect.value, 10);
    if (gameMode === 'survival') {
      settings.survivalStart = parseInt(survivalStartSelect.value, 10);
      settings.survivalAdd = parseInt(survivalAddSelect.value, 10);
    }
    await roomRef.update({
      rounds,
      players: resetPlayers,
      status: 'lobby',
      currentRound: 0,
      playAt: null,
      settings,
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
    const existingPlayer = (snap.val().players && snap.val().players[playerId]) || null;
    await withTimeout(roomRef.child('players/' + playerId).update({
      name: playerName,
      score: (existingPlayer && existingPlayer.score) || 0,
      streak: (existingPlayer && existingPlayer.streak) || 0,
      bestStreak: (existingPlayer && existingPlayer.bestStreak) || 0,
      emoji: (existingPlayer && existingPlayer.emoji) || pickPlayerEmoji(),
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
    chip.innerHTML = `${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)}`;
    playerLobbyList.appendChild(chip);
  });
}
let currentBet = false;
function setupPlayerRound(room, index) {
  answered = false;
  currentBet = false;
  runScoreText.classList.add('hidden');
  const round = room.rounds[index];
  const me = (room.players && room.players[playerId]) || null;
  if (me && me.eliminated) {
    setupEliminatedSpectatorView(room, index, round);
    return;
  }
  if (round.isProgressive) {
    setupProgressivePlayerRound(room, index, round);
    return;
  }
  progressiveControls.classList.add('hidden');
  eliminatedNotice.classList.add('hidden');
  if (playerDiscArt) playerDiscArt.classList.add('hidden');
  playerRoundCounter.textContent = round.isTiebreak ? '🔥 Ronda de desempate' : `Ronda ${index + 1}/${room.settings.roundsCount}`;
  playerReveal.classList.add('hidden');
  playerAnswerGrid.classList.remove('hidden');
  playerAnswerGrid.innerHTML = '';
  btnManualPlay.classList.add('hidden');
  playerTimerWrap.classList.add('hidden');
  clearInterval(playerTimerInterval);
  playerStatusText.textContent = 'Prepárate…';

  if (room.settings && room.settings.mode === 'bet') {
    betControls.classList.remove('hidden');
    betStatus.classList.add('hidden');
    btnPlaceBet.disabled = false;
    btnPlaceBet.textContent = '💰 Apostar doble o nada esta ronda';
    btnPlaceBet.onclick = () => {
      if (answered) return;
      currentBet = true;
      btnPlaceBet.disabled = true;
      btnPlaceBet.textContent = '💰 Apostado — doble si aciertas, -100 si fallas';
    };
  } else {
    betControls.classList.add('hidden');
  }

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
// ---------- Vista de espectador (jugador eliminado) ----------
function setupEliminatedSpectatorView(room, index, round) {
  runScoreText.classList.add('hidden');
  progressiveControls.classList.add('hidden');
  betControls.classList.add('hidden');
  if (playerDiscArt) playerDiscArt.classList.add('hidden');
  playerTimerWrap.classList.add('hidden');
  clearInterval(playerTimerInterval);
  clearTimeout(localSnippetTimer);
  playerReveal.classList.add('hidden');
  playerAnswerGrid.classList.add('hidden');
  playerAnswerGrid.innerHTML = '';
  btnManualPlay.classList.add('hidden');
  playerRoundCounter.textContent = `Ronda ${index + 1}/${room.settings.roundsCount}`;
  playerStatusText.textContent = '';
  eliminatedNotice.textContent = '💀 Fuiste eliminado — puedes seguir mirando cómo termina la partida.';
  eliminatedNotice.classList.remove('hidden');
}
// ---------- Modo progresivo (jugador) ----------
let progressiveStageIndex = 0;
function setupProgressivePlayerRound(room, index, round) {
  runScoreText.classList.add('hidden');
  progressiveStageIndex = 0;
  playerRoundCounter.textContent = round.isTiebreak ? '🔥 Ronda de desempate' : `Ronda ${index + 1}/${room.settings.roundsCount}`;
  playerReveal.classList.add('hidden');
  playerAnswerGrid.classList.remove('hidden');
  progressiveControls.classList.remove('hidden');
  playerTimerWrap.classList.add('hidden');
  clearInterval(playerTimerInterval);
  btnManualPlay.classList.add('hidden');
  btnProgressiveSkip.classList.remove('hidden');
  playerStatusText.textContent = 'Prepárate…';
  progressivePointsLabel.textContent = `Vale ${PROGRESSIVE_POINTS[0]} pts`;

  if (playerDiscArt) {
    if (round.trackImage) {
      playerDiscArt.src = round.trackImage;
      playerDiscArt.classList.remove('hidden');
      playerDiscArt.style.filter = 'blur(20px)';
    } else {
      playerDiscArt.classList.add('hidden');
    }
  }

  playerAnswerGrid.innerHTML = '';
  round.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = opt;
    btn.onclick = () => submitProgressiveAnswer(index, i, round.correctIndex);
    playerAnswerGrid.appendChild(btn);
  });

  audioPlayer.src = round.previewUrl;
  audioPlayer.load();
  btnManualPlay.onclick = () => { audioPlayer.play().catch(() => {}); };
  btnProgressiveSkip.onclick = () => advanceProgressiveStage();
  btnProgressiveReplay.onclick = () => replayProgressiveStage();

  const delay = Math.max(0, room.playAt - getServerNow());
  clearTimeout(localSnippetTimer);
  setTimeout(() => {
    playerStatusText.textContent = '🔊 ¡Escucha!';
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => { btnManualPlay.classList.remove('hidden'); });
    scheduleProgressivePause(0, PROGRESSIVE_STAGES[0]);
  }, delay);
}
function scheduleProgressivePause(fromSeconds, toSeconds) {
  clearTimeout(localSnippetTimer);
  const ms = Math.max(0, (toSeconds - fromSeconds) * 1000);
  localSnippetTimer = setTimeout(() => { audioPlayer.pause(); }, ms);
}
function replayProgressiveStage() {
  if (answered) return;
  audioPlayer.currentTime = 0;
  audioPlayer.play().catch(() => {});
  const isLastStage = progressiveStageIndex >= PROGRESSIVE_STAGES.length - 1;
  if (isLastStage) {
    clearTimeout(localSnippetTimer);
  } else {
    scheduleProgressivePause(0, PROGRESSIVE_STAGES[progressiveStageIndex]);
  }
}
function advanceProgressiveStage() {
  if (answered) return;
  if (progressiveStageIndex >= PROGRESSIVE_STAGES.length - 1) return;
  const fromSeconds = PROGRESSIVE_STAGES[progressiveStageIndex];
  progressiveStageIndex += 1;
  const isLastStage = progressiveStageIndex >= PROGRESSIVE_STAGES.length - 1;
  progressivePointsLabel.textContent = `Vale ${PROGRESSIVE_POINTS[progressiveStageIndex]} pts`;
  if (playerDiscArt && !playerDiscArt.classList.contains('hidden')) {
    const blurAmount = Math.max(0, 20 - progressiveStageIndex * 5);
    playerDiscArt.style.filter = `blur(${blurAmount}px)`;
  }
  playTickSound();
  audioPlayer.play().catch(() => {});
  if (isLastStage) {
    // Última etapa: deja sonar el resto del preview completo en vez
    // de pausarse en seco — ya no hay más a donde "escuchar más".
    clearTimeout(localSnippetTimer);
    btnProgressiveSkip.classList.add('hidden');
    playerStatusText.textContent = '🔊 Última oportunidad — suena hasta el final del fragmento.';
  } else {
    scheduleProgressivePause(fromSeconds, PROGRESSIVE_STAGES[progressiveStageIndex]);
  }
}
function submitProgressiveAnswer(index, optionIndex, correctIndex) {
  if (answered) return;
  answered = true;
  clearTimeout(localSnippetTimer);
  audioPlayer.pause();
  progressiveControls.classList.add('hidden');
  lockAnswerButtons(optionIndex);
  const correct = optionIndex === correctIndex;
  const points = correct ? PROGRESSIVE_POINTS[progressiveStageIndex] : 0;
  if (correct) playCorrectSound(); else playWrongSound();
  playerStatusText.textContent = correct
    ? `¡Correcto! +${points} pts. Esperando a los demás…`
    : 'Respuesta enviada. Esperando a los demás…';
  roomRef.child(`rounds/${index}/answers/${playerId}`).set({
    optionIndex, correct, points, stage: progressiveStageIndex, answeredAt: getServerNow(), name: playerName,
  });
}
function lockAnswerButtons(selectedIndex) {
  const buttons = playerAnswerGrid.querySelectorAll('.answer-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === selectedIndex) b.classList.add('selected');
  });
}
// ---------- Modos de carrera (Contrarreloj / Supervivencia) ----------
let runModeStarted = false;
let runQueueIndex = 0;
let runScore = 0;
let runTimeLeft = 0;
let runInterval = null;
let runSongTimer = null;
let runAnswered = false;
const RUN_SNIPPET_SECS = 6;

function startPlayerRun(room) {
  runQueueIndex = 0;
  runScore = 0;
  runAnswered = false;
  const mode = room.settings.mode;
  runTimeLeft = mode === 'survival' ? (room.settings.survivalStart || 15) : (room.settings.blitzSeconds || 60);
  runScoreText.classList.remove('hidden');
  runScoreText.textContent = `Aciertos: 0`;
  progressiveControls.classList.add('hidden');
  betControls.classList.add('hidden');
  eliminatedNotice.classList.add('hidden');
  playerReveal.classList.add('hidden');
  if (playerDiscArt) playerDiscArt.classList.add('hidden');
  playerTimerWrap.classList.remove('hidden');
  playerTimerBar.classList.remove('urgent');
  const delay = Math.max(0, room.playAt - getServerNow());
  playerStatusText.textContent = 'Prepárate…';
  playerRoundCounter.textContent = mode === 'survival' ? '🏃 Supervivencia' : '⏱ Contrarreloj';
  setTimeout(() => {
    startRunClock(room, mode);
    playNextRunSong(room);
  }, delay);
}
function startRunClock(room, mode) {
  clearInterval(runInterval);
  const maxForBar = mode === 'survival' ? (room.settings.survivalStart || 15) + (room.settings.survivalAdd || 5) * 3 : runTimeLeft;
  const updateBar = () => {
    playerTimerText.textContent = Math.ceil(runTimeLeft) + 's';
    const pct = Math.max(0, Math.min(100, (runTimeLeft / maxForBar) * 100));
    playerTimerBar.style.width = pct + '%';
    playerTimerBar.classList.toggle('urgent', runTimeLeft <= 5);
  };
  updateBar();
  runInterval = setInterval(() => {
    runTimeLeft -= 1;
    updateBar();
    if (runTimeLeft <= 0) {
      endPlayerRun();
    }
  }, 1000);
}
function playNextRunSong(room) {
  if (runTimeLeft <= 0) return;
  runAnswered = false;
  const rounds = Object.values(room.rounds || {});
  if (!rounds.length) return;
  const round = rounds[runQueueIndex % rounds.length];
  runQueueIndex += 1;

  playerAnswerGrid.classList.remove('hidden');
  playerAnswerGrid.innerHTML = '';
  btnManualPlay.classList.add('hidden');
  round.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = opt;
    btn.onclick = () => submitRunAnswer(room, i, round.correctIndex);
    playerAnswerGrid.appendChild(btn);
  });

  audioPlayer.src = round.previewUrl;
  audioPlayer.load();
  audioPlayer.currentTime = 0;
  audioPlayer.play().catch(() => { btnManualPlay.classList.remove('hidden'); });
  btnManualPlay.onclick = () => { audioPlayer.play().catch(() => {}); };
  playerStatusText.textContent = '🔊 ¡Adivina rápido!';

  clearTimeout(runSongTimer);
  runSongTimer = setTimeout(() => {
    if (!runAnswered) submitRunAnswer(room, -1, round.correctIndex);
  }, RUN_SNIPPET_SECS * 1000);
}
function submitRunAnswer(room, optionIndex, correctIndex) {
  if (runAnswered || runTimeLeft <= 0) return;
  runAnswered = true;
  clearTimeout(runSongTimer);
  audioPlayer.pause();
  const buttons = playerAnswerGrid.querySelectorAll('.answer-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === correctIndex) b.classList.add('correct');
    else if (i === optionIndex) b.classList.add('wrong');
  });
  const correct = optionIndex === correctIndex;
  if (correct) {
    runScore += 1;
    playCorrectSound();
    runScoreText.textContent = `Aciertos: ${runScore}`;
    if (room.settings.mode === 'survival') {
      runTimeLeft += (room.settings.survivalAdd || 5);
    }
  } else {
    playWrongSound();
  }
  roomRef.child('players/' + playerId + '/score').set(runScore);
  setTimeout(() => {
    if (runTimeLeft > 0) playNextRunSong(room);
  }, 500);
}
function stopPlayerRun() {
  clearInterval(runInterval);
  clearTimeout(runSongTimer);
  audioPlayer.pause();
}
function endPlayerRun() {
  clearInterval(runInterval);
  clearTimeout(runSongTimer);
  audioPlayer.pause();
  playerTimerWrap.classList.add('hidden');
  playerAnswerGrid.classList.add('hidden');
  playerStatusText.textContent = `🏁 ¡Se acabó tu tiempo! Terminaste con ${runScore} aciertos. Esperando a los demás…`;
  roomRef.child('players/' + playerId + '/score').set(runScore);
}
function submitAnswer(index, optionIndex, correctIndex, btnEl) {
  if (answered) return;
  answered = true;
  betControls.classList.add('hidden');
  lockAnswerButtons(optionIndex);
  const correct = optionIndex === correctIndex;
  const answeredAt = getServerNow();
  if (correct) playCorrectSound(); else playWrongSound();
  playerStatusText.textContent = correct
    ? '¡Correcto! Esperando a los demás…'
    : 'Respuesta enviada. Esperando a los demás…';
  roomRef.child(`rounds/${index}/answers/${playerId}`).set({ optionIndex, correct, answeredAt, bet: currentBet, name: playerName });
}
function showPlayerReveal(room, index) {
  const round = room.rounds[index];
  playerAnswerGrid.classList.add('hidden');
  playerReveal.classList.remove('hidden');
  const me = (room.players && room.players[playerId]) || null;
  const myAnswer = round.answers && round.answers[playerId];
  const gotIt = myAnswer && myAnswer.correct;
  playerRevealBanner.textContent = (me && me.eliminated)
    ? '💀 Estás eliminado — mirando desde las gradas'
    : (gotIt ? '✅ ¡Correcto!' : (myAnswer ? '❌ Fallaste' : '⌛ No respondiste a tiempo'));
  playerPointsText.textContent = (me && me.eliminated) ? '' : `+${(myAnswer && myAnswer.points) || 0} pts esta ronda`;
  playerRevealTitle.textContent = round.trackName;
  playerRevealArtist.textContent = round.trackArtist;
  if (round.trackImage) {
    playerRevealArt.src = round.trackImage;
    playerRevealArt.classList.remove('hidden');
  } else {
    playerRevealArt.classList.add('hidden');
  }
  const eliminatedThisRound = round.eliminatedThisRound;
  if (eliminatedThisRound && eliminatedThisRound.length) {
    playerEliminatedBanner.textContent = `💀 Quedaron eliminados: ${eliminatedThisRound.join(', ')}`;
    playerEliminatedBanner.classList.remove('hidden');
  } else {
    playerEliminatedBanner.classList.add('hidden');
  }
  renderLeaderboardInto(playerRoundLeaderboard, room.players || {}, playerId, round.answers || {});
}
function renderPlayerResults(room) {
  const players = room.players || {};
  playerWinnerBanner.textContent = winnerMessage(players);
  playerFunFacts.innerHTML = computeFunFactsHtml(room);
  const sorted = Object.entries(players).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  const topScore = sorted.length ? (sorted[0][1].score || 0) : 0;
  playerResultsList.innerHTML = '';
  sorted.forEach(([pid, p]) => {
    const row = document.createElement('div');
    let cls = 'result-row';
    if ((p.score || 0) === topScore && topScore > 0) cls += ' winner';
    row.className = cls;
    row.innerHTML = `<span class="name">${playerLabel(p, pid === playerId)}</span><span class="score">${p.score || 0}</span>`;
    playerResultsList.appendChild(row);
  });
  if (topScore > 0 && players[playerId] && (players[playerId].score || 0) === topScore) fireConfetti();
}
function listenAsPlayer() {
  showScreen('player-lobby');
  runModeStarted = false;
  roomRef.on('value', snap => {
    const room = snap.val();
    if (!room) return;
    const isRunMode = room.settings && (room.settings.mode === 'blitz' || room.settings.mode === 'survival');
    if (room.status === 'lobby') {
      renderPlayerLobby(room.players || {});
      showScreen('player-lobby');
      lastRenderedRound = -1;
      lastRenderedStatus = 'lobby';
      runModeStarted = false;
    } else if (room.status === 'playing' && isRunMode) {
      showScreen('player-game');
      if (!runModeStarted) {
        runModeStarted = true;
        startPlayerRun(room);
      }
      lastRenderedStatus = 'playing';
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
      stopPlayerRun();
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
btnRoleSolo.onclick = () => { entryContext = 'solo'; showScreen('login'); };
btnRoleHost.onclick = () => { entryContext = 'multiplayer'; showScreen('login'); };
btnRolePlayer.onclick = () => { initFirebase(); showScreen('player-join'); };
// Muestra solo los modos de juego que tienen sentido según por dónde
// entró (Solo: modos de un jugador; Multijugador: modos de sala). Si
// el modo que estaba activo ya no aplica en este contexto, vuelve a
// "Normal" por defecto.
function applyModeTabsForContext() {
  modeTabs.forEach(tab => {
    const contexts = (tab.dataset.context || '').split(' ');
    tab.style.display = contexts.includes(entryContext) ? '' : 'none';
  });
  const activeTab = document.querySelector('.mode-tab.active');
  if (!activeTab || activeTab.style.display === 'none') {
    modeTabs.forEach(t => t.classList.remove('active'));
    const normalTab = document.querySelector('.mode-tab[data-mode="normal"]');
    if (normalTab) normalTab.classList.add('active');
    gameMode = 'normal';
    modeHint.textContent = MODE_HINTS.normal;
    eliminationField.classList.add('hidden');
    blitzField.classList.add('hidden');
    survivalField.classList.add('hidden');
  }
  btnCreateRoom.textContent = entryContext === 'solo' ? 'Empezar a practicar' : 'Crear sala';
}
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
  entryContext = sessionStorage.getItem('rq_entry_context') || 'multiplayer';
  const loggedIn = wasHostLogin ? await handleRedirectIfPresent() : false;
  if (loggedIn) {
    applyModeTabsForContext();
    showScreen('host-setup');
    // La carga automática de la lista de playlists está desactivada
    // por ahora (bug activo de Spotify, ver README) — usa el botón
    // 🔄 si quieres intentarlo, o el buscador / link manual de abajo.
  } else {
    showScreen('role');
  }
})();
