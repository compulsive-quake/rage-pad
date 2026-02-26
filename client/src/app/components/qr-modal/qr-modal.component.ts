import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { take } from 'rxjs';
import { SoundService } from '../../services/sound.service';

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
  private mouseDownOnOverlay = false;

  constructor(private soundService: SoundService) {}

  onOverlayMouseDown(event: MouseEvent): void {
    this.mouseDownOnOverlay = event.target === event.currentTarget;
  }

  onOverlayMouseUp(event: MouseEvent): void {
    if (this.mouseDownOnOverlay && event.target === event.currentTarget) {
      this.onClose();
    }
    this.mouseDownOnOverlay = false;
  }

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
    this.soundService.getQrCode()
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
