import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, take, forkJoin } from 'rxjs';
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
    ContentComponent
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
  isRenameModalOpen = false;
  isRenaming = false;
  soundToRename: Sound | null = null;
  renameValue = '';

  // Playback progress tracking
  playbackProgress = 0;
  playbackTimeRemaining = 0;
  currentSoundDuration = 0;
  playbackStartTime = 0;

  // Active category for nav highlight
  activeCategory: string = '';

  // Category icons mapping (SVG paths for fallback)
  categoryIcons: { [key: string]: string } = {
    'default': 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
  };

  // Category icons from soundlist.spl (base64 images)
  categoryIconsMap: Map<string, CategoryIcon> = new Map();
  // Ordered list of category names as they appear in Soundpad (from SPL file)
  categoryOrder: string[] = [];

  @ViewChild('renameInput') renameInput!: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private playbackTimer: any = null;

  constructor(private soundpadService: SoundpadService) {}

  ngOnInit(): void {
    // Subscribe to connection status
    this.soundpadService.getConnectionStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe((status: ConnectionStatus) => {
        this.isConnected = status.connected;
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

    // Reload sounds automatically whenever soundlist.spl changes on disk.
    this.soundpadService.listenForConfigChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('[config-watch] soundlist.spl changed – reloading sounds');
        this.loadSounds(true);
      });
  }

  ngOnDestroy(): void {
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
        next: () => {
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
    if (!this.isRenameMode) {
      this.isRenameModalOpen = false;
      this.soundToRename = null;
      this.renameValue = '';
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
}
