export interface IFilter {
  words: string;
  maxSize: number;
  shuffleWords: boolean;
}

export type IWorkerMessage = { 
  type: 'progress'; 
  placed: number; 
  total: number;
  board: string[][];
  leftOut: string[];
} | { 
  type: 'done'; 
  result: string[][] | null;
};
