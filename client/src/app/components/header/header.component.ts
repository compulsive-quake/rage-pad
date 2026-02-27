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
  @Input() isQueueMode = false;
  @Input() queueLength = 0;
  @Input() playbackProgress = 0;

  isFullscreen = false;

  @Output() search = new EventEmitter<string>();
  @Output() refresh = new EventEmitter<void>();
  @Output() toggleRenameMode = new EventEmitter<void>();
  @Output() toggleReorderMode = new EventEmitter<void>();
  @Output() toggleQueueMode = new EventEmitter<void>();
  @Output() toggleSettings = new EventEmitter<void>();
  @Output() addSound = new EventEmitter<void>();

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

  onToggleQueueMode(): void {
    this.toggleQueueMode.emit();
  }

  onToggleSettings(): void {
    this.toggleSettings.emit();
  }

  onAddSound(): void {
    this.addSound.emit();
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      this.isFullscreen = false;
    } else {
      document.documentElement.requestFullscreen();
      this.isFullscreen = true;
    }
  }
}
