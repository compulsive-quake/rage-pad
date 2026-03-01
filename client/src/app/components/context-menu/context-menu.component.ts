import { Component, Input, Output, EventEmitter, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sound } from '../../models/sound.model';

@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="context-menu-backdrop"
      *ngIf="visible"
      (click)="close()"
      (contextmenu)="onBackdropRightClick($event)"
    >
      <div
        class="context-menu"
        [style.left.px]="x"
        [style.top.px]="y"
        (click)="$event.stopPropagation()"
      >
        <button class="context-menu-item edit" (click)="onEdit()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z"/>
          </svg>
          Edit Sound
        </button>
        <button class="context-menu-item rename" (click)="onRename()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z"/>
          </svg>
          Rename Sound
        </button>
        <button *ngIf="nsfwModeEnabled" class="context-menu-item nsfw" (click)="onToggleNsfw()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
          </svg>
          {{ sound?.nsfw ? 'Unmark NSFW' : 'Mark as NSFW' }}
        </button>
        <button class="context-menu-item delete" (click)="onDelete()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          Delete Sound
        </button>
      </div>
    </div>
  `,
  styles: [`
    .context-menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9999;
    }

    .context-menu {
      position: fixed;
      min-width: 160px;
      background: #1e1e2e;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 4px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }

    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      background: none;
      border: none;
      color: #e0e0e0;
      font-size: 0.85rem;
      cursor: pointer;
      border-radius: 6px;
      transition: background 0.15s;

      svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      &:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      &.edit {
        color: #3498db;
      }

      &.edit:hover {
        background: rgba(52, 152, 219, 0.15);
      }

      &.rename {
        color: #f39c12;
      }

      &.rename:hover {
        background: rgba(243, 156, 18, 0.15);
      }

      &.delete {
        color: #e74c3c;
      }

      &.delete:hover {
        background: rgba(231, 76, 60, 0.15);
      }

      &.nsfw {
        color: #e74c3c;
      }

      &.nsfw:hover {
        background: rgba(231, 76, 60, 0.15);
      }
    }
  `]
})
export class ContextMenuComponent {
  @Input() visible = false;
  @Input() x = 0;
  @Input() y = 0;
  @Input() sound: Sound | null = null;
  @Input() nsfwModeEnabled = false;
  @Output() closed = new EventEmitter<void>();
  @Output() editSound = new EventEmitter<void>();
  @Output() renameSound = new EventEmitter<void>();
  @Output() deleteSound = new EventEmitter<void>();
  @Output() toggleNsfw = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible) this.close();
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropRightClick(event: MouseEvent): void {
    event.preventDefault();
    this.close();
  }

  onEdit(): void {
    this.editSound.emit();
  }

  onRename(): void {
    this.renameSound.emit();
  }

  onDelete(): void {
    this.deleteSound.emit();
  }

  onToggleNsfw(): void {
    this.toggleNsfw.emit();
  }
}
