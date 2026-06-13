import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IFilter } from './app.model';

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

  private initWorker(): void {
    this.worker = new Worker(new URL('./app.worker', import.meta.url), { type: 'module' });

    this.worker.onmessage = ({ data }) => {
      this.results = data;
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
