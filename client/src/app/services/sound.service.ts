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
import { Sound, ConnectionStatus, CategoryIcon, AudioDevices } from '../models/sound.model';

export interface AppSettings {
  keepAwakeEnabled: boolean;
  idleTimeoutEnabled: boolean;
  wakeMinutes: number;
  autoUpdateCheckEnabled: boolean;
  updateCheckIntervalMinutes: number;
  serverPort: number;
  audioInputDevice: string;
  audioOutputDevice: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  keepAwakeEnabled: false,
  idleTimeoutEnabled: false,
  wakeMinutes: 30,
  autoUpdateCheckEnabled: true,
  updateCheckIntervalMinutes: 60,
  serverPort: 8088,
  audioInputDevice: '',
  audioOutputDevice: '',
};

@Injectable({
  providedIn: 'root'
})
export class SoundService implements OnDestroy {
  private get apiUrl(): string {
    return `${window.location.origin}/api`;
  }

  private connectionStatus$ = new BehaviorSubject<ConnectionStatus>({ connected: false });
  private sounds$ = new BehaviorSubject<Sound[]>([]);
  private destroy$ = new Subject<void>();

  constructor(private http: HttpClient, private ngZone: NgZone) {
    this.startConnectionCheck();
  }

  get port(): number {
    return Number(window.location.port) || 8088;
  }

  changeServerPort(newPort: number): Observable<{ port: number; message: string }> {
    return this.http.post<{ port: number; message: string }>(`${this.apiUrl}/change-port`, { port: newPort });
  }

  verifyNewPort(port: number): Observable<boolean> {
    const url = `http://${window.location.hostname}:${port}/api/status`;
    return this.http.get<ConnectionStatus>(url).pipe(
      map(s => s.connected),
      catchError(() => of(false))
    );
  }

  getQrCode(): Observable<{ url: string; qrDataUrl: string }> {
    return this.http.get<{ url: string; qrDataUrl: string }>(`${this.apiUrl}/qr-code`);
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

  playSound(id: number, speakersOnly = false, micOnly = false): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/${id}/play`, { speakersOnly, micOnly }).pipe(
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

  updateSoundDetails(id: number, customTag: string, artist: string, title: string, category?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/${id}/update-details`, {
      customTag, artist, title, category
    }).pipe(
      catchError(error => {
        console.error('Failed to update sound details:', error);
        return of({ error: 'Failed to update sound details' });
      })
    );
  }

  renameSound(id: number, title: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/${id}/rename`, { title }).pipe(
      catchError(error => {
        console.error('Failed to rename sound:', error);
        return of({ error: 'Failed to rename sound' });
      })
    );
  }

  deleteSound(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/sounds/${id}`).pipe(
      catchError(error => {
        console.error('Failed to delete sound:', error);
        return of({ error: 'Failed to delete sound' });
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

  reorderSound(soundId: number, targetCategory: string, targetPosition: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/reorder`, {
      soundId,
      targetCategory,
      targetPosition
    }).pipe(
      catchError(error => {
        console.error('Failed to reorder sound:', error);
        return of({ error: 'Failed to reorder sound' });
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

  updateCategoryIcon(categoryName: string, iconBase64: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/category-icon`, { categoryName, iconBase64 }).pipe(
      catchError(error => {
        console.error('Failed to update category icon:', error);
        return of({ error: 'Failed to update category icon' });
      })
    );
  }

  getCategories(): Observable<{ id: number; name: string; parentCategory: string }[]> {
    return this.http.get<{ id: number; name: string; parentCategory: string }[]>(`${this.apiUrl}/categories`).pipe(
      catchError(() => of([]))
    );
  }

  addSound(file: File, category: string, displayName?: string, cropStartSec?: number, cropEndSec?: number, artist?: string, title?: string, durationSeconds?: number, originalFile?: File | null): Observable<any> {
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
    formData.append('artist', artist ?? '');
    formData.append('title', title ?? '');
    if (durationSeconds !== undefined && durationSeconds > 0) {
      formData.append('durationSeconds', String(durationSeconds));
    }
    if (originalFile) {
      formData.append('originalFile', originalFile);
    }
    return this.http.post(`${this.apiUrl}/sounds/add`, formData);
  }

  getUncroppedList(): Observable<{ urls: string[] }> {
    return this.http.get<{ urls: string[] }>(`${this.apiUrl}/sounds/uncropped-list`).pipe(
      catchError(() => of({ urls: [] }))
    );
  }

  resetCrop(soundUrl: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/sounds/reset-crop`, { url: soundUrl }).pipe(
      catchError(error => {
        console.error('Failed to reset crop:', error);
        return of({ error: 'Failed to reset crop' });
      })
    );
  }

  listenForConfigChanges(): Observable<void> {
    return new Observable<void>(observer => {
      const es = new EventSource(`${this.apiUrl}/config-watch`);

      es.addEventListener('reload', () => {
        this.ngZone.run(() => observer.next());
      });

      es.onerror = () => {
        console.warn('[config-watch] SSE connection error; browser will retry');
      };

      return () => es.close();
    });
  }

  checkForUpdate(): Observable<UpdateInfo> {
    return this.http.get<any>('https://api.github.com/repos/compulsive-quake/rage-pad/releases/latest').pipe(
      map(release => {
        const latestTag = (release.tag_name || '').replace(/^v/, '');
        const updateAvailable = this.isNewerVersion(latestTag, APP_VERSION);
        const assets: any[] = release.assets || [];
        const installer = assets.find((a: any) => a.name?.endsWith('.exe'));
        return {
          updateAvailable,
          latestVersion: latestTag,
          downloadUrl: installer?.browser_download_url || release.html_url || ''
        };
      }),
      catchError(() => of({ updateAvailable: false, latestVersion: APP_VERSION, downloadUrl: '' }))
    );
  }

  launchInstaller(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.apiUrl}/launch-installer`, {});
  }

  // ── Audio devices ──────────────────────────────────────────────────────────

  getAudioDevices(): Observable<AudioDevices> {
    return this.http.get<AudioDevices>(`${this.apiUrl}/audio/devices`).pipe(
      catchError(() => of({ input: [], output: [] }))
    );
  }

  setInputDevice(deviceName: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/audio/input-device`, { deviceName }).pipe(
      catchError(error => {
        console.error('Failed to set input device:', error);
        return of({ error: 'Failed to set input device' });
      })
    );
  }

  setOutputDevice(deviceName: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/audio/output-device`, { deviceName }).pipe(
      catchError(error => {
        console.error('Failed to set output device:', error);
        return of({ error: 'Failed to set output device' });
      })
    );
  }

  getSoundAudio(id: number): Observable<File> {
    return this.http.get(`${this.apiUrl}/sounds/${id}/audio`, {
      responseType: 'blob',
      observe: 'response',
    }).pipe(
      map(response => {
        const blob = response.body as Blob;
        const contentDisposition = response.headers.get('Content-Disposition') || '';
        let fileName = `sound_${id}.wav`;
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match) {
          try {
            fileName = decodeURIComponent(match[1]);
          } catch {
            fileName = match[1];
          }
        }
        return new File([blob], fileName, { type: blob.type || 'audio/mpeg' });
      })
    );
  }

  updateSoundFile(id: number, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('soundFile', file);
    return this.http.post(`${this.apiUrl}/sounds/${id}/update-file`, formData);
  }

  fetchYoutubeAudio(url: string): Observable<{ file: File; title: string; durationSeconds: number }> {
    return this.http.post(`${this.apiUrl}/youtube/fetch`, { url }, {
      responseType: 'blob',
      observe: 'response',
    }).pipe(
      map(response => {
        const blob = response.body as Blob;
        const encodedTitle = response.headers.get('X-Video-Title') || '';
        const title = encodedTitle ? decodeURIComponent(encodedTitle) : 'YouTube Audio';
        const durationSeconds = parseInt(response.headers.get('X-Video-Duration') || '0', 10) || 0;
        const contentDisposition = response.headers.get('Content-Disposition') || '';
        let fileName = 'youtube_audio.m4a';
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match) {
          try {
            fileName = decodeURIComponent(match[1]);
          } catch {
            fileName = match[1];
          }
        }
        const file = new File([blob], fileName, { type: blob.type || 'audio/mpeg' });
        return { file, title, durationSeconds };
      })
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
}
