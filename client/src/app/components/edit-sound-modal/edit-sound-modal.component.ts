import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { SoundService } from '../../services/sound.service';
import { Sound } from '../../models/sound.model';
import { WaveformPreviewComponent } from '../waveform-preview/waveform-preview.component';

@Component({
  selector: 'app-edit-sound-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, WaveformPreviewComponent],
  templateUrl: './edit-sound-modal.component.html',
  styleUrls: ['./edit-sound-modal.component.scss']
})
export class EditSoundModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() sound: Sound | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  isLoading = false;
  isSaving = false;
  audioFile: File | null = null;
  originalUncroppedFile: File | null = null;
  errorMessage = '';

  // Waveform state
  previewDuration = 0;
  cropStart = 0;
  cropEnd = 1;

  // Crop confirmation dialog
  showCropConfirmDialog = false;
  private pendingAction: 'save' | 'copy' | null = null;

  // Save a Copy name dialog
  showCopyNameDialog = false;
  copyName = '';

  constructor(private soundService: SoundService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.sound) {
      this.resetState();
      this.fetchAudio();
    }
  }

  private resetState(): void {
    this.isLoading = false;
    this.isSaving = false;
    this.audioFile = null;
    this.originalUncroppedFile = null;
    this.errorMessage = '';
    this.previewDuration = 0;
    this.cropStart = 0;
    this.cropEnd = 1;
    this.showCropConfirmDialog = false;
    this.pendingAction = null;
    this.showCopyNameDialog = false;
    this.copyName = '';
  }

  private fetchAudio(): void {
    if (!this.sound) return;
    this.isLoading = true;
    this.errorMessage = '';

    this.soundService.getSoundAudio(this.sound.id)
      .pipe(take(1))
      .subscribe({
        next: (file) => {
          this.audioFile = file;
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Failed to fetch sound audio:', err);
          this.errorMessage = err?.error?.error || 'Failed to load audio file.';
          this.isLoading = false;
        }
      });
  }

  close(): void {
    if (this.isSaving) return;
    this.closed.emit();
  }

  // Waveform event handlers
  onWaveformFileChanged(newFile: File): void {
    this.audioFile = newFile;
  }

  onOriginalFileChanged(originalFile: File | null): void {
    this.originalUncroppedFile = originalFile;
  }

  onDurationChanged(duration: number): void {
    this.previewDuration = duration;
  }

  onCropStateChanged(state: { start: number; end: number; duration: number }): void {
    this.cropStart = state.start;
    this.cropEnd = state.end;
    this.previewDuration = state.duration;
  }

  get hasPendingCrop(): boolean {
    return this.cropStart !== 0 || this.cropEnd !== 1;
  }

  // --- Save (overwrite) ---
  onSave(): void {
    if (this.hasPendingCrop) {
      this.pendingAction = 'save';
      this.showCropConfirmDialog = true;
      return;
    }
    this.doSave();
  }

  private doSave(): void {
    if (!this.audioFile || !this.sound || this.isSaving) return;
    this.isSaving = true;
    this.errorMessage = '';

    this.soundService.updateSoundFile(this.sound.id, this.audioFile)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.saved.emit();
        },
        error: (err) => {
          console.error('Failed to update sound file:', err);
          this.errorMessage = err?.error?.error || 'Failed to save. Please try again.';
          this.isSaving = false;
        }
      });
  }

  // --- Save a Copy ---
  onSaveACopy(): void {
    if (this.hasPendingCrop) {
      this.pendingAction = 'copy';
      this.showCropConfirmDialog = true;
      return;
    }
    this.openCopyNameDialog();
  }

  private openCopyNameDialog(): void {
    this.copyName = this.sound?.title || '';
    this.showCopyNameDialog = true;
  }

  onCopyNameCancel(): void {
    this.showCopyNameDialog = false;
    this.copyName = '';
  }

  onCopyNameConfirm(): void {
    if (!this.audioFile || !this.sound || this.isSaving) return;

    let finalName = this.copyName.trim();
    if (!finalName) {
      finalName = (this.sound.title || 'sound') + ' copy';
    } else if (finalName === this.sound.title) {
      finalName = finalName + ' copy';
    }

    this.showCopyNameDialog = false;
    this.isSaving = true;
    this.errorMessage = '';

    this.soundService.addSound(
      this.audioFile,
      this.sound.category,
      finalName,
      undefined,
      undefined,
      this.sound.artist,
      this.sound.title,
      this.previewDuration > 0 ? Math.round(this.previewDuration) : undefined,
      this.originalUncroppedFile
    ).pipe(take(1))
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.saved.emit();
        },
        error: (err) => {
          console.error('Failed to save copy:', err);
          this.errorMessage = err?.error?.error || 'Failed to save copy. Please try again.';
          this.isSaving = false;
        }
      });
  }

  // --- Crop confirmation dialog ---
  onCropConfirmContinue(): void {
    this.showCropConfirmDialog = false;
    const action = this.pendingAction;
    this.pendingAction = null;
    if (action === 'save') {
      this.doSave();
    } else if (action === 'copy') {
      this.openCopyNameDialog();
    }
  }

  onCropConfirmCancel(): void {
    this.showCropConfirmDialog = false;
    this.pendingAction = null;
  }
}
