/// <reference lib="webworker" />
import { IFilter, IWorkerMessage } from './app.model';

addEventListener('message', ({ data }) => {
  const results = algorithm(data);
  send({ type: 'done', results });
});

function send(message: IWorkerMessage): void {
  postMessage(message);
}

function algorithm(filter: IFilter): string[][][] {
  const words = filter.words
    .split(',')
    .map(word => word.trim())
    .filter(word => word.length > 0)
    .map(word => word.toUpperCase())
    .sort((a, b) => b.length - a.length);

  // Returns if there are no words once blank entries are removed, such as for an input of only commas or spaces
  if (words.length === 0) return [];

  // Shuffles the words with a Fisher-Yates shuffle so every order is equally likely
  if (filter.shuffleWords) {
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
  }

  // The board is a flat grid of char codes (0 for empty) centered on the first word
  // It is padded so that every cell read while testing a placement stays inside the grid
  const maxSize = Number(filter.maxSize);
  const maxWordLength = Math.max(...words.map(word => word.length));
  const offset = Math.max(maxSize, words[0].length) + maxWordLength + 2;
  const side = offset * 2 + 1;
  const board = new Uint16Array(side * side);
  const results: string[][][] = [];

  let currentBounds = { minRow: 0, maxRow: 0, minCol: 0, maxCol: words[0].length - 1 }; // Tracks the bounds of the board throughout the algorithm
  const exploredStates = new Set<string>(); // Tracks states (board plus remaining words) that have been fully explored, including recorded solutions
  const letterIndex = new Map<number, Set<number>>(); // Stores information mapping a letter's char code to every cell on the board that is that letter

  // 64-bit Zobrist-style hash of the board split into two 32-bit halves, updated incrementally as cells are set and deleted
  let boardHashHi = 0;
  let boardHashLo = 0;

  // Random 64-bit values per word index, XORed together to hash the set of remaining words
  const wordHashHi = words.map(() => (Math.random() * 0x100000000) | 0);
  const wordHashLo = words.map(() => (Math.random() * 0x100000000) | 0);

  // Unique letter char codes of each word, and whether each pair of words shares a letter
  const wordLetters = words.map(word => [...new Set(Array.from(word, (_, i) => word.charCodeAt(i)))]);
  const sharesLetter = words.map((_, i) => words.map((_, j) => i !== j && wordLetters[i].some(code => wordLetters[j].includes(code))));

  // Scrambles a 32-bit integer (murmur3 finalizer) and returns it
  function mix32(h: number): number {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h;
  }

  // Toggles a letter at a cell in or out of the board hash
  function toggleBoardHash(cell: number, code: number): void {
    boardHashHi ^= mix32(mix32(cell ^ 0x9e3779b9) + code);
    boardHashLo ^= mix32(mix32(cell ^ 0x7f4a7c15) + code);
  }

  // Converts a row and col into an index into the board grid and return it
  function cellIndex(row: number, col: number): number {
    return (row + offset) * side + col + offset;
  }

  // Gets the char code of the letter at a position on the board, or 0 if empty, and return it
  function getCell(row: number, col: number): number {
    return board[cellIndex(row, col)];
  }

  // Sets a letter in a position on the board, add the position to the letter index, and adjust the bounds of the board
  function setCell(row: number, col: number, code: number): void {
    const cell = cellIndex(row, col);
    board[cell] = code;
    toggleBoardHash(cell, code);

    let positions = letterIndex.get(code);
    if (!positions) {
      positions = new Set();
      letterIndex.set(code, positions);
    }
    positions.add(cell);

    currentBounds.minRow = Math.min(currentBounds.minRow, row);
    currentBounds.maxRow = Math.max(currentBounds.maxRow, row);
    currentBounds.minCol = Math.min(currentBounds.minCol, col);
    currentBounds.maxCol = Math.max(currentBounds.maxCol, col);
  }

  // Deletes a letter given a cell on the board and remove the cell from the letter index
  // Bounds are not adjusted here; callers restore the bounds saved before the placement
  function deleteCell(cell: number) {
    const code = board[cell];

    if (code) {
      toggleBoardHash(cell, code);
      const positions = letterIndex.get(code);
      if (positions) {
        positions.delete(cell);
        if (positions.size === 0) {
          letterIndex.delete(code);
        }
      }
    }
    board[cell] = 0;
  }

  // Determines the bounds of the board after the given word is added and returns whether or not the word will fit
  // Only the first and last letters of the word can extend the bounds
  function placementFits(word: string, startRow: number, startCol: number, vertical: boolean): boolean {
    const endRow = vertical ? startRow + word.length - 1 : startRow;
    const endCol = vertical ? startCol : startCol + word.length - 1;

    const width = Math.max(currentBounds.maxCol, endCol) - Math.min(currentBounds.minCol, startCol) + 1;
    const height = Math.max(currentBounds.maxRow, endRow) - Math.min(currentBounds.minRow, startRow) + 1;

    return width <= maxSize && height <= maxSize;
  }

  // Determines if a word can be placed on the board without creating any new words
  // The anchor is the index of the letter the placement was generated from; placements that intersect the board before it are rejected
  // since the same placement is also generated from that earlier intersection
  function canPlaceWord(word: string, startRow: number, startCol: number, vertical: boolean, anchor: number): boolean {
    let intersections = 0;
    let newTiles = 0;

    // Checks that the cells before and after the word are empty
    const beforeRow = vertical ? startRow - 1 : startRow;
    const beforeCol = vertical ? startCol : startCol - 1;
    if (getCell(beforeRow, beforeCol)) {
      return false;
    }
    const afterRow = vertical ? startRow + word.length : startRow;
    const afterCol = vertical ? startCol : startCol + word.length;
    if (getCell(afterRow, afterCol)) {
      return false;
    }

    let twoInARow = false;

    // Checks each cell that would occupy a letter of the new word and determines if it will fit
    for (let i = 0; i < word.length; i++) {
      const row = vertical ? startRow + i : startRow;
      const col = vertical ? startCol : startCol + i;
      const existing = getCell(row, col);
      const code = word.charCodeAt(i);

      // Return if the cell contains a letter that is not the correct letter
      if (existing && existing !== code) {
        return false;
      }

      // Return if this placement was already tried from an earlier intersection
      if (existing && i < anchor) {
        return false;
      }

      // Continues to the next letter if there is an intersection
      const isIntersection = existing === code;
      if (isIntersection && twoInARow === false) {
        intersections++;
        twoInARow = true;
        continue;
      } else if (isIntersection && twoInARow === true) {
        return false;
      } else {
        twoInARow = false;
      }

      newTiles++;

      // Checks if the adjacent tiles of the positions of the letters being added are empty
      if (vertical) {
        if (getCell(row, col - 1)) return false;
        if (getCell(row, col + 1)) return false;
      } else {
        if (getCell(row - 1, col)) return false;
        if (getCell(row + 1, col)) return false;
      }
    }

    return intersections > 0 && newTiles > 0;
  }

  // Stack of the cells added by every placement currently on the board, so placements can be undone without allocating
  const addedCells: number[] = [];

  // Places a word on the board, pushes the cells of the new letters onto the added cells stack, and returns how many were added
  function placeWord(word: string, startRow: number, startCol: number, vertical: boolean): number {
    let added = 0;

    for (let i = 0; i < word.length; i++) {
      const row = vertical ? startRow + i : startRow;
      const col = vertical ? startCol : startCol + i;
      const cell = cellIndex(row, col);

      if (!board[cell]) {
        setCell(row, col, word.charCodeAt(i));
        addedCells.push(cell);
        added++;
      }
    }

    return added;
  }

  // Removes from the board the given number of most recently added cells
  function undoPlacement(count: number) {
    for (let i = 0; i < count; i++) {
      deleteCell(addedCells.pop()!);
    }
  }

  // Returns a matrix given the current state of the board
  function boardToMatrix(): string[][] {
    const { minRow, maxRow, minCol, maxCol } = currentBounds;
    const matrix: string[][] = [];

    for (let row = minRow; row <= maxRow; row++) {
      const line: string[] = [];
      for (let col = minCol; col <= maxCol; col++) {
        const code = getCell(row, col);
        line.push(code ? String.fromCharCode(code) : ' ');
      }
      matrix.push(line);
    }

    return matrix;
  }

  // Scratch flags for allWordsReachable, indexed by word, cleared after every call
  const reachedFlags = new Uint8Array(words.length);

  // Returns whether every remaining word can still be placed, either by sharing a letter with the board or with another reachable remaining word
  function allWordsReachable(wordsLeft: number[]): boolean {
    let reachedCount = 0;

    // Marks the words that share a letter with the board
    for (const id of wordsLeft) {
      for (const code of wordLetters[id]) {
        if (letterIndex.has(code)) {
          reachedFlags[id] = 1;
          reachedCount++;
          break;
        }
      }
    }

    // Repeatedly marks the words that share a letter with a marked word until nothing changes
    let changed = reachedCount > 0;
    while (changed && reachedCount < wordsLeft.length) {
      changed = false;
      for (const id of wordsLeft) {
        if (reachedFlags[id]) continue;
        for (const other of wordsLeft) {
          if (reachedFlags[other] && sharesLetter[other][id]) {
            reachedFlags[id] = 1;
            reachedCount++;
            changed = true;
            break;
          }
        }
      }
    }

    for (const id of wordsLeft) reachedFlags[id] = 0;

    return reachedCount === wordsLeft.length;
  }

  // Removes the word at the given index of the array, shifting later words down
  function removeWordAt(wordsLeft: number[], index: number) {
    for (let i = index; i < wordsLeft.length - 1; i++) {
      wordsLeft[i] = wordsLeft[i + 1];
    }
    wordsLeft.pop();
  }

  // Inserts a word at the given index of the array, shifting later words up
  function insertWordAt(wordsLeft: number[], index: number, wordId: number) {
    wordsLeft.push(wordId);
    for (let i = wordsLeft.length - 1; i > index; i--) {
      wordsLeft[i] = wordsLeft[i - 1];
    }
    wordsLeft[index] = wordId;
  }

  // The most words placed on the board in any state so far, reported to the page whenever it increases
  let bestPlaced = 1;

  function search(wordsLeft: number[], wordsHashHi: number, wordsHashLo: number) {
    if (results.length >= filter.maxResults) return;

    const placed = words.length - wordsLeft.length;
    if (placed > bestPlaced) {
      bestPlaced = placed;
      send({ type: 'progress', placed, total: words.length });
    }

    // Checks if the current state has already been fully explored and returns if so
    const stateKey = `${boardHashHi ^ wordsHashHi}:${boardHashLo ^ wordsHashLo}`;
    if (exploredStates.has(stateKey)) return;

    // If all of the words have been used, push the solution to the results
    // The words hash is 0 here, so the state key identifies the board alone and repeated solutions are caught by the check above
    if (wordsLeft.length === 0) {
      exploredStates.add(stateKey);
      results.push(boardToMatrix());
      return;
    }

    // Returns early if some remaining word can never connect to the board
    if (!allWordsReachable(wordsLeft)) {
      exploredStates.add(stateKey);
      return;
    }

    // Loops through the remaining words in the array
    for (let wordIndex = 0; wordIndex < wordsLeft.length; wordIndex++) {
      const wordId = wordsLeft[wordIndex];
      const word = words[wordId];

      // Loops through the letters in a word
      for (let letterIndexInWord = 0; letterIndexInWord < word.length; letterIndexInWord++) {
        // Gets the positions of every place on the board with the current letter and continues if one is not found
        const matchingPositions = letterIndex.get(word.charCodeAt(letterIndexInWord));
        if (!matchingPositions) continue;

        // Loops through every possible position to place the word
        for (const cell of matchingPositions) {
          const row = Math.floor(cell / side) - offset;
          const col = (cell % side) - offset;

          // Attempts to place the word vertically and then horizontally through this position
          for (let direction = 0; direction < 2; direction++) {
            const vertical = direction === 0;
            const startRow = vertical ? row - letterIndexInWord : row;
            const startCol = vertical ? col : col - letterIndexInWord;

            if (!placementFits(word, startRow, startCol, vertical)) continue;
            if (!canPlaceWord(word, startRow, startCol, vertical, letterIndexInWord)) continue;

            // Saves the bounds so they can be restored after backtracking instead of being recomputed
            const { minRow, maxRow, minCol, maxCol } = currentBounds;

            // Places the word and returns the number of new letters in case they need to be removed later
            const added = placeWord(word, startRow, startCol, vertical);

            // Removes the word from the remaining words in place, keeping their order, and restores it after searching
            removeWordAt(wordsLeft, wordIndex);
            search(wordsLeft, wordsHashHi ^ wordHashHi[wordId], wordsHashLo ^ wordHashLo[wordId]);
            insertWordAt(wordsLeft, wordIndex, wordId);

            undoPlacement(added);
            currentBounds.minRow = minRow;
            currentBounds.maxRow = maxRow;
            currentBounds.minCol = minCol;
            currentBounds.maxCol = maxCol;

            if (results.length >= filter.maxResults) return;
          }
        }
      }
    }

    // Records that the current state has been fully explored, so any solutions it leads to are already in the results
    exploredStates.add(stateKey);
  }

  // Place the first word in the list horizontally
  const firstWord = words[0];
  for (let i = 0; i < firstWord.length; i++) {
    setCell(0, i, firstWord.charCodeAt(i));
  }
  send({ type: 'progress', placed: 1, total: words.length });

  // Search with every word except the first remaining, by index
  const remaining = words.map((_, i) => i).slice(1);
  let remainingHashHi = 0;
  let remainingHashLo = 0;
  for (const i of remaining) {
    remainingHashHi ^= wordHashHi[i];
    remainingHashLo ^= wordHashLo[i];
  }

  search(remaining, remainingHashHi, remainingHashLo);

  return results;
}
