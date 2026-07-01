/**
 * multiplayer.js
 * Room-code based realtime multiplayer over Firebase Firestore.
 *
 * Firestore document shape: rooms/{roomCode}
 * {
 *   board: number[14],
 *   currentPlayer: 1 | 2,
 *   status: 'waiting' | 'active' | 'finished',
 *   gameOver: boolean,
 *   winner: 0 | 1 | 2 | null,
 *   players: {
 *     p1: { id: string, name: string, connected: boolean } | null,
 *     p2: { id: string, name: string, connected: boolean } | null
 *   },
 *   lastMove: { by: 1|2, pitIndex: number, moveId: number } | null,
 *   rematch: { p1: boolean, p2: boolean },
 *   createdAt: serverTimestamp,
 *   updatedAt: serverTimestamp
 * }
 */

import {
  db,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  isFirebaseReady,
} from './firebase.js';
import { createInitialBoard, simulateMove, isValidMove } from './game.js';

const SESSION_KEY = 'avalancheMancala.session';
const PLAYER_ID_KEY = 'avalancheMancala.playerId';

let unsubscribe = null;

/* ------------------------------------------------------------------ */
/* Local identity + session persistence (enables reconnect)            */
/* ------------------------------------------------------------------ */

export function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function saveSession(roomCode, slot) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, slot }));
}

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ------------------------------------------------------------------ */
/* Room codes                                                          */
/* ------------------------------------------------------------------ */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion

function generateRoomCode(length = 5) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/* ------------------------------------------------------------------ */
/* Room lifecycle                                                      */
/* ------------------------------------------------------------------ */

function requireDb() {
  if (!isFirebaseReady() || !db) {
    throw new Error(
      'Firebase is not configured. Add your project credentials to firebase.js to enable online play.'
    );
  }
}

/**
 * Creates a new room and assigns the local player to slot p1.
 * Retries a few times in the unlikely event of a room-code collision.
 */
export async function createRoom(displayName) {
  requireDb();
  const playerId = getPlayerId();

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = generateRoomCode();
    const ref = doc(db, 'rooms', roomCode);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;

    await setDoc(ref, {
      board: createInitialBoard(),
      currentPlayer: 1,
      status: 'waiting',
      gameOver: false,
      winner: null,
      players: {
        p1: { id: playerId, name: displayName || 'Player 1', connected: true },
        p2: null,
      },
      lastMove: null,
      rematch: { p1: false, p2: false },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    saveSession(roomCode, 'p1');
    return { roomCode, slot: 'p1' };
  }

  throw new Error('Could not generate a unique room code. Please try again.');
}

/**
 * Joins an existing room. If this player was already p1 or p2 in that room
 * (matched by playerId, e.g. after a refresh), reconnects to that slot.
 * Otherwise claims the open p2 slot.
 */
export async function joinRoom(roomCode, displayName) {
  requireDb();
  roomCode = (roomCode || '').trim().toUpperCase();
  if (!roomCode) throw new Error('Enter a room code.');

  const playerId = getPlayerId();
  const ref = doc(db, 'rooms', roomCode);

  const slot = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Room not found. Check the code and try again.');
    const data = snap.data();

    if (data.players?.p1?.id === playerId) {
      tx.update(ref, { 'players.p1.connected': true, updatedAt: serverTimestamp() });
      return 'p1';
    }
    if (data.players?.p2?.id === playerId) {
      tx.update(ref, { 'players.p2.connected': true, updatedAt: serverTimestamp() });
      return 'p2';
    }
    if (!data.players?.p2) {
      tx.update(ref, {
        'players.p2': { id: playerId, name: displayName || 'Player 2', connected: true },
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      return 'p2';
    }
    throw new Error('This room is already full.');
  });

  saveSession(roomCode, slot);
  return { roomCode, slot };
}

/** Attempts to resume a previously saved session (used on page load). */
export async function reconnect() {
  const session = getStoredSession();
  if (!session) return null;
  requireDb();

  const ref = doc(db, 'rooms', session.roomCode);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    clearStoredSession();
    return null;
  }
  const data = snap.data();
  const mySlot = session.slot;
  if (!data.players?.[mySlot] || data.players[mySlot].id !== getPlayerId()) {
    clearStoredSession();
    return null;
  }
  await updateDoc(ref, { [`players.${mySlot}.connected`]: true, updatedAt: serverTimestamp() });
  return { roomCode: session.roomCode, slot: mySlot };
}

export function listenToRoom(roomCode, onUpdate, onError) {
  requireDb();
  if (unsubscribe) unsubscribe();
  const ref = doc(db, 'rooms', roomCode);
  unsubscribe = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onError && onError(new Error('Room no longer exists.'));
        return;
      }
      onUpdate(snap.data());
    },
    (err) => onError && onError(err)
  );
  return unsubscribe;
}

export function stopListening() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

export async function markDisconnected(roomCode, slot) {
  if (!isFirebaseReady() || !roomCode || !slot) return;
  try {
    const ref = doc(db, 'rooms', roomCode);
    await updateDoc(ref, { [`players.${slot}.connected`]: false, updatedAt: serverTimestamp() });
  } catch {
    /* best-effort only */
  }
}

/* ------------------------------------------------------------------ */
/* Gameplay                                                             */
/* ------------------------------------------------------------------ */

const slotToPlayer = { p1: 1, p2: 2 };

/**
 * Submits a move inside a transaction so two simultaneous taps can't both
 * apply. Computes the resulting state with the same deterministic game
 * logic used for local play, then writes the authoritative result.
 */
export async function makeMove(roomCode, slot, pitIndex) {
  requireDb();
  const ref = doc(db, 'rooms', roomCode);
  const player = slotToPlayer[slot];

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Room no longer exists.');
    const data = snap.data();

    if (data.gameOver) throw new Error('The game has already ended.');
    if (data.currentPlayer !== player) throw new Error('Not your turn.');
    if (!isValidMove(data.board, player, pitIndex)) throw new Error('Invalid move.');

    const result = simulateMove(data.board, player, pitIndex);
    const nextPlayer = result.extraTurn ? player : player === 1 ? 2 : 1;
    const moveId = (data.lastMove?.moveId || 0) + 1;

    tx.update(ref, {
      board: result.board,
      currentPlayer: result.gameOver ? data.currentPlayer : nextPlayer,
      gameOver: result.gameOver,
      winner: result.gameOver ? result.winner : null,
      status: result.gameOver ? 'finished' : 'active',
      lastMove: { by: player, pitIndex, moveId },
      updatedAt: serverTimestamp(),
    });
  });
}

/** Marks the local player ready for a rematch; resets the board once both are ready. */
export async function requestRematch(roomCode, slot) {
  requireDb();
  const ref = doc(db, 'rooms', roomCode);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Room no longer exists.');
    const data = snap.data();
    const rematch = { ...(data.rematch || { p1: false, p2: false }), [slot]: true };

    if (rematch.p1 && rematch.p2) {
      tx.update(ref, {
        board: createInitialBoard(),
        currentPlayer: 1,
        status: 'active',
        gameOver: false,
        winner: null,
        lastMove: null,
        rematch: { p1: false, p2: false },
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.update(ref, { rematch, updatedAt: serverTimestamp() });
    }
  });
}

export function otherSlot(slot) {
  return slot === 'p1' ? 'p2' : 'p1';
}

export function playerNumberForSlot(slot) {
  return slotToPlayer[slot];
}
