import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { VBCableBannerComponent } from '../vbcable-banner/vbcable-banner.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, SearchBarComponent, VBCableBannerComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  @Input() isLoading = false;
  @Input() isReorderMode = false;
  @Input() isQueueMode = false;
  @Input() queueLength = 0;
  @Input() playbackProgress = 0;
  @Input() showVBCableBanner = false;

  isFullscreen = false;

  @Output() search = new EventEmitter<string>();
  @Output() refresh = new EventEmitter<void>();
  @Output() toggleReorderMode = new EventEmitter<void>();
  @Output() toggleQueueMode = new EventEmitter<void>();
  @Output() toggleSettings = new EventEmitter<void>();
  @Output() addSound = new EventEmitter<void>();
  @Output() vbcableDismissed = new EventEmitter<void>();
  @Output() vbcableInstalled = new EventEmitter<void>();

  onSearch(query: string): void {
    this.search.emit(query);
  }

  onRefresh(): void {
    this.refresh.emit();
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
