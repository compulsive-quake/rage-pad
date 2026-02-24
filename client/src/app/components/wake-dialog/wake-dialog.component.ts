import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-wake-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './wake-dialog.component.html',
  styleUrls: ['./wake-dialog.component.scss']
})
export class WakeDialogComponent {
  @Input() isOpen = false;
  @Input() isUiDimmed = false;
  @Input() countdownSeconds = 300;
  @Output() dismissed = new EventEmitter<void>();

  formatWakeCountdown(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  onDismiss(): void {
    this.dismissed.emit();
  }
}
