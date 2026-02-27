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
      [class.queued]="queuePositions.length > 0"
      [class.has-icon]="iconUrl"
      [class.hide-title]="sound.hideTitle"
      [class.icon-drag-over]="isIconDragOver"
      [style.backgroundImage]="iconUrl ? 'url(' + iconUrl + ')' : ''"
      (click)="onClick()"
      (contextmenu)="onContextMenu($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <span class="sound-title">{{ sound.title }}</span>
      <span class="rename-badge" *ngIf="isRenameMode" title="Click to rename">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
      </span>
      <span class="queue-badge" *ngIf="queuePositions.length > 0">{{ queuePositions.join(', ') }}</span>
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

    .queue-badge {
      position: absolute;
      top: 6px;
      left: 6px;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      background: rgba(230, 126, 34, 0.92);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      font-size: 0.7rem;
      font-weight: 700;
      color: #fff;
      line-height: 1;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      animation: queueBadgeIn 0.2s ease-out;
    }

    @keyframes queueBadgeIn {
      from { transform: scale(0); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .sound-button.queued {
      border-color: rgba(230, 126, 34, 0.5);
    }

    .sound-button.icon-drag-over {
      border-color: #f39c12;
      box-shadow: 0 0 16px rgba(243, 156, 18, 0.4);
    }

    .sound-button.has-icon {
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }

    .sound-button.has-icon:hover {
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      background-color: transparent;
    }

    .sound-button.has-icon.playing {
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }

    .has-icon .sound-title {
      text-shadow: 0 1px 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.95);
      font-weight: 700;
    }

    .sound-button.hide-title .sound-title {
      display: none;
    }

    .sound-button.has-icon.playing::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(74, 26, 107, 0.5);
      border-radius: 11px;
      pointer-events: none;
    }

    .sound-button.has-icon:hover::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(42, 42, 62, 0.35);
      border-radius: 11px;
      pointer-events: none;
    }

  `]
})
export class SoundCardComponent {
  @Input() sound!: Sound;
  @Input() isPlaying = false;
  @Input() isRenameMode = false;
  @Input() queuePositions: number[] = [];
  @Output() play = new EventEmitter<Sound>();
  @Output() rename = new EventEmitter<Sound>();
  @Output() soundContextMenu = new EventEmitter<{ sound: Sound; event: MouseEvent }>();
  @Output() iconDropped = new EventEmitter<{ sound: Sound; iconBase64: string }>();

  isIconDragOver = false;

  private static readonly ALLOWED_IMAGE_TYPES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'image/bmp', 'image/x-icon', 'image/svg+xml'
  ];
  private static readonly MAX_ICON_SIZE = 256;

  get iconUrl(): string {
    if (!this.sound.icon) return '';
    if (this.sound.iconIsBase64) {
      return `data:image/png;base64,${this.sound.icon}`;
    }
    return this.sound.icon;
  }

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

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.isIconDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isIconDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isIconDragOver = false;

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!SoundCardComponent.ALLOWED_IMAGE_TYPES.includes(file.type)) return;

    const img = new Image();
    img.onload = () => {
      const max = SoundCardComponent.MAX_ICON_SIZE;
      let { width, height } = img;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        this.iconDropped.emit({ sound: this.sound, iconBase64: base64 });
      }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

}
