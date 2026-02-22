import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConnectionStatusComponent } from '../connection-status/connection-status.component';

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

  @Output() stop = new EventEmitter<void>();
  @Output() togglePause = new EventEmitter<void>();
  @Output() volumeChange = new EventEmitter<number>();
  @Output() playbackModeChange = new EventEmitter<'both' | 'mic' | 'speakers'>();

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

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
