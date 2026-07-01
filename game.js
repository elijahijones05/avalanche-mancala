/**
 * game.js
 * Pure Avalanche Mancala game logic. No DOM, no Firebase.
 *
 * Board representation: array of 14 integers.
 *   Indices 0-5   : Player 1 pits (left to right, sowing direction increasing)
 *   Index  6      : Player 1 store
 *   Indices 7-12  : Player 2 pits
 *   Index  13     : Player 2 store
 *
 * Sowing always moves in increasing index order, wrapping 13 -> 0,
 * and always skips the sowing player's OPPONENT store.
 */

export const STORE1 = 6;
export const STORE2 = 13;
export const PITS_PER_SIDE = 6;
export const STONES_PER_PIT = 4;

/** Fresh starting board: 4 stones in each of the 12 pits, empty stores. */
export function createInitialBoard() {
  const board = new Array(14).fill(STONES_PER_PIT);
  board[STORE1] = 0;
  board[STORE2] = 0;
  return board;
}

export function ownPits(player) {
  return player === 1 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
}

export function ownStore(player) {
  return player === 1 ? STORE1 : STORE2;
}

export function oppStore(player) {
  return player === 1 ? STORE2 : STORE1;
}

export function isOwnPit(index, player) {
  return player === 1 ? index >= 0 && index <= 5 : index >= 7 && index <= 12;
}

/** The pit directly across the board from `index` (0<->12, 1<->11, ... 5<->7). */
export function oppositeIndex(index) {
  return 12 - index;
}

function nextIndex(index, player) {
  let n = (index + 1) % 14;
  const opp = oppStore(player);
  if (n === opp) n = (n + 1) % 14;
  return n;
}

export function isValidMove(board, player, pitIndex) {
  if (!ownPits(player).includes(pitIndex)) return false;
  if (!board || board[pitIndex] <= 0) return false;
  return true;
}

export function getValidMoves(board, player) {
  return ownPits(player).filter((i) => board[i] > 0);
}

export function hasAnyMoves(board, player) {
  return getValidMoves(board, player).length > 0;
}

/**
 * Simulates a full move, including avalanche relay sowing. Landing the
 * final stone in an empty pit (yours or the opponent's) simply ends the
 * turn — standard Avalanche rules have no capture mechanic.
 *
 * trace step types:
 *   { type: 'pickup',    index, count }               - stones lifted from starting pit
 *   { type: 'sow',       index }                       - one stone dropped in `index`
 *   { type: 'avalanche', index, count }                - stones re-lifted from `index` (relay continues)
 *   { type: 'store',     index }                       - final stone landed in a store (turn ends / extra turn)
 */
export function simulateMove(board, player, pitIndex) {
  if (!isValidMove(board, player, pitIndex)) {
    throw new Error(`Invalid move: player ${player} cannot sow pit ${pitIndex}`);
  }

  const newBoard = board.slice();
  const trace = [];

  let stones = newBoard[pitIndex];
  newBoard[pitIndex] = 0;
  trace.push({ type: 'pickup', index: pitIndex, count: stones });

  let index = pitIndex;
  let extraTurn = false;

  const SAFETY_LIMIT = 500; // guards against unforeseen infinite relay loops
  let iterations = 0;

  while (stones > 0) {
    iterations++;
    if (iterations > SAFETY_LIMIT) {
      console.warn('Avalanche relay exceeded safety limit; ending move early.');
      break;
    }

    let lastIndex = index;
    for (let i = 0; i < stones; i++) {
      lastIndex = nextIndex(lastIndex, player);
      newBoard[lastIndex]++;
      trace.push({ type: 'sow', index: lastIndex });
    }
    index = lastIndex;
    stones = 0;

    if (index === ownStore(player)) {
      extraTurn = true;
      trace.push({ type: 'store', index });
      break;
    }

    if (newBoard[index] === 1) {
      // Landed in a pit that was empty before this stone.
      // Standard Avalanche rule: no capture — the turn simply ends here,
      // and the single stone just placed stays in the pit.
      break;
    } else {
      // Avalanche: pit had stones already -> pick them all up and keep sowing.
      stones = newBoard[index];
      newBoard[index] = 0;
      trace.push({ type: 'avalanche', index, count: stones });
    }
  }

  const p1Empty = ownPits(1).every((i) => newBoard[i] === 0);
  const p2Empty = ownPits(2).every((i) => newBoard[i] === 0);

  let gameOver = false;
  let winner = null;
  let sweep = null;

  if (p1Empty || p2Empty) {
    gameOver = true;
    if (p1Empty && !p2Empty) {
      let sum = 0;
      const swept = [];
      ownPits(2).forEach((i) => {
        if (newBoard[i] > 0) swept.push(i);
        sum += newBoard[i];
        newBoard[i] = 0;
      });
      newBoard[STORE2] += sum;
      sweep = { player: 2, store: STORE2, pits: swept, amount: sum };
    } else if (p2Empty && !p1Empty) {
      let sum = 0;
      const swept = [];
      ownPits(1).forEach((i) => {
        if (newBoard[i] > 0) swept.push(i);
        sum += newBoard[i];
        newBoard[i] = 0;
      });
      newBoard[STORE1] += sum;
      sweep = { player: 1, store: STORE1, pits: swept, amount: sum };
    }
    if (newBoard[STORE1] > newBoard[STORE2]) winner = 1;
    else if (newBoard[STORE2] > newBoard[STORE1]) winner = 2;
    else winner = 0; // tie
  }

  return {
    board: newBoard,
    trace,
    extraTurn,
    gameOver,
    winner,
    sweep,
    scores: { p1: newBoard[STORE1], p2: newBoard[STORE2] },
  };
}
