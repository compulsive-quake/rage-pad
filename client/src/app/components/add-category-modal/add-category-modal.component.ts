import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { SoundService } from '../../services/sound.service';

@Component({
  selector: 'app-add-category-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-category-modal.component.html',
  styleUrls: ['./add-category-modal.component.scss']
})
export class AddCategoryModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  @Output() categoryAdded = new EventEmitter<string>();

  @ViewChild('nameInput') nameInput!: ElementRef<HTMLInputElement>;

  categoryName = '';
  iconBase64 = '';
  iconPreview = '';
  isCreating = false;
  errorMessage = '';
  mouseDownOnOverlay = false;
  isDragOver = false;

  constructor(private soundService: SoundService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.categoryName = '';
      this.iconBase64 = '';
      this.iconPreview = '';
      this.isCreating = false;
      this.errorMessage = '';
      this.isDragOver = false;
      setTimeout(() => {
        this.nameInput?.nativeElement?.focus();
      }, 50);
    }
  }

  onOverlayMouseDown(event: MouseEvent): void {
    this.mouseDownOnOverlay = event.target === event.currentTarget;
  }

  onOverlayMouseUp(event: MouseEvent): void {
    if (this.mouseDownOnOverlay && event.target === event.currentTarget) {
      this.onClose();
    }
    this.mouseDownOnOverlay = false;
  }

  onClose(): void {
    if (this.isCreating) return;
    this.closed.emit();
  }

  onIconFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.processImageFile(input.files[0]);
    }
  }

  onIconDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onIconDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onIconDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
    const files = event.dataTransfer?.files;
    if (files && files[0] && files[0].type.startsWith('image/')) {
      this.processImageFile(files[0]);
    }
  }

  removeIcon(): void {
    this.iconBase64 = '';
    this.iconPreview = '';
  }

  private processImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      this.iconPreview = result;
      // Strip the data URL prefix for the base64 payload
      this.iconBase64 = result.includes(',') ? result.split(',')[1] : result;
    };
    reader.readAsDataURL(file);
  }

  confirm(): void {
    if (!this.categoryName.trim() || this.isCreating) return;

    this.isCreating = true;
    this.errorMessage = '';

    this.soundService.createCategory(this.categoryName.trim(), this.iconBase64 || undefined)
      .pipe(take(1))
      .subscribe({
        next: (result: any) => {
          this.isCreating = false;
          if (result?.error) {
            this.errorMessage = result.error;
          } else {
            this.categoryAdded.emit(this.categoryName.trim());
          }
        },
        error: (err) => {
          console.error('Failed to create category:', err);
          this.isCreating = false;
          this.errorMessage = 'Failed to create category';
        }
      });
  }
}
