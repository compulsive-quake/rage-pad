import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, interval, switchMap, catchError, of, Subject, takeUntil, take } from 'rxjs';
import { Sound, ConnectionStatus, CategoryIcon } from '../models/sound.model';

@Injectable({
  providedIn: 'root'
})
export class SoundpadService implements OnDestroy {
  private apiUrl = 'http://localhost:3000/api';
  private connectionStatus$ = new BehaviorSubject<ConnectionStatus>({ connected: false });
  private sounds$ = new BehaviorSubject<Sound[]>([]);
  private destroy$ = new Subject<void>();

  constructor(private http: HttpClient, private ngZone: NgZone) {
    // Check connection status periodically
    this.startConnectionCheck();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private startConnectionCheck(): void {
    interval(30000).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.checkConnection()),
      catchError(() => of({ connected: false }))
    ).subscribe(status => {
      this.connectionStatus$.next(status);
    });

    // Initial check
    this.checkConnection().pipe(take(1)).subscribe(status => {
      this.connectionStatus$.next(status);
    });
  }

  checkConnection(): Observable<ConnectionStatus> {
    return this.http.get<ConnectionStatus>(`${this.apiUrl}/status`).pipe(
      catchError(() => of({ connected: false, error: 'Cannot connect to server' }))
    );
  }

  getConnectionStatus(): Observable<ConnectionStatus> {
    return this.connectionStatus$.asObservable();
  }

  getSounds(): Observable<Sound[]> {
    return this.http.get<Sound[]>(`${this.apiUrl}/sounds`).pipe(
      catchError(() => of([]))
    );
  }

  searchSounds(query: string): Observable<Sound[]> {
    return this.http.get<Sound[]>(`${this.apiUrl}/sounds/search`, {
      params: { q: query }
    }).pipe(
      catchError(() => of([]))
    );
  }

  playSound(index: number, speakersOnly = false, micOnly = false): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/${index}/play`, { speakersOnly, micOnly }).pipe(
      catchError(error => {
        console.error('Failed to play sound:', error);
        return of({ error: 'Failed to play sound' });
      })
    );
  }

  stopSound(): Observable<any> {
    return this.http.post(`${this.apiUrl}/stop`, {}).pipe(
      catchError(error => {
        console.error('Failed to stop sound:', error);
        return of({ error: 'Failed to stop sound' });
      })
    );
  }

  togglePause(): Observable<any> {
    return this.http.post(`${this.apiUrl}/pause`, {}).pipe(
      catchError(error => {
        console.error('Failed to toggle pause:', error);
        return of({ error: 'Failed to toggle pause' });
      })
    );
  }

  setVolume(volume: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/volume`, { volume }).pipe(
      catchError(error => {
        console.error('Failed to set volume:', error);
        return of({ error: 'Failed to set volume' });
      })
    );
  }

  renameSound(index: number, title: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/${index}/rename`, { title }).pipe(
      catchError(error => {
        console.error('Failed to rename sound:', error);
        return of({ error: 'Failed to rename sound' });
      })
    );
  }

  restartSoundpad(index?: number, title?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/restart`, { index, title }).pipe(
      catchError(error => {
        console.error('Failed to restart Soundpad:', error);
        return of({ error: 'Failed to restart Soundpad' });
      })
    );
  }

  refreshSounds(): void {
    this.getSounds().subscribe(sounds => {
      this.sounds$.next(sounds);
    });
  }

  getCachedSounds(): Observable<Sound[]> {
    return this.sounds$.asObservable();
  }

  getCategoryIcons(): Observable<CategoryIcon[]> {
    return this.http.get<CategoryIcon[]>(`${this.apiUrl}/category-icons`).pipe(
      catchError(() => of([]))
    );
  }

  getCategories(): Observable<{ name: string; parentCategory: string }[]> {
    return this.http.get<{ name: string; parentCategory: string }[]>(`${this.apiUrl}/categories`).pipe(
      catchError(() => of([]))
    );
  }

  addSound(file: File, category: string, displayName?: string): Observable<any> {
    const formData = new FormData();
    formData.append('soundFile', file);
    formData.append('category', category);
    if (displayName) {
      formData.append('displayName', displayName);
    }
    return this.http.post(`${this.apiUrl}/sounds/add`, formData);
  }

  /**
   * Returns an Observable that emits once every time the server detects a
   * change to soundlist.spl.  The Observable completes when the caller
   * unsubscribes (the underlying EventSource is closed automatically).
   */
  listenForConfigChanges(): Observable<void> {
    return new Observable<void>(observer => {
      const es = new EventSource(`${this.apiUrl}/config-watch`);

      es.addEventListener('reload', () => {
        // EventSource callbacks run outside Angular's zone – bring them back in
        this.ngZone.run(() => observer.next());
      });

      es.onerror = () => {
        // Don't complete – the browser will auto-reconnect; just log
        console.warn('[config-watch] SSE connection error; browser will retry');
      };

      // Teardown: close the EventSource when the subscriber unsubscribes
      return () => es.close();
    });
  }
}
