import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sound } from '../../models/sound.model';

@Component({
  selector: 'app-sound-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="sound-button"
      [class.playing]="isPlaying"
      [class.rename-mode]="isRenameMode"
      (click)="onClick()"
      (contextmenu)="onContextMenu($event)"
    >
      <span class="sound-title">{{ sound.title }}</span>
      <span class="rename-badge" *ngIf="isRenameMode" title="Click to rename">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
      </span>
    </button>
  `,
  styles: [`
    .sound-button {
      width: 120px;
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.75rem;
      background: linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      cursor: pointer;
      transition: box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s ease;
      position: relative;
    }

    .sound-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
      border-color: rgba(138, 43, 226, 0.5);
      background: linear-gradient(135deg, #2a2a3e 0%, #3d3d54 100%);
    }

    .sound-button:active {
      transform: translateY(0);
    }

    .sound-button.playing {
      background: linear-gradient(135deg, #4a1a6b 0%, #6b2d9e 100%);
      border-color: #9b59b6;
      box-shadow: 0 0 20px rgba(155, 89, 182, 0.4);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .sound-button.rename-mode {
      border-color: rgba(52, 152, 219, 0.6);
      background: linear-gradient(135deg, #1a2a3e 0%, #1e3a54 100%);
    }

    .sound-button.rename-mode:hover {
      border-color: #3498db;
      background: linear-gradient(135deg, #1e3248 0%, #244460 100%);
      box-shadow: 0 8px 25px rgba(52, 152, 219, 0.25);
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 20px rgba(155, 89, 182, 0.4); }
      50% { box-shadow: 0 0 30px rgba(155, 89, 182, 0.6); }
    }

    .sound-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: #fff;
      text-align: center;
      word-break: break-word;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      line-height: 1.3;
    }

    .sound-button.playing .sound-title {
      color: #fff;
    }

    .rename-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 20px;
      height: 20px;
      background: rgba(52, 152, 219, 0.85);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;

      svg {
        width: 11px;
        height: 11px;
        color: #fff;
      }
    }

  `]
})
export class SoundCardComponent {
  @Input() sound!: Sound;
  @Input() isPlaying = false;
  @Input() isRenameMode = false;
  @Output() play = new EventEmitter<Sound>();
  @Output() rename = new EventEmitter<Sound>();
  @Output() soundContextMenu = new EventEmitter<{ sound: Sound; event: MouseEvent }>();

  onClick(): void {
    if (this.isRenameMode) {
      this.rename.emit(this.sound);
    } else {
      this.play.emit(this.sound);
    }
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.soundContextMenu.emit({ sound: this.sound, event });
  }

}
