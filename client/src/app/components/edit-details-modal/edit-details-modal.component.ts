import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { SoundService } from '../../services/sound.service';
import { Sound, CategoryIcon } from '../../models/sound.model';
import { CategorySelectComponent } from '../category-select/category-select.component';

@Component({
  selector: 'app-edit-details-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, CategorySelectComponent],
  templateUrl: './edit-details-modal.component.html',
  styleUrls: ['./edit-details-modal.component.scss']
})
export class EditDetailsModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() sound: Sound | null = null;
  @Input() sounds: Sound[] = [];
  @Input() categoryIconsMap: Map<string, CategoryIcon> = new Map();
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  editTag = '';
  editArtist = '';
  editCategory = '';
  editIcon = '';
  editIconIsBase64 = false;
  editHideTitle = false;
  iconPreviewUrl = '';
  categories: { name: string; parentCategory: string }[] = [];
  errorMessage = '';
  isSaving = false;

  iconDragOver = false;
  iconSelected = false;
  showArtistSuggestions = false;
  filteredArtistSuggestions: string[] = [];

  constructor(private soundService: SoundService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.sound) {
      this.prefillFromSound(this.sound);
      this.soundService.getCategories()
        .pipe(take(1))
        .subscribe({
          next: (cats) => { this.categories = cats; },
          error: () => { this.categories = []; }
        });
    }
  }

  private prefillFromSound(sound: Sound): void {
    this.editTag = sound.customTag || sound.title || '';
    this.editArtist = sound.artist || '';
    this.editCategory = sound.category || '';
    this.editIcon = sound.icon || '';
    this.editIconIsBase64 = sound.iconIsBase64 || false;
    this.editHideTitle = sound.hideTitle || false;
    this.iconPreviewUrl = this.editIcon
      ? (this.editIconIsBase64 ? `data:image/png;base64,${this.editIcon}` : this.editIcon)
      : '';
    this.errorMessage = '';
    this.isSaving = false;
    this.iconSelected = false;
    this.showArtistSuggestions = false;
    this.filteredArtistSuggestions = [];
  }

  close(): void {
    if (this.isSaving) return;
    this.closed.emit();
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
    const query = this.editArtist.trim().toLowerCase();
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
    const query = this.editArtist.trim().toLowerCase();
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
    this.editArtist = artist;
    this.showArtistSuggestions = false;
  }

  onCategoryChange(categoryName: string): void {
    this.editCategory = categoryName;
  }

  private static readonly ALLOWED_IMAGE_TYPES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'image/bmp', 'image/x-icon', 'image/svg+xml'
  ];
  private static readonly MAX_ICON_SIZE = 256;

  onIconSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (!EditDetailsModalComponent.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.errorMessage = 'Unsupported image type';
      return;
    }
    this.processIconFile(file);
    input.value = '';
  }

  onIconDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.iconDragOver = true;
  }

  onIconDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.iconDragOver = false;
  }

  onIconDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.iconDragOver = false;

    const file = event.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      this.errorMessage = 'Only image files can be dropped here';
      return;
    }
    if (!EditDetailsModalComponent.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.errorMessage = 'Unsupported image type';
      return;
    }
    this.processIconFile(file);
  }

  selectIcon(event: Event): void {
    event.stopPropagation();
    this.iconSelected = true;
    (event.target as HTMLElement).focus();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.iconSelected = false;
  }

  onIconKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
      event.preventDefault();
      this.pasteIconFromClipboard();
    }
  }

  private async pasteIconFromClipboard(): Promise<void> {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          this.processIconFile(blob);
          return;
        }
      }
      this.errorMessage = 'No image found in clipboard';
    } catch {
      this.errorMessage = 'Could not read clipboard. Make sure you have copied an image.';
    }
  }

  private processIconFile(file: Blob): void {
    const img = new Image();
    img.onload = () => {
      const max = EditDetailsModalComponent.MAX_ICON_SIZE;
      let { width, height } = img;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        this.editIcon = base64;
        this.editIconIsBase64 = true;
        this.iconPreviewUrl = dataUrl;
      }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  removeIcon(): void {
    this.editIcon = '';
    this.editIconIsBase64 = false;
    this.iconPreviewUrl = '';
  }

  save(): void {
    if (!this.sound || this.isSaving) return;
    const tag = this.editTag.trim();
    if (!tag) {
      this.errorMessage = 'Tag is required';
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';

    // Only pass category if it changed from the original
    const categoryChanged = this.editCategory !== this.sound.category;

    // Determine icon value: undefined means no change, empty string means remove
    let iconValue: string | undefined;
    const originalIcon = this.sound.icon || '';
    if (this.editIcon !== originalIcon) {
      iconValue = this.editIcon;
    }

    // Determine hideTitle value
    const hideTitleValue = this.editHideTitle !== (this.sound.hideTitle || false)
      ? this.editHideTitle
      : undefined;

    this.soundService.updateSoundDetails(
      this.sound.id,
      tag,
      this.editArtist.trim(),
      categoryChanged ? this.editCategory : undefined,
      iconValue,
      hideTitleValue
    ).pipe(take(1)).subscribe({
      next: (result: any) => {
        this.isSaving = false;
        if (result?.error) {
          this.errorMessage = result.error;
        } else {
          this.saved.emit();
        }
      },
      error: (err: any) => {
        this.isSaving = false;
        this.errorMessage = err?.error?.error || 'Failed to update sound details';
      }
    });
  }
}
