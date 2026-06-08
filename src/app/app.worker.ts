/// <reference lib="webworker" />
import { IFilter } from './app.model';

addEventListener('message', ({ data }) => {
  const result = algorithm(data);
  postMessage(result);
});

function algorithm(filter: IFilter): string[][][] {
  if (filter.words.length === 0) return [];

  const words = filter.words
    .replace(/\s+/g, '')
    .split(',')
    .map(word => word.toUpperCase())
    .sort((a, b) => b.length - a.length);

  if (filter.shuffleWords) words.sort(() => Math.random() - 0.5);

  const board = new Map<number, string>();
  const results: string[][][] = [];

  let currentBounds = { minRow: 0, maxRow: 0, minCol: 0, maxCol: words[0].length - 1 }; // Tracks the bounds of the board throughout the algorithm
  const seen = new Set<string>(); // Tracks solution boards that have already been recorded
  const deadStates = new Set<string>(); // Tracks dead board states that do not lead to a solution
  const letterIndex = new Map<string, Set<number>>(); // Stores information mapping a letter to every position on the board that is that letter

  // Packs a row and col into a single 32-bit integer and return it
  function hashCoord(row: number, col: number): number {
    return (row << 16) | (col & 0xffff);
  }

  // Unpacks the 32-bit integer back into [row, col] and return it
  function unhashCoord(hash: number): [number, number] {
    const row = hash >> 16;
    const col = (hash << 16) >> 16;
    return [row, col];
  }

  // Gets the letter of a position on the board and return it
  function getCell(row: number, col: number): string | undefined {
    return board.get(hashCoord(row, col));
  }

  // Sets a letter in a position on the board, add the position to the letter index, and adjust the bounds of the board
  function setCell(row: number, col: number, letter: string): void {
    const hash = hashCoord(row, col);
    board.set(hash, letter);

    let positions = letterIndex.get(letter);
    if (!positions) {
      positions = new Set();
      letterIndex.set(letter, positions);
    }
    positions.add(hash);

    currentBounds.minRow = Math.min(currentBounds.minRow, row);
    currentBounds.maxRow = Math.max(currentBounds.maxRow, row);
    currentBounds.minCol = Math.min(currentBounds.minCol, col);
    currentBounds.maxCol = Math.max(currentBounds.maxCol, col);
  }

  // Deletes a letter given a position on the board, remove the position from the letter index, and adjust the bounds of the board if needed
  function deleteCell(row: number, col: number) {
    const hash = hashCoord(row, col);
    const letter = board.get(hash);

    if (letter) {
      const positions = letterIndex.get(letter);
      if (positions) {
        positions.delete(hash);
        if (positions.size === 0) {
          letterIndex.delete(letter);
        }
      }
    }
    board.delete(hash);

    if (row === currentBounds.minRow || row === currentBounds.maxRow || col === currentBounds.minCol || col === currentBounds.maxCol) {
      if (board.size === 0) {
        currentBounds = { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 };
        return;
      }

      let minRow = Infinity;
      let maxRow = -Infinity;
      let minCol = Infinity;
      let maxCol = -Infinity;

      for (const hash of board.keys()) {
        const [r, c] = unhashCoord(hash);
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
      }

      currentBounds = { minRow, maxRow, minCol, maxCol };
    }
  }

  // Determines the bounds of the board after the given word is added and returns whether or not the word will fit
  function placementFits(word: string, startRow: number, startCol: number, vertical: boolean): boolean {
    let { minRow, maxRow, minCol, maxCol } = currentBounds;

    for (let i = 0; i < word.length; i++) {
      const row = vertical ? startRow + i : startRow;
      const col = vertical ? startCol : startCol + i;

      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    }

    const width = maxCol - minCol + 1;
    const height = maxRow - minRow + 1;

    return width <= filter.maxSize && height <= filter.maxSize;
  }

  // Determines if a word can be placed on the board without creating any new words
  function canPlaceWord(word: string, startRow: number, startCol: number, vertical: boolean): boolean {
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

    // Checks each cell that would occupy a letter of the new word and determines if it will fit
    for (let i = 0; i < word.length; i++) {
      const row = vertical ? startRow + i : startRow;
      const col = vertical ? startCol : startCol + i;
      const existing = getCell(row, col);

      // Return if the cell contains a letter that is not the correct letter
      if (existing && existing !== word[i]) {
        return false;
      }

      // Continues to the next letter if there is an intersection
      const isIntersection = existing === word[i];
      if (isIntersection) {
        intersections++;
        continue;
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

  // Places a word on the board and returns the positions on the board that occupy the new letters
  function placeWord(word: string, startRow: number, startCol: number, vertical: boolean): [number, number][] {
    const addedCells: [number, number][] = [];

    for (let i = 0; i < word.length; i++) {
      const row = vertical ? startRow + i : startRow;
      const col = vertical ? startCol : startCol + i;

      if (!getCell(row, col)) {
        setCell(row, col, word[i]);
        addedCells.push([row, col]);
      }
    }

    return addedCells;
  }

  // Removes from the board the given positions
  function undoPlacement(addedCells: [number, number][]) {
    for (const [row, col] of addedCells) {
      deleteCell(row, col);
    }
  }

  // Returns a matrix given the current state of the board
  function boardToMatrix(): string[][] {
    const { minRow, maxRow, minCol, maxCol } = currentBounds;
    const matrix = Array.from({ length: maxRow - minRow + 1 }, () => Array(maxCol - minCol + 1).fill(' '));

    for (const [hash, letter] of board.entries()) {
      const [row, col] = unhashCoord(hash);
      matrix[row - minRow][col - minCol] = letter;
    }

    return matrix;
  }

  // Converts the state of the board to a string in sorted order
  function serializeBoard(): string {
    const sortedHashes = [...board.keys()].sort((a, b) => a - b);
    let result = '';

    for (let i = 0; i < sortedHashes.length; i++) {
      const hash = sortedHashes[i];
      result += `${hash}:${board.get(hash)}|`;
    }

    return result;
  }

  function search(wordsLeft: string[]) {
    if (results.length >= filter.maxResults) return;

    // Checks if the current state of the board has already been determined to be a dead state and returns if so
    const stateKey = serializeBoard() + '#' + [...wordsLeft].sort().join(',');
    if (deadStates.has(stateKey)) return;

    let foundSolution = false;

    // If all of the words have been used, check to see if the same solution was already added and push the solution to the results if it is new
    if (wordsLeft.length === 0) {
      const signature = serializeBoard();

      if (!seen.has(signature)) {
        seen.add(signature);
        results.push(boardToMatrix());

        foundSolution = true;
      }

      return;
    }

    // Loops through the remaining words in the array
    for (let wordIndex = 0; wordIndex < wordsLeft.length; wordIndex++) {
      const word = wordsLeft[wordIndex];

      // Loops through the letters in a word
      for (let letterIndexInWord = 0; letterIndexInWord < word.length; letterIndexInWord++) {
        // Gets the positions of every place on the board with the current letter and continues if one is not found
        const matchingPositions = letterIndex.get(word[letterIndexInWord]);
        if (!matchingPositions) continue;

        // Loops through every possible position to place the word
        for (const hash of matchingPositions) {
          const [row, col] = unhashCoord(hash);
          const letterIndex = letterIndexInWord;

          // Vertical and horizontal placement
          const placements = [
            { vertical: true, startRow: row - letterIndex, startCol: col },
            { vertical: false, startRow: row, startCol: col - letterIndex },
          ];

          // Attempts to place the word in every position
          for (const placement of placements) {
            if (!canPlaceWord(word, placement.startRow, placement.startCol, placement.vertical)) continue;
            if (!placementFits(word, placement.startRow, placement.startCol, placement.vertical)) continue;

            // Places the word and returns the cells in case the letters need to be removed later
            const addedCells = placeWord(word, placement.startRow, placement.startCol, placement.vertical);

            const nextWords = [...wordsLeft];
            nextWords.splice(wordIndex, 1);

            search(nextWords);

            undoPlacement(addedCells);

            if (results.length >= filter.maxResults) return;
          }
        }
      }
    }

    // Records that the current state is a dead one and will not lead to any results
    if (!foundSolution) {
      deadStates.add(stateKey);
    }
  }

  // Place the first word in the list horizontally
  const firstWord = words[0];
  for (let i = 0; i < firstWord.length; i++) {
    setCell(0, i, firstWord[i]);
  }

  search(words.slice(1));

  return results;
}
