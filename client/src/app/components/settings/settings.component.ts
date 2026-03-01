import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { APP_VERSION, SoundService, VBCableStatus, YoutubeCacheInfo } from '../../services/sound.service';
import { AudioDevices } from '../../models/sound.model';

export interface SettingsPayload {
  keepAwakeEnabled: boolean;
  idleTimeoutEnabled: boolean;
  wakeMinutes: number;
  autoUpdateCheckEnabled: boolean;
  updateCheckIntervalMinutes: number;
  serverPort: number;
  audioInputDevice: string;
  audioOutputDevice: string;
  youtubeCachePath: string;
  youtubeCacheTtlMinutes: number;
  youtubeCacheMaxSizeMb: number;
  nsfwModeEnabled: boolean;
  storeServerUrl: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit, OnChanges {
  @Input() keepAwakeEnabled = false;
  @Input() idleTimeoutEnabled = false;
  @Input() wakeMinutes = 30;
  @Input() autoUpdateCheckEnabled = true;
  @Input() updateCheckIntervalMinutes = 60;
  @Input() serverPort = 8088;
  @Input() isPortChanging = false;
  @Input() portChangeError = '';
  @Input() isCheckingForUpdate = false;
  @Input() latestVersion = '';
  @Input() updateAvailable = false;
  @Input() nsfwModeEnabled = false;
  @Input() storeServerUrl = 'http://localhost:9090';

  @Output() saveSettings = new EventEmitter<SettingsPayload>();
  @Output() closeSettings = new EventEmitter<void>();
  @Output() checkForUpdates = new EventEmitter<void>();

  // Draft (pending) values
  draftKeepAwake = false;
  draftIdleTimeout = false;
  draftWakeMinutes = 30;
  draftAutoUpdateCheck = true;
  draftUpdateCheckInterval = 60;
  intervalPreset: string = '60';
  draftServerPort = 8088;
  draftInputDevice = '';
  draftOutputDevice = '';
  draftNsfwMode = false;
  draftStoreServerUrl = 'http://localhost:9090';
  currentStoreServerUrl = 'http://localhost:9090';

  // YouTube cache draft values
  draftYoutubeCachePath = '';
  draftYoutubeCacheTtl = 4320;
  draftYoutubeCacheMaxSize = 100;
  currentYoutubeCachePath = '';
  currentYoutubeCacheTtl = 4320;
  currentYoutubeCacheMaxSize = 100;
  dataDir = '';

  // YouTube cache info
  cacheInfo: YoutubeCacheInfo | null = null;
  isClearingCache = false;
  cacheClearMessage = '';

  // Audio devices
  audioDevices: AudioDevices = { input: [], output: [] };
  currentInputDevice = '';
  currentOutputDevice = '';

  // VB-Cable status
  vbCableStatus: VBCableStatus | null = null;
  isRefreshingVBCable = false;

  // Version
  readonly appVersion = APP_VERSION;

  // Tabs
  activeTab: 'general' | 'audio' | 'youtube' | 'updates' = 'general';

  // Version info dialog
  showVersionDialog = false;

  // Discard confirmation dialog
  showDiscardDialog = false;

  // QR code
  qrDataUrl = '';
  qrServerUrl = '';
  isLoadingQr = false;

  constructor(private soundService: SoundService) {}

  ngOnInit(): void {
    this.loadQrCode();
    this.loadAudioDevices();
    this.loadAudioSettings();
    this.loadYoutubeCacheInfo();
    this.loadVBCableStatus();
    this.snapshotDraft();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['keepAwakeEnabled'] || changes['idleTimeoutEnabled'] || changes['wakeMinutes'] ||
        changes['autoUpdateCheckEnabled'] || changes['updateCheckIntervalMinutes'] || changes['serverPort'] ||
        changes['nsfwModeEnabled'] || changes['storeServerUrl']) {
      this.snapshotDraft();
    }

    const checkChange = changes['isCheckingForUpdate'];
    if (checkChange && checkChange.previousValue === true && checkChange.currentValue === false && !this.updateAvailable) {
      this.showVersionDialog = true;
    }
  }

  private snapshotDraft(): void {
    this.draftKeepAwake = this.keepAwakeEnabled;
    this.draftIdleTimeout = this.idleTimeoutEnabled;
    this.draftWakeMinutes = this.wakeMinutes;
    this.draftAutoUpdateCheck = this.autoUpdateCheckEnabled;
    this.draftUpdateCheckInterval = this.updateCheckIntervalMinutes;
    this.intervalPreset = [30, 60, 1440].includes(this.updateCheckIntervalMinutes)
      ? String(this.updateCheckIntervalMinutes) : 'custom';
    this.draftServerPort = this.serverPort;
    this.draftNsfwMode = this.nsfwModeEnabled;
    this.draftStoreServerUrl = this.storeServerUrl;
    this.currentStoreServerUrl = this.storeServerUrl;
    this.draftInputDevice = this.currentInputDevice;
    this.draftOutputDevice = this.currentOutputDevice;
    this.draftYoutubeCachePath = this.currentYoutubeCachePath;
    this.draftYoutubeCacheTtl = this.currentYoutubeCacheTtl;
    this.draftYoutubeCacheMaxSize = this.currentYoutubeCacheMaxSize;
  }

  get hasChanges(): boolean {
    return this.draftKeepAwake !== this.keepAwakeEnabled ||
           this.draftIdleTimeout !== this.idleTimeoutEnabled ||
           this.draftWakeMinutes !== this.wakeMinutes ||
           this.draftAutoUpdateCheck !== this.autoUpdateCheckEnabled ||
           this.draftUpdateCheckInterval !== this.updateCheckIntervalMinutes ||
           this.draftServerPort !== this.serverPort ||
           this.draftNsfwMode !== this.nsfwModeEnabled ||
           this.draftStoreServerUrl !== this.currentStoreServerUrl ||
           this.draftInputDevice !== this.currentInputDevice ||
           this.draftOutputDevice !== this.currentOutputDevice ||
           this.draftYoutubeCachePath !== this.currentYoutubeCachePath ||
           this.draftYoutubeCacheTtl !== this.currentYoutubeCacheTtl ||
           this.draftYoutubeCacheMaxSize !== this.currentYoutubeCacheMaxSize;
  }

  // ── Draft change handlers ──────────────────────────────────────────────

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

  onToggleNsfwMode(): void {
    this.draftNsfwMode = !this.draftNsfwMode;
  }

  onServerPortChange(value: number): void {
    this.draftServerPort = value;
  }

  onStoreServerUrlChange(value: string): void {
    this.draftStoreServerUrl = value;
  }

  onInputDeviceChange(device: string): void {
    this.draftInputDevice = device;
  }

  onOutputDeviceChange(device: string): void {
    this.draftOutputDevice = device;
  }

  onYoutubeCachePathChange(value: string): void {
    this.draftYoutubeCachePath = value;
  }

  onBrowseCachePath(): void {
    this.soundService.browseFolder(this.draftYoutubeCachePath || this.dataDir)
      .pipe(take(1))
      .subscribe(result => {
        if (result.path) {
          this.draftYoutubeCachePath = result.path;
        }
      });
  }

  onYoutubeCacheTtlChange(value: number): void {
    this.draftYoutubeCacheTtl = value;
  }

  onYoutubeCacheMaxSizeChange(value: number): void {
    this.draftYoutubeCacheMaxSize = value;
  }

  onClearYoutubeCache(): void {
    this.isClearingCache = true;
    this.cacheClearMessage = '';
    this.soundService.clearYoutubeCache()
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.isClearingCache = false;
          this.cacheClearMessage = `Cleared ${result.cleared} entries`;
          this.loadYoutubeCacheInfo();
          setTimeout(() => { this.cacheClearMessage = ''; }, 3000);
        },
        error: () => {
          this.isClearingCache = false;
          this.cacheClearMessage = 'Failed to clear';
          setTimeout(() => { this.cacheClearMessage = ''; }, 3000);
        }
      });
  }

  onCheckForUpdates(): void {
    this.checkForUpdates.emit();
  }

  closeVersionDialog(): void {
    this.showVersionDialog = false;
  }

  // ── Save ───────────────────────────────────────────────────────────────

  onSave(): void {
    this.currentInputDevice = this.draftInputDevice;
    this.currentOutputDevice = this.draftOutputDevice;
    this.currentStoreServerUrl = this.draftStoreServerUrl;
    this.currentYoutubeCachePath = this.draftYoutubeCachePath;
    this.currentYoutubeCacheTtl = this.draftYoutubeCacheTtl;
    this.currentYoutubeCacheMaxSize = this.draftYoutubeCacheMaxSize;

    this.saveSettings.emit({
      keepAwakeEnabled: this.draftKeepAwake,
      idleTimeoutEnabled: this.draftIdleTimeout,
      wakeMinutes: this.draftWakeMinutes,
      autoUpdateCheckEnabled: this.draftAutoUpdateCheck,
      updateCheckIntervalMinutes: this.draftUpdateCheckInterval,
      serverPort: this.draftServerPort,
      audioInputDevice: this.draftInputDevice,
      audioOutputDevice: this.draftOutputDevice,
      youtubeCachePath: this.draftYoutubeCachePath,
      youtubeCacheTtlMinutes: this.draftYoutubeCacheTtl,
      youtubeCacheMaxSizeMb: this.draftYoutubeCacheMaxSize,
      nsfwModeEnabled: this.draftNsfwMode,
      storeServerUrl: this.draftStoreServerUrl,
    });
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
    this.snapshotDraft();
    this.closeSettings.emit();
  }

  onDiscardCancel(): void {
    this.showDiscardDialog = false;
  }

  // ── QR code ─────────────────────────────────────────────────────────────

  private loadQrCode(): void {
    this.isLoadingQr = true;
    this.soundService.getQrCode()
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

  // ── Audio devices ──────────────────────────────────────────────────────

  private loadAudioDevices(): void {
    this.soundService.getAudioDevices()
      .pipe(take(1))
      .subscribe(devices => {
        this.audioDevices = devices;
      });
  }

  private loadAudioSettings(): void {
    this.soundService.getSettings()
      .pipe(take(1))
      .subscribe(settings => {
        this.dataDir = settings.dataDir || '';
        this.currentInputDevice = settings.audioInputDevice || '';
        this.currentOutputDevice = settings.audioOutputDevice || '';
        this.draftInputDevice = this.currentInputDevice;
        this.draftOutputDevice = this.currentOutputDevice;
        // Store server URL
        this.currentStoreServerUrl = settings.storeServerUrl || 'http://localhost:9090';
        this.draftStoreServerUrl = this.currentStoreServerUrl;
        // YouTube cache settings
        this.currentYoutubeCachePath = settings.youtubeCachePath || '';
        this.currentYoutubeCacheTtl = settings.youtubeCacheTtlMinutes || 4320;
        this.currentYoutubeCacheMaxSize = settings.youtubeCacheMaxSizeMb || 100;
        this.draftYoutubeCachePath = this.currentYoutubeCachePath;
        this.draftYoutubeCacheTtl = this.currentYoutubeCacheTtl;
        this.draftYoutubeCacheMaxSize = this.currentYoutubeCacheMaxSize;
      });
  }

  // ── YouTube cache info ──────────────────────────────────────────────────

  private loadYoutubeCacheInfo(): void {
    this.soundService.getYoutubeCacheInfo()
      .pipe(take(1))
      .subscribe(info => {
        this.cacheInfo = info;
      });
  }

  // ── VB-Cable status ──────────────────────────────────────────────────

  private loadVBCableStatus(): void {
    this.soundService.getVBCableStatus()
      .pipe(take(1))
      .subscribe(status => {
        this.vbCableStatus = status;
      });
  }

  onRefreshVBCableStatus(): void {
    this.isRefreshingVBCable = true;
    this.soundService.getVBCableStatus()
      .pipe(take(1))
      .subscribe(status => {
        this.vbCableStatus = status;
        this.isRefreshingVBCable = false;
      });
  }
}
