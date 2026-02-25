import { Component, Input, Output, EventEmitter, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

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
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
          Edit Sound
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

      &.delete {
        color: #e74c3c;
      }

      &.delete:hover {
        background: rgba(231, 76, 60, 0.15);
      }
    }
  `]
})
export class ContextMenuComponent {
  @Input() visible = false;
  @Input() x = 0;
  @Input() y = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() editSound = new EventEmitter<void>();
  @Output() deleteSound = new EventEmitter<void>();

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

  onDelete(): void {
    this.deleteSound.emit();
  }
}
