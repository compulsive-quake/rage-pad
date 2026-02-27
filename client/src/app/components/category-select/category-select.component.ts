import { Component, Input, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoryIcon } from '../../models/sound.model';

@Component({
  selector: 'app-category-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './category-select.component.html',
  styleUrls: ['./category-select.component.scss']
})
export class CategorySelectComponent {
  @Input() categories: { name: string; parentCategory: string }[] = [];
  @Input() categoryIconsMap: Map<string, CategoryIcon> = new Map();
  @Input() selected = '';
  @Output() selectionChange = new EventEmitter<string>();
  @Output() categoryCreated = new EventEmitter<string>();

  @ViewChild('newCategoryInput') newCategoryInput!: ElementRef<HTMLInputElement>;

  isDropdownOpen = false;
  isCreating = false;
  newCategoryName = '';

  toggleDropdown(): void {
    if (this.isDropdownOpen) {
      this.isDropdownOpen = false;
      this.cancelCreate();
    } else {
      this.isDropdownOpen = true;
    }
  }

  selectCategory(categoryName: string): void {
    this.selectionChange.emit(categoryName);
    this.isDropdownOpen = false;
    this.cancelCreate();
  }

  onBlur(event: FocusEvent): void {
    const relatedTarget = event.relatedTarget as HTMLElement;
    // If focus is moving to an element inside the dropdown, don't close
    if (relatedTarget?.closest('.custom-category-select')) {
      return;
    }
    setTimeout(() => {
      if (this.isCreating) {
        return;
      }
      this.isDropdownOpen = false;
      this.cancelCreate();
    }, 150);
  }

  startCreate(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCreating = true;
    this.newCategoryName = '';
    setTimeout(() => this.newCategoryInput?.nativeElement?.focus(), 0);
  }

  confirmCreate(): void {
    const name = this.newCategoryName.trim();
    if (!name) return;

    const exists = this.categories.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      this.categories.push({ name, parentCategory: '' });
      this.categoryCreated.emit(name);
    }

    this.selectionChange.emit(name);
    this.isDropdownOpen = false;
    this.isCreating = false;
    this.newCategoryName = '';
  }

  cancelCreate(): void {
    this.isCreating = false;
    this.newCategoryName = '';
  }

  onCreateInputBlur(event: FocusEvent): void {
    const relatedTarget = event.relatedTarget as HTMLElement;
    // If focus is moving to an element inside the dropdown, don't save yet
    if (relatedTarget?.closest('.custom-category-select')) {
      return;
    }
    // Save and close when focus leaves the component (click outside)
    const name = this.newCategoryName.trim();
    if (name) {
      this.confirmCreate();
    } else {
      this.cancelCreate();
      this.isDropdownOpen = false;
    }
  }

  onCreateRowMousedown(event: MouseEvent): void {
    // Allow default mousedown on the input (enables text selection)
    // but prevent it on the surrounding row (prevents blur/close)
    if ((event.target as HTMLElement).tagName !== 'INPUT') {
      event.preventDefault();
    }
  }

  onCreateInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmCreate();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelCreate();
    }
  }

  getCategoryImageUrl(categoryName: string): string {
    const icon = this.categoryIconsMap.get(categoryName);
    if (!icon || !icon.icon) return '';
    if (icon.isBase64) {
      return `data:image/png;base64,${icon.icon}`;
    }
    return '';
  }
}
