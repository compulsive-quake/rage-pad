import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { APP_VERSION, SoundService, VBCableStatus, YoutubeCacheInfo, GameProfile, PttStatus } from '../../services/sound.service';
import { AudioDevices } from '../../models/sound.model';
import { environment } from '../../../environments/environment';

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
  audioEngineUrl: string;
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
  @Input() storeServerUrl = environment.storeServerUrl;
  @Input() audioEngineUrl = '';

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
  draftStoreServerUrl = environment.storeServerUrl;
  currentStoreServerUrl = environment.storeServerUrl;
  draftAudioEngineUrl = '';
  currentAudioEngineUrl = '';

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

  // PTT
  pttEnabled = false;
  pttStatus: PttStatus | null = null;
  pttProfiles: GameProfile[] = [];
  pttStatusInterval: any = null;
  showAddCustomGame = false;
  customGameName = '';
  customProcessName = '';
  customKeyCode = 0x56; // V
  showProcessPicker = false;
  runningProcesses: string[] = [];
  processFilter = '';
  loadingProcesses = false;
  pttKeyOptions = [
    { code: 0x56, label: 'V' },
    { code: 0x42, label: 'B' },
    { code: 0x43, label: 'C' },
    { code: 0x54, label: 'T' },
    { code: 0x55, label: 'U' },
    { code: 0x58, label: 'X' },
    { code: 0x59, label: 'Y' },
    { code: 0x5A, label: 'Z' },
    { code: 0x46, label: 'F' },
    { code: 0x47, label: 'G' },
    { code: 0x48, label: 'H' },
    { code: 0x4A, label: 'J' },
    { code: 0x4B, label: 'K' },
    { code: 0x4E, label: 'N' },
    { code: 0x4D, label: 'M' },
    { code: 0x09, label: 'Tab' },
    { code: 0x14, label: 'Caps Lock' },
    { code: 0xA0, label: 'Left Shift' },
    { code: 0xA2, label: 'Left Ctrl' },
    { code: 0xA4, label: 'Left Alt' },
    { code: 0x05, label: 'Mouse 4' },
    { code: 0x06, label: 'Mouse 5' },
    { code: 0xC0, label: '~ (Tilde)' },
  ];

  // Tabs
  activeTab: 'general' | 'audio' | 'youtube' | 'updates' | 'ptt' = 'general';

  // Version info dialog
  showVersionDialog = false;

  // Discard confirmation dialog
  showDiscardDialog = false;

  // QR code
  qrDataUrl = '';
  qrServerUrl = '';
  isLoadingQr = false;

  // Android QR code
  androidQrDataUrl = '';
  androidQrUrl = '';

  constructor(private soundService: SoundService) {}

  ngOnInit(): void {
    this.loadQrCode();
    this.loadAndroidQr();
    this.loadAudioDevices();
    this.loadAudioSettings();
    this.loadYoutubeCacheInfo();
    this.loadVBCableStatus();
    this.snapshotDraft();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['keepAwakeEnabled'] || changes['idleTimeoutEnabled'] || changes['wakeMinutes'] ||
        changes['autoUpdateCheckEnabled'] || changes['updateCheckIntervalMinutes'] || changes['serverPort'] ||
        changes['nsfwModeEnabled'] || changes['storeServerUrl'] || changes['audioEngineUrl']) {
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
    this.draftAudioEngineUrl = this.audioEngineUrl;
    this.currentAudioEngineUrl = this.audioEngineUrl;
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
           this.draftAudioEngineUrl !== this.currentAudioEngineUrl ||
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

  onAudioEngineUrlChange(value: string): void {
    this.draftAudioEngineUrl = value;
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
    this.currentAudioEngineUrl = this.draftAudioEngineUrl;
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
      audioEngineUrl: this.draftAudioEngineUrl,
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

  private loadAndroidQr(): void {
    this.soundService.getAndroidQr()
      .pipe(take(1))
      .subscribe({
        next: (data) => {
          this.androidQrDataUrl = data.qrDataUrl;
          this.androidQrUrl = data.url;
        },
        error: () => {}
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
        this.currentStoreServerUrl = settings.storeServerUrl || environment.storeServerUrl;
        this.draftStoreServerUrl = this.currentStoreServerUrl;
        // Audio engine URL
        this.currentAudioEngineUrl = settings.audioEngineUrl || '';
        this.draftAudioEngineUrl = this.currentAudioEngineUrl;
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

  // ── PTT (Push-to-Talk) ──────────────────────────────────────────────────

  loadPttData(): void {
    this.soundService.getPttStatus().pipe(take(1)).subscribe(status => {
      this.pttStatus = status;
      this.pttEnabled = status.enabled;
    });
    this.soundService.getPttProfiles().pipe(take(1)).subscribe(profiles => {
      this.pttProfiles = profiles;
    });
    // Poll status while on PTT tab
    if (this.pttStatusInterval) clearInterval(this.pttStatusInterval);
    this.pttStatusInterval = setInterval(() => {
      if (this.activeTab !== 'ptt') {
        clearInterval(this.pttStatusInterval);
        this.pttStatusInterval = null;
        return;
      }
      this.soundService.getPttStatus().pipe(take(1)).subscribe(status => {
        this.pttStatus = status;
      });
    }, 3000);
  }

  onTogglePtt(): void {
    this.pttEnabled = !this.pttEnabled;
    this.soundService.setPttEnabled(this.pttEnabled).pipe(take(1)).subscribe(status => {
      this.pttStatus = status;
    });
  }

  onToggleProfile(index: number): void {
    this.pttProfiles[index].enabled = !this.pttProfiles[index].enabled;
    this.savePttProfiles();
  }

  onProfileKeyChange(index: number, keyCode: number): void {
    this.pttProfiles[index].pttKeyCode = keyCode;
    const key = this.pttKeyOptions.find(k => k.code === keyCode);
    if (key) this.pttProfiles[index].pttKeyLabel = key.label;
    this.savePttProfiles();
  }

  onDeleteProfile(index: number): void {
    this.pttProfiles.splice(index, 1);
    this.savePttProfiles();
  }

  onAddCustomGame(): void {
    const key = this.pttKeyOptions.find(k => k.code === this.customKeyCode);
    const newProfile: GameProfile = {
      id: 'custom-' + Date.now(),
      name: this.customGameName,
      processName: this.customProcessName,
      pttKeyCode: this.customKeyCode,
      pttKeyLabel: key?.label || 'V',
      enabled: true,
      isPreset: false,
    };
    this.pttProfiles.push(newProfile);
    this.savePttProfiles();
    this.showAddCustomGame = false;
    this.customGameName = '';
    this.customProcessName = '';
    this.customKeyCode = 0x56;
  }

  onBrowseProcesses(): void {
    this.loadingProcesses = true;
    this.soundService.getPttProcesses().pipe(take(1)).subscribe({
      next: (processes) => {
        this.runningProcesses = processes;
        this.processFilter = '';
        this.showProcessPicker = true;
        this.loadingProcesses = false;
      },
      error: () => {
        this.loadingProcesses = false;
      }
    });
  }

  get filteredProcesses(): string[] {
    if (!this.processFilter) return this.runningProcesses;
    const filter = this.processFilter.toLowerCase();
    return this.runningProcesses.filter(p => p.toLowerCase().includes(filter));
  }

  onPickProcess(processName: string): void {
    this.customProcessName = processName;
    this.showProcessPicker = false;
  }

  private savePttProfiles(): void {
    this.soundService.savePttProfiles(this.pttProfiles).pipe(take(1)).subscribe(profiles => {
      this.pttProfiles = profiles;
    });
  }
}
