import { Component, Input, Output, EventEmitter, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { ConnectionStatusComponent } from '../connection-status/connection-status.component';
import { SoundpadService } from '../../services/soundpad.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, FormsModule, ConnectionStatusComponent],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {
  @Input() isConnected = false;
  @Input() currentlyPlayingIndex: number | null = null;
  @Input() isPaused = false;
  @Input() playbackProgress = 0;
  @Input() playbackTimeRemaining = 0;
  @Input() volume = 100;
  @Input() playbackMode: 'both' | 'mic' | 'speakers' = 'both';

  /** Whether auto-launch is enabled (controls visibility of manual start button) */
  @Input() autoLaunchEnabled = true;
  /** True while a launch attempt is in progress */
  @Input() isLaunching = false;
  /** Error message to show in the footer when auto-launch fails */
  @Input() launchErrorMessage = '';
  /** Seconds remaining until the next auto-launch retry */
  @Input() launchRetryCountdown = 0;

  /** Update notification inputs */
  @Input() updateAvailable = false;
  @Input() latestVersion = '';
  @Input() downloadUrl = '';

  /** Download state */
  isDownloading = false;
  downloadPercent = 0;
  downloadDone = false;
  downloadError = '';

  @Output() stop = new EventEmitter<void>();
  @Output() togglePause = new EventEmitter<void>();
  @Output() volumeChange = new EventEmitter<number>();
  @Output() playbackModeChange = new EventEmitter<'both' | 'mic' | 'speakers'>();
  /** Emitted when the user clicks the manual "Start Soundpad" button */
  @Output() manualLaunch = new EventEmitter<void>();
  /** Emitted when the user dismisses the update banner */
  @Output() dismissUpdate = new EventEmitter<void>();

  constructor(private soundpadService: SoundpadService, private ngZone: NgZone) {}

  onStop(): void {
    this.stop.emit();
  }

  onTogglePause(): void {
    this.togglePause.emit();
  }

  onVolumeChange(value: number): void {
    this.volumeChange.emit(value);
  }

  onSetPlaybackMode(mode: 'both' | 'mic' | 'speakers'): void {
    this.playbackModeChange.emit(mode);
  }

  onManualLaunch(): void {
    this.manualLaunch.emit();
  }

  onDismissUpdate(): void {
    this.dismissUpdate.emit();
  }

  onDownloadUpdate(): void {
    if (this.isDownloading || this.downloadDone || !this.downloadUrl) return;
    this.isDownloading = true;
    this.downloadPercent = 0;
    this.downloadError = '';

    const apiUrl = `${window.location.origin}/api/download-update?url=${encodeURIComponent(this.downloadUrl)}`;
    const es = new EventSource(apiUrl);

    es.addEventListener('progress', (e: MessageEvent) => {
      this.ngZone.run(() => {
        const data = JSON.parse(e.data);
        this.downloadPercent = data.percent;
      });
    });

    es.addEventListener('done', () => {
      this.ngZone.run(() => {
        this.downloadDone = true;
        this.isDownloading = false;
        es.close();
      });
    });

    es.addEventListener('error', (e: any) => {
      this.ngZone.run(() => {
        // SSE 'error' can fire for both custom error events and connection loss
        if (e.data) {
          const data = JSON.parse(e.data);
          this.downloadError = data.message || 'Download failed';
        } else {
          this.downloadError = 'Download connection lost';
        }
        this.isDownloading = false;
        es.close();
      });
    });
  }

  onLaunchInstaller(): void {
    this.soundpadService.launchInstaller()
      .pipe(take(1))
      .subscribe({
        error: () => {
          this.downloadError = 'Failed to launch installer';
          this.downloadDone = false;
        }
      });
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
