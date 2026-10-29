import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IFilter, IWorkerMessage } from './app.model';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss', './app.gridmedia.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  public filter: IFilter = {
    words: '',
    maxSize: 15,
    maxResults: 1,
    shuffleWords: false,
  };

  public results: string[][][] = [];

  public loading = false;
  public attempted = false;

  public bestPlaced = 0;
  public totalWords = 0;

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
    this.results = [];
    this.bestPlaced = 0;
    this.totalWords = 0;

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
  }

  public toggleMirror(index: number): void {
    this.results[index] = this.results[index][0].map((_, colIndex) => this.results[index].map(row => row[colIndex]));
  }

  private initWorker(): void {
    this.worker = new Worker(new URL('./app.worker', import.meta.url), { type: 'module' });

    this.worker.onmessage = ({ data }: MessageEvent<IWorkerMessage>) => {
      if (data.type === 'progress') {
        this.bestPlaced = data.placed;
        this.totalWords = data.total;
        return;
      }

      this.results = data.results;
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
