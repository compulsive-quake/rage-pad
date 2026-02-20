import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, QueryList, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, take, forkJoin } from 'rxjs';
import { SoundpadService } from './services/soundpad.service';
import { Sound, ConnectionStatus, Category, CategoryIcon } from './models/sound.model';
import { SoundCardComponent } from './components/sound-card/sound-card.component';
import { SearchBarComponent } from './components/search-bar/search-bar.component';
import { ConnectionStatusComponent } from './components/connection-status/connection-status.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    SoundCardComponent,
    SearchBarComponent,
    ConnectionStatusComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  sounds: Sound[] = [];
  filteredSounds: Sound[] = [];
  categories: Category[] = [];
  isConnected = false;
  isLoading = true;
  currentlyPlayingIndex: number | null = null;
  isActuallyPlaying = false;
  isPaused = false;
  volume = 100;
  speakersOnly = false;
  micOnly = false;
  searchQuery = '';
  isSettingsModalOpen = false;
  isRestarting = false;
  
  // Playback progress tracking
  playbackProgress = 0;
  playbackTimeRemaining = 0;
  currentSoundDuration = 0;
  playbackStartTime = 0;
  
  // Category icons mapping (SVG paths for fallback)
  categoryIcons: { [key: string]: string } = {
    'default': 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
  };
  
  // Category icons from soundlist.spl (base64 images)
  categoryIconsMap: Map<string, CategoryIcon> = new Map();
  
  // Category visibility tracking for scroll reveal
  visibleCategories: Set<string> = new Set();
  private intersectionObserver: IntersectionObserver | null = null;
  
  @ViewChild('categoriesContainer') categoriesContainer!: ElementRef;
  @ViewChild('mainContent') mainContent!: ElementRef;
  
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  private playbackTimer: any = null;
  private scrollListener: (() => void) | null = null;

  constructor(private soundpadService: SoundpadService) {}

  ngOnInit(): void {
    // Subscribe to connection status (no auto-refresh on connection change)
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
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
    this.setupScrollFade();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    if (this.scrollListener && this.mainContent?.nativeElement) {
      this.mainContent.nativeElement.removeEventListener('scroll', this.scrollListener);
      this.scrollListener = null;
    }
  }

  setupScrollFade(): void {
    const container = this.mainContent?.nativeElement;
    if (!container) return;

    this.scrollListener = () => {
      const containerRect = container.getBoundingClientRect();
      const fadeZone = 120; // px over which to fade
      const categoryElements = container.querySelectorAll('.category-section');
      categoryElements.forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const topClip = containerRect.top - rect.top; // positive = clipped at top
        const bottomClip = rect.bottom - containerRect.bottom; // positive = clipped at bottom
        const clip = Math.max(topClip, bottomClip, 0);
        const opacity = clip === 0 ? 1 : Math.max(0, 1 - clip / fadeZone);
        htmlEl.style.opacity = String(opacity);
      });
    };

    container.addEventListener('scroll', this.scrollListener, { passive: true });
    // Run once on init
    this.scrollListener();
  }

  setupIntersectionObserver(): void {
    // Create intersection observer to detect when categories become fully visible
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const categoryName = entry.target.getAttribute('data-category');
          if (categoryName) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.9) {
              // Category is fully visible (90%+)
              this.visibleCategories.add(categoryName);
            }
          }
        });
      },
      {
        root: null, // viewport
        rootMargin: '0px',
        threshold: [0, 0.5, 0.9, 1.0] // Multiple thresholds for smoother detection
      }
    );
  }

  observeCategory(element: HTMLElement, categoryName: string): void {
    if (this.intersectionObserver && element) {
      element.setAttribute('data-category', categoryName);
      this.intersectionObserver.observe(element);
    }
  }

  isCategoryVisible(categoryName: string): boolean {
    return this.visibleCategories.has(categoryName);
  }

  loadSounds(): void {
    this.isLoading = true;
    // Clear visible categories when reloading
    this.visibleCategories.clear();
    
    // Fetch both sounds and category icons in parallel
    forkJoin({
      sounds: this.soundpadService.getSounds().pipe(take(1)),
      categoryIcons: this.soundpadService.getCategoryIcons().pipe(take(1))
    }).subscribe({
      next: ({ sounds, categoryIcons }) => {
        this.sounds = sounds;
        this.filteredSounds = sounds;
        
        // Build category icons map
        this.categoryIconsMap.clear();
        categoryIcons.forEach(icon => {
          this.categoryIconsMap.set(icon.name, icon);
        });
        
        this.groupSoundsByCategory(sounds);
        this.isLoading = false;
        
        // Observe category elements after view updates
        setTimeout(() => {
          this.observeAllCategories();
          this.scrollListener?.();
        }, 0);
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  observeAllCategories(): void {
    if (!this.intersectionObserver) {
      this.setupIntersectionObserver();
    }
    
    // Disconnect existing observations
    this.intersectionObserver?.disconnect();
    
    // Find all category sections and observe them
    const categoryElements = document.querySelectorAll('.category-section[data-category]');
    categoryElements.forEach((element) => {
      this.intersectionObserver?.observe(element);
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

  groupSoundsByCategory(sounds: Sound[]): void {
    const categoryMap = new Map<string, { sounds: Sound[], image: string }>();
    
    sounds.forEach(sound => {
      const category = sound.category || 'Uncategorized';
      if (!categoryMap.has(category)) {
        // Get the category icon from the map
        const categoryIcon = this.categoryIconsMap.get(category);
        let image = '';
        if (categoryIcon && categoryIcon.isBase64) {
          image = `data:image/png;base64,${categoryIcon.icon}`;
        }
        categoryMap.set(category, { sounds: [], image });
      }
      categoryMap.get(category)!.sounds.push(sound);
    });
    
    // Convert map to array and sort alphabetically, but put 'Uncategorized' at the end
    this.categories = Array.from(categoryMap.entries())
      .sort((a, b) => {
        if (a[0] === 'Uncategorized') return 1;
        if (b[0] === 'Uncategorized') return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, data]) => ({ name, sounds: data.sounds, image: data.image }));
  }

  getCategoryIcon(categoryName: string): string {
    return this.categoryIcons[categoryName.toLowerCase()] || this.categoryIcons['default'];
  }
  
  getCategoryImageUrl(categoryName: string): string | null {
    const categoryIcon = this.categoryIconsMap.get(categoryName);
    if (categoryIcon && categoryIcon.isBase64) {
      return `data:image/png;base64,${categoryIcon.icon}`;
    }
    return null;
  }

  encodeURIComponent(str: string): string {
    return encodeURIComponent(str);
  }

  trackByCategory(index: number, category: Category): string {
    return category.name;
  }

  playSound(sound: Sound): void {
    this.soundpadService.playSound(sound.index, this.speakersOnly, this.micOnly)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.currentlyPlayingIndex = sound.index;
          this.isActuallyPlaying = true;
          this.isPaused = false;
          
          // Parse duration and start progress tracking
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
          // Sound finished - reset everything
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
            // Resuming - adjust start time
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

  toggleMicOnly(): void {
    this.micOnly = !this.micOnly;
    if (this.micOnly) this.speakersOnly = false;
    const mode = this.micOnly ? 2 : 0;
    this.soundpadService.setPlayMode(mode)
      .pipe(take(1))
      .subscribe({
        error: (err) => {
          console.error('Failed to set mic only mode:', err);
          this.micOnly = !this.micOnly;
        }
      });
  }

  toggleSpeakersOnly(): void {
    this.speakersOnly = !this.speakersOnly;
    if (this.speakersOnly) this.micOnly = false;
    this.soundpadService.setSpeakersOnly(this.speakersOnly)
      .pipe(take(1))
      .subscribe({
        error: (err) => {
          console.error('Failed to set speakers only mode:', err);
          // Revert on error
          this.speakersOnly = !this.speakersOnly;
        }
      });
  }

  refreshSounds(): void {
    this.loadSounds();
  }

  trackByIndex(index: number, sound: Sound): number {
    return sound.index;
  }

  toggleSettingsModal(): void {
    this.isSettingsModalOpen = !this.isSettingsModalOpen;
  }

  restartSoundpad(): void {
    if (this.isRestarting) return;
    
    this.isRestarting = true;
    this.soundpadService.restartSoundpad()
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          console.log('Restart command sent:', response);
          // Briefly show a message or just close the modal
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

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
