import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, interval, switchMap, catchError, of, Subject, takeUntil, take } from 'rxjs';
import { map } from 'rxjs/operators';
import packageJson from '../../../../package.json';

export const APP_VERSION: string = packageJson.version;

export interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
  downloadUrl: string;
}
import { Sound, ConnectionStatus, CategoryIcon } from '../models/sound.model';

export interface AppSettings {
  configWatchEnabled: boolean;
  autoLaunchEnabled: boolean;
  keepAwakeEnabled: boolean;
  idleTimeoutEnabled: boolean;
  wakeMinutes: number;
  autoUpdateCheckEnabled: boolean;
  serverPort: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  configWatchEnabled: false,
  autoLaunchEnabled: true,
  keepAwakeEnabled: false,
  idleTimeoutEnabled: false,
  wakeMinutes: 30,
  autoUpdateCheckEnabled: true,
  serverPort: 3000,
};

@Injectable({
  providedIn: 'root'
})
export class SoundpadService implements OnDestroy {
  /**
   * API base URL.  The UI and API are co-hosted on the same Express
   * server, so `window.location.origin` is always the correct base.
   * After a port-change redirect, origin automatically reflects the new port.
   */
  private get apiUrl(): string {
    return `${window.location.origin}/api`;
  }

  private connectionStatus$ = new BehaviorSubject<ConnectionStatus>({ connected: false });
  private sounds$ = new BehaviorSubject<Sound[]>([]);
  private destroy$ = new Subject<void>();

  constructor(private http: HttpClient, private ngZone: NgZone) {
    // Check connection status periodically
    this.startConnectionCheck();
  }

  /** The port the page (and therefore the API) is currently served from. */
  get port(): number {
    return Number(window.location.port) || 3000;
  }

  /** Ask the server (on its current port) to move to a new port. */
  changeServerPort(newPort: number): Observable<{ port: number; message: string }> {
    return this.http.post<{ port: number; message: string }>(`${this.apiUrl}/change-port`, { port: newPort });
  }

  /** Verify that the server is reachable on the given port. */
  verifyNewPort(port: number): Observable<boolean> {
    const url = `http://${window.location.hostname}:${port}/api/status`;
    return this.http.get<ConnectionStatus>(url).pipe(
      map(s => s.connected),
      catchError(() => of(false))
    );
  }

  /** Build a category-image URL using the current origin. */
  getCategoryImageUrl(path: string): string {
    return `${window.location.origin}/api/category-image?path=${encodeURIComponent(path)}`;
  }

  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.apiUrl}/settings`).pipe(
      catchError(() => of(DEFAULT_SETTINGS))
    );
  }

  saveSettings(partial: Partial<AppSettings>): Observable<AppSettings> {
    return this.http.put<AppSettings>(`${this.apiUrl}/settings`, partial).pipe(
      catchError(() => of({ ...DEFAULT_SETTINGS, ...partial }))
    );
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
        const body = error?.error;
        if (body?.soundpadNotRunning) {
          return of({ error: 'Soundpad is not running', soundpadNotRunning: true });
        }
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

  reorderCategory(categoryName: string, targetPosition: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/categories/reorder`, {
      categoryName,
      targetPosition
    }).pipe(
      catchError(error => {
        console.error('Failed to reorder category:', error);
        return of({ error: 'Failed to reorder category' });
      })
    );
  }

  reorderSound(soundIndex: number, targetCategory: string, targetPosition: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/reorder`, {
      soundIndex,
      targetCategory,
      targetPosition
    }).pipe(
      catchError(error => {
        console.error('Failed to reorder sound:', error);
        return of({ error: 'Failed to reorder sound' });
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

  launchSoundpad(): Observable<any> {
    return this.http.post(`${this.apiUrl}/launch-soundpad`, {}).pipe(
      catchError(error => {
        console.error('Failed to launch Soundpad:', error);
        return of({ error: 'Failed to launch Soundpad' });
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

  addSound(file: File, category: string, displayName?: string, cropStartSec?: number, cropEndSec?: number, artist?: string, title?: string, durationSeconds?: number): Observable<any> {
    const formData = new FormData();
    formData.append('soundFile', file);
    formData.append('category', category);
    if (displayName) {
      formData.append('displayName', displayName);
    }
    if (cropStartSec !== undefined) {
      formData.append('cropStart', String(cropStartSec));
    }
    if (cropEndSec !== undefined) {
      formData.append('cropEnd', String(cropEndSec));
    }
    // Always send artist and title (even as empty strings) so the server can write them to the SPL tag
    formData.append('artist', artist ?? '');
    formData.append('title', title ?? '');
    if (durationSeconds !== undefined && durationSeconds > 0) {
      formData.append('durationSeconds', String(durationSeconds));
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

  checkForUpdate(): Observable<UpdateInfo> {
    return this.http.get<any>('https://api.github.com/repos/compulsive-quake/rage-pad/releases/latest').pipe(
      map(release => {
        const latestTag = (release.tag_name || '').replace(/^v/, '');
        const updateAvailable = this.isNewerVersion(latestTag, APP_VERSION);
        return {
          updateAvailable,
          latestVersion: latestTag,
          downloadUrl: release.html_url || ''
        };
      }),
      catchError(() => of({ updateAvailable: false, latestVersion: APP_VERSION, downloadUrl: '' }))
    );
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  /**
   * Fetches audio from a YouTube URL.
   * Returns an Observable that emits { file: File, title: string, durationSeconds: number }.
   */
  fetchYoutubeAudio(url: string): Observable<{ file: File; title: string; durationSeconds: number }> {
    return this.http.post(`${this.apiUrl}/youtube/fetch`, { url }, {
      responseType: 'blob',
      observe: 'response',
    }).pipe(
      map(response => {
        const blob = response.body as Blob;
        // Extract title from response header
        const encodedTitle = response.headers.get('X-Video-Title') || '';
        const title = encodedTitle ? decodeURIComponent(encodedTitle) : 'YouTube Audio';
        // Extract duration from response header
        const durationSeconds = parseInt(response.headers.get('X-Video-Duration') || '0', 10) || 0;
        // Extract filename from Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition') || '';
        let fileName = 'youtube_audio.mp3';
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match) {
          try {
            fileName = decodeURIComponent(match[1]);
          } catch {
            fileName = match[1];
          }
        }
        const file = new File([blob], fileName, { type: 'audio/mpeg' });
        return { file, title, durationSeconds };
      })
    );
  }
}
