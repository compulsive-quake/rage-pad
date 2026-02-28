import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SoundService, VBCableInstallProgress } from '../../services/sound.service';

export type VBCableBannerState = 'warning' | 'downloading' | 'extracting' | 'installing' | 'done' | 'error';

@Component({
  selector: 'app-vbcable-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './vbcable-banner.component.html',
  styleUrls: ['./vbcable-banner.component.scss']
})
export class VBCableBannerComponent {
  @Output() dismissed = new EventEmitter<void>();
  @Output() installed = new EventEmitter<void>();

  state: VBCableBannerState = 'warning';
  downloadPercent = 0;
  errorMessage = '';

  constructor(private soundService: SoundService) {}

  onInstall(): void {
    this.state = 'downloading';
    this.downloadPercent = 0;
    this.errorMessage = '';

    this.soundService.installVBCable().subscribe({
      next: (event: VBCableInstallProgress) => {
        switch (event.type) {
          case 'progress':
            this.state = 'downloading';
            this.downloadPercent = event.percent || 0;
            break;
          case 'extracting':
            this.state = 'extracting';
            break;
          case 'installing':
            this.state = 'installing';
            break;
          case 'done':
            this.state = 'done';
            this.installed.emit();
            break;
        }
      },
      error: (err: Error) => {
        this.state = 'error';
        this.errorMessage = err.message || 'Installation failed';
      }
    });
  }

  onRetry(): void {
    this.onInstall();
  }

  onDismiss(): void {
    this.dismissed.emit();
  }
}
