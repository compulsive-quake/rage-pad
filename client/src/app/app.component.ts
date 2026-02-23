import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subject, Subscription, takeUntil, debounceTime, distinctUntilChanged, take, forkJoin } from 'rxjs';
import { SoundpadService } from './services/soundpad.service';
import { Sound, ConnectionStatus, Category, CategoryIcon } from './models/sound.model';
import { HeaderComponent } from './components/header/header.component';
import { FooterComponent } from './components/footer/footer.component';
import { ContentComponent } from './components/content/content.component';

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
  isRenameModalOpen = false;
  isRenaming = false;
  soundToRename: Sound | null = null;
  renameValue = '';

  // Add Sound modal state
  isAddSoundModalOpen = false;
  isAddingSound = false;
  addSoundFile: File | null = null;
  addSoundName = '';
  addSoundArtist = '';
  addSoundTitle = '';
  addSoundCategory = '';
  addSoundCategories: { name: string; parentCategory: string }[] = [];
  addSoundError = '';
  isDragOver = false;
  isAddSoundCancelFlashing = false;

  // YouTube URL input state
  youtubeUrl = '';
  isFetchingYoutube = false;
  youtubeFetchError = '';
  /** Duration in seconds returned by the YouTube fetch endpoint (0 = unknown) */
  youtubeDurationSeconds = 0;

  // Artist autocomplete state
  showArtistSuggestions = false;
  filteredArtistSuggestions: string[] = [];

  // Category dropdown state
  isCategoryDropdownOpen = false;

  // Config-watch (soundlist.spl change detection) toggle
  configWatchEnabled: boolean;
  private configWatchSub: Subscription | null = null;

  // Auto-launch Soundpad toggle
  autoLaunchEnabled: boolean;
  /** True while a launch attempt is in progress */
  isLaunching = false;
  /** Number of consecutive failed launch attempts */
  private launchFailCount = 0;
  /** Seconds remaining until the next auto-launch retry */
  launchRetryCountdown = 0;
  /** Error message shown in the footer when auto-launch fails */
  launchErrorMessage = '';
  private launchRetryTimer: any = null;
  private launchCountdownTimer: any = null;

  // Playback progress tracking
  playbackProgress = 0;
  playbackTimeRemaining = 0;
  currentSoundDuration = 0;
  playbackStartTime = 0;

  // Active category for nav highlight
  activeCategory: string = '';

  // Drag-and-drop state – suppresses reloads while a drag animation is settling
  private isDragActive = false;
  private pendingReload = false;

  // Category icons mapping (SVG paths for fallback)
  categoryIcons: { [key: string]: string } = {
    'default': 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
  };

  // Category icons from soundlist.spl (base64 images)
  categoryIconsMap: Map<string, CategoryIcon> = new Map();
  // Ordered list of category names as they appear in Soundpad (from SPL file)
  categoryOrder: string[] = [];

  // ── Waveform / Audio Preview ─────────────────────────────────────────────
  previewLoading = false;
  previewDuration = 0;
  previewCurrentTime = 0;
  previewIsPlaying = false;
  previewPlayheadPos = 0;   // 0–1 fraction across the full waveform
  /** Crop start as a fraction 0–1 of total duration */
  cropStart = 0;
  /** Crop end as a fraction 0–1 of total duration */
  cropEnd = 1;
  /** Which crop handle is currently keyboard-focused: 'start' | 'end' | null */
  focusedCropHandle: 'start' | 'end' | null = null;
  /** True while the crop is being applied (encoding WAV) */
  isCropping = false;
  /** Original file before any crop was applied – set by applyCrop(), cleared on reset/remove */
  originalFile: File | null = null;
  /** Original AudioBuffer before any crop was applied */
  private originalAudioBuffer: AudioBuffer | null = null;

  private audioCtx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private previewSourceNode: AudioBufferSourceNode | null = null;
  private previewStartedAt = 0;   // audioCtx.currentTime when playback started
  private previewOffsetSec = 0;   // seconds into the buffer where playback began
  private previewAnimFrame: number | null = null;
  private waveformPeaks: Float32Array | null = null;

  // Crop drag state
  private cropDragHandle: 'start' | 'end' | null = null;
  private cropDragBound: ((e: MouseEvent) => void) | null = null;
  private cropDragEndBound: (() => void) | null = null;

  @ViewChild('renameInput') renameInput!: ElementRef<HTMLInputElement>;
  @ViewChild('waveformCanvas') waveformCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('waveformSection') waveformSection!: ElementRef<HTMLDivElement>;

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private playbackTimer: any = null;

  constructor(private soundpadService: SoundpadService, private ngZone: NgZone, private cdr: ChangeDetectorRef) {
    // Restore config-watch preference from localStorage (default: disabled)
    const stored = localStorage.getItem('configWatchEnabled');
    this.configWatchEnabled = stored === 'true';

    // Restore auto-launch preference from localStorage (default: enabled)
    const storedAutoLaunch = localStorage.getItem('autoLaunchEnabled');
    this.autoLaunchEnabled = storedAutoLaunch === null ? true : storedAutoLaunch === 'true';
  }

  ngOnInit(): void {
    // Subscribe to connection status
    this.soundpadService.getConnectionStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe((status: ConnectionStatus) => {
        const wasConnected = this.isConnected;
        this.isConnected = status.connected;

        if (status.connected) {
          // Soundpad is now connected – clear any pending retry state
          this.clearLaunchRetry();
        } else if (!status.connected && this.autoLaunchEnabled && !this.isLaunching && !this.launchRetryTimer) {
          // Not connected – trigger auto-launch (initial check or reconnect scenario)
          this.attemptAutoLaunch();
        }
      });

    // Setup search with debounce
    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.filterSounds(query);
    });

    // Initial load only once
    this.loadSounds();

    // Start config-watch if enabled
    if (this.configWatchEnabled) {
      this.startConfigWatch();
    }
  }

  /** Subscribe to SSE config-watch so the sound list auto-reloads on soundlist.spl changes. */
  private startConfigWatch(): void {
    this.stopConfigWatch();
    this.configWatchSub = this.soundpadService.listenForConfigChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('[config-watch] soundlist.spl changed – reloading sounds');
        if (this.isDragActive) {
          // Defer the reload until the drag animation settles
          this.pendingReload = true;
        } else {
          this.loadSounds(true);
        }
      });
  }

  /** Tear down the SSE config-watch subscription. */
  private stopConfigWatch(): void {
    if (this.configWatchSub) {
      this.configWatchSub.unsubscribe();
      this.configWatchSub = null;
    }
  }

  /** Toggle soundlist.spl change detection on/off and persist the preference. */
  toggleConfigWatch(): void {
    this.configWatchEnabled = !this.configWatchEnabled;
    localStorage.setItem('configWatchEnabled', String(this.configWatchEnabled));

    if (this.configWatchEnabled) {
      this.startConfigWatch();
    } else {
      this.stopConfigWatch();
    }
  }

  // ── Auto-launch Soundpad ─────────────────────────────────────────────────

  /** Toggle auto-launch on/off and persist the preference. */
  toggleAutoLaunch(): void {
    this.autoLaunchEnabled = !this.autoLaunchEnabled;
    localStorage.setItem('autoLaunchEnabled', String(this.autoLaunchEnabled));

    if (!this.autoLaunchEnabled) {
      // User turned off auto-launch – cancel any pending retry
      this.clearLaunchRetry();
    } else if (!this.isConnected && !this.isLaunching) {
      // User turned on auto-launch while Soundpad is not connected – try immediately
      this.attemptAutoLaunch();
    }
  }

  /**
   * Attempt to launch Soundpad.  On failure, schedule a retry with exponential
   * back-off (capped at 60 s) and show a countdown in the footer.
   */
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
            // Success – the connection-status subscription will clear retry state
            this.launchFailCount = 0;
            this.launchErrorMessage = '';
            // Trigger a connection check to update status quickly
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

  /** Called when a launch attempt fails. Schedules a retry with back-off. */
  private onLaunchFailed(errorMsg: string): void {
    this.launchFailCount++;

    // Exponential back-off: 5s, 10s, 20s, 40s, 60s (capped)
    const baseDelay = 5;
    const delaySec = Math.min(baseDelay * Math.pow(2, this.launchFailCount - 1), 60);

    this.launchErrorMessage = `Failed to start Soundpad: ${errorMsg}`;
    this.launchRetryCountdown = delaySec;

    if (!this.autoLaunchEnabled) return;

    // Countdown timer (ticks every second)
    this.launchCountdownTimer = setInterval(() => {
      this.launchRetryCountdown = Math.max(this.launchRetryCountdown - 1, 0);
      this.cdr.detectChanges();
    }, 1000);

    // Retry timer
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

  /** Cancel any pending retry timers and reset launch state. */
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

  /** Manual "Start Soundpad" button handler (used when auto-launch is off). */
  manualLaunchSoundpad(): void {
    this.launchFailCount = 0;
    this.attemptAutoLaunch();
  }

  ngOnDestroy(): void {
    this.stopConfigWatch();
    this.clearLaunchRetry();
    this.destroy$.next();
    this.destroy$.complete();
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.destroyPreviewAudio();
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
            // Soundpad is not running – update connection state and handle accordingly
            this.isConnected = false;
            if (this.autoLaunchEnabled && !this.isLaunching) {
              this.attemptAutoLaunch();
            } else if (!this.autoLaunchEnabled) {
              // Show error in footer with Start Soundpad button
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

  toggleRenameMode(): void {
    this.isRenameMode = !this.isRenameMode;
    if (this.isRenameMode) {
      this.isReorderMode = false;
    }
    if (!this.isRenameMode) {
      this.isRenameModalOpen = false;
      this.soundToRename = null;
      this.renameValue = '';
    }
  }

  toggleReorderMode(): void {
    this.isReorderMode = !this.isReorderMode;
    if (this.isReorderMode) {
      this.isRenameMode = false;
      this.isRenameModalOpen = false;
      this.soundToRename = null;
      this.renameValue = '';
    }
  }

  onReorderSound(event: { soundIndex: number; targetCategory: string; targetPosition: number }): void {
    // The CDK drag-drop has already moved the item in the local arrays via
    // moveItemInArray / transferArrayItem, so the UI is already correct.
    // We only need to persist the change on the server. We intentionally do NOT
    // call loadSounds() here to avoid rebuilding the DOM and causing stutter.
    // The config-watch SSE will eventually trigger a silent reload once the
    // drag animation has settled (see onDragStateChange).
    this.soundpadService.reorderSound(event.soundIndex, event.targetCategory, event.targetPosition)
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          if (result?.error) {
            console.error('Failed to reorder sound:', result.error);
            // On error, force a reload to restore correct state
            this.loadSounds(true);
          }
          // On success: do NOT reload here. The config-watch SSE or the
          // dragStateChange handler will pick up the pending reload.
        },
        error: (err: any) => {
          console.error('Failed to reorder sound:', err);
          // On error, force a reload to restore correct state
          this.loadSounds(true);
        }
      });
  }

  /** Called by the content component when a drag starts or the drop animation finishes. */
  onDragStateChange(isDragging: boolean): void {
    this.isDragActive = isDragging;
    if (!isDragging && this.pendingReload) {
      // The drag animation has settled – now it's safe to reload
      this.pendingReload = false;
      this.loadSounds(true);
    }
  }

  openRenameModal(sound: Sound): void {
    this.soundToRename = sound;
    this.renameValue = sound.title;
    this.isRenameModalOpen = true;
    setTimeout(() => {
      this.renameInput?.nativeElement?.focus();
      this.renameInput?.nativeElement?.select();
    }, 50);
  }

  cancelRename(): void {
    this.isRenameModalOpen = false;
    this.soundToRename = null;
    this.renameValue = '';
  }

  confirmRename(): void {
    if (!this.soundToRename || !this.renameValue.trim() || this.isRenaming) return;

    this.isRenaming = true;
    const sound = this.soundToRename;
    const newTitle = this.renameValue.trim();

    this.soundpadService.restartSoundpad(sound.index, newTitle)
      .pipe(take(1))
      .subscribe({
        next: () => {
          sound.title = newTitle;
          this.isRenaming = false;
          this.isRenameModalOpen = false;
          this.soundToRename = null;
          this.renameValue = '';
          this.isRenameMode = false;
        },
        error: (err) => {
          console.error('Failed to rename sound:', err);
          this.isRenaming = false;
        }
      });
  }

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

  // ── Add Sound Modal ──────────────────────────────────────────────────────

  private readonly ALLOWED_AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|wma|m4a|opus|aiff|ape)$/i;

  openAddSoundModal(): void {
    this.isAddSoundModalOpen = true;
    this.addSoundFile = null;
    this.addSoundName = '';
    this.addSoundArtist = '';
    this.addSoundTitle = '';
    this.addSoundCategory = '';
    this.addSoundError = '';
    this.isDragOver = false;
    this.isAddingSound = false;
    this.showArtistSuggestions = false;
    this.filteredArtistSuggestions = [];
    this.isCategoryDropdownOpen = false;
    this.youtubeUrl = '';
    this.isFetchingYoutube = false;
    this.youtubeFetchError = '';
    this.youtubeDurationSeconds = 0;
    this.resetPreviewState();

    // Fetch categories from the server so the dropdown is always fresh
    this.soundpadService.getCategories()
      .pipe(take(1))
      .subscribe({
        next: (cats) => {
          this.addSoundCategories = cats;
          // Default to the first category if available
          if (cats.length > 0) {
            this.addSoundCategory = cats[0].name;
          }
        },
        error: () => {
          this.addSoundCategories = [];
        }
      });
  }

  flashAddSoundCancelBtn(): void {
    if (this.isAddingSound || this.isAddSoundCancelFlashing) return;
    this.isAddSoundCancelFlashing = true;
    setTimeout(() => {
      this.isAddSoundCancelFlashing = false;
    }, 800);
  }

  closeAddSoundModal(): void {
    if (this.isAddingSound) return; // prevent closing while upload is in progress
    this.isAddSoundModalOpen = false;
    this.addSoundFile = null;
    this.addSoundName = '';
    this.addSoundArtist = '';
    this.addSoundTitle = '';
    this.addSoundCategory = '';
    this.addSoundError = '';
    this.isDragOver = false;
    this.showArtistSuggestions = false;
    this.filteredArtistSuggestions = [];
    this.isCategoryDropdownOpen = false;
    this.youtubeUrl = '';
    this.isFetchingYoutube = false;
    this.youtubeFetchError = '';
    this.youtubeDurationSeconds = 0;
    this.destroyPreviewAudio();
    this.resetPreviewState();
  }

  /** Returns a sorted, deduplicated list of all non-empty artists from existing sounds. */
  get allArtists(): string[] {
    const set = new Set<string>();
    this.sounds.forEach(s => {
      if (s.artist && s.artist.trim()) {
        set.add(s.artist.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  onArtistInput(): void {
    const query = this.addSoundArtist.trim().toLowerCase();
    if (!query) {
      this.filteredArtistSuggestions = this.allArtists;
    } else {
      this.filteredArtistSuggestions = this.allArtists.filter(a =>
        a.toLowerCase().includes(query)
      );
    }
    this.showArtistSuggestions = this.filteredArtistSuggestions.length > 0;
  }

  onArtistFocus(): void {
    const query = this.addSoundArtist.trim().toLowerCase();
    if (!query) {
      this.filteredArtistSuggestions = this.allArtists;
    } else {
      this.filteredArtistSuggestions = this.allArtists.filter(a =>
        a.toLowerCase().includes(query)
      );
    }
    this.showArtistSuggestions = this.filteredArtistSuggestions.length > 0;
  }

  onArtistBlur(): void {
    // Delay hiding so a click on a suggestion registers first
    setTimeout(() => {
      this.showArtistSuggestions = false;
    }, 150);
  }

  selectArtistSuggestion(artist: string): void {
    this.addSoundArtist = artist;
    this.showArtistSuggestions = false;
  }

  /** Returns the resolved image URL for a category name (from categoryIconsMap). */
  getCategoryImageUrl(categoryName: string): string {
    const icon = this.categoryIconsMap.get(categoryName);
    return this.resolveCategoryImageUrl(icon);
  }

  toggleCategoryDropdown(): void {
    this.isCategoryDropdownOpen = !this.isCategoryDropdownOpen;
  }

  selectCategory(categoryName: string): void {
    this.addSoundCategory = categoryName;
    this.isCategoryDropdownOpen = false;
  }

  closeCategoryDropdown(): void {
    this.isCategoryDropdownOpen = false;
  }

  onCategoryDropdownBlur(): void {
    // Delay so mousedown on an option fires before the dropdown closes
    setTimeout(() => {
      this.isCategoryDropdownOpen = false;
    }, 150);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
    this.addSoundError = '';

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!this.ALLOWED_AUDIO_EXTENSIONS.test(file.name)) {
      this.addSoundError = 'Only audio files are accepted (MP3, WAV, OGG, FLAC, AAC, WMA, M4A, OPUS, AIFF, APE).';
      return;
    }
    this.addSoundFile = file;
    this.addSoundName = this.fileNameWithoutExtension(file.name);
    this.loadAudioPreview(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.addSoundError = '';

    if (!this.ALLOWED_AUDIO_EXTENSIONS.test(file.name)) {
      this.addSoundError = 'Only audio files are accepted (MP3, WAV, OGG, FLAC, AAC, WMA, M4A, OPUS, AIFF, APE).';
      return;
    }
    this.addSoundFile = file;
    this.addSoundName = this.fileNameWithoutExtension(file.name);
    this.loadAudioPreview(file);
  }

  private fileNameWithoutExtension(name: string): string {
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  }

  removeFile(event: Event): void {
    event.stopPropagation();
    this.addSoundFile = null;
    this.addSoundName = '';
    this.addSoundArtist = '';
    this.addSoundTitle = '';
    this.youtubeUrl = '';
    this.youtubeFetchError = '';
    this.youtubeDurationSeconds = 0;
    this.destroyPreviewAudio();
    this.resetPreviewState();
  }

  fetchFromYoutube(): void {
    const url = this.youtubeUrl.trim();
    if (!url || this.isFetchingYoutube) return;

    this.isFetchingYoutube = true;
    this.youtubeFetchError = '';
    this.addSoundError = '';

    this.soundpadService.fetchYoutubeAudio(url)
      .pipe(take(1))
      .subscribe({
        next: ({ file, title, durationSeconds }) => {
          this.isFetchingYoutube = false;
          this.addSoundFile = file;
          // Store the duration so it can be written to the SPL tag
          this.youtubeDurationSeconds = durationSeconds;
          // Auto-populate the title and tag from the YouTube video title
          this.addSoundTitle = title;
          this.addSoundName = title;
          // Load the audio into the waveform/crop tool
          this.loadAudioPreview(file);
        },
        error: (err) => {
          this.isFetchingYoutube = false;
          const errMsg = err?.error?.error || err?.message || 'Failed to fetch audio from YouTube.';
          this.youtubeFetchError = errMsg;
        }
      });
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  confirmAddSound(): void {
    if (!this.addSoundFile || this.isAddingSound) return;

    // Default to first category if none selected
    const category = this.addSoundCategory.trim() ||
      (this.addSoundCategories.length > 0 ? this.addSoundCategories[0].name : '');

    if (!category) {
      this.addSoundError = 'No categories available. Please create a category in Soundpad first.';
      return;
    }

    if (!this.addSoundName.trim()) {
      this.addSoundError = 'Tag is required.';
      return;
    }

    const displayName = this.addSoundName.trim();
    const artist = this.addSoundArtist.trim();
    const title = this.addSoundTitle.trim();

    this.isAddingSound = true;
    this.addSoundError = '';

    // If crop is applied, pass crop times; otherwise pass undefined
    const cropStartSec = this.cropStart > 0 ? this.cropStart * this.previewDuration : undefined;
    const cropEndSec = this.cropEnd < 1 ? this.cropEnd * this.previewDuration : undefined;

    // Compute effective duration for the SPL tag:
    // - If the audio was fetched from YouTube, use the server-provided duration
    // - Adjust for any crop that was applied
    // - If the waveform was decoded, use the AudioBuffer duration as a fallback
    let effectiveDuration = this.youtubeDurationSeconds > 0
      ? this.youtubeDurationSeconds
      : (this.previewDuration > 0 ? this.previewDuration : 0);
    if (effectiveDuration > 0 && (cropStartSec !== undefined || cropEndSec !== undefined)) {
      const start = cropStartSec ?? 0;
      const end = cropEndSec ?? effectiveDuration;
      effectiveDuration = Math.max(end - start, 0);
    }
    const durationSeconds = effectiveDuration > 0 ? Math.round(effectiveDuration) : undefined;

    this.soundpadService.addSound(this.addSoundFile, category, displayName, cropStartSec, cropEndSec, artist, title, durationSeconds)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isAddingSound = false;
          this.isAddSoundModalOpen = false;
          this.addSoundFile = null;
          this.addSoundName = '';
          this.addSoundArtist = '';
          this.addSoundTitle = '';
          this.addSoundCategory = '';
          this.destroyPreviewAudio();
          this.resetPreviewState();
          // Refresh the sound list immediately so the grid updates
          this.loadSounds(true);
        },
        error: (err) => {
          console.error('Failed to add sound:', err);
          this.addSoundError = err?.error?.error || 'Failed to add sound. Please try again.';
          this.isAddingSound = false;
        }
      });
  }

  // ── Audio Preview / Waveform ─────────────────────────────────────────────

  private resetPreviewState(): void {
    this.previewLoading = false;
    this.previewDuration = 0;
    this.previewCurrentTime = 0;
    this.previewIsPlaying = false;
    this.previewPlayheadPos = 0;
    this.cropStart = 0;
    this.cropEnd = 1;
    this.focusedCropHandle = null;
    this.isCropping = false;
    this.audioBuffer = null;
    this.waveformPeaks = null;
    this.previewOffsetSec = 0;
    this.previewStartedAt = 0;
    this.originalFile = null;
    this.originalAudioBuffer = null;
  }

  private destroyPreviewAudio(): void {
    this.stopPreviewPlayback();
    if (this.previewAnimFrame !== null) {
      cancelAnimationFrame(this.previewAnimFrame);
      this.previewAnimFrame = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.removeCropDragListeners();
  }

  private loadAudioPreview(file: File): void {
    this.destroyPreviewAudio();
    this.resetPreviewState();
    this.previewLoading = true;

    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      if (!arrayBuffer) {
        this.previewLoading = false;
        return;
      }

      // Parse ID3v2 tags and pre-fill Artist / Title if not already set by the user
      const tags = this.parseId3Tags(arrayBuffer);
      if (tags.artist && !this.addSoundArtist) {
        this.addSoundArtist = tags.artist;
      }
      if (tags.title && !this.addSoundTitle) {
        this.addSoundTitle = tags.title;
        // If Title gets a valid value from ID3 tags, use it for Tag instead of file name
        this.addSoundName = tags.title;
      }

      this.audioCtx = new AudioContext();
      this.audioCtx.decodeAudioData(arrayBuffer.slice(0))
        .then((buffer) => {
          this.ngZone.run(() => {
            this.audioBuffer = buffer;
            this.previewDuration = buffer.duration;
            this.previewLoading = false;
            this.waveformPeaks = this.computePeaks(buffer, 600);
            // Draw after Angular renders the canvas
            setTimeout(() => this.drawWaveform(), 50);
          });
        })
        .catch(() => {
          this.ngZone.run(() => {
            this.previewLoading = false;
          });
        });
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * Minimal ID3v2 parser – extracts TPE1 (artist) and TIT2 (title) from the
   * beginning of an audio file's ArrayBuffer.  Supports ID3v2.3 and v2.4.
   * Returns empty strings for any tag that is absent or cannot be decoded.
   */
  private parseId3Tags(buffer: ArrayBuffer): { artist: string; title: string } {
    const result = { artist: '', title: '' };
    try {
      const bytes = new Uint8Array(buffer);

      // ID3v2 header: "ID3" + version (2 bytes) + flags (1 byte) + size (4 bytes syncsafe)
      if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
        return result; // No ID3v2 header
      }

      const majorVersion = bytes[3]; // 2, 3, or 4
      // Syncsafe integer for total tag size (excluding 10-byte header)
      const tagSize =
        ((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f);

      let offset = 10;
      const end = Math.min(10 + tagSize, bytes.length);

      // Skip extended header if present (flag bit 6 of byte 5)
      if (bytes[5] & 0x40) {
        if (majorVersion === 4) {
          const extSize =
            ((bytes[10] & 0x7f) << 21) |
            ((bytes[11] & 0x7f) << 14) |
            ((bytes[12] & 0x7f) << 7) |
            (bytes[13] & 0x7f);
          offset += extSize;
        } else {
          const extSize = (bytes[10] << 24) | (bytes[11] << 16) | (bytes[12] << 8) | bytes[13];
          offset += extSize + 4;
        }
      }

      const decoder = new TextDecoder('utf-8');

      while (offset + 10 < end) {
        // Frame ID: 4 chars (v2.3/v2.4) or 3 chars (v2.2)
        const frameIdLen = majorVersion === 2 ? 3 : 4;
        const frameId = String.fromCharCode(...bytes.slice(offset, offset + frameIdLen));

        // Frame size
        let frameSize: number;
        if (majorVersion === 2) {
          frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
          offset += 6;
        } else if (majorVersion === 4) {
          // Syncsafe in v2.4
          frameSize =
            ((bytes[offset + 4] & 0x7f) << 21) |
            ((bytes[offset + 5] & 0x7f) << 14) |
            ((bytes[offset + 6] & 0x7f) << 7) |
            (bytes[offset + 7] & 0x7f);
          offset += 10;
        } else {
          // v2.3: plain big-endian
          frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
          offset += 10;
        }

        if (frameSize <= 0 || offset + frameSize > end) break;

        const isArtist = frameId === 'TPE1' || frameId === 'TP1';
        const isTitle  = frameId === 'TIT2' || frameId === 'TT2';

        if (isArtist || isTitle) {
          // First byte of text frame is encoding: 0=Latin-1, 1=UTF-16, 2=UTF-16BE, 3=UTF-8
          const encoding = bytes[offset];
          const textBytes = bytes.slice(offset + 1, offset + frameSize);
          let text = '';
          if (encoding === 1 || encoding === 2) {
            // UTF-16 (with or without BOM)
            text = new TextDecoder('utf-16le').decode(textBytes);
          } else {
            text = decoder.decode(textBytes);
          }
          // Strip null terminators
          text = text.replace(/\0/g, '').trim();
          if (isArtist) result.artist = text;
          if (isTitle)  result.title  = text;
        }

        offset += frameSize;

        if (result.artist && result.title) break; // found both, stop early
      }
    } catch {
      // Silently ignore parse errors – fields stay empty
    }
    return result;
  }

  /** Compute peak amplitudes (max absolute value per bucket) for waveform display */
  private computePeaks(buffer: AudioBuffer, numBuckets: number): Float32Array {
    const channelData = buffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / numBuckets);
    const peaks = new Float32Array(numBuckets);
    for (let i = 0; i < numBuckets; i++) {
      let max = 0;
      const start = i * blockSize;
      const end = start + blockSize;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      peaks[i] = max;
    }
    return peaks;
  }

  /** Draw the waveform on the canvas */
  drawWaveform(): void {
    const canvasEl = this.waveformCanvas?.nativeElement;
    if (!canvasEl || !this.waveformPeaks) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const peaks = this.waveformPeaks;
    const n = peaks.length;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, W, H);

    const barW = W / n;
    const midY = H / 2;

    for (let i = 0; i < n; i++) {
      const x = i * barW;
      const frac = i / n;
      const barH = peaks[i] * midY * 0.95;

      // Determine colour based on crop region
      if (frac < this.cropStart || frac > this.cropEnd) {
        ctx.fillStyle = 'rgba(155, 89, 182, 0.25)';
      } else {
        // Gradient: purple → red
        const t = (frac - this.cropStart) / Math.max(this.cropEnd - this.cropStart, 0.001);
        const r = Math.round(155 + (231 - 155) * t);
        const g = Math.round(89 + (76 - 89) * t);
        const b = Math.round(182 + (60 - 182) * t);
        ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      }

      ctx.fillRect(x, midY - barH, Math.max(barW - 0.5, 0.5), barH * 2);
    }
  }

  /** Handle click on waveform canvas to seek */
  onWaveformMousedown(event: MouseEvent): void {
    const canvasEl = this.waveformCanvas?.nativeElement;
    if (!canvasEl || !this.audioBuffer) return;
    const rect = canvasEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.seekPreviewTo(frac * this.previewDuration);
    this.focusedCropHandle = null;
    // Focus the waveform section for keyboard events
    this.waveformSection?.nativeElement?.focus();
  }

  private seekPreviewTo(timeSec: number): void {
    const wasPlaying = this.previewIsPlaying;
    if (wasPlaying) this.stopPreviewPlayback();
    this.previewOffsetSec = Math.max(this.cropStart * this.previewDuration,
      Math.min(this.cropEnd * this.previewDuration, timeSec));
    this.previewCurrentTime = this.previewOffsetSec;
    this.previewPlayheadPos = this.previewDuration > 0 ? this.previewOffsetSec / this.previewDuration : 0;
    if (wasPlaying) this.startPreviewPlayback();
  }

  togglePreviewPlayback(): void {
    if (this.previewIsPlaying) {
      this.pausePreviewPlayback();
    } else {
      this.startPreviewPlayback();
    }
    // Focus the waveform section for keyboard events
    setTimeout(() => this.waveformSection?.nativeElement?.focus(), 0);
  }

  restartPreviewFromCropStart(): void {
    this.stopPreviewPlayback();
    this.previewOffsetSec = this.cropStart * this.previewDuration;
    this.previewCurrentTime = this.previewOffsetSec;
    this.previewPlayheadPos = this.cropStart;
    this.startPreviewPlayback();
    // Focus the waveform section for keyboard events
    setTimeout(() => this.waveformSection?.nativeElement?.focus(), 0);
  }

  private startPreviewPlayback(): void {
    if (!this.audioCtx || !this.audioBuffer) return;

    // Resume suspended context (browser autoplay policy)
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const startOffset = this.previewOffsetSec;
    const cropEndSec = this.cropEnd * this.previewDuration;
    const duration = cropEndSec - startOffset;
    if (duration <= 0) {
      // Reset to crop start and play from there
      this.previewOffsetSec = this.cropStart * this.previewDuration;
      return this.startPreviewPlayback();
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(this.audioCtx.destination);
    source.start(0, startOffset, duration);
    source.onended = () => {
      this.ngZone.run(() => {
        if (this.previewIsPlaying) {
          this.previewIsPlaying = false;
          this.previewOffsetSec = this.cropStart * this.previewDuration;
          this.previewCurrentTime = this.previewOffsetSec;
          this.previewPlayheadPos = this.cropStart;
          this.drawWaveform();
          this.cdr.detectChanges();
        }
      });
    };

    this.previewSourceNode = source;
    this.previewStartedAt = this.audioCtx.currentTime;
    this.previewIsPlaying = true;
    this.schedulePlayheadAnimation();
  }

  private pausePreviewPlayback(): void {
    if (!this.previewIsPlaying || !this.audioCtx) return;
    // Capture current position before stopping
    const elapsed = this.audioCtx.currentTime - this.previewStartedAt;
    this.previewOffsetSec = Math.min(
      this.previewOffsetSec + elapsed,
      this.cropEnd * this.previewDuration
    );
    this.stopPreviewPlayback();
  }

  private stopPreviewPlayback(): void {
    if (this.previewSourceNode) {
      try { this.previewSourceNode.onended = null; this.previewSourceNode.stop(); } catch {}
      this.previewSourceNode = null;
    }
    this.previewIsPlaying = false;
    if (this.previewAnimFrame !== null) {
      cancelAnimationFrame(this.previewAnimFrame);
      this.previewAnimFrame = null;
    }
  }

  private schedulePlayheadAnimation(): void {
    if (this.previewAnimFrame !== null) {
      cancelAnimationFrame(this.previewAnimFrame);
    }
    const tick = () => {
      if (!this.previewIsPlaying || !this.audioCtx) return;
      const elapsed = this.audioCtx.currentTime - this.previewStartedAt;
      const currentSec = Math.min(this.previewOffsetSec + elapsed, this.cropEnd * this.previewDuration);
      this.ngZone.run(() => {
        this.previewCurrentTime = currentSec;
        this.previewPlayheadPos = this.previewDuration > 0 ? currentSec / this.previewDuration : 0;
        this.drawWaveform();
      });
      this.previewAnimFrame = requestAnimationFrame(tick);
    };
    this.previewAnimFrame = requestAnimationFrame(tick);
  }

  // ── Crop handles ─────────────────────────────────────────────────────────

  startCropDrag(event: MouseEvent, handle: 'start' | 'end'): void {
    event.preventDefault();
    event.stopPropagation();
    this.cropDragHandle = handle;
    this.focusedCropHandle = handle;

    this.cropDragBound = (e: MouseEvent) => this.onCropDragMove(e);
    this.cropDragEndBound = () => this.onCropDragEnd();

    document.addEventListener('mousemove', this.cropDragBound);
    document.addEventListener('mouseup', this.cropDragEndBound);

    // Focus waveform section for keyboard events
    this.waveformSection?.nativeElement?.focus();
  }

  private onCropDragMove(event: MouseEvent): void {
    const canvasEl = this.waveformCanvas?.nativeElement;
    if (!canvasEl || !this.cropDragHandle) return;
    const rect = canvasEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));

    if (this.cropDragHandle === 'start') {
      this.cropStart = Math.min(frac, this.cropEnd - 0.01);
      // If playhead is before new start, move it
      if (this.previewPlayheadPos < this.cropStart) {
        this.previewOffsetSec = this.cropStart * this.previewDuration;
        this.previewPlayheadPos = this.cropStart;
        this.previewCurrentTime = this.previewOffsetSec;
      }
    } else {
      this.cropEnd = Math.max(frac, this.cropStart + 0.01);
      if (this.previewPlayheadPos > this.cropEnd) {
        this.previewOffsetSec = this.cropEnd * this.previewDuration;
        this.previewPlayheadPos = this.cropEnd;
        this.previewCurrentTime = this.previewOffsetSec;
      }
    }
    this.drawWaveform();
  }

  private onCropDragEnd(): void {
    this.cropDragHandle = null;
    this.removeCropDragListeners();
  }

  private removeCropDragListeners(): void {
    if (this.cropDragBound) {
      document.removeEventListener('mousemove', this.cropDragBound);
      this.cropDragBound = null;
    }
    if (this.cropDragEndBound) {
      document.removeEventListener('mouseup', this.cropDragEndBound);
      this.cropDragEndBound = null;
    }
  }

  resetCrop(): void {
    this.cropStart = 0;
    this.cropEnd = 1;
    this.drawWaveform();
  }

  /** Deselect any focused crop handle (start or end). */
  blurCropHandles(): void {
    if (this.focusedCropHandle !== null) {
      this.focusedCropHandle = null;
    }
  }

  /**
   * Apply the current crop: slice the AudioBuffer to [cropStart, cropEnd],
   * encode it as a WAV Blob, replace addSoundFile, regenerate peaks and
   * redraw the waveform.  Crop handles are reset to 0/1 afterwards.
   */
  applyCrop(): void {
    if (!this.audioBuffer || !this.audioCtx || this.isCropping) return;
    if (this.cropStart === 0 && this.cropEnd === 1) return; // nothing to crop

    this.isCropping = true;
    this.stopPreviewPlayback();

    const sampleRate = this.audioBuffer.sampleRate;
    const numChannels = this.audioBuffer.numberOfChannels;
    const startSample = Math.floor(this.cropStart * this.audioBuffer.length);
    const endSample   = Math.ceil(this.cropEnd   * this.audioBuffer.length);
    const newLength   = endSample - startSample;

    // Save originals before replacing (only on first crop – keep the very first original)
    if (!this.originalFile) {
      this.originalFile = this.addSoundFile;
      this.originalAudioBuffer = this.audioBuffer;
    }

    // Build a new AudioBuffer containing only the cropped region
    const croppedBuffer = this.audioCtx.createBuffer(numChannels, newLength, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
      const src = this.audioBuffer.getChannelData(ch);
      const dst = croppedBuffer.getChannelData(ch);
      dst.set(src.subarray(startSample, endSample));
    }

    // Encode to WAV in-browser (PCM 16-bit)
    const wavBlob = this.audioBufferToWav(croppedBuffer);
    const originalName = this.addSoundFile?.name ?? 'cropped.wav';
    const baseName = this.fileNameWithoutExtension(originalName);
    const newFile = new File([wavBlob], `${baseName}.wav`, { type: 'audio/wav' });

    // Replace the audio buffer and file reference
    this.audioBuffer = croppedBuffer;
    this.addSoundFile = newFile;
    this.previewDuration = croppedBuffer.duration;

    // Reset crop handles and playhead
    this.cropStart = 0;
    this.cropEnd = 1;
    this.previewOffsetSec = 0;
    this.previewCurrentTime = 0;
    this.previewPlayheadPos = 0;

    // Recompute peaks and redraw
    this.waveformPeaks = this.computePeaks(croppedBuffer, 600);
    this.isCropping = false;
    this.cdr.detectChanges();
    setTimeout(() => this.drawWaveform(), 0);
  }

  /**
   * Restore the original (pre-crop) file and AudioBuffer.
   * Resets the waveform display to the full-length media.
   */
  resetToOriginal(): void {
    if (!this.originalFile || !this.originalAudioBuffer) return;

    this.stopPreviewPlayback();

    this.addSoundFile = this.originalFile;
    this.audioBuffer = this.originalAudioBuffer;
    this.previewDuration = this.originalAudioBuffer.duration;

    // Clear the saved originals so the button disappears
    this.originalFile = null;
    this.originalAudioBuffer = null;

    // Reset crop handles and playhead
    this.cropStart = 0;
    this.cropEnd = 1;
    this.previewOffsetSec = 0;
    this.previewCurrentTime = 0;
    this.previewPlayheadPos = 0;
    this.focusedCropHandle = null;

    // Recompute peaks and redraw
    this.waveformPeaks = this.computePeaks(this.audioBuffer, 600);
    this.cdr.detectChanges();
    setTimeout(() => this.drawWaveform(), 0);
  }

  /**
   * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
   * Interleaves all channels (standard WAV layout).
   */
  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate  = buffer.sampleRate;
    const numSamples  = buffer.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign  = numChannels * bytesPerSample;
    const dataSize    = numSamples * blockAlign;
    const headerSize  = 44;

    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4,  36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);           // PCM chunk size
    view.setUint16(20, 1, true);            // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);           // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channel data
    let offset = 44;
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  onPreviewKeydown(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      event.preventDefault();
      this.blurCropHandles();
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      this.restartPreviewFromCropStart();
      return;
    }

    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
      const step = event.shiftKey ? 0.01 : 0.001; // shift = coarser step
      const delta = event.code === 'ArrowLeft' ? -step : step;

      if (this.focusedCropHandle === 'start') {
        this.cropStart = Math.max(0, Math.min(this.cropEnd - 0.001, this.cropStart + delta));
        this.drawWaveform();
      } else if (this.focusedCropHandle === 'end') {
        this.cropEnd = Math.max(this.cropStart + 0.001, Math.min(1, this.cropEnd + delta));
        this.drawWaveform();
      }
      return;
    }

    // Tab between handles
    if (event.code === 'Tab') {
      event.preventDefault();
      if (this.focusedCropHandle === null || this.focusedCropHandle === 'end') {
        this.focusedCropHandle = 'start';
      } else {
        this.focusedCropHandle = 'end';
      }
    }
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
