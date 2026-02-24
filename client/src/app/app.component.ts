import { Component, OnInit, OnDestroy, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subject, Subscription, takeUntil, debounceTime, distinctUntilChanged, take, forkJoin, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SoundpadService } from './services/soundpad.service';
import { Sound, ConnectionStatus, Category, CategoryIcon } from './models/sound.model';
import { HeaderComponent } from './components/header/header.component';
import { FooterComponent } from './components/footer/footer.component';
import { ContentComponent } from './components/content/content.component';
import { SettingsComponent, SettingsPayload } from './components/settings/settings.component';
import { RenameModalComponent } from './components/rename-modal/rename-modal.component';
import { WakeDialogComponent } from './components/wake-dialog/wake-dialog.component';
import { AddSoundModalComponent } from './components/add-sound-modal/add-sound-modal.component';

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
  currentlyPlayingIndex: number | null = null;
  isActuallyPlaying = false;
  isPaused = false;
  volume = 100;
  playbackMode: 'both' | 'mic' | 'speakers' = 'both';
  searchQuery = '';
  isSettingsModalOpen = false;
  isRestarting = false;
  isRenameMode = false;
  isReorderMode = false;

  // Rename modal state
  isRenameModalOpen = false;
  soundToRename: Sound | null = null;

  // Add Sound modal state
  isAddSoundModalOpen = false;

  // Config-watch toggle
  configWatchEnabled: boolean;
  private configWatchSub: Subscription | null = null;

  // Auto-launch
  autoLaunchEnabled: boolean;
  isLaunching = false;
  private launchFailCount = 0;
  launchRetryCountdown = 0;
  launchErrorMessage = '';
  private launchRetryTimer: any = null;
  private launchCountdownTimer: any = null;

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

  // Update check
  autoUpdateCheckEnabled: boolean;
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

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private playbackTimer: any = null;

  constructor(private soundpadService: SoundpadService, private ngZone: NgZone, private cdr: ChangeDetectorRef) {
    const stored = localStorage.getItem('configWatchEnabled');
    this.configWatchEnabled = stored === 'true';

    const storedAutoLaunch = localStorage.getItem('autoLaunchEnabled');
    this.autoLaunchEnabled = storedAutoLaunch === null ? true : storedAutoLaunch === 'true';

    const storedKeepAwake = localStorage.getItem('keepAwakeEnabled');
    this.keepAwakeEnabled = storedKeepAwake === 'true';
    const storedIdleTimeout = localStorage.getItem('idleTimeoutEnabled');
    this.idleTimeoutEnabled = storedIdleTimeout === 'true';
    const storedWakeMinutes = localStorage.getItem('wakeMinutes');
    this.wakeMinutes = storedWakeMinutes ? parseInt(storedWakeMinutes, 10) || 30 : 30;

    const storedAutoUpdateCheck = localStorage.getItem('autoUpdateCheckEnabled');
    this.autoUpdateCheckEnabled = storedAutoUpdateCheck === null ? true : storedAutoUpdateCheck === 'true';
  }

  ngOnInit(): void {
    this.soundpadService.getConnectionStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe((status: ConnectionStatus) => {
        this.isConnected = status.connected;

        if (status.connected) {
          this.clearLaunchRetry();
        } else if (!status.connected && this.autoLaunchEnabled && !this.isLaunching && !this.launchRetryTimer) {
          this.attemptAutoLaunch();
        }
      });

    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.filterSounds(query);
    });

    this.loadSounds();

    if (this.configWatchEnabled) {
      this.startConfigWatch();
    }

    if (this.keepAwakeEnabled) {
      this.acquireWakeLock();
    }

    if (this.autoUpdateCheckEnabled) {
      this.startUpdateCheck();
    }
  }

  private startConfigWatch(): void {
    this.stopConfigWatch();
    this.configWatchSub = this.soundpadService.listenForConfigChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('[config-watch] soundlist.spl changed – reloading sounds');
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

  toggleConfigWatch(): void {
    this.configWatchEnabled = !this.configWatchEnabled;
    localStorage.setItem('configWatchEnabled', String(this.configWatchEnabled));
    if (this.configWatchEnabled) {
      this.startConfigWatch();
    } else {
      this.stopConfigWatch();
    }
  }

  // ── Auto-launch ──────────────────────────────────────────────────────────

  toggleAutoLaunch(): void {
    this.autoLaunchEnabled = !this.autoLaunchEnabled;
    localStorage.setItem('autoLaunchEnabled', String(this.autoLaunchEnabled));
    if (!this.autoLaunchEnabled) {
      this.clearLaunchRetry();
    } else if (!this.isConnected && !this.isLaunching) {
      this.attemptAutoLaunch();
    }
  }

  attemptAutoLaunch(): void {
    if (this.isLaunching || this.isConnected) return;

    this.isLaunching = true;
    this.launchErrorMessage = '';
    this.launchRetryCountdown = 0;
    this.clearLaunchRetry();

    this.soundpadService.launchSoundpad()
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          this.isLaunching = false;
          if (result?.error) {
            this.onLaunchFailed(result.error);
          } else {
            this.launchFailCount = 0;
            this.launchErrorMessage = '';
            this.soundpadService.checkConnection().pipe(take(1)).subscribe(status => {
              this.isConnected = status.connected;
              if (status.connected) {
                this.clearLaunchRetry();
                this.loadSounds();
              }
            });
          }
        },
        error: (err: any) => {
          this.isLaunching = false;
          this.onLaunchFailed(err?.message || 'Failed to launch Soundpad');
        }
      });
  }

  private onLaunchFailed(errorMsg: string): void {
    this.launchFailCount++;
    const baseDelay = 5;
    const delaySec = Math.min(baseDelay * Math.pow(2, this.launchFailCount - 1), 60);

    this.launchErrorMessage = `Failed to start Soundpad: ${errorMsg}`;
    this.launchRetryCountdown = delaySec;

    if (!this.autoLaunchEnabled) return;

    this.launchCountdownTimer = setInterval(() => {
      this.launchRetryCountdown = Math.max(this.launchRetryCountdown - 1, 0);
      this.cdr.detectChanges();
    }, 1000);

    this.launchRetryTimer = setTimeout(() => {
      if (this.launchCountdownTimer) {
        clearInterval(this.launchCountdownTimer);
        this.launchCountdownTimer = null;
      }
      if (this.autoLaunchEnabled && !this.isConnected) {
        this.attemptAutoLaunch();
      }
    }, delaySec * 1000);
  }

  private clearLaunchRetry(): void {
    if (this.launchRetryTimer) {
      clearTimeout(this.launchRetryTimer);
      this.launchRetryTimer = null;
    }
    if (this.launchCountdownTimer) {
      clearInterval(this.launchCountdownTimer);
      this.launchCountdownTimer = null;
    }
    this.launchRetryCountdown = 0;
    this.launchErrorMessage = '';
    this.isLaunching = false;
  }

  manualLaunchSoundpad(): void {
    this.launchFailCount = 0;
    this.attemptAutoLaunch();
  }

  // ── Update check ────────────────────────────────────────────────────────

  private startUpdateCheck(): void {
    this.stopUpdateCheck();
    // Check immediately then every 30 minutes
    this.updateCheckSub = timer(0, 30 * 60 * 1000).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.soundpadService.checkForUpdate())
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
    this.soundpadService.checkForUpdate()
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
    this.clearLaunchRetry();
    this.stopUpdateCheck();
    this.releaseWakeLock();
    this.clearWakeTimers();
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
      sounds: this.soundpadService.getSounds().pipe(take(1)),
      categoryIcons: this.soundpadService.getCategoryIcons().pipe(take(1))
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
    if (!categoryIcon.icon.startsWith('stock_')) {
      return `http://localhost:3000/api/category-image?path=${encodeURIComponent(categoryIcon.icon)}`;
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
    this.soundpadService.playSound(sound.index, this.playbackMode === 'speakers', this.playbackMode === 'mic')
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          if (result?.soundpadNotRunning) {
            this.isConnected = false;
            if (this.autoLaunchEnabled && !this.isLaunching) {
              this.attemptAutoLaunch();
            } else if (!this.autoLaunchEnabled) {
              this.launchErrorMessage = 'Soundpad is not running';
            }
            return;
          }
          if (result?.error) {
            console.error('Failed to play sound:', result.error);
            return;
          }
          this.currentlyPlayingIndex = sound.index;
          this.isActuallyPlaying = true;
          this.isPaused = false;

          this.currentSoundDuration = this.parseDuration(sound.duration);
          this.playbackStartTime = Date.now();
          this.playbackProgress = 0;
          this.playbackTimeRemaining = this.currentSoundDuration;

          this.startProgressTimer();
        },
        error: (err) => {
          console.error('Failed to play sound:', err);
        }
      });
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
      if (this.currentlyPlayingIndex !== null && !this.isPaused && this.currentSoundDuration > 0) {
        const elapsed = (Date.now() - this.playbackStartTime) / 1000;
        this.playbackProgress = Math.min((elapsed / this.currentSoundDuration) * 100, 100);
        this.playbackTimeRemaining = Math.max(this.currentSoundDuration - elapsed, 0);

        if (this.playbackTimeRemaining <= 0) {
          this.currentlyPlayingIndex = null;
          this.isActuallyPlaying = false;
          this.playbackProgress = 0;
          this.playbackTimeRemaining = 0;
          clearInterval(this.playbackTimer);
          this.playbackTimer = null;
        }
      }
    }, 100);
  }

  stopSound(): void {
    this.soundpadService.stopSound()
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.currentlyPlayingIndex = null;
          this.isActuallyPlaying = false;
          this.isPaused = false;
          this.playbackProgress = 0;
          this.playbackTimeRemaining = 0;
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
    this.soundpadService.togglePause()
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
    this.soundpadService.setVolume(volume)
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
    this.loadSounds();
  }

  toggleSettingsModal(): void {
    this.isSettingsModalOpen = !this.isSettingsModalOpen;
  }

  onSaveSettings(payload: SettingsPayload): void {
    if (payload.configWatchEnabled !== this.configWatchEnabled) {
      this.configWatchEnabled = payload.configWatchEnabled;
      localStorage.setItem('configWatchEnabled', String(this.configWatchEnabled));
      if (this.configWatchEnabled) {
        this.startConfigWatch();
      } else {
        this.stopConfigWatch();
      }
    }

    if (payload.autoLaunchEnabled !== this.autoLaunchEnabled) {
      this.autoLaunchEnabled = payload.autoLaunchEnabled;
      localStorage.setItem('autoLaunchEnabled', String(this.autoLaunchEnabled));
      if (!this.autoLaunchEnabled) {
        this.clearLaunchRetry();
      } else if (!this.isConnected && !this.isLaunching) {
        this.attemptAutoLaunch();
      }
    }

    if (payload.keepAwakeEnabled !== this.keepAwakeEnabled) {
      this.keepAwakeEnabled = payload.keepAwakeEnabled;
      localStorage.setItem('keepAwakeEnabled', String(this.keepAwakeEnabled));
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
      localStorage.setItem('idleTimeoutEnabled', String(this.idleTimeoutEnabled));
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
      localStorage.setItem('wakeMinutes', String(this.wakeMinutes));
      if (this.keepAwakeEnabled && this.idleTimeoutEnabled && this.wakeLockSentinel && !this.isWakeDialogOpen) {
        this.startWakeTimer();
      }
    }

    if (payload.autoUpdateCheckEnabled !== this.autoUpdateCheckEnabled) {
      this.autoUpdateCheckEnabled = payload.autoUpdateCheckEnabled;
      localStorage.setItem('autoUpdateCheckEnabled', String(this.autoUpdateCheckEnabled));
      if (this.autoUpdateCheckEnabled) {
        this.startUpdateCheck();
      } else {
        this.stopUpdateCheck();
        this.updateAvailable = false;
      }
    }
  }

  toggleRenameMode(): void {
    this.isRenameMode = !this.isRenameMode;
    if (this.isRenameMode) {
      this.isReorderMode = false;
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
    }
  }

  onReorderSound(event: { soundIndex: number; targetCategory: string; targetPosition: number }): void {
    this.soundpadService.reorderSound(event.soundIndex, event.targetCategory, event.targetPosition)
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

    this.soundpadService.reorderCategory(event.categoryName, event.targetPosition)
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

  // ── Restart Soundpad ──────────────────────────────────────────────────────

  restartSoundpad(): void {
    if (this.isRestarting) return;

    this.isRestarting = true;
    this.soundpadService.restartSoundpad()
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          console.log('Restart command sent:', response);
          setTimeout(() => {
            this.isRestarting = false;
            this.isSettingsModalOpen = false;
          }, 2000);
        },
        error: (err) => {
          console.error('Failed to restart Soundpad:', err);
          this.isRestarting = false;
        }
      });
  }

  // ── Wake Lock ─────────────────────────────────────────────────────────────

  toggleKeepAwake(): void {
    this.keepAwakeEnabled = !this.keepAwakeEnabled;
    localStorage.setItem('keepAwakeEnabled', String(this.keepAwakeEnabled));
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
    localStorage.setItem('wakeMinutes', String(this.wakeMinutes));
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
