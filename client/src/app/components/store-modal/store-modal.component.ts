import { Component, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take, forkJoin } from 'rxjs';
import { SoundService, StoreDownloadProgress } from '../../services/sound.service';
import { StoreCategory, StoreCategoryDetail, StoreSound } from '../../models/sound.model';

@Component({
  selector: 'app-store-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './store-modal.component.html',
  styleUrls: ['./store-modal.component.scss']
})
export class StoreModalComponent implements OnInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  @Output() categoryDownloaded = new EventEmitter<string>();

  categories: StoreCategory[] = [];
  filteredCategories: StoreCategory[] = [];
  localCategoryNames: Set<string> = new Set();
  isLoading = false;
  searchQuery = '';

  // Detail view
  selectedCategory: StoreCategoryDetail | null = null;
  isLoadingDetail = false;

  // Download state
  isDownloading = false;
  downloadProgress = 0;
  downloadTotal = 0;
  downloadCurrentTitle = '';
  downloadError = '';

  // Sound preview state
  private audioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  previewingSoundFileName: string | null = null;

  constructor(private soundService: SoundService) {}

  ngOnInit(): void {
    this.loadCategories();
  }

  ngOnDestroy(): void {
    this.stopPreview();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  loadCategories(): void {
    this.isLoading = true;
    forkJoin({
      cats: this.soundService.getStoreCategories().pipe(take(1)),
      localNames: this.soundService.getLocalCategoryNames().pipe(take(1)),
    }).subscribe({
      next: ({ cats, localNames }) => {
        this.categories = cats;
        this.localCategoryNames = new Set(localNames);
        this.applyFilter();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  isCategoryDownloaded(name: string): boolean {
    return this.localCategoryNames.has(name);
  }

  applyFilter(): void {
    if (!this.searchQuery.trim()) {
      this.filteredCategories = this.categories;
    } else {
      const q = this.searchQuery.toLowerCase();
      this.filteredCategories = this.categories.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.uploader_name.toLowerCase().includes(q)
      );
    }
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.applyFilter();
  }

  viewCategory(cat: StoreCategory): void {
    this.isLoadingDetail = true;
    this.downloadError = '';
    this.soundService.getStoreCategoryDetail(cat.id)
      .pipe(take(1))
      .subscribe({
        next: (detail) => {
          this.selectedCategory = detail;
          this.isLoadingDetail = false;
        },
        error: () => {
          this.isLoadingDetail = false;
        }
      });
  }

  backToList(): void {
    this.stopPreview();
    this.selectedCategory = null;
    this.downloadError = '';
  }

  downloadCategory(): void {
    if (!this.selectedCategory || this.isDownloading) return;

    this.isDownloading = true;
    this.downloadProgress = 0;
    this.downloadTotal = 0;
    this.downloadCurrentTitle = '';
    this.downloadError = '';

    this.soundService.downloadStoreCategory(this.selectedCategory.category.id)
      .subscribe({
        next: (event: StoreDownloadProgress) => {
          if (event.type === 'phase' && event.phase === 'downloading_sounds') {
            this.downloadTotal = event.total || 0;
          }
          if (event.type === 'progress') {
            this.downloadProgress = event.current || 0;
            this.downloadCurrentTitle = event.title || '';
          }
          if (event.type === 'done') {
            this.isDownloading = false;
            if (event.categoryName) {
              this.localCategoryNames.add(event.categoryName);
            }
            this.categoryDownloaded.emit(event.categoryName || '');
          }
        },
        error: (err: Error) => {
          this.isDownloading = false;
          this.downloadError = err.message || 'Download failed';
        }
      });
  }

  // ── Sound preview ──────────────────────────────────────────────────────

  togglePreview(sound: StoreSound): void {
    if (this.previewingSoundFileName === sound.file_name) {
      this.stopPreview();
    } else {
      this.playPreview(sound);
    }
  }

  private async playPreview(sound: StoreSound): Promise<void> {
    this.stopPreview();
    this.previewingSoundFileName = sound.file_name;

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const blob = await this.soundService.getStoreSoundAudio(sound.file_name)
        .pipe(take(1))
        .toPromise();
      if (!blob) {
        this.previewingSoundFileName = null;
        return;
      }

      // Bail if a different sound started while we were loading
      if (this.previewingSoundFileName !== sound.file_name) return;

      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Bail again after decode
      if (this.previewingSoundFileName !== sound.file_name) return;

      this.currentAudioSource = this.audioContext.createBufferSource();
      this.currentAudioSource.buffer = audioBuffer;

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1;

      this.currentAudioSource.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.currentAudioSource.onended = () => {
        if (this.previewingSoundFileName === sound.file_name) {
          this.previewingSoundFileName = null;
        }
      };

      this.currentAudioSource.start();
    } catch (err) {
      console.error('[store-preview] Failed to play:', err);
      this.previewingSoundFileName = null;
    }
  }

  stopPreview(): void {
    if (this.currentAudioSource) {
      this.currentAudioSource.onended = null;
      try { this.currentAudioSource.stop(); } catch { /* already stopped */ }
      this.currentAudioSource = null;
    }
    this.previewingSoundFileName = null;
  }

  formatDuration(ms: number): string {
    const sec = Math.round(ms / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}:${s.toString().padStart(2, '0')}`;
  }

  onClose(): void {
    if (this.isDownloading) return;
    this.stopPreview();
    this.closed.emit();
  }
}
