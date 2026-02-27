import { Component, OnInit, OnDestroy, NgZone, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subject, Subscription, takeUntil, debounceTime, distinctUntilChanged, take, forkJoin, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SoundService, AppSettings } from './services/sound.service';
import { Sound, ConnectionStatus, Category, CategoryIcon } from './models/sound.model';
import { HeaderComponent } from './components/header/header.component';
import { FooterComponent } from './components/footer/footer.component';
import { ContentComponent } from './components/content/content.component';
import { SettingsComponent, SettingsPayload } from './components/settings/settings.component';
import { RenameModalComponent } from './components/rename-modal/rename-modal.component';
import { WakeDialogComponent } from './components/wake-dialog/wake-dialog.component';
import { AddSoundModalComponent } from './components/add-sound-modal/add-sound-modal.component';
import { ContextMenuComponent } from './components/context-menu/context-menu.component';
import { EditSoundModalComponent } from './components/edit-sound-modal/edit-sound-modal.component';
import { EditDetailsModalComponent } from './components/edit-details-modal/edit-details-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    HeaderComponent,
    FooterComponent,
    ContentComponent,
    SettingsComponent,
    RenameModalComponent,
    WakeDialogComponent,
    AddSoundModalComponent,
    ContextMenuComponent,
    EditSoundModalComponent,
    EditDetailsModalComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  sounds: Sound[] = [];
  filteredSounds: Sound[] = [];
  categories: Category[] = [];
  isConnected = false;
  isLoading = true;
  currentlyPlayingId: number | null = null;
  isActuallyPlaying = false;
  isPaused = false;
  volume = 100;
  playbackMode: 'both' | 'mic' | 'speakers' = 'both';
  searchQuery = '';
  isSettingsModalOpen = false;
  isRenameMode = false;
  isReorderMode = false;
  isQueueMode = false;
  soundQueue: Sound[] = [];

  // Rename modal state
  isRenameModalOpen = false;
  soundToRename: Sound | null = null;

  // Add Sound modal state
  isAddSoundModalOpen = false;

  // Context menu state (desktop Tauri build only)
  isTauri = !!(window as any).__TAURI_INTERNALS__;
  contextMenuVisible = false;
  contextMenuX = 0;
  contextMenuY = 0;
  contextMenuSound: Sound | null = null;

  // Edit sound modal state
  isEditSoundModalOpen = false;
  soundToEdit: Sound | null = null;

  // Edit details modal state
  isEditDetailsModalOpen = false;
  soundToEditDetails: Sound | null = null;

  // Delete confirmation state
  isDeleteConfirmOpen = false;
  soundToDelete: Sound | null = null;
  isDeleting = false;

  // SSE config-watch
  private configWatchSub: Subscription | null = null;

  // Wake Lock
  keepAwakeEnabled: boolean = false;
  idleTimeoutEnabled: boolean = false;
  wakeMinutes: number = 30;
  isWakeDialogOpen = false;
  isUiDimmed = false;
  wakeCountdownSeconds = 300;
  private wakeLockSentinel: WakeLockSentinel | null = null;
  private wakeTimer: any = null;
  private wakeCountdownTimer: any = null;
  private wakeDimTimer: any = null;

  // Server port
  serverPort: number = 8088;
  isPortChanging = false;
  portChangeError = '';

  // Update check
  autoUpdateCheckEnabled: boolean;
  updateCheckIntervalMinutes = 60;
  updateAvailable = false;
  latestVersion = '';
  downloadUrl = '';
  updateDismissed = false;
  isCheckingForUpdate = false;
  private updateCheckSub: Subscription | null = null;

  // Playback progress tracking
  playbackProgress = 0;
  playbackTimeRemaining = 0;
  currentSoundDuration = 0;
  playbackStartTime = 0;

  // Active category for nav highlight
  activeCategory: string = '';

  // Drag-and-drop state
  private isDragActive = false;
  private pendingReload = false;

  // Category icons
  categoryIcons: { [key: string]: string } = {
    'default': 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
  };
  categoryIconsMap: Map<string, CategoryIcon> = new Map();
  categoryOrder: string[] = [];

  // Web Audio API for speaker playback
  private audioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private audioBufferCache = new Map<number, AudioBuffer>();

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private playbackTimer: any = null;

  constructor(private soundService: SoundService, private ngZone: NgZone, private cdr: ChangeDetectorRef) {
    this.autoUpdateCheckEnabled = true;
    this.serverPort = Number(window.location.port) || 8088;
  }

  @HostListener('document:contextmenu', ['$event'])
  onGlobalContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  ngOnInit(): void {
    // Load settings from the server DB, then initialise features
    this.soundService.getSettings()
      .pipe(take(1))
      .subscribe((settings: AppSettings) => {
        this.keepAwakeEnabled = settings.keepAwakeEnabled;
        this.idleTimeoutEnabled = settings.idleTimeoutEnabled;
        this.wakeMinutes = settings.wakeMinutes;
        this.autoUpdateCheckEnabled = settings.autoUpdateCheckEnabled;
        this.updateCheckIntervalMinutes = settings.updateCheckIntervalMinutes;
        this.serverPort = settings.serverPort;
        this.initializeAfterSettingsLoad();
      });

    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.filterSounds(query);
    });

    this.loadSounds();
  }

  private initializeAfterSettingsLoad(): void {
    this.soundService.getConnectionStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe((status: ConnectionStatus) => {
        this.isConnected = status.connected;
      });

    // Always listen for SSE reload events
    this.startConfigWatch();

    if (this.keepAwakeEnabled) {
      this.acquireWakeLock();
    }

    if (this.autoUpdateCheckEnabled) {
      this.startUpdateCheck();
    }
  }

  private startConfigWatch(): void {
    this.stopConfigWatch();
    this.configWatchSub = this.soundService.listenForConfigChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('[config-watch] Data changed – reloading sounds');
        if (this.isDragActive) {
          this.pendingReload = true;
        } else {
          this.loadSounds(true);
        }
      });
  }

  private stopConfigWatch(): void {
    if (this.configWatchSub) {
      this.configWatchSub.unsubscribe();
      this.configWatchSub = null;
    }
  }

  // ── Update check ────────────────────────────────────────────────────────

  private startUpdateCheck(): void {
    this.stopUpdateCheck();
    const intervalMs = this.updateCheckIntervalMinutes * 60 * 1000;
    this.updateCheckSub = timer(0, intervalMs).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.soundService.checkForUpdate())
    ).subscribe(info => {
      if (info.updateAvailable && info.latestVersion !== this.latestVersion) {
        this.updateDismissed = false;
      }
      this.updateAvailable = info.updateAvailable;
      this.latestVersion = info.latestVersion;
      this.downloadUrl = info.downloadUrl;
    });
  }

  private stopUpdateCheck(): void {
    if (this.updateCheckSub) {
      this.updateCheckSub.unsubscribe();
      this.updateCheckSub = null;
    }
  }

  dismissUpdate(): void {
    this.updateDismissed = true;
  }

  manualUpdateCheck(): void {
    this.isCheckingForUpdate = true;
    this.soundService.checkForUpdate()
      .pipe(take(1))
      .subscribe(info => {
        this.isCheckingForUpdate = false;
        this.latestVersion = info.latestVersion;
        this.downloadUrl = info.downloadUrl;
        if (info.updateAvailable) {
          this.updateAvailable = true;
          this.updateDismissed = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.stopConfigWatch();
    this.stopUpdateCheck();
    this.releaseWakeLock();
    this.clearWakeTimers();
    this.stopWebAudio();
    this.destroy$.next();
    this.destroy$.complete();
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  loadSounds(silent = false): void {
    if (!silent) {
      this.isLoading = true;
    }

    forkJoin({
      sounds: this.soundService.getSounds().pipe(take(1)),
      categoryIcons: this.soundService.getCategoryIcons().pipe(take(1))
    }).subscribe({
      next: ({ sounds, categoryIcons }) => {
        if (sounds.length === 0 && this.sounds.length > 0) {
          this.isLoading = false;
          return;
        }

        this.sounds = sounds;
        this.filteredSounds = sounds;

        this.categoryIconsMap.clear();
        this.categoryOrder = categoryIcons.map(icon => icon.name);
        categoryIcons.forEach(icon => {
          this.categoryIconsMap.set(icon.name, icon);
        });

        if (this.searchQuery.trim()) {
          this.filterSounds(this.searchQuery);
        } else {
          this.groupSoundsByCategory(this.filteredSounds);
        }
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  onSearch(query: string): void {
    this.searchQuery = query;
    this.searchSubject$.next(query);
  }

  filterSounds(query: string): void {
    if (!query.trim()) {
      this.filteredSounds = this.sounds;
      this.groupSoundsByCategory(this.sounds);
      return;
    }

    const lowerQuery = query.toLowerCase();
    this.filteredSounds = this.sounds.filter(sound =>
      sound.title.toLowerCase().includes(lowerQuery) ||
      sound.artist.toLowerCase().includes(lowerQuery) ||
      sound.category.toLowerCase().includes(lowerQuery)
    );
    this.groupSoundsByCategory(this.filteredSounds);
  }

  resolveCategoryImageUrl(categoryIcon: CategoryIcon | undefined): string {
    if (!categoryIcon || !categoryIcon.icon) return '';
    if (categoryIcon.isBase64) {
      return `data:image/png;base64,${categoryIcon.icon}`;
    }
    return '';
  }

  groupSoundsByCategory(sounds: Sound[]): void {
    const topLevelMap = new Map<string, { sounds: Sound[], image: string, subCategories: Map<string, { sounds: Sound[], image: string }> }>();

    sounds.forEach(sound => {
      const category = sound.category || 'Uncategorized';
      const parentCategory = sound.parentCategory || '';

      if (parentCategory) {
        if (!topLevelMap.has(parentCategory)) {
          const parentIcon = this.categoryIconsMap.get(parentCategory);
          const parentImage = this.resolveCategoryImageUrl(parentIcon);
          topLevelMap.set(parentCategory, { sounds: [], image: parentImage, subCategories: new Map() });
        }

        const parentEntry = topLevelMap.get(parentCategory)!;

        if (!parentEntry.subCategories.has(category)) {
          const subIcon = this.categoryIconsMap.get(category);
          const subImage = this.resolveCategoryImageUrl(subIcon);
          parentEntry.subCategories.set(category, { sounds: [], image: subImage });
        }

        parentEntry.subCategories.get(category)!.sounds.push(sound);
      } else {
        if (!topLevelMap.has(category)) {
          const categoryIcon = this.categoryIconsMap.get(category);
          const image = this.resolveCategoryImageUrl(categoryIcon);
          topLevelMap.set(category, { sounds: [], image, subCategories: new Map() });
        }
        topLevelMap.get(category)!.sounds.push(sound);
      }
    });

    const splOrderedEntries = <T>(map: Map<string, T>): Array<[string, T]> => {
      const entries = Array.from(map.entries());
      return entries.sort((a, b) => {
        if (a[0] === 'Uncategorized') return 1;
        if (b[0] === 'Uncategorized') return -1;
        const aIdx = this.categoryOrder.indexOf(a[0]);
        const bIdx = this.categoryOrder.indexOf(b[0]);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return 0;
      });
    };

    this.categories = splOrderedEntries(topLevelMap).map(([name, data]) => ({
      name,
      sounds: data.sounds.slice().sort((a, b) => a.categoryIndex - b.categoryIndex),
      image: data.image,
      subCategories: splOrderedEntries(data.subCategories).map(([subName, subData]) => ({
        name: subName,
        sounds: subData.sounds.slice().sort((a, b) => a.categoryIndex - b.categoryIndex),
        image: subData.image,
        subCategories: []
      }))
    }));
  }

  playSound(sound: Sound): void {
    if (this.isQueueMode) {
      this.soundQueue.push(sound);
      // If nothing is currently playing, start the queue
      if (!this.isActuallyPlaying) {
        this.playNextInQueue();
      }
      return;
    }
    this.playSoundImmediate(sound);
  }

  private playSoundImmediate(sound: Sound): void {
    const speakersOnly = this.playbackMode === 'speakers';
    const micOnly = this.playbackMode === 'mic';

    // Start UI state and Web Audio playback immediately — don't wait for the
    // server round-trip.  The server play is fire-and-forget anyway.
    this.currentlyPlayingId = sound.id;
    this.isActuallyPlaying = true;
    this.isPaused = false;

    this.currentSoundDuration = this.parseDuration(sound.duration);
    this.playbackStartTime = Date.now();
    this.playbackProgress = 0;
    this.playbackTimeRemaining = this.currentSoundDuration;

    this.startProgressTimer();

    // Start Web Audio speaker playback immediately (in parallel with server call)
    if (!micOnly) {
      this.playWebAudio(sound.id);
    }

    // Tell the server to play through audio engine (mic/VB-Cable) in the background
    if (!speakersOnly) {
      this.soundService.playSound(sound.id, speakersOnly, micOnly)
        .pipe(take(1))
        .subscribe({
          error: (err) => {
            console.error('Failed to play sound on audio engine:', err);
          }
        });
    }
  }

  private playNextInQueue(): void {
    if (this.soundQueue.length === 0) return;
    this.playSoundImmediate(this.soundQueue[0]);
  }

  private onSoundPlaybackEnded(): void {
    if (this.isQueueMode && this.soundQueue.length > 0) {
      this.soundQueue.shift(); // remove the one that just finished
      if (this.soundQueue.length > 0) {
        this.playNextInQueue();
        return;
      }
    }
    this.currentlyPlayingId = null;
    this.isActuallyPlaying = false;
    this.playbackProgress = 0;
    this.playbackTimeRemaining = 0;
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  toggleQueueMode(): void {
    this.isQueueMode = !this.isQueueMode;
    if (this.isQueueMode) {
      this.isRenameMode = false;
      this.isReorderMode = false;
    } else {
      this.soundQueue = [];
    }
  }

  // ── Web Audio API (speaker playback) ───────────────────────────────────

  private playWebAudio(soundId: number): void {
    this.stopWebAudio();
    this.startWebAudioPlayback(soundId);
  }

  private async startWebAudioPlayback(soundId: number): Promise<void> {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Use cached AudioBuffer if available, otherwise fetch and decode
      let audioBuffer = this.audioBufferCache.get(soundId);
      if (!audioBuffer) {
        const file = await this.soundService.getSoundAudio(soundId).pipe(take(1)).toPromise();
        if (!file) return;
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.audioBufferCache.set(soundId, audioBuffer);
      }

      // Bail if a different sound started while we were loading
      if (this.currentlyPlayingId !== soundId) return;

      this.currentAudioSource = this.audioContext.createBufferSource();
      this.currentAudioSource.buffer = audioBuffer;

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume / 100;

      this.currentAudioSource.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.currentAudioSource.onended = () => {
        this.ngZone.run(() => {
          if (this.currentlyPlayingId === soundId) {
            this.onSoundPlaybackEnded();
          }
        });
      };

      this.currentAudioSource.start();
    } catch (err) {
      console.error('[web-audio] Failed to play:', err);
    }
  }

  private stopWebAudio(): void {
    if (this.currentAudioSource) {
      try { this.currentAudioSource.stop(); } catch { /* already stopped */ }
      this.currentAudioSource = null;
    }
  }

  parseDuration(duration: string): number {
    if (!duration) return 0;
    const parts = duration.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return parseInt(duration, 10) || 0;
  }

  startProgressTimer(): void {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }

    this.playbackTimer = setInterval(() => {
      if (this.currentlyPlayingId !== null && !this.isPaused && this.currentSoundDuration > 0) {
        const elapsed = (Date.now() - this.playbackStartTime) / 1000;
        this.playbackProgress = Math.min((elapsed / this.currentSoundDuration) * 100, 100);
        this.playbackTimeRemaining = Math.max(this.currentSoundDuration - elapsed, 0);

        if (this.playbackTimeRemaining <= 0) {
          this.onSoundPlaybackEnded();
        }
      }
    }, 100);
  }

  stopSound(): void {
    this.soundQueue = [];
    this.soundService.stopSound()
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.currentlyPlayingId = null;
          this.isActuallyPlaying = false;
          this.isPaused = false;
          this.playbackProgress = 0;
          this.playbackTimeRemaining = 0;
          this.stopWebAudio();
          if (this.playbackTimer) {
            clearInterval(this.playbackTimer);
            this.playbackTimer = null;
          }
        },
        error: (err) => {
          console.error('Failed to stop sound:', err);
        }
      });
  }

  togglePause(): void {
    this.soundService.togglePause()
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isPaused = !this.isPaused;
          if (!this.isPaused) {
            this.playbackStartTime = Date.now() - (this.currentSoundDuration - this.playbackTimeRemaining) * 1000;
          }
        },
        error: (err) => {
          console.error('Failed to toggle pause:', err);
        }
      });
  }

  setVolume(volume: number): void {
    this.volume = volume;

    // Update Web Audio gain
    if (this.gainNode) {
      this.gainNode.gain.value = volume / 100;
    }

    this.soundService.setVolume(volume)
      .pipe(take(1))
      .subscribe({
        error: (err) => {
          console.error('Failed to set volume:', err);
        }
      });
  }

  setPlaybackMode(mode: 'both' | 'mic' | 'speakers'): void {
    this.playbackMode = mode;
  }

  refreshSounds(): void {
    this.audioBufferCache.clear();
    this.loadSounds();
  }

  toggleSettingsModal(): void {
    this.isSettingsModalOpen = !this.isSettingsModalOpen;
  }

  onSaveSettings(payload: SettingsPayload): void {
    const { serverPort: _port, ...settingsToSave } = payload;
    this.soundService.saveSettings(settingsToSave)
      .pipe(take(1))
      .subscribe(() => {
        this.applySettingsSideEffects(payload);
      });
  }

  private applySettingsSideEffects(payload: SettingsPayload): void {
    if (payload.keepAwakeEnabled !== this.keepAwakeEnabled) {
      this.keepAwakeEnabled = payload.keepAwakeEnabled;
      if (this.keepAwakeEnabled) {
        this.acquireWakeLock();
      } else {
        this.releaseWakeLock();
        this.clearWakeTimers();
        this.isWakeDialogOpen = false;
        this.isUiDimmed = false;
      }
    }

    if (payload.idleTimeoutEnabled !== this.idleTimeoutEnabled) {
      this.idleTimeoutEnabled = payload.idleTimeoutEnabled;
      if (this.keepAwakeEnabled && this.wakeLockSentinel) {
        if (this.idleTimeoutEnabled) {
          this.startWakeTimer();
        } else {
          this.clearWakeTimers();
          this.isWakeDialogOpen = false;
          this.isUiDimmed = false;
        }
      }
    }

    if (payload.wakeMinutes !== this.wakeMinutes) {
      this.wakeMinutes = Math.max(1, Math.min(480, payload.wakeMinutes || 30));
      if (this.keepAwakeEnabled && this.idleTimeoutEnabled && this.wakeLockSentinel && !this.isWakeDialogOpen) {
        this.startWakeTimer();
      }
    }

    if (payload.autoUpdateCheckEnabled !== this.autoUpdateCheckEnabled ||
        payload.updateCheckIntervalMinutes !== this.updateCheckIntervalMinutes) {
      this.autoUpdateCheckEnabled = payload.autoUpdateCheckEnabled;
      this.updateCheckIntervalMinutes = payload.updateCheckIntervalMinutes;
      if (this.autoUpdateCheckEnabled) {
        this.startUpdateCheck();
      } else {
        this.stopUpdateCheck();
        this.updateAvailable = false;
      }
    }

    if (payload.serverPort !== this.serverPort) {
      this.migrateServerPort(payload.serverPort);
    }
  }

  private migrateServerPort(newPort: number): void {
    this.isPortChanging = true;
    this.portChangeError = '';

    this.soundService.changeServerPort(newPort)
      .pipe(take(1))
      .subscribe({
        next: () => {
          let attempts = 0;
          const poll = () => {
            attempts++;
            this.soundService.verifyNewPort(newPort)
              .pipe(take(1))
              .subscribe(ok => {
                if (ok) {
                  this.isPortChanging = false;
                  const url = new URL(window.location.href);
                  url.port = String(newPort);
                  window.location.href = url.toString();
                } else if (attempts < 8) {
                  setTimeout(poll, 500);
                } else {
                  this.isPortChanging = false;
                  this.portChangeError = `Server not reachable on port ${newPort}`;
                }
              });
          };
          setTimeout(poll, 600);
        },
        error: (err: any) => {
          this.isPortChanging = false;
          this.portChangeError = err?.error?.error || `Failed to change port`;
        }
      });
  }

  toggleRenameMode(): void {
    this.isRenameMode = !this.isRenameMode;
    if (this.isRenameMode) {
      this.isReorderMode = false;
      this.isQueueMode = false;
      this.soundQueue = [];
    }
    if (!this.isRenameMode) {
      this.isRenameModalOpen = false;
      this.soundToRename = null;
    }
  }

  toggleReorderMode(): void {
    this.isReorderMode = !this.isReorderMode;
    if (this.isReorderMode) {
      this.isRenameMode = false;
      this.isRenameModalOpen = false;
      this.soundToRename = null;
      this.isQueueMode = false;
      this.soundQueue = [];
    }
  }

  onReorderSound(event: { soundId: number; targetCategory: string; targetPosition: number }): void {
    this.soundService.reorderSound(event.soundId, event.targetCategory, event.targetPosition)
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          if (result?.error) {
            console.error('Failed to reorder sound:', result.error);
            this.loadSounds(true);
          }
        },
        error: (err: any) => {
          console.error('Failed to reorder sound:', err);
          this.loadSounds(true);
        }
      });
  }

  onReorderCategory(event: { categoryName: string; targetPosition: number }): void {
    const fromIdx = this.categoryOrder.indexOf(event.categoryName);
    if (fromIdx !== -1) {
      this.categoryOrder.splice(fromIdx, 1);
      this.categoryOrder.splice(event.targetPosition, 0, event.categoryName);
    }

    this.soundService.reorderCategory(event.categoryName, event.targetPosition)
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          if (result?.error) {
            console.error('Failed to reorder category:', result.error);
            this.loadSounds(true);
          }
        },
        error: (err: any) => {
          console.error('Failed to reorder category:', err);
          this.loadSounds(true);
        }
      });
  }

  onUpdateCategoryIcon(event: { categoryName: string; iconBase64: string }): void {
    this.soundService.updateCategoryIcon(event.categoryName, event.iconBase64)
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          if (result?.error) {
            console.error('Failed to update category icon:', result.error);
          } else {
            this.loadSounds(true);
          }
        },
        error: (err: any) => {
          console.error('Failed to update category icon:', err);
        }
      });
  }

  onDragStateChange(isDragging: boolean): void {
    this.isDragActive = isDragging;
    if (!isDragging && this.pendingReload) {
      this.pendingReload = false;
      this.loadSounds(true);
    }
  }

  // ── Rename modal handlers ──────────────────────────────────────────────────

  openRenameModal(sound: Sound): void {
    this.soundToRename = sound;
    this.isRenameModalOpen = true;
  }

  onRenameClosed(): void {
    this.isRenameModalOpen = false;
    this.soundToRename = null;
  }

  onSoundRenamed(event: { sound: Sound; newTitle: string }): void {
    event.sound.title = event.newTitle;
    this.isRenameModalOpen = false;
    this.soundToRename = null;
    this.isRenameMode = false;
  }

  // ── Add Sound modal handlers ───────────────────────────────────────────────

  openAddSoundModal(): void {
    this.isAddSoundModalOpen = true;
  }

  onAddSoundClosed(): void {
    this.isAddSoundModalOpen = false;
  }

  onSoundAdded(): void {
    this.isAddSoundModalOpen = false;
    this.loadSounds(true);
  }

  // ── Context menu & Delete sound ──────────────────────────────────────────

  onSoundContextMenu(event: { sound: Sound; event: MouseEvent }): void {
    this.contextMenuSound = event.sound;
    this.contextMenuX = event.event.clientX;
    this.contextMenuY = event.event.clientY;
    this.contextMenuVisible = true;
  }

  onContextMenuClosed(): void {
    this.contextMenuVisible = false;
    this.contextMenuSound = null;
  }

  onContextMenuEdit(): void {
    this.soundToEdit = this.contextMenuSound;
    this.contextMenuVisible = false;
    this.contextMenuSound = null;
    this.isEditSoundModalOpen = true;
  }

  onEditSoundClosed(): void {
    this.isEditSoundModalOpen = false;
    this.soundToEdit = null;
  }

  onEditSoundSaved(): void {
    this.isEditSoundModalOpen = false;
    this.soundToEdit = null;
    this.loadSounds(true);
  }

  onContextMenuRename(): void {
    this.soundToEditDetails = this.contextMenuSound;
    this.contextMenuVisible = false;
    this.contextMenuSound = null;
    this.isEditDetailsModalOpen = true;
  }

  onEditDetailsClosed(): void {
    this.isEditDetailsModalOpen = false;
    this.soundToEditDetails = null;
  }

  onEditDetailsSaved(): void {
    this.isEditDetailsModalOpen = false;
    this.soundToEditDetails = null;
    this.loadSounds(true);
  }

  onContextMenuDelete(): void {
    this.soundToDelete = this.contextMenuSound;
    this.contextMenuVisible = false;
    this.contextMenuSound = null;
    this.isDeleteConfirmOpen = true;
  }

  cancelDelete(): void {
    this.isDeleteConfirmOpen = false;
    this.soundToDelete = null;
    this.isDeleting = false;
  }

  confirmDelete(): void {
    if (!this.soundToDelete || this.isDeleting) return;
    this.isDeleting = true;

    this.soundService.deleteSound(this.soundToDelete.id)
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          this.isDeleting = false;
          this.isDeleteConfirmOpen = false;
          this.soundToDelete = null;
          if (result?.error) {
            console.error('Failed to delete sound:', result.error);
          } else {
            this.loadSounds(true);
          }
        },
        error: (err: any) => {
          console.error('Failed to delete sound:', err);
          this.isDeleting = false;
          this.isDeleteConfirmOpen = false;
          this.soundToDelete = null;
        }
      });
  }

  // ── Wake Lock ─────────────────────────────────────────────────────────────

  toggleKeepAwake(): void {
    this.keepAwakeEnabled = !this.keepAwakeEnabled;
    if (this.keepAwakeEnabled) {
      this.acquireWakeLock();
    } else {
      this.releaseWakeLock();
      this.clearWakeTimers();
      this.isWakeDialogOpen = false;
      this.isUiDimmed = false;
    }
  }

  onWakeMinutesChange(value: number): void {
    this.wakeMinutes = Math.max(1, Math.min(480, value || 30));
    if (this.keepAwakeEnabled && this.wakeLockSentinel && !this.isWakeDialogOpen) {
      this.startWakeTimer();
    }
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          if (this.keepAwakeEnabled && !this.isWakeDialogOpen) {
            document.addEventListener('visibilitychange', this.onVisibilityChange);
          }
        });
        this.startWakeTimer();
      }
    } catch (err) {
      console.warn('[WakeLock] Failed to acquire wake lock:', err);
    }
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && this.keepAwakeEnabled && !this.isWakeDialogOpen) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.acquireWakeLock();
    }
  };

  private async releaseWakeLock(): Promise<void> {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch { /* already released */ }
      this.wakeLockSentinel = null;
    }
  }

  private startWakeTimer(): void {
    this.clearWakeTimers();
    if (!this.idleTimeoutEnabled) return;
    const ms = this.wakeMinutes * 60 * 1000;
    this.wakeTimer = setTimeout(() => {
      this.ngZone.run(() => {
        this.showWakeDialog();
      });
    }, ms);
  }

  private clearWakeTimers(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    if (this.wakeCountdownTimer) {
      clearInterval(this.wakeCountdownTimer);
      this.wakeCountdownTimer = null;
    }
    if (this.wakeDimTimer) {
      clearTimeout(this.wakeDimTimer);
      this.wakeDimTimer = null;
    }
  }

  private showWakeDialog(): void {
    this.isWakeDialogOpen = true;
    this.isUiDimmed = false;
    this.wakeCountdownSeconds = 300;

    this.wakeCountdownTimer = setInterval(() => {
      this.wakeCountdownSeconds = Math.max(0, this.wakeCountdownSeconds - 1);
      this.cdr.detectChanges();

      if (this.wakeCountdownSeconds <= 0) {
        if (this.wakeCountdownTimer) {
          clearInterval(this.wakeCountdownTimer);
          this.wakeCountdownTimer = null;
        }
        this.isUiDimmed = true;
        this.releaseWakeLock();
        this.cdr.detectChanges();
      }
    }, 1000);
  }

  dismissWakeDialog(): void {
    this.isWakeDialogOpen = false;
    this.isUiDimmed = false;
    this.clearWakeTimers();
    if (this.keepAwakeEnabled) {
      this.acquireWakeLock();
    }
  }
}
