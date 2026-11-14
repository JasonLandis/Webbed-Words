export interface IFilter {
  words: string;
  maxSize: number;
  maxResults: number;
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
  results: string[][][] 
};
