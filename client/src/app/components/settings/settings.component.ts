import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { APP_VERSION, SoundpadService } from '../../services/soundpad.service';

export interface SettingsPayload {
  configWatchEnabled: boolean;
  autoLaunchEnabled: boolean;
  keepAwakeEnabled: boolean;
  idleTimeoutEnabled: boolean;
  wakeMinutes: number;
  autoUpdateCheckEnabled: boolean;
  updateCheckIntervalMinutes: number;
  serverPort: number;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit, OnChanges {
  // Current (committed) values from parent
  @Input() configWatchEnabled = false;
  @Input() autoLaunchEnabled = false;
  @Input() keepAwakeEnabled = false;
  @Input() idleTimeoutEnabled = false;
  @Input() wakeMinutes = 30;
  @Input() autoUpdateCheckEnabled = true;
  @Input() updateCheckIntervalMinutes = 60;
  @Input() serverPort = 3000;
  @Input() isPortChanging = false;
  @Input() portChangeError = '';
  @Input() isRestarting = false;
  @Input() isCheckingForUpdate = false;
  @Input() latestVersion = '';
  @Input() updateAvailable = false;

  // Events
  @Output() saveSettings = new EventEmitter<SettingsPayload>();
  @Output() restartSoundpad = new EventEmitter<void>();
  @Output() closeSettings = new EventEmitter<void>();
  @Output() checkForUpdates = new EventEmitter<void>();

  // Draft (pending) values – user edits these
  draftConfigWatch = false;
  draftAutoLaunch = false;
  draftKeepAwake = false;
  draftIdleTimeout = false;
  draftWakeMinutes = 30;
  draftAutoUpdateCheck = true;
  draftUpdateCheckInterval = 60;
  intervalPreset: string = '60';
  draftServerPort = 3000;

  // Version
  readonly appVersion = APP_VERSION;

  // Version info dialog
  showVersionDialog = false;

  // Discard confirmation dialog
  showDiscardDialog = false;

  // QR code
  qrDataUrl = '';
  qrServerUrl = '';
  isLoadingQr = false;

  constructor(private soundpadService: SoundpadService) {}

  ngOnInit(): void {
    this.loadQrCode();
    this.snapshotDraft();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When parent updates inputs (e.g. after a save), re-snapshot
    if (changes['configWatchEnabled'] || changes['autoLaunchEnabled'] ||
        changes['keepAwakeEnabled'] || changes['idleTimeoutEnabled'] || changes['wakeMinutes'] ||
        changes['autoUpdateCheckEnabled'] || changes['updateCheckIntervalMinutes'] || changes['serverPort']) {
      this.snapshotDraft();
    }

    // When a manual update check finishes (isCheckingForUpdate goes true→false), show dialog if up to date
    const checkChange = changes['isCheckingForUpdate'];
    if (checkChange && checkChange.previousValue === true && checkChange.currentValue === false && !this.updateAvailable) {
      this.showVersionDialog = true;
    }
  }

  /** Copy current committed values into draft state */
  private snapshotDraft(): void {
    this.draftConfigWatch = this.configWatchEnabled;
    this.draftAutoLaunch = this.autoLaunchEnabled;
    this.draftKeepAwake = this.keepAwakeEnabled;
    this.draftIdleTimeout = this.idleTimeoutEnabled;
    this.draftWakeMinutes = this.wakeMinutes;
    this.draftAutoUpdateCheck = this.autoUpdateCheckEnabled;
    this.draftUpdateCheckInterval = this.updateCheckIntervalMinutes;
    this.intervalPreset = [30, 60, 1440].includes(this.updateCheckIntervalMinutes)
      ? String(this.updateCheckIntervalMinutes) : 'custom';
    this.draftServerPort = this.serverPort;
  }

  /** Whether any draft value differs from the committed value */
  get hasChanges(): boolean {
    return this.draftConfigWatch !== this.configWatchEnabled ||
           this.draftAutoLaunch !== this.autoLaunchEnabled ||
           this.draftKeepAwake !== this.keepAwakeEnabled ||
           this.draftIdleTimeout !== this.idleTimeoutEnabled ||
           this.draftWakeMinutes !== this.wakeMinutes ||
           this.draftAutoUpdateCheck !== this.autoUpdateCheckEnabled ||
           this.draftUpdateCheckInterval !== this.updateCheckIntervalMinutes ||
           this.draftServerPort !== this.serverPort;
  }

  // ── Draft change handlers ──────────────────────────────────────────────

  onToggleConfigWatch(): void {
    this.draftConfigWatch = !this.draftConfigWatch;
  }

  onToggleAutoLaunch(): void {
    this.draftAutoLaunch = !this.draftAutoLaunch;
  }

  onToggleKeepAwake(): void {
    this.draftKeepAwake = !this.draftKeepAwake;
  }

  onToggleIdleTimeout(): void {
    this.draftIdleTimeout = !this.draftIdleTimeout;
  }

  onWakeMinutesChange(value: number): void {
    this.draftWakeMinutes = value;
  }

  onToggleAutoUpdateCheck(): void {
    this.draftAutoUpdateCheck = !this.draftAutoUpdateCheck;
  }

  onIntervalPresetChange(preset: string): void {
    this.intervalPreset = preset;
    if (preset !== 'custom') {
      this.draftUpdateCheckInterval = Number(preset);
    }
  }

  onCustomIntervalChange(value: number): void {
    this.draftUpdateCheckInterval = value;
  }

  onServerPortChange(value: number): void {
    this.draftServerPort = value;
  }

  onCheckForUpdates(): void {
    this.checkForUpdates.emit();
  }

  closeVersionDialog(): void {
    this.showVersionDialog = false;
  }

  // ── Save ───────────────────────────────────────────────────────────────

  onSave(): void {
    this.saveSettings.emit({
      configWatchEnabled: this.draftConfigWatch,
      autoLaunchEnabled: this.draftAutoLaunch,
      keepAwakeEnabled: this.draftKeepAwake,
      idleTimeoutEnabled: this.draftIdleTimeout,
      wakeMinutes: this.draftWakeMinutes,
      autoUpdateCheckEnabled: this.draftAutoUpdateCheck,
      updateCheckIntervalMinutes: this.draftUpdateCheckInterval,
      serverPort: this.draftServerPort
    });
  }

  // ── Restart (immediate action, not a setting) ─────────────────────────

  onRestartSoundpad(): void {
    this.restartSoundpad.emit();
  }

  // ── Close with unsaved-changes guard ──────────────────────────────────

  onClose(): void {
    if (this.hasChanges) {
      this.showDiscardDialog = true;
    } else {
      this.closeSettings.emit();
    }
  }

  onDiscardConfirm(): void {
    this.showDiscardDialog = false;
    this.snapshotDraft(); // reset draft to committed values
    this.closeSettings.emit();
  }

  onDiscardCancel(): void {
    this.showDiscardDialog = false;
  }

  // ── QR code ─────────────────────────────────────────────────────────────

  private loadQrCode(): void {
    this.isLoadingQr = true;
    this.soundpadService.getQrCode()
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          this.qrDataUrl = data.qrDataUrl;
          this.qrServerUrl = data.url;
          this.isLoadingQr = false;
        },
        error: () => {
          this.isLoadingQr = false;
        }
      });
  }
}
