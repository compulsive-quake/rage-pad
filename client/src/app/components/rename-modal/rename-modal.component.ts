import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { SoundpadService } from '../../services/soundpad.service';
import { Sound } from '../../models/sound.model';

@Component({
  selector: 'app-rename-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rename-modal.component.html',
  styleUrls: ['./rename-modal.component.scss']
})
export class RenameModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() sound: Sound | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() renamed = new EventEmitter<{ sound: Sound; newTitle: string }>();

  @ViewChild('renameInput') renameInput!: ElementRef<HTMLInputElement>;

  isRenaming = false;
  renameValue = '';
  private mouseDownOnOverlay = false;

  constructor(private soundpadService: SoundpadService) {}

  onOverlayMouseDown(event: MouseEvent): void {
    this.mouseDownOnOverlay = event.target === event.currentTarget;
  }

  onOverlayMouseUp(event: MouseEvent): void {
    if (this.mouseDownOnOverlay && event.target === event.currentTarget) {
      this.onClose();
    }
    this.mouseDownOnOverlay = false;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.renameValue = this.sound?.title ?? '';
      this.isRenaming = false;
      setTimeout(() => {
        this.renameInput?.nativeElement?.focus();
        this.renameInput?.nativeElement?.select();
      }, 50);
    }
  }

  onClose(): void {
    if (this.isRenaming) return;
    this.closed.emit();
  }

  confirm(): void {
    if (!this.sound || !this.renameValue.trim() || this.isRenaming) return;

    this.isRenaming = true;
    const sound = this.sound;
    const newTitle = this.renameValue.trim();

    this.soundpadService.restartSoundpad(sound.index, newTitle)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isRenaming = false;
          this.renamed.emit({ sound, newTitle });
        },
        error: (err) => {
          console.error('Failed to rename sound:', err);
          this.isRenaming = false;
        }
      });
  }
}
