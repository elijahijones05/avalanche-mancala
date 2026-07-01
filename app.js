/**
 * app.js
 * Wires together game.js (rules), multiplayer.js (Firebase sync), and the DOM.
 */

import {
  createInitialBoard,
  simulateMove,
  isValidMove,
  STORE1,
  STORE2,
} from './game.js';

import {
  createRoom,
  joinRoom,
  reconnect,
  listenToRoom,
  stopListening,
  makeMove,
  requestRematch,
  markDisconnected,
  getStoredSession,
  clearStoredSession,
  playerNumberForSlot,
  otherSlot,
} from './multiplayer.js';

import { isFirebaseReady, getInitError } from './firebase.js';

/* ------------------------------------------------------------------ */
/* Element references                                                   */
/* ------------------------------------------------------------------ */

const el = {
  screens: {
    mode: document.getElementById('screen-mode'),
    onlineSetup: document.getElementById('screen-online-setup'),
    waiting: document.getElementById('screen-waiting'),
    game: document.getElementById('screen-game'),
  },
  btnMenu: document.getElementById('btn-menu'),
  btnPlayLocal: document.getElementById('btn-play-local'),
  btnPlayOnline: document.getElementById('btn-play-online'),
  firebaseWarning: document.getElementById('firebase-warning'),
  inputNameCreate: document.getElementById('input-name-create'),
  inputNameJoin: document.getElementById('input-name-join'),
  inputRoomCode: document.getElementById('input-room-code'),
  btnCreateRoom: document.getElementById('btn-create-room'),
  btnJoinRoom: document.getElementById('btn-join-room'),
  onlineSetupError: document.getElementById('online-setup-error'),
  waitingRoomCode: document.getElementById('waiting-room-code'),
  btnCopyCode: document.getElementById('btn-copy-code'),
  btnCancelWaiting: document.getElementById('btn-cancel-waiting'),
  board: document.getElementById('board'),
  rowTop: document.getElementById('row-top'),
  rowBottom: document.getElementById('row-bottom'),
  store6: document.getElementById('store-6'),
  store13: document.getElementById('store-13'),
  stones6: document.getElementById('stones-6'),
  stones13: document.getElementById('stones-13'),
  count6: document.getElementById('count-6'),
  count13: document.getElementById('count-13'),
  chipP1: document.getElementById('chip-p1'),
  chipP2: document.getElementById('chip-p2'),
  nameP1: document.getElementById('name-p1'),
  nameP2: document.getElementById('name-p2'),
  scoreP1: document.getElementById('score-p1'),
  scoreP2: document.getElementById('score-p2'),
  turnText: document.getElementById('turn-text'),
  roomTag: document.getElementById('room-tag'),
  roomTagCode: document.getElementById('room-tag-code'),
  connectionStatus: document.getElementById('connection-status'),
  statusLine: document.getElementById('status-line'),
  modalGameover: document.getElementById('modal-gameover'),
  gameoverMessage: document.getElementById('gameover-message'),
  finalNameP1: document.getElementById('final-name-p1'),
  finalNameP2: document.getElementById('final-name-p2'),
  finalScoreP1: document.getElementById('final-score-p1'),
  finalScoreP2: document.getElementById('final-score-p2'),
  btnRematch: document.getElementById('btn-rematch'),
  btnBackToMenu: document.getElementById('btn-back-to-menu'),
  rematchStatus: document.getElementById('rematch-status'),
  toast: document.getElementById('toast'),
};

/* ------------------------------------------------------------------ */
/* App state                                                            */
/* ------------------------------------------------------------------ */

const state = {
  mode: null, // 'local' | 'online'
  board: createInitialBoard(),
  currentPlayer: 1,
  gameOver: false,
  winner: null,
  animating: false,
  names: { p1: 'Player 1', p2: 'Player 2' },

  // online-only
  roomCode: null,
  slot: null, // 'p1' | 'p2'
  lastAppliedMoveId: 0,
  connected: true,
  rematchArmed: false,
};

let pitEls = {}; // index -> element

/* ------------------------------------------------------------------ */
/* Screen navigation                                                    */
/* ------------------------------------------------------------------ */

function showScreen(name) {
  Object.entries(el.screens).forEach(([key, node]) => {
    node.classList.toggle('active', key === name);
  });
  el.btnMenu.hidden = name === 'mode';
}

function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  el.toast.classList.toggle('toast-error', isError);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.toast.hidden = true;
  }, 3200);
}

/* ------------------------------------------------------------------ */
/* Board rendering                                                      */
/* ------------------------------------------------------------------ */

function buildBoardSkeleton() {
  el.rowTop.innerHTML = '';
  el.rowBottom.innerHTML = '';
  pitEls = {};

  // Top row displays player 2 pits in visual order 12..7 (right-to-left flow)
  const topOrder = [12, 11, 10, 9, 8, 7];
  const bottomOrder = [0, 1, 2, 3, 4, 5];

  topOrder.forEach((i) => el.rowTop.appendChild(makePitEl(i)));
  bottomOrder.forEach((i) => el.rowBottom.appendChild(makePitEl(i)));
}

function makePitEl(index) {
  const div = document.createElement('div');
  div.className = 'pit';
  div.dataset.index = String(index);
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  div.innerHTML = `<span class="pit-index-label"></span><span class="pit-count"></span>`;
  div.addEventListener('click', () => onPitClick(index));
  div.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPitClick(index);
    }
  });
  pitEls[index] = div;
  return div;
}

const MAX_VISIBLE_STONES = 13;

function renderStonesInto(container, count, countLabelEl) {
  // Rebuild stones without re-triggering pop animation on every render tick:
  // only add/remove the delta.
  const current = container.querySelectorAll('.stone').length;
  const visibleTarget = Math.min(count, MAX_VISIBLE_STONES);

  if (visibleTarget > current) {
    for (let i = current; i < visibleTarget; i++) {
      const s = document.createElement('span');
      s.className = 'stone';
      container.appendChild(s);
    }
  } else if (visibleTarget < current) {
    for (let i = current; i > visibleTarget; i--) {
      container.lastElementChild && container.removeChild(container.lastElementChild);
    }
  }

  let overflowTag = container.querySelector('.pit-overflow-tag');
  if (count > MAX_VISIBLE_STONES) {
    if (!overflowTag) {
      overflowTag = document.createElement('span');
      overflowTag.className = 'pit-overflow-tag';
      container.appendChild(overflowTag);
    }
    overflowTag.textContent = `+${count - MAX_VISIBLE_STONES}`;
  } else if (overflowTag) {
    overflowTag.remove();
  }

  if (countLabelEl) countLabelEl.textContent = count > 0 ? String(count) : '';
}

function renderBoard() {
  const board = state.board;

  for (let i = 0; i <= 12; i++) {
    if (i === STORE1) continue;
    const pitEl = pitEls[i];
    if (!pitEl) continue;
    renderStonesInto(pitEl, board[i], pitEl.querySelector('.pit-count'));

    const player = i <= 5 ? 1 : 2;
    const playable = !state.gameOver && !state.animating && state.currentPlayer === player && board[i] > 0 && isLocalPlayerTurn(player);
    pitEl.dataset.playable = playable ? 'true' : 'false';
  }

  renderStonesInto(el.stones6, board[STORE1], el.count6);
  renderStonesInto(el.stones13, board[STORE2], el.count13);

  el.scoreP1.textContent = board[STORE1];
  el.scoreP2.textContent = board[STORE2];

  el.chipP1.classList.toggle('active-turn', state.currentPlayer === 1 && !state.gameOver);
  el.chipP2.classList.toggle('active-turn', state.currentPlayer === 2 && !state.gameOver);

  el.nameP1.textContent = state.names.p1;
  el.nameP2.textContent = state.names.p2;
  el.finalNameP1.textContent = state.names.p1;
  el.finalNameP2.textContent = state.names.p2;

  updateTurnText();
}

function isLocalPlayerTurn(player) {
  if (state.mode === 'local') return true;
  return playerNumberForSlot(state.slot) === player;
}

function updateTurnText() {
  if (state.gameOver) {
    el.turnText.textContent = 'Game over';
    return;
  }
  const whoseName = state.currentPlayer === 1 ? state.names.p1 : state.names.p2;
  if (state.mode === 'online') {
    const isMe = playerNumberForSlot(state.slot) === state.currentPlayer;
    el.turnText.textContent = isMe ? 'Your turn' : `${whoseName}'s turn`;
  } else {
    el.turnText.textContent = `${whoseName}'s turn`;
  }
}

function setStatusLine(text) {
  el.statusLine.textContent = text || '\u00A0';
}

/* ------------------------------------------------------------------ */
/* Animation                                                            */
/* ------------------------------------------------------------------ */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pitElementFor(index) {
  if (index === STORE1) return el.store6;
  if (index === STORE2) return el.store13;
  return pitEls[index];
}

/**
 * Plays back a move trace produced by simulateMove, animating pit-by-pit.
 * Mutates a working copy of the board as it goes and re-renders after each
 * atomic step so the counts on screen always match what's visible.
 */
async function animateTrace(boardBeforeMove, trace) {
  state.animating = true;
  const working = boardBeforeMove.slice();

  for (const step of trace) {
    if (step.type === 'pickup') {
      working[step.index] = 0;
      renderWorking(working);
      const source = pitElementFor(step.index);
      source && source.classList.add('active-sow');
      await delay(250);
      source && source.classList.remove('active-sow');
    } else if (step.type === 'sow') {
      working[step.index] += 1;
      renderWorking(working);
      const target = pitElementFor(step.index);
      if (target) {
        target.classList.add('active-sow');
        setTimeout(() => target.classList.remove('active-sow'), 260);
      }
      await delay(320);
    } else if (step.type === 'avalanche') {
      const source = pitElementFor(step.index);
      if (source) {
        const stones = source.querySelectorAll ? source.querySelectorAll('.stone') : [];
        stones.forEach((s) => s.classList.add('tumbling'));
      }
      await delay(250);
      working[step.index] = 0;
      renderWorking(working);
      await delay(150);
    } else if (step.type === 'store') {
      const store = pitElementFor(step.index);
      store && store.classList.add('store-fill-flash');
      await delay(600);
      store && store.classList.remove('store-fill-flash');
    }
  }

  state.animating = false;
}

function renderWorking(working) {
  const snapshot = state.board;
  state.board = working;
  renderBoard();
  state.board = snapshot; // restore; caller updates state.board to final value when done
}

/* ------------------------------------------------------------------ */
/* Local mode                                                           */
/* ------------------------------------------------------------------ */

function startLocalGame() {
  state.mode = 'local';
  state.board = createInitialBoard();
  state.currentPlayer = 1;
  state.gameOver = false;
  state.winner = null;
  state.names = { p1: 'Player 1', p2: 'Player 2' };
  el.roomTag.hidden = true;
  buildBoardSkeleton();
  renderBoard();
  setStatusLine('Pass the device — Player 1 goes first.');
  showScreen('game');
}

async function onPitClick(index) {
  if (state.animating || state.gameOver) return;

  if (state.mode === 'local') {
    const player = index <= 5 ? 1 : 2;
    if (player !== state.currentPlayer) return;
    if (!isValidMove(state.board, player, index)) return;
    await playLocalMove(player, index);
  } else if (state.mode === 'online') {
    const player = index <= 5 ? 1 : 2;
    const myPlayer = playerNumberForSlot(state.slot);
    if (player !== myPlayer || state.currentPlayer !== myPlayer) return;
    if (!isValidMove(state.board, myPlayer, index)) return;
    try {
      await makeMove(state.roomCode, state.slot, index);
    } catch (err) {
      toast(err.message, true);
    }
  }
}

async function playLocalMove(player, index) {
  const before = state.board.slice();
  const result = simulateMove(state.board, player, index);
  await animateTrace(before, result.trace);

  state.board = result.board;
  state.currentPlayer = result.extraTurn ? player : player === 1 ? 2 : 1;
  state.gameOver = result.gameOver;
  state.winner = result.winner;

  renderBoard();

  if (result.extraTurn) {
    setStatusLine(`${player === 1 ? state.names.p1 : state.names.p2} lands in the store — go again!`);
  } else {
    setStatusLine('');
  }

  if (result.gameOver) {
    showGameOver();
  }
}

/* ------------------------------------------------------------------ */
/* Online mode                                                          */
/* ------------------------------------------------------------------ */

function checkFirebaseAvailability() {
  if (!isFirebaseReady()) {
    el.firebaseWarning.hidden = false;
    el.firebaseWarning.textContent =
      'Online play needs Firebase configured. Add your project credentials in firebase.js, then reload. (' +
      (getInitError() || 'no config found') +
      ')';
    el.btnCreateRoom.disabled = true;
    el.btnJoinRoom.disabled = true;
    return false;
  }
  el.firebaseWarning.hidden = true;
  el.btnCreateRoom.disabled = false;
  el.btnJoinRoom.disabled = false;
  return true;
}

async function handleCreateRoom() {
  el.onlineSetupError.textContent = '';
  try {
    const name = el.inputNameCreate.value.trim() || 'Player 1';
    const { roomCode, slot } = await createRoom(name);
    enterOnlineRoom(roomCode, slot, name);
  } catch (err) {
    el.onlineSetupError.textContent = err.message;
  }
}

async function handleJoinRoom() {
  el.onlineSetupError.textContent = '';
  try {
    const name = el.inputNameJoin.value.trim() || 'Player 2';
    const code = el.inputRoomCode.value.trim().toUpperCase();
    const { roomCode, slot } = await joinRoom(code, name);
    enterOnlineRoom(roomCode, slot, name);
  } catch (err) {
    el.onlineSetupError.textContent = err.message;
  }
}

function enterOnlineRoom(roomCode, slot, myName) {
  state.mode = 'online';
  state.roomCode = roomCode;
  state.slot = slot;
  state.lastAppliedMoveId = 0;
  state.connected = true;

  if (slot === 'p1') {
    state.names.p1 = myName;
  } else {
    state.names.p2 = myName;
  }

  el.waitingRoomCode.textContent = roomCode;
  el.roomTagCode.textContent = roomCode;
  el.roomTag.hidden = false;

  buildBoardSkeleton();
  attachRoom(roomCode);

  showScreen('waiting');

  window.addEventListener('beforeunload', handleUnload);
}

function attachRoom(roomCode) {
  listenToRoom(
    roomCode,
    (data) => onRoomUpdate(data),
    (err) => toast(err.message, true)
  );
}

function handleUnload() {
  if (state.mode === 'online' && state.roomCode && state.slot) {
    markDisconnected(state.roomCode, state.slot);
  }
}

async function onRoomUpdate(data) {
  // Update names / connection status
  if (data.players?.p1?.name) state.names.p1 = data.players.p1.name;
  if (data.players?.p2?.name) state.names.p2 = data.players.p2.name;

  const opponentSlot = otherSlot(state.slot);
  const opponent = data.players?.[opponentSlot];
  state.connected = !!opponent?.connected;

  // Still waiting for an opponent to join
  if (!data.players?.p1 || !data.players?.p2) {
    showScreen('waiting');
    return;
  }

  if (el.screens.waiting.classList.contains('active') || el.screens.onlineSetup.classList.contains('active')) {
    showScreen('game');
  }

  updateConnectionBadge();

  const incomingMoveId = data.lastMove?.moveId || 0;

  // Fresh game / rematch reset (no move yet, or moveId went back to 0)
  if (incomingMoveId === 0) {
    state.board = data.board;
    state.currentPlayer = data.currentPlayer;
    state.gameOver = data.gameOver;
    state.winner = data.winner;
    state.lastAppliedMoveId = 0;
    hideGameOverModal();
    renderBoard();
    setStatusLine('');
    return;
  }

  // A new move needs to be animated locally
  if (incomingMoveId !== state.lastAppliedMoveId && !state.animating) {
    state.animating = true;
    const before = state.board.slice();
    try {
      const player = data.lastMove.by;
      const result = simulateMove(before, player, data.lastMove.pitIndex);
      await animateTrace(before, result.trace);
    } catch (err) {
      console.error('Animation replay failed, snapping to server state:', err);
    }
    state.animating = false;
    state.lastAppliedMoveId = incomingMoveId;
    state.board = data.board; // server state is authoritative
    state.currentPlayer = data.currentPlayer;
    state.gameOver = data.gameOver;
    state.winner = data.winner;
    renderBoard();

    if (data.gameOver) {
      showGameOver();
    }
  } else if (!state.animating) {
    // No new move, just keep local view in sync (e.g. presence changes)
    state.board = data.board;
    state.currentPlayer = data.currentPlayer;
    state.gameOver = data.gameOver;
    state.winner = data.winner;
    renderBoard();
    if (data.gameOver) showGameOver();
  }

  // Rematch status
  if (data.rematch) {
    const meArmed = data.rematch[state.slot];
    const themArmed = data.rematch[opponentSlot];
    if (meArmed && !themArmed) {
      el.rematchStatus.textContent = 'Waiting for opponent to accept the rematch\u2026';
    } else if (!meArmed && themArmed) {
      el.rematchStatus.textContent = `${state.names[opponentSlot]} wants a rematch!`;
    } else {
      el.rematchStatus.textContent = '';
    }
  }
}

function updateConnectionBadge() {
  el.connectionStatus.textContent = state.connected ? 'opponent connected' : 'opponent disconnected';
  el.connectionStatus.classList.toggle('connected', state.connected);
  el.connectionStatus.classList.toggle('disconnected', !state.connected);
}

async function attemptReconnect() {
  const session = getStoredSession();
  if (!session || !isFirebaseReady()) return false;
  try {
    const result = await reconnect();
    if (result) {
      state.mode = 'online';
      state.roomCode = result.roomCode;
      state.slot = result.slot;
      state.lastAppliedMoveId = 0;
      el.waitingRoomCode.textContent = result.roomCode;
      el.roomTagCode.textContent = result.roomCode;
      el.roomTag.hidden = false;
      buildBoardSkeleton();
      attachRoom(result.roomCode);
      showScreen('waiting');
      window.addEventListener('beforeunload', handleUnload);
      toast('Reconnected to your game.');
      return true;
    }
  } catch (err) {
    console.warn('Reconnect failed:', err);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Game over + rematch                                                  */
/* ------------------------------------------------------------------ */

function showGameOver() {
  const p1 = state.board[STORE1];
  const p2 = state.board[STORE2];
  el.finalScoreP1.textContent = p1;
  el.finalScoreP2.textContent = p2;

  let message;
  if (state.winner === 0) {
    message = "It's a tie!";
  } else {
    const winnerName = state.winner === 1 ? state.names.p1 : state.names.p2;
    if (state.mode === 'online' && playerNumberForSlot(state.slot) === state.winner) {
      message = 'You win! \u{1F389}';
    } else if (state.mode === 'online') {
      message = `${winnerName} wins.`;
    } else {
      message = `${winnerName} wins!`;
    }
  }
  el.gameoverMessage.textContent = message;
  el.rematchStatus.textContent = '';
  el.modalGameover.hidden = false;
}

function hideGameOverModal() {
  el.modalGameover.hidden = true;
}

async function handleRematch() {
  if (state.mode === 'local') {
    startLocalGame();
    hideGameOverModal();
    return;
  }
  try {
    el.btnRematch.disabled = true;
    await requestRematch(state.roomCode, state.slot);
    el.rematchStatus.textContent = 'Rematch requested\u2026';
  } catch (err) {
    toast(err.message, true);
  } finally {
    el.btnRematch.disabled = false;
  }
}

function backToMenu() {
  hideGameOverModal();
  if (state.mode === 'online') {
    stopListening();
    if (state.roomCode && state.slot) markDisconnected(state.roomCode, state.slot);
    window.removeEventListener('beforeunload', handleUnload);
    clearStoredSession();
  }
  state.mode = null;
  state.roomCode = null;
  state.slot = null;
  showScreen('mode');
}

/* ------------------------------------------------------------------ */
/* Wiring                                                               */
/* ------------------------------------------------------------------ */

el.btnPlayLocal.addEventListener('click', startLocalGame);

el.btnPlayOnline.addEventListener('click', () => {
  checkFirebaseAvailability();
  el.onlineSetupError.textContent = '';
  showScreen('onlineSetup');
});

el.btnCreateRoom.addEventListener('click', handleCreateRoom);
el.btnJoinRoom.addEventListener('click', handleJoinRoom);

el.btnCancelWaiting.addEventListener('click', () => {
  stopListening();
  clearStoredSession();
  window.removeEventListener('beforeunload', handleUnload);
  showScreen('onlineSetup');
});

el.btnCopyCode.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.roomCode || '');
    toast('Room code copied.');
  } catch {
    toast('Could not copy automatically — copy it manually.', true);
  }
});

el.btnMenu.addEventListener('click', backToMenu);
el.btnBackToMenu.addEventListener('click', backToMenu);
el.btnRematch.addEventListener('click', handleRematch);

el.inputRoomCode.addEventListener('input', () => {
  el.inputRoomCode.value = el.inputRoomCode.value.toUpperCase();
});

/* ------------------------------------------------------------------ */
/* Boot                                                                  */
/* ------------------------------------------------------------------ */

async function boot() {
  buildBoardSkeleton();
  checkFirebaseAvailability();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed:', err));
  }

  const resumed = await attemptReconnect();
  if (!resumed) {
    showScreen('mode');
  }
}

boot();