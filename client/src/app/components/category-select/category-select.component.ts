import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CategoryIcon } from '../../models/sound.model';

@Component({
  selector: 'app-category-select',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-select.component.html',
  styleUrls: ['./category-select.component.scss']
})
export class CategorySelectComponent {
  @Input() categories: { name: string; parentCategory: string }[] = [];
  @Input() categoryIconsMap: Map<string, CategoryIcon> = new Map();
  @Input() selected = '';
  @Output() selectionChange = new EventEmitter<string>();

  isDropdownOpen = false;

  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  selectCategory(categoryName: string): void {
    this.selectionChange.emit(categoryName);
    this.isDropdownOpen = false;
  }

  onBlur(): void {
    setTimeout(() => {
      this.isDropdownOpen = false;
    }, 150);
  }

  getCategoryImageUrl(categoryName: string): string {
    const icon = this.categoryIconsMap.get(categoryName);
    if (!icon || !icon.icon) return '';
    if (icon.isBase64) {
      return `data:image/png;base64,${icon.icon}`;
    }
    if (!icon.icon.startsWith('stock_')) {
      return `http://localhost:3000/api/category-image?path=${encodeURIComponent(icon.icon)}`;
    }
    return '';
  }
}
