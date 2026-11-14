import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IFilter, IWorkerMessage } from './app.model';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  public filter: IFilter = {
    words: 'enter, your, own, list, of, comma, separated, words, here, and, hit, generate',
    maxSize: 15,
    shuffleWords: true,
  };

  public result: string[][] | null = null;

  public loading = false;
  public attempted = false;

  public bestPlaced = 0;
  public totalWords = 0;
  private bestBoard?: string[][];
  private bestLeftOut: string[] = [];
  public leftOutWords: string[] = []; // Words missing from the shown board after a cancel

  public elapsedTime = 0;
  private timerId?: number;
  private startTime = 0;

  private worker?: Worker;

  public ngOnInit(): void {
    this.initWorker();
  }

  public ngOnDestroy(): void {
    this.worker?.terminate();
    this.clearTimer();
  }

  public generate(): void {
    this.attempted = true;
    this.loading = true;
    this.result = null;
    this.bestPlaced = 0;
    this.totalWords = 0;
    this.bestBoard = undefined;
    this.bestLeftOut = [];
    this.leftOutWords = [];

    this.startTime = performance.now();

    this.timerId = window.setInterval(() => {
      this.elapsedTime = performance.now() - this.startTime;
    }, 10);

    this.worker?.postMessage(this.filter);
  }

  public cancel(): void {
    if (!this.loading) return;
    this.worker?.terminate();
    this.clearTimer();
    this.loading = false;
    this.initWorker();

    // Shows the board with the most words placed so far
    if (this.bestBoard) {
      this.result = this.bestBoard;
      this.leftOutWords = this.bestLeftOut;
    }
  }

  public toggleMirror(): void {
    const board = this.result;
    if (!board) return;
    this.result = board[0].map((_, colIndex) => board.map(row => row[colIndex]));
  }

  // Draws the board onto a canvas in the page's colors and downloads it as a PNG
  public exportPng(): void {
    const board = this.result;
    if (!board) return;

    const tileSize = 60;
    const gap = 6;
    const padding = 20;
    const scale = 2; // Draws at double resolution so the image stays sharp

    const rows = board.length;
    const cols = board[0].length;
    const width = padding * 2 + cols * tileSize + (cols - 1) * gap;
    const height = padding * 2 + rows * tileSize + (rows - 1) * gap;

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);

    ctx.fillStyle = '#3a69a2';
    ctx.fillRect(0, 0, width, height);

    ctx.font = `bold 30px 'SN Pro', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    board.forEach((row, r) => {
      row.forEach((letter, c) => {
        const x = padding + c * (tileSize + gap);
        const y = padding + r * (tileSize + gap);

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x, y, tileSize, tileSize, 4);
        ctx.fill();

        if (letter.trim()) {
          ctx.fillStyle = '#000000';
          ctx.fillText(letter, x + tileSize / 2, y + tileSize / 2);
        }
      });
    });

    const link = document.createElement('a');
    link.download = `webbed-words-${rows}x${cols}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  private initWorker(): void {
    this.worker = new Worker(new URL('./app.worker', import.meta.url), { type: 'module' });

    this.worker.onmessage = ({ data }: MessageEvent<IWorkerMessage>) => {
      if (data.type === 'progress') {
        this.bestPlaced = data.placed;
        this.totalWords = data.total;
        this.bestBoard = data.board;
        this.bestLeftOut = data.leftOut;
        return;
      }

      this.result = data.result;
      this.clearTimer();
      this.elapsedTime = performance.now() - this.startTime;
      this.loading = false;
    };
  }

  private clearTimer(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
  }

  get wordCount(): number {
    return this.filter.words
      .split(',')
      .map(word => word.trim())
      .filter(word => word.length > 0).length;
  }
}
