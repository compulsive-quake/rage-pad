import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { SoundpadService } from '../../services/soundpad.service';
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
  editTitle = '';
  editArtist = '';
  editCategory = '';
  categories: { name: string; parentCategory: string }[] = [];
  errorMessage = '';
  isSaving = false;

  showArtistSuggestions = false;
  filteredArtistSuggestions: string[] = [];

  constructor(private soundpadService: SoundpadService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.sound) {
      this.prefillFromSound(this.sound);
      this.soundpadService.getCategories()
        .pipe(take(1))
        .subscribe({
          next: (cats) => { this.categories = cats; },
          error: () => { this.categories = []; }
        });
    }
  }

  private prefillFromSound(sound: Sound): void {
    this.editTag = sound.customTag || sound.title || '';
    this.editTitle = sound.rawTitle || '';
    this.editArtist = sound.artist || '';
    this.editCategory = sound.category || '';
    this.errorMessage = '';
    this.isSaving = false;
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

    this.soundpadService.updateSoundDetails(
      this.sound.index,
      tag,
      this.editArtist.trim(),
      this.editTitle.trim(),
      categoryChanged ? this.editCategory : undefined
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
