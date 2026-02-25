import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchBarComponent } from '../search-bar/search-bar.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, SearchBarComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  @Input() isLoading = false;
  @Input() isRenameMode = false;
  @Input() isReorderMode = false;
  @Input() playbackProgress = 0;

  @Output() search = new EventEmitter<string>();
  @Output() refresh = new EventEmitter<void>();
  @Output() toggleRenameMode = new EventEmitter<void>();
  @Output() toggleReorderMode = new EventEmitter<void>();
  @Output() toggleSettings = new EventEmitter<void>();
  @Output() addSound = new EventEmitter<void>();
  @Output() showQrCode = new EventEmitter<void>();

  onSearch(query: string): void {
    this.search.emit(query);
  }

  onRefresh(): void {
    this.refresh.emit();
  }

  onToggleRenameMode(): void {
    this.toggleRenameMode.emit();
  }

  onToggleReorderMode(): void {
    this.toggleReorderMode.emit();
  }

  onToggleSettings(): void {
    this.toggleSettings.emit();
  }

  onAddSound(): void {
    this.addSound.emit();
  }

  onShowQrCode(): void {
    this.showQrCode.emit();
  }
}
