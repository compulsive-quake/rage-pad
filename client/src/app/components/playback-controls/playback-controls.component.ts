import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-playback-controls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="playback-controls">
      <div class="control-buttons">
        <button 
          class="control-btn stop-btn" 
          (click)="onStop()"
          title="Stop"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12"/>
          </svg>
        </button>
        
        <button 
          class="control-btn pause-btn" 
          (click)="onPause()"
          title="Pause/Resume"
        >
          <svg *ngIf="!isPaused" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
          <svg *ngIf="isPaused" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </button>
      </div>

      <div class="volume-control">
        <svg class="volume-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path *ngIf="volume > 50" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          <path *ngIf="volume > 0 && volume <= 50" d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
          <path *ngIf="volume === 0" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
        </svg>
        <input 
          type="range" 
          class="volume-slider"
          min="0" 
          max="100" 
          [(ngModel)]="volume"
          (change)="onVolumeChange()"
        />
        <span class="volume-value">{{ volume }}%</span>
      </div>
    </div>
  `,
  styles: [`
    .playback-controls {
      display: flex;
      align-items: center;
      gap: 2rem;
      padding: 1rem 1.5rem;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 50px;
      backdrop-filter: blur(10px);
    }

    .control-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .control-btn {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .control-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.05);
    }

    .control-btn:active {
      transform: scale(0.95);
    }

    .control-btn svg {
      width: 20px;
      height: 20px;
      color: #fff;
    }

    .stop-btn:hover {
      background: rgba(231, 76, 60, 0.3);
    }

    .stop-btn:hover svg {
      color: #e74c3c;
    }

    .pause-btn:hover {
      background: rgba(155, 89, 182, 0.3);
    }

    .pause-btn:hover svg {
      color: #9b59b6;
    }

    .volume-control {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .volume-icon {
      width: 20px;
      height: 20px;
      color: rgba(255, 255, 255, 0.7);
    }

    .volume-slider {
      width: 100px;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }

    .volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      background: #9b59b6;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .volume-slider::-webkit-slider-thumb:hover {
      transform: scale(1.2);
      background: #a569bd;
    }

    .volume-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      background: #9b59b6;
      border: none;
      border-radius: 50%;
      cursor: pointer;
    }

    .volume-value {
      min-width: 40px;
      font-size: 0.85rem;
      color: rgba(255, 255, 255, 0.7);
      text-align: right;
    }
  `]
})
export class PlaybackControlsComponent {
  @Input() isPaused = false;
  @Input() volume = 100;
  @Output() stop = new EventEmitter<void>();
  @Output() pause = new EventEmitter<void>();
  @Output() volumeChange = new EventEmitter<number>();

  onStop(): void {
    this.stop.emit();
  }

  onPause(): void {
    this.pause.emit();
  }

  onVolumeChange(): void {
    this.volumeChange.emit(this.volume);
  }
}
