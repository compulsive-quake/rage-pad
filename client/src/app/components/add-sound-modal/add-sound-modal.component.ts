import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { SoundpadService } from '../../services/soundpad.service';
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
  addSoundTitle = '';
  addSoundCategory = '';
  addSoundCategories: { name: string; parentCategory: string }[] = [];
  addSoundError = '';
  isDragOver = false;
  isAddSoundCancelFlashing = false;

  youtubeUrl = '';
  isFetchingYoutube = false;
  youtubeFetchError = '';
  youtubeDurationSeconds = 0;

  showArtistSuggestions = false;
  filteredArtistSuggestions: string[] = [];

  step: 'select' | 'preview' | 'details' = 'select';
  showCropConfirmDialog = false;

  // Waveform state (updated via events from WaveformPreviewComponent)
  previewDuration = 0;
  cropStart = 0;
  cropEnd = 1;

  // Original uncropped file (set when user applies crop, null otherwise)
  originalUncroppedFile: File | null = null;

  private readonly ALLOWED_AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|wma|m4a|opus|aiff|ape)$/i;

  constructor(private soundpadService: SoundpadService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetState();
      this.soundpadService.getCategories()
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
    this.addSoundTitle = '';
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
    this.addSoundTitle = '';
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

    this.soundpadService.fetchYoutubeAudio(url)
      .pipe(take(1))
      .subscribe({
        next: ({ file, title, durationSeconds }) => {
          this.isFetchingYoutube = false;
          this.addSoundFile = file;
          this.youtubeDurationSeconds = durationSeconds;
          this.addSoundTitle = title;
          this.addSoundName = title;
          this.step = 'preview';
        },
        error: (err) => {
          this.isFetchingYoutube = false;
          this.youtubeFetchError = err?.error?.error || err?.message || 'Failed to fetch audio from YouTube.';
        }
      });
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
    if (meta.title && !this.addSoundTitle) {
      this.addSoundTitle = meta.title;
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

    const cropStartSec = this.cropStart > 0 ? this.cropStart * this.previewDuration : undefined;
    const cropEndSec = this.cropEnd < 1 ? this.cropEnd * this.previewDuration : undefined;

    let effectiveDuration = this.youtubeDurationSeconds > 0
      ? this.youtubeDurationSeconds
      : (this.previewDuration > 0 ? this.previewDuration : 0);
    if (effectiveDuration > 0 && (cropStartSec !== undefined || cropEndSec !== undefined)) {
      const start = cropStartSec ?? 0;
      const end = cropEndSec ?? effectiveDuration;
      effectiveDuration = Math.max(end - start, 0);
    }
    const durationSeconds = effectiveDuration > 0 ? Math.round(effectiveDuration) : undefined;

    this.soundpadService.addSound(this.addSoundFile, category, displayName, cropStartSec, cropEndSec, artist, title, durationSeconds, this.originalUncroppedFile)
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
