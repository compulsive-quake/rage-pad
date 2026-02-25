import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { take } from 'rxjs';
import { SoundpadService } from '../../services/soundpad.service';

@Component({
  selector: 'app-qr-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './qr-modal.component.html',
  styleUrls: ['./qr-modal.component.scss']
})
export class QrModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();

  qrDataUrl = '';
  serverUrl = '';
  isLoading = false;
  error = '';

  constructor(private soundpadService: SoundpadService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.loadQrCode();
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  private loadQrCode(): void {
    this.isLoading = true;
    this.error = '';
    this.soundpadService.getQrCode()
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          this.qrDataUrl = data.qrDataUrl;
          this.serverUrl = data.url;
          this.isLoading = false;
        },
        error: () => {
          this.error = 'Failed to generate QR code';
          this.isLoading = false;
        }
      });
  }
}
