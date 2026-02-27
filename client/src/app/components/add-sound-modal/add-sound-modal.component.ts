import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take, Subscription } from 'rxjs';
import { SoundService, YoutubeFetchProgress, YoutubeCacheEntry } from '../../services/sound.service';
import { Sound, CategoryIcon } from '../../models/sound.model';
import { CategorySelectComponent } from '../category-select/category-select.component';
import { WaveformPreviewComponent } from '../waveform-preview/waveform-preview.component';

@Component({
  selector: 'app-add-sound-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, CategorySelectComponent, WaveformPreviewComponent],
  templateUrl: './add-sound-modal.component.html',
  styleUrls: ['./add-sound-modal.component.scss']
})
export class AddSoundModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() sounds: Sound[] = [];
  @Input() categoryIconsMap: Map<string, CategoryIcon> = new Map();
  @Output() closed = new EventEmitter<void>();
  @Output() soundAdded = new EventEmitter<void>();

  isAddingSound = false;
  addSoundFile: File | null = null;
  addSoundName = '';
  addSoundArtist = '';
  addSoundCategory = '';
  addSoundCategories: { name: string; parentCategory: string }[] = [];
  addSoundError = '';
  isDragOver = false;
  isAddSoundCancelFlashing = false;

  youtubeUrl = '';
  isFetchingYoutube = false;
  youtubeFetchError = '';
  youtubeDurationSeconds = 0;
  showYoutubeRetryBtn = false;
  youtubeProgressPercent = 0;
  youtubePhase: 'metadata' | 'downloading' | 'processing' | '' = '';
  youtubeTitle = '';
  youtubeSpeed = '';
  youtubeEta = '';
  private youtubeFetchAttempts = 0;
  private youtubeRetryTimer: any = null;
  private youtubeSubscription: Subscription | null = null;

  showArtistSuggestions = false;
  filteredArtistSuggestions: string[] = [];

  // Recent YouTube videos from cache
  allCachedVideos: YoutubeCacheEntry[] = [];
  recentYoutubeVideos: YoutubeCacheEntry[] = [];
  showRecentVideos = false;
  cachedVideosLoaded = false;

  @ViewChild('youtubeInput') youtubeInputRef!: ElementRef<HTMLInputElement>;

  step: 'select' | 'preview' | 'details' = 'select';
  showCropConfirmDialog = false;

  // Waveform state (updated via events from WaveformPreviewComponent)
  previewDuration = 0;
  cropStart = 0;
  cropEnd = 1;

  // Original uncropped file (set when user applies crop, null otherwise)
  originalUncroppedFile: File | null = null;

  private readonly ALLOWED_AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|wma|m4a|opus|aiff|ape)$/i;

  constructor(private soundService: SoundService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetState();
      this.soundService.getCategories()
        .pipe(take(1))
        .subscribe({
          next: (cats) => {
            this.addSoundCategories = cats;
            if (cats.length > 0) {
              this.addSoundCategory = cats[0].name;
            }
          },
          error: () => {
            this.addSoundCategories = [];
          }
        });
    }
  }

  private resetState(): void {
    this.step = 'select';
    this.addSoundFile = null;
    this.addSoundName = '';
    this.addSoundArtist = '';
    this.addSoundCategory = '';
    this.addSoundError = '';
    this.isDragOver = false;
    this.isAddingSound = false;
    this.showArtistSuggestions = false;
    this.filteredArtistSuggestions = [];
    this.youtubeUrl = '';
    this.isFetchingYoutube = false;
    this.youtubeFetchError = '';
    this.youtubeDurationSeconds = 0;
    this.showYoutubeRetryBtn = false;
    this.youtubeProgressPercent = 0;
    this.youtubePhase = '';
    this.youtubeTitle = '';
    this.youtubeSpeed = '';
    this.youtubeEta = '';
    this.youtubeFetchAttempts = 0;
    this.allCachedVideos = [];
    this.recentYoutubeVideos = [];
    this.showRecentVideos = false;
    this.cachedVideosLoaded = false;
    if (this.youtubeSubscription) {
      this.youtubeSubscription.unsubscribe();
      this.youtubeSubscription = null;
    }
    if (this.youtubeRetryTimer) {
      clearTimeout(this.youtubeRetryTimer);
      this.youtubeRetryTimer = null;
    }
    this.previewDuration = 0;
    this.cropStart = 0;
    this.cropEnd = 1;
    this.showCropConfirmDialog = false;
    this.originalUncroppedFile = null;
  }

  close(): void {
    if (this.isAddingSound) return;
    this.closed.emit();
  }

  flashCancelBtn(): void {
    if (this.isAddingSound || this.isAddSoundCancelFlashing) return;
    this.isAddSoundCancelFlashing = true;
    setTimeout(() => {
      this.isAddSoundCancelFlashing = false;
    }, 800);
  }

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
    setTimeout(() => {
      this.showArtistSuggestions = false;
    }, 150);
  }

  selectArtistSuggestion(artist: string): void {
    this.addSoundArtist = artist;
    this.showArtistSuggestions = false;
  }

  onYoutubeUrlFocus(): void {
    if (this.isFetchingYoutube || this.isAddingSound) return;

    const loadAndShow = () => {
      this.filterCachedVideos();
      this.showRecentVideos = this.recentYoutubeVideos.length > 0;
    };

    if (this.cachedVideosLoaded) {
      loadAndShow();
      return;
    }

    this.soundService.getYoutubeCacheList()
      .pipe(take(1))
      .subscribe({
        next: (entries) => {
          this.allCachedVideos = entries;
          this.cachedVideosLoaded = true;
          loadAndShow();
        },
        error: () => {
          this.allCachedVideos = [];
          this.recentYoutubeVideos = [];
          this.showRecentVideos = false;
          this.cachedVideosLoaded = true;
        }
      });
  }

  onYoutubeUrlInput(): void {
    if (this.isFetchingYoutube || this.isAddingSound) return;
    if (!this.cachedVideosLoaded) return;
    this.filterCachedVideos();
    this.showRecentVideos = this.recentYoutubeVideos.length > 0;
  }

  private filterCachedVideos(): void {
    const query = this.youtubeUrl.trim().toLowerCase();
    if (!query) {
      this.recentYoutubeVideos = this.allCachedVideos;
      return;
    }
    this.recentYoutubeVideos = this.allCachedVideos.filter(v =>
      v.title.toLowerCase().includes(query) ||
      v.videoUrl.toLowerCase().includes(query) ||
      v.videoId.toLowerCase().includes(query)
    );
  }

  onYoutubeUrlBlur(): void {
    setTimeout(() => {
      this.showRecentVideos = false;
    }, 200);
  }

  selectRecentVideo(entry: YoutubeCacheEntry): void {
    this.youtubeUrl = entry.videoUrl;
    this.showRecentVideos = false;
    this.fetchFromYoutube();
  }

  clearRecentVideos(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.soundService.clearYoutubeCache().subscribe(() => {
      this.recentYoutubeVideos = [];
      this.allCachedVideos = [];
      this.showRecentVideos = false;
    });
  }

  formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  onCategoryChange(categoryName: string): void {
    this.addSoundCategory = categoryName;
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
    this.step = 'preview';
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
    this.step = 'preview';
  }

  private fileNameWithoutExtension(name: string): string {
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  }

  removeFile(event?: Event): void {
    event?.stopPropagation();
    this.addSoundFile = null;
    this.addSoundName = '';
    this.addSoundArtist = '';
    this.youtubeUrl = '';
    this.youtubeFetchError = '';
    this.youtubeDurationSeconds = 0;
    this.previewDuration = 0;
    this.cropStart = 0;
    this.cropEnd = 1;
    this.originalUncroppedFile = null;
    this.step = 'select';
  }

  fetchFromYoutube(): void {
    const url = this.youtubeUrl.trim();
    if (!url || this.isFetchingYoutube) return;

    this.isFetchingYoutube = true;
    this.youtubeFetchError = '';
    this.addSoundError = '';
    this.showYoutubeRetryBtn = false;
    this.youtubeProgressPercent = 0;
    this.youtubePhase = '';
    this.youtubeTitle = '';
    this.youtubeSpeed = '';
    this.youtubeEta = '';
    this.youtubeFetchAttempts++;

    if (this.youtubeSubscription) {
      this.youtubeSubscription.unsubscribe();
    }

    this.youtubeSubscription = this.soundService.fetchYoutubeAudioWithProgress(url)
      .subscribe({
        next: (event: YoutubeFetchProgress) => {
          if (event.type === 'phase' && event.phase) {
            this.youtubePhase = event.phase;
          } else if (event.type === 'metadata') {
            this.youtubeTitle = event.title || '';
          } else if (event.type === 'progress') {
            this.youtubeProgressPercent = event.percent || 0;
            this.youtubeSpeed = event.speed || '';
            this.youtubeEta = event.eta || '';
          } else if (event.type === 'done') {
            this.youtubePhase = 'processing';
            // Download the completed file
            this.soundService.downloadYoutubeFile(event.fileId!)
              .pipe(take(1))
              .subscribe({
                next: ({ file, title, durationSeconds }) => {
                  this.isFetchingYoutube = false;
                  this.youtubePhase = '';
                  this.youtubeFetchAttempts = 0;
                  this.addSoundFile = file;
                  this.youtubeDurationSeconds = durationSeconds;
                  this.addSoundName = title;
                  this.step = 'preview';
                },
                error: (err) => {
                  this.handleYoutubeFetchError(err?.message || 'Failed to download completed file.');
                }
              });
          }
        },
        error: (err) => {
          this.handleYoutubeFetchError(err?.message || 'Failed to fetch audio from YouTube.');
        }
      });
  }

  private handleYoutubeFetchError(errorMsg: string): void {
    this.isFetchingYoutube = false;
    this.youtubePhase = '';

    if (this.youtubeFetchAttempts < 2) {
      this.youtubeFetchError = errorMsg + ' Retrying…';
      this.youtubeRetryTimer = setTimeout(() => {
        this.youtubeRetryTimer = null;
        this.fetchFromYoutube();
      }, 2000);
    } else {
      this.youtubeFetchError = errorMsg;
      this.showYoutubeRetryBtn = true;
    }
  }

  retryYoutubeFetch(): void {
    this.youtubeFetchAttempts = 0;
    this.showYoutubeRetryBtn = false;
    this.fetchFromYoutube();
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Waveform event handlers
  onWaveformFileChanged(newFile: File): void {
    this.addSoundFile = newFile;
  }

  onOriginalFileChanged(originalFile: File | null): void {
    this.originalUncroppedFile = originalFile;
  }

  onMetadataParsed(meta: { artist: string; title: string }): void {
    if (meta.artist && !this.addSoundArtist) {
      this.addSoundArtist = meta.artist;
    }
    if (meta.title && !this.addSoundName) {
      this.addSoundName = meta.title;
    }
  }

  onDurationChanged(duration: number): void {
    this.previewDuration = duration;
  }

  onCropStateChanged(state: { start: number; end: number; duration: number }): void {
    this.cropStart = state.start;
    this.cropEnd = state.end;
    this.previewDuration = state.duration;
  }

  blurCropHandles(): void {
    // This is now handled by the waveform-preview component internally
  }

  get hasPendingCrop(): boolean {
    return this.cropStart !== 0 || this.cropEnd !== 1;
  }

  goToDetails(): void {
    if (this.hasPendingCrop) {
      this.showCropConfirmDialog = true;
      return;
    }
    this.step = 'details';
  }

  onCropConfirmContinue(): void {
    this.showCropConfirmDialog = false;
    this.step = 'details';
  }

  onCropConfirmCancel(): void {
    this.showCropConfirmDialog = false;
  }

  goBackToPreview(): void {
    this.step = 'preview';
  }

  goBackToSelect(): void {
    this.removeFile();
  }

  confirmAddSound(): void {
    if (!this.addSoundFile || this.isAddingSound) return;

    const category = this.addSoundCategory.trim() ||
      (this.addSoundCategories.length > 0 ? this.addSoundCategories[0].name : '');

    if (!category) {
      this.addSoundError = 'No categories available. Please create a category first.';
      return;
    }

    if (!this.addSoundName.trim()) {
      this.addSoundError = 'Title is required.';
      return;
    }

    const displayName = this.addSoundName.trim();
    const artist = this.addSoundArtist.trim();

    this.isAddingSound = true;
    this.addSoundError = '';

    const cropStartSec = this.cropStart > 0 ? this.cropStart * this.previewDuration : undefined;
    const cropEndSec = this.cropEnd < 1 ? this.cropEnd * this.previewDuration : undefined;

    const durationSeconds = this.previewDuration > 0 ? Math.round(this.previewDuration) : undefined;

    this.soundService.addSound(this.addSoundFile, category, displayName, cropStartSec, cropEndSec, artist, durationSeconds, this.originalUncroppedFile)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isAddingSound = false;
          this.soundAdded.emit();
        },
        error: (err) => {
          console.error('Failed to add sound:', err);
          this.addSoundError = err?.error?.error || 'Failed to add sound. Please try again.';
          this.isAddingSound = false;
        }
      });
  }
}
