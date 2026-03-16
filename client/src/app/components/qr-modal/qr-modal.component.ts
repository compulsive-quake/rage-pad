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

  activeTab: 'browser' | 'android' = 'browser';

  qrDataUrl = '';
  serverUrl = '';
  isLoading = false;
  error = '';

  androidQrDataUrl = '';
  androidUrl = '';
  isAndroidLoading = false;
  androidError = '';

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
      this.loadAndroidQr();
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  switchTab(tab: 'browser' | 'android'): void {
    this.activeTab = tab;
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

  private loadAndroidQr(): void {
    this.isAndroidLoading = true;
    this.androidError = '';
    this.soundService.getAndroidQr()
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          this.androidQrDataUrl = data.qrDataUrl;
          this.androidUrl = data.url;
          this.isAndroidLoading = false;
        },
        error: () => {
          this.androidError = 'Failed to generate QR code';
          this.isAndroidLoading = false;
        }
      });
  }
}
