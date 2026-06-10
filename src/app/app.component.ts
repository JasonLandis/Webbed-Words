import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IFilter } from './app.model';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  public filter: IFilter = {
    words: '',
    maxSize: 15,
    maxResults: 3,
    shuffleWords: true,
  };

  public results: string[][][] = [];

  public loading = false;
  public attempted = false;

  public elapsedTime = 0;
  private timerId?: number;
  private startTime = 0;

  private worker?: Worker;

  public ngOnInit(): void {
    this.worker = new Worker(new URL('./app.worker', import.meta.url), { type: 'module' });

    this.worker.onmessage = ({ data }) => {
      this.results = data;

      clearInterval(this.timerId);

      this.elapsedTime = performance.now() - this.startTime;
      this.loading = false;
    };
  }

  public ngOnDestroy(): void {
    this.worker?.terminate();
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
}
