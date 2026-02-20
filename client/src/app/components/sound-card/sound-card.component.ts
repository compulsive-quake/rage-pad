import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sound } from '../../models/sound.model';

@Component({
  selector: 'app-sound-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button class="sound-button" [class.playing]="isPlaying" (click)="onPlay()">
      <span class="sound-title">{{ sound.title }}</span>
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
      transition: all 0.3s ease;
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
  `]
})
export class SoundCardComponent {
  @Input() sound!: Sound;
  @Input() isPlaying = false;
  @Output() play = new EventEmitter<Sound>();

  onPlay(): void {
    this.play.emit(this.sound);
  }
}
