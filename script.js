/* =====================================================
   BLOCK FUSION — script.js
   Pure JS canvas-based block placement puzzle game
   ===================================================== */

/* ─── CONSTANTS ──────────────────────────────────── */
const COLS = 9;
const ROWS = 9;
const PIECE_COUNT = 3;
const COLORS = [
  { fill: '#00e5c8', glow: 'rgba(0,229,200,0.65)',   dark: '#007a6d' },
  { fill: '#7b4fff', glow: 'rgba(123,79,255,0.65)',  dark: '#3d1f99' },
  { fill: '#ff4fb8', glow: 'rgba(255,79,184,0.65)',  dark: '#991060' },
  { fill: '#ffd166', glow: 'rgba(255,209,102,0.65)', dark: '#997a00' },
  { fill: '#4faaff', glow: 'rgba(79,170,255,0.65)',  dark: '#1a5999' },
  { fill: '#44ee88', glow: 'rgba(68,238,136,0.65)',  dark: '#1a7a40' },
];

/* ─── PIECE SHAPES ───────────────────────────────── */
const SHAPES = [
  // 1-cell
  [[1]],
  // 2-cell line H
  [[1,1]],
  // 2-cell line V
  [[1],[1]],
  // 3-cell line H
  [[1,1,1]],
  // 3-cell line V
  [[1],[1],[1]],
  // 4-cell line H
  [[1,1,1,1]],
  // 4-cell line V
  [[1],[1],[1],[1]],
  // 5-cell line H
  [[1,1,1,1,1]],
  // 5-cell line V
  [[1],[1],[1],[1],[1]],
  // 2×2 square
  [[1,1],[1,1]],
  // 3×3 square
  [[1,1,1],[1,1,1],[1,1,1]],
  // 2×3 rect
  [[1,1,1],[1,1,1]],
  // 3×2 rect
  [[1,1],[1,1],[1,1]],
  // L-shapes
  [[1,0],[1,0],[1,1]],
  [[0,1],[0,1],[1,1]],
  [[1,1],[1,0],[1,0]],
  [[1,1],[0,1],[0,1]],
  // T-shapes
  [[1,1,1],[0,1,0]],
  [[0,1,0],[1,1,1]],
  [[1,0],[1,1],[1,0]],
  [[0,1],[1,1],[0,1]],
  // S/Z shapes
  [[0,1,1],[1,1,0]],
  [[1,1,0],[0,1,1]],
  [[1,0],[1,1],[0,1]],
  [[0,1],[1,1],[1,0]],
  // Corner shapes
  [[1,1],[1,0]],
  [[1,1],[0,1]],
  [[0,1],[1,1]],
  [[1,0],[1,1]],
  // Plus / cross
  [[0,1,0],[1,1,1],[0,1,0]],
  // U-shape
  [[1,0,1],[1,1,1]],
  [[1,1,1],[1,0,1]],
];

/* ─── AUDIO SYSTEM ───────────────────────────────── */
const Audio = (() => {
  let ctx = null, muted = false;

  function init() {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function beep(freq, dur, vol = 0.18, type = 'sine', when = 0) {
    if (!ctx || muted) return;
    resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
    gain.gain.setValueAtTime(vol, ctx.currentTime + when);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
    osc.start(ctx.currentTime + when);
    osc.stop(ctx.currentTime + when + dur + 0.01);
  }

  function place() {
    beep(330, 0.07, 0.15, 'sine');
    beep(500, 0.05, 0.10, 'sine', 0.05);
  }

  function clear(count) {
    const notes = [440, 550, 660, 880];
    notes.slice(0, Math.min(count, 4)).forEach((n, i) => {
      beep(n, 0.12, 0.18, 'triangle', i * 0.08);
    });
  }

  function combo(mult) {
    beep(300 + mult * 80, 0.18, 0.2, 'sawtooth');
    beep(600 + mult * 160, 0.14, 0.15, 'sine', 0.1);
  }

  function gameover() {
    [440,330,220,110].forEach((f, i) => beep(f, 0.22, 0.18, 'sawtooth', i * 0.14));
  }

  function toggleMute() {
    muted = !muted;
    return muted;
  }

  return { init, resume, place, clear, combo, gameover, toggleMute };
})();

/* ─── STORAGE ────────────────────────────────────── */
const Store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ─── GAME STATE ─────────────────────────────────── */
let state = {
  board: [],       // ROWS×COLS, 0=empty, else color index 1-based
  pieces: [],      // array of 3 piece objects {shape, colorIdx, used}
  score: 0,
  best: 0,
  lines: 0,
  combo: 0,
  comboTimer: 0,
  paused: false,
  over: false,
  animating: false,
  placementFlash: [],  // [{r,c,frame}]
  clearFlash: [],      // [{cells:[{r,c}], frame, maxFrame}]
};

/* ─── CELL SIZE & CANVAS SETUP ───────────────────── */
let cellSize = 40;
let boardCanvas, boardCtx;
let ghostCanvas, ghostCtx;
let bgCanvas, bgCtx;

function computeCellSize() {
  const isMobile = window.innerWidth <= 700;
  const hPad = isMobile ? 16 : 240; // space for panels
  const vPad = isMobile
    ? (58 + 140 + 24)  // header + mobile tray + padding
    : (58 + 24);        // header + padding
  const maxW = (window.innerWidth - hPad) / COLS;
  const maxH = (window.innerHeight - vPad) / ROWS;
  cellSize = Math.floor(Math.min(maxW, maxH, 52));
  if (cellSize < 24) cellSize = 24;
}

function resizeBoard() {
  computeCellSize();
  const w = COLS * cellSize;
  const h = ROWS * cellSize;
  boardCanvas.width = w;
  boardCanvas.height = h;
  boardCanvas.style.width = w + 'px';
  boardCanvas.style.height = h + 'px';
  renderBoard();
  renderPieceTray();
}

/* ─── BACKGROUND PARTICLES ───────────────────────── */
const particles = [];
function initParticles() {
  bgCanvas = document.getElementById('bg-canvas');
  bgCtx = bgCanvas.getContext('2d');
  bgCanvas.width = window.innerWidth;
  bgCanvas.height = window.innerHeight;
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * bgCanvas.width,
      y: Math.random() * bgCanvas.height,
      r: Math.random() * 1.5 + 0.3,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      a: Math.random(),
      da: (Math.random() - 0.5) * 0.008,
    });
  }
  animateParticles();
}

function animateParticles() {
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    p.a += p.da;
    if (p.a < 0 || p.a > 1) p.da *= -1;
    if (p.x < 0) p.x = bgCanvas.width;
    if (p.x > bgCanvas.width) p.x = 0;
    if (p.y < 0) p.y = bgCanvas.height;
    if (p.y > bgCanvas.height) p.y = 0;
    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    bgCtx.fillStyle = `rgba(0,229,200,${p.a * 0.6})`;
    bgCtx.fill();
  }
  requestAnimationFrame(animateParticles);
}

/* ─── BOARD RENDERING ────────────────────────────── */
function renderBoard() {
  if (!boardCtx) return;
  const W = boardCanvas.width, H = boardCanvas.height;
  boardCtx.clearRect(0, 0, W, H);

  // Background
  boardCtx.fillStyle = '#0d1021';
  boardCtx.fillRect(0, 0, W, H);

  // Grid lines
  boardCtx.strokeStyle = 'rgba(123,79,255,0.20)';
  boardCtx.lineWidth = 0.8;
  for (let c = 0; c <= COLS; c++) {
    boardCtx.beginPath();
    boardCtx.moveTo(c * cellSize, 0);
    boardCtx.lineTo(c * cellSize, H);
    boardCtx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, r * cellSize);
    boardCtx.lineTo(W, r * cellSize);
    boardCtx.stroke();
  }

  // Cells
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = state.board[r][c];
      if (v) {
        drawCell(boardCtx, c * cellSize, r * cellSize, cellSize, v - 1, 1.0);
      }
    }
  }

  // Placement flash overlay
  for (const pf of state.placementFlash) {
    const alpha = 1 - pf.frame / 8;
    if (alpha > 0) {
      drawCell(boardCtx, pf.c * cellSize, pf.r * cellSize, cellSize, pf.ci, alpha * 0.7, true);
    }
  }

  // Clear flash overlay
  for (const cf of state.clearFlash) {
    const t = cf.frame / cf.maxFrame;
    const alpha = 1 - t;
    const brightness = 1 + t * 3;
    for (const {r, c, ci} of cf.cells) {
      drawClearCell(boardCtx, c * cellSize, r * cellSize, cellSize, ci, alpha, brightness);
    }
  }

  // Drop preview (ghost)
  if (state.ghostCells && state.ghostCells.length > 0) {
    for (const {r, c, ci} of state.ghostCells) {
      drawGhostCell(boardCtx, c * cellSize, r * cellSize, cellSize, ci);
    }
  }
}

function drawCell(ctx, x, y, sz, colorIdx, alpha = 1.0, bright = false) {
  const col = COLORS[colorIdx % COLORS.length];
  const pad = 2;
  const r = sz - pad * 2;
  const rr = 5;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Glow
  if (!bright) {
    ctx.shadowColor = col.glow;
    ctx.shadowBlur = 10;
  } else {
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 20;
  }

  // Main block
  ctx.fillStyle = col.fill;
  roundRect(ctx, x + pad, y + pad, r, r, rr);
  ctx.fill();

  // Darker bottom/right edge (3D feel)
  ctx.shadowBlur = 0;
  ctx.fillStyle = col.dark;
  roundRect(ctx, x + pad + 2, y + pad + 2, r - 2, r - 2, rr - 1);
  ctx.fill();

  // Lighter top-left shine
  ctx.fillStyle = col.fill;
  roundRect(ctx, x + pad + 2, y + pad + 2, r - 5, r - 5, rr - 1);
  ctx.fill();

  // Highlight
  const grad = ctx.createLinearGradient(x + pad, y + pad, x + pad + r * 0.7, y + pad + r * 0.7);
  grad.addColorStop(0, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  roundRect(ctx, x + pad, y + pad, r, r, rr);
  ctx.fill();

  ctx.restore();
}

function drawGhostCell(ctx, x, y, sz, colorIdx) {
  const col = COLORS[colorIdx % COLORS.length];
  const pad = 2;
  const r = sz - pad * 2;
  const rr = 5;
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = col.fill;
  roundRect(ctx, x + pad, y + pad, r, r, rr);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = col.fill;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + pad, y + pad, r, r, rr);
  ctx.stroke();
  ctx.restore();
}

function drawClearCell(ctx, x, y, sz, colorIdx, alpha, brightness) {
  const col = COLORS[colorIdx % COLORS.length];
  const pad = 2;
  const r = sz - pad * 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 20 * brightness;
  ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
  roundRect(ctx, x + pad, y + pad, r, r, 5);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ─── PIECE TRAY RENDERING ───────────────────────── */
function renderPieceTray() {
  for (let i = 0; i < PIECE_COUNT; i++) {
    ['piece-slot-', 'mobile-piece-slot-'].forEach(prefix => {
      const slot = document.getElementById(prefix + i);
      if (!slot) return;

      let c = slot.querySelector('canvas');
      if (!c) { c = document.createElement('canvas'); slot.appendChild(c); }
      const ctx = c.getContext('2d');

      const p = state.pieces[i];
      if (!p || p.used) {
        c.width = 1; c.height = 1;
        slot.style.opacity = '0.35';
        return;
      }
      slot.style.opacity = '1';

      const pCols = p.shape[0].length;
      const pRows = p.shape.length;

      // Use fixed fallback sizes — don't rely on offsetWidth which can be 0
      const isMobile = prefix === 'mobile-piece-slot-';
      const slotW = isMobile ? 90 : 120;
      const slotH = isMobile ? 80 : 90;
      const cs = Math.min(
        Math.floor((slotW - 16) / pCols),
        Math.floor((slotH - 16) / pRows),
        22
      );
      if (cs < 4) return; // too small, skip

      const pw = pCols * cs;
      const ph = pRows * cs;
      c.width = pw; c.height = ph;
      ctx.clearRect(0, 0, pw, ph);
      for (let r = 0; r < pRows; r++) {
        for (let cc = 0; cc < pCols; cc++) {
          if (p.shape[r][cc]) {
            drawCell(ctx, cc * cs, r * cs, cs, p.colorIdx, 1.0);
          }
        }
      }
    });
  }
}

/* ─── SCORE POPUPS ───────────────────────────────── */
function spawnPopup(text, x, y, type = '') {
  const popup = document.createElement('div');
  popup.className = 'score-popup' + (type ? ' ' + type : '');
  popup.textContent = text;
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  document.getElementById('popup-layer').appendChild(popup);
  setTimeout(() => popup.remove(), 1200);
}

/* ─── UI UPDATES ─────────────────────────────────── */
function updateUI() {
  document.getElementById('display-score').textContent = state.score.toLocaleString();
  document.getElementById('display-best').textContent = state.best.toLocaleString();
  const comboMult = Math.min(state.combo + 1, 10);
  document.getElementById('display-combo').textContent = '×' + comboMult;
  document.getElementById('display-lines').textContent = state.lines;

  // Combo bar
  const barPct = Math.min((state.combo / 9) * 100, 100);
  document.getElementById('combo-bar').style.width = barPct + '%';

  // Mobile header score
  const msMobile = document.getElementById('mobile-score-bar');
  if (msMobile) {
    document.getElementById('ms-score').textContent = state.score.toLocaleString();
    document.getElementById('ms-combo').textContent = '×' + comboMult;
  }
}

/* ─── GAME INIT ──────────────────────────────────── */
function initBoard() {
  state.board = Array.from({length: ROWS}, () => Array(COLS).fill(0));
}

function newGame() {
  state.score = 0;
  state.lines = 0;
  state.combo = 0;
  state.comboTimer = 0;
  state.paused = false;
  state.over = false;
  state.animating = false;
  state.placementFlash = [];
  state.clearFlash = [];
  state.ghostCells = [];
  state.best = Store.get('blockfusion_best', 0);
  initBoard();
  refillPieces();
  hideOverlays();
  updateUI();
  renderBoard();
  renderPieceTray();
}

function refillPieces() {
  state.pieces = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    state.pieces.push(randomPiece());
  }
}

function randomPiece() {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const colorIdx = Math.floor(Math.random() * COLORS.length);
  return { shape, colorIdx, used: false };
}

/* ─── PLACEMENT LOGIC ────────────────────────────── */
function canPlace(piece, row, col) {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c]) {
        const br = row + r, bc = col + c;
        if (br < 0 || br >= ROWS || bc < 0 || bc >= COLS) return false;
        if (state.board[br][bc]) return false;
      }
    }
  }
  return true;
}

function placePiece(pieceIdx, row, col) {
  if (state.over || state.paused) return false;
  const piece = state.pieces[pieceIdx];
  if (!piece || piece.used) return false;
  if (!canPlace(piece, row, col)) return false;

  // Stamp onto board
  const placed = [];
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c]) {
        const br = row + r, bc = col + c;
        state.board[br][bc] = piece.colorIdx + 1;
        placed.push({r: br, c: bc, ci: piece.colorIdx});
      }
    }
  }

  // Placement flash
  state.placementFlash = placed.map(({r, c, ci}) => ({r, c, ci, frame: 0}));

  // Score for placement
  const placePts = placed.length * 10;
  state.score += placePts;
  const bx = col * cellSize + (piece.shape[0].length * cellSize) / 2;
  const by = row * cellSize;
  spawnPopup('+' + placePts, bx, by);

  Audio.resume();
  Audio.place();

  // Mark used
  piece.used = true;

  // Check clears
  setTimeout(() => {
    checkClears(row, col, piece);
  }, 80);

  updateUI();
  renderBoard();
  renderPieceTray();
  return true;
}

function checkClears(placedRow, placedCol, piece) {
  const fullRows = [];
  const fullCols = [];

  for (let r = 0; r < ROWS; r++) {
    if (state.board[r].every(v => v > 0)) fullRows.push(r);
  }
  for (let c = 0; c < COLS; c++) {
    if (state.board.every(row => row[c] > 0)) fullCols.push(c);
  }

  const totalCleared = fullRows.length + fullCols.length;
  if (totalCleared === 0) {
    state.combo = 0;
    afterPlacement();
    return;
  }

  // Build clear cells list
  const clearSet = new Set();
  const clearCells = [];
  for (const r of fullRows) {
    for (let c = 0; c < COLS; c++) {
      const key = r + ',' + c;
      if (!clearSet.has(key)) { clearSet.add(key); clearCells.push({r, c, ci: (state.board[r][c] || 1) - 1}); }
    }
  }
  for (const c of fullCols) {
    for (let r = 0; r < ROWS; r++) {
      const key = r + ',' + c;
      if (!clearSet.has(key)) { clearSet.add(key); clearCells.push({r, c, ci: (state.board[r][c] || 1) - 1}); }
    }
  }

  // Flash animation
  state.clearFlash.push({ cells: clearCells, frame: 0, maxFrame: 18 });
  state.animating = true;

  // Score
  state.combo++;
  const comboMult = Math.min(state.combo, 10);
  const linePts = totalCleared * COLS * 15 * comboMult;
  state.lines += totalCleared;
  state.score += linePts;

  if (state.score > state.best) {
    state.best = state.score;
    Store.set('blockfusion_best', state.best);
  }

  // Popup
  const cx = (COLS / 2) * cellSize;
  const cy = (ROWS / 2) * cellSize - 20;
  let popupType = '';
  if (totalCleared >= 3) popupType = 'big';
  else if (comboMult > 1) popupType = 'combo';
  spawnPopup('+' + linePts + (comboMult > 1 ? ' ×' + comboMult : ''), cx, cy, popupType);

  Audio.clear(totalCleared);
  if (comboMult > 1) setTimeout(() => Audio.combo(comboMult), 200);

  updateUI();

  // Animate then clear
  let frame = 0;
  const maxFrame = 18;
  const flashInterval = setInterval(() => {
    frame++;
    state.clearFlash[state.clearFlash.length - 1].frame = frame;
    renderBoard();
    if (frame >= maxFrame) {
      clearInterval(flashInterval);
      // Actually clear the cells
      for (const key of clearSet) {
        const [r, c] = key.split(',').map(Number);
        state.board[r][c] = 0;
      }
      state.clearFlash = state.clearFlash.filter(cf => cf.frame < cf.maxFrame);
      state.animating = false;
      afterPlacement();
      renderBoard();
    }
  }, 28);
}

function afterPlacement() {
  // If all pieces used, refill
  if (state.pieces.every(p => p.used)) {
    refillPieces();
    renderPieceTray();
  }
  // Check game over
  const hasMove = state.pieces.some(p => !p.used && hasValidPlacement(p));
  if (!hasMove) {
    triggerGameOver();
  }
}

function hasValidPlacement(piece) {
  for (let r = 0; r <= ROWS - piece.shape.length; r++) {
    for (let c = 0; c <= COLS - piece.shape[0].length; c++) {
      if (canPlace(piece, r, c)) return true;
    }
  }
  return false;
}

function triggerGameOver() {
  state.over = true;
  if (state.score > state.best) {
    state.best = state.score;
    Store.set('blockfusion_best', state.best);
  }
  Audio.gameover();
  setTimeout(showGameOver, 500);
}

/* ─── OVERLAYS ───────────────────────────────────── */
function showGameOver() {
  document.getElementById('go-score').textContent = state.score.toLocaleString();
  document.getElementById('go-best').textContent = state.best.toLocaleString();
  document.getElementById('go-lines').textContent = state.lines;
  const newBest = state.score >= state.best && state.score > 0;
  document.getElementById('new-best-badge').classList.toggle('hidden', !newBest);
  document.getElementById('overlay-gameover').classList.remove('hidden');
}

function hideOverlays() {
  document.getElementById('overlay-pause').classList.add('hidden');
  document.getElementById('overlay-gameover').classList.add('hidden');
}

function togglePause() {
  if (state.over) return;
  state.paused = !state.paused;
  document.getElementById('icon-pause').style.display = state.paused ? 'none' : '';
  document.getElementById('icon-play').style.display = state.paused ? '' : 'none';
  if (state.paused) {
    document.getElementById('overlay-pause').classList.remove('hidden');
  } else {
    document.getElementById('overlay-pause').classList.add('hidden');
  }
}

/* ─── ANIMATION LOOP ─────────────────────────────── */
function flashLoop() {
  let needRender = false;

  // Placement flash
  state.placementFlash = state.placementFlash.filter(pf => {
    pf.frame++;
    return pf.frame < 8;
  });
  if (state.placementFlash.length > 0) needRender = true;

  // Ghost cells reset each frame
  if (drag.active) needRender = true;

  if (needRender) renderBoard();
  requestAnimationFrame(flashLoop);
}

/* ─── DRAG & DROP SYSTEM ─────────────────────────── */
const drag = {
  active: false,
  pieceIdx: -1,
  piece: null,
  // current pointer position
  px: 0, py: 0,
  // offset from piece top-left when grab started
  ox: 0, oy: 0,
};

function getBoardRect() {
  return boardCanvas.getBoundingClientRect();
}

function pointerToBoardCell(px, py) {
  const rect = getBoardRect();
  const bx = px - rect.left;
  const by = py - rect.top;
  return {
    col: Math.floor(bx / cellSize),
    row: Math.floor(by / cellSize),
  };
}

function startDrag(e, pieceIdx) {
  if (state.over || state.paused || state.animating) return;
  const piece = state.pieces[pieceIdx];
  if (!piece || piece.used) return;

  Audio.resume();

  const pt = getPointer(e);
  drag.active = true;
  drag.pieceIdx = pieceIdx;
  drag.piece = piece;
  drag.px = pt.x;
  drag.py = pt.y;

  // Center the piece on the pointer
  const pCols = piece.shape[0].length;
  const pRows = piece.shape.length;
  drag.ox = (pCols * cellSize) / 2;
  drag.oy = (pRows * cellSize) / 2;

  const slot = document.getElementById(
    (window.innerWidth <= 700 ? 'mobile-piece-slot-' : 'piece-slot-') + pieceIdx
  );
  if (slot) slot.classList.add('dragging-active');

  updateGhost();
  updateDragGhost();
  document.getElementById('drag-ghost').style.display = 'block';
  document.getElementById('board-canvas').style.cursor = 'grabbing';
}

function moveDrag(e) {
  if (!drag.active) return;
  const pt = getPointer(e);
  drag.px = pt.x;
  drag.py = pt.y;
  updateGhost();
  updateDragGhost();
}

function endDrag(e) {
  if (!drag.active) return;
  const pt = getPointer(e);

  // Try to place on board
  const piece = drag.piece;
  const pCols = piece.shape[0].length;
  const pRows = piece.shape.length;

  const topLeftX = pt.x - drag.ox;
  const topLeftY = pt.y - drag.oy;

  const rect = getBoardRect();
  const boardX = topLeftX - rect.left;
  const boardY = topLeftY - rect.top;

  const col = Math.round(boardX / cellSize);
  const row = Math.round(boardY / cellSize);

  placePiece(drag.pieceIdx, row, col);

  // Clean up
  const slot = document.getElementById(
    (window.innerWidth <= 700 ? 'mobile-piece-slot-' : 'piece-slot-') + drag.pieceIdx
  );
  if (slot) slot.classList.remove('dragging-active');

  drag.active = false;
  drag.piece = null;
  state.ghostCells = [];
  document.getElementById('drag-ghost').style.display = 'none';
  document.getElementById('board-canvas').style.cursor = 'default';
  renderBoard();
}

function updateGhost() {
  if (!drag.active) { state.ghostCells = []; return; }
  const piece = drag.piece;
  const pCols = piece.shape[0].length;
  const pRows = piece.shape.length;

  const topLeftX = drag.px - drag.ox;
  const topLeftY = drag.py - drag.oy;
  const rect = getBoardRect();
  const boardX = topLeftX - rect.left;
  const boardY = topLeftY - rect.top;

  const col = Math.round(boardX / cellSize);
  const row = Math.round(boardY / cellSize);

  if (canPlace(piece, row, col)) {
    state.ghostCells = [];
    for (let r = 0; r < pRows; r++) {
      for (let c = 0; c < pCols; c++) {
        if (piece.shape[r][c]) {
          state.ghostCells.push({r: row + r, c: col + c, ci: piece.colorIdx});
        }
      }
    }
  } else {
    state.ghostCells = [];
  }
}

function updateDragGhost() {
  const ghost = document.getElementById('drag-ghost');
  const piece = drag.piece;
  if (!piece) return;

  const pCols = piece.shape[0].length;
  const pRows = piece.shape.length;
  const cs = cellSize;
  const w = pCols * cs;
  const h = pRows * cs;

  ghost.width = w;
  ghost.height = h;
  ghost.style.width = w + 'px';
  ghost.style.height = h + 'px';
  ghost.style.left = (drag.px - drag.ox) + 'px';
  ghost.style.top = (drag.py - drag.oy) + 'px';

  ghostCtx.clearRect(0, 0, w, h);
  ghostCtx.globalAlpha = 0.82;
  for (let r = 0; r < pRows; r++) {
    for (let c = 0; c < pCols; c++) {
      if (piece.shape[r][c]) {
        drawCell(ghostCtx, c * cs, r * cs, cs, piece.colorIdx, 1.0);
      }
    }
  }
}

function getPointer(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

/* ─── SLOT EVENTS ────────────────────────────────── */
function bindSlotEvents(slotEl, idx) {
  // Mouse
  slotEl.addEventListener('mousedown', e => { e.preventDefault(); startDrag(e, idx); });
  // Touch
  slotEl.addEventListener('touchstart', e => { e.preventDefault(); startDrag(e, idx); }, { passive: false });
}

/* ─── GLOBAL POINTER EVENTS ──────────────────────── */
function bindGlobalEvents() {
  // Mouse move/up
  window.addEventListener('mousemove', moveDrag);
  window.addEventListener('mouseup', endDrag);
  // Touch move/end
  window.addEventListener('touchmove', e => { if (drag.active) { e.preventDefault(); moveDrag(e); } }, { passive: false });
  window.addEventListener('touchend', e => { if (drag.active) { e.preventDefault(); endDrag(e); } }, { passive: false });
  window.addEventListener('touchcancel', e => { if (drag.active) endDrag(e); }, { passive: false });

  // Resize
  window.addEventListener('resize', () => {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    resizeBoard();
  });
}

/* ─── BUTTON WIRING ──────────────────────────────── */
function bindButtons() {
  document.getElementById('btn-sound').addEventListener('click', () => {
    const muted = Audio.toggleMute();
    Store.set('blockfusion_muted', muted);
    document.getElementById('icon-sound-on').style.display = muted ? 'none' : '';
    document.getElementById('icon-sound-off').style.display = muted ? '' : 'none';
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    togglePause();
  });

  document.getElementById('btn-new').addEventListener('click', () => {
    if (confirm('Start a new game?')) newGame();
  });

  document.getElementById('btn-resume').addEventListener('click', () => {
    if (state.paused) togglePause();
  });

  document.getElementById('btn-restart-pause').addEventListener('click', () => {
    newGame();
  });

  document.getElementById('btn-play-again').addEventListener('click', () => {
    newGame();
  });
}

/* ─── MOBILE SCORE BAR ───────────────────────────── */
function injectMobileScoreBar() {
  const header = document.getElementById('header');
  const bar = document.createElement('div');
  bar.id = 'mobile-score-bar';
  bar.innerHTML = `
    <div class="ms-item"><span class="ms-label">SCORE</span><span class="ms-val" id="ms-score">0</span></div>
    <div class="ms-item"><span class="ms-label">COMBO</span><span class="ms-val" id="ms-combo">×1</span></div>
  `;
  // Insert between logo and controls
  header.insertBefore(bar, header.querySelector('.header-controls'));
}

/* ─── BOOT ───────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  boardCanvas = document.getElementById('board-canvas');
  boardCtx = boardCanvas.getContext('2d');
  ghostCanvas = document.getElementById('drag-ghost');
  ghostCtx = ghostCanvas.getContext('2d');

  injectMobileScoreBar();
  Audio.init();

  // Restore sound pref
  const wasMuted = Store.get('blockfusion_muted', false);
  if (wasMuted) {
    Audio.toggleMute();
    document.getElementById('icon-sound-on').style.display = 'none';
    document.getElementById('icon-sound-off').style.display = '';
  }

  initParticles();
  resizeBoard();
  bindGlobalEvents();
  bindButtons();

  // Bind piece slots
  for (let i = 0; i < PIECE_COUNT; i++) {
    bindSlotEvents(document.getElementById('piece-slot-' + i), i);
    bindSlotEvents(document.getElementById('mobile-piece-slot-' + i), i);
  }

  newGame();
  flashLoop();

  // Re-render after layout fully paints (fixes blank pieces on first load)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resizeBoard();
    renderPieceTray();
  }));
});
