import {
  Component, Input, Output, EventEmitter, ViewChild, ElementRef,
  OnChanges, SimpleChanges, OnDestroy, NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-waveform-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './waveform-preview.component.html',
  styleUrls: ['./waveform-preview.component.scss']
})
export class WaveformPreviewComponent implements OnChanges, OnDestroy {
  @Input() file: File | null = null;
  @Output() fileChanged = new EventEmitter<File>();
  @Output() originalFileChanged = new EventEmitter<File | null>();
  @Output() metadataParsed = new EventEmitter<{ artist: string; title: string }>();
  @Output() durationChanged = new EventEmitter<number>();
  @Output() cropStateChanged = new EventEmitter<{ start: number; end: number; duration: number }>();

  @ViewChild('waveformCanvas') waveformCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('frequencyCanvas') frequencyCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('waveformSection') waveformSection!: ElementRef<HTMLDivElement>;

  previewLoading = false;
  previewDuration = 0;
  previewCurrentTime = 0;
  previewIsPlaying = false;
  previewPlayheadPos = 0;
  cropStart = 0;
  cropEnd = 1;
  focusedCropHandle: 'start' | 'end' | null = null;
  isCropping = false;
  originalFile: File | null = null;
  volumeGain = 1.0;
  volumeSliderMax = 300;
  scopeMaxFreq = 20000;
  croppedPeakAmplitude = 0;
  isNormalized = false;
  isClipping = false;
  showClippingWarning = false;
  clippingWarningFading = false;

  private originalAudioBuffer: AudioBuffer | null = null;
  private audioCtx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private previewSourceNode: AudioBufferSourceNode | null = null;
  private previewStartedAt = 0;
  private previewOffsetSec = 0;
  private previewAnimFrame: number | null = null;
  private waveformPeaks: Float32Array | null = null;
  private cropDragHandle: 'start' | 'end' | null = null;
  private cropDragBound: ((e: MouseEvent) => void) | null = null;
  private cropDragEndBound: (() => void) | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private frequencyData: Uint8Array | null = null;
  private frequencyPeaks: Float32Array | null = null;
  private frequencyPeakClipped: Uint8Array | null = null;
  private frequencyPeakClipTime: Float64Array | null = null;
  private timeDomainData: Float32Array | null = null;
  private peakDecayAnimFrame: number | null = null;
  private lastPeakDecayTime = 0;
  private skipNextFileChange = false;
  private clippingWarningTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['file']) {
      if (this.skipNextFileChange) {
        this.skipNextFileChange = false;
        return;
      }
      const newFile = changes['file'].currentValue as File | null;
      if (newFile) {
        this.loadAudioPreview(newFile);
      } else {
        this.destroyPreviewAudio();
        this.resetPreviewState();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyPreviewAudio();
  }

  resetPreviewState(): void {
    this.previewLoading = false;
    this.previewDuration = 0;
    this.previewCurrentTime = 0;
    this.previewIsPlaying = false;
    this.previewPlayheadPos = 0;
    this.cropStart = 0;
    this.cropEnd = 1;
    this.focusedCropHandle = null;
    this.isCropping = false;
    this.audioBuffer = null;
    this.waveformPeaks = null;
    this.previewOffsetSec = 0;
    this.previewStartedAt = 0;
    this.originalFile = null;
    this.originalAudioBuffer = null;
    this.volumeGain = 1.0;
    this.volumeSliderMax = 300;
    this.scopeMaxFreq = 20000;
    this.croppedPeakAmplitude = 0;
    this.isNormalized = false;
  }

  destroyPreviewAudio(): void {
    this.stopPreviewPlayback();
    if (this.previewAnimFrame !== null) {
      cancelAnimationFrame(this.previewAnimFrame);
      this.previewAnimFrame = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.gainNode = null;
    this.analyserNode = null;
    this.frequencyData = null;
    this.frequencyPeaks = null;
    this.frequencyPeakClipped = null;
    this.frequencyPeakClipTime = null;
    this.timeDomainData = null;
    if (this.peakDecayAnimFrame !== null) {
      cancelAnimationFrame(this.peakDecayAnimFrame);
      this.peakDecayAnimFrame = null;
    }
    if (this.clippingWarningTimeout !== null) {
      clearTimeout(this.clippingWarningTimeout);
      this.clippingWarningTimeout = null;
    }
    this.showClippingWarning = false;
    this.clippingWarningFading = false;
    this.removeCropDragListeners();
  }

  private loadAudioPreview(file: File): void {
    this.destroyPreviewAudio();
    this.resetPreviewState();
    this.previewLoading = true;

    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      if (!arrayBuffer) {
        this.previewLoading = false;
        return;
      }

      const tags = this.parseId3Tags(arrayBuffer);
      if (tags.artist || tags.title) {
        this.metadataParsed.emit(tags);
      }

      this.audioCtx = new AudioContext();
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.frequencyPeaks = new Float32Array(this.analyserNode.frequencyBinCount);
      this.frequencyPeakClipped = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.frequencyPeakClipTime = new Float64Array(this.analyserNode.frequencyBinCount);
      this.timeDomainData = new Float32Array(this.analyserNode.fftSize);
      this.audioCtx.decodeAudioData(arrayBuffer.slice(0))
        .then((buffer) => {
          this.ngZone.run(() => {
            this.audioBuffer = buffer;
            this.previewDuration = buffer.duration;
            this.previewLoading = false;
            this.durationChanged.emit(buffer.duration);
            this.waveformPeaks = this.computePeaks(buffer, 600);
            this.scopeMaxFreq = 20000;
            this.updateCroppedPeakAmplitude();
            setTimeout(() => this.drawWaveform(), 50);
          });
        })
        .catch(() => {
          this.ngZone.run(() => {
            this.previewLoading = false;
          });
        });
    };
    reader.readAsArrayBuffer(file);
  }

  private parseId3Tags(buffer: ArrayBuffer): { artist: string; title: string } {
    const result = { artist: '', title: '' };
    try {
      const bytes = new Uint8Array(buffer);
      if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
        return result;
      }
      const majorVersion = bytes[3];
      const tagSize =
        ((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f);

      let offset = 10;
      const end = Math.min(10 + tagSize, bytes.length);

      if (bytes[5] & 0x40) {
        if (majorVersion === 4) {
          const extSize =
            ((bytes[10] & 0x7f) << 21) |
            ((bytes[11] & 0x7f) << 14) |
            ((bytes[12] & 0x7f) << 7) |
            (bytes[13] & 0x7f);
          offset += extSize;
        } else {
          const extSize = (bytes[10] << 24) | (bytes[11] << 16) | (bytes[12] << 8) | bytes[13];
          offset += extSize + 4;
        }
      }

      const decoder = new TextDecoder('utf-8');

      while (offset + 10 < end) {
        const frameIdLen = majorVersion === 2 ? 3 : 4;
        const frameId = String.fromCharCode(...bytes.slice(offset, offset + frameIdLen));

        let frameSize: number;
        if (majorVersion === 2) {
          frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
          offset += 6;
        } else if (majorVersion === 4) {
          frameSize =
            ((bytes[offset + 4] & 0x7f) << 21) |
            ((bytes[offset + 5] & 0x7f) << 14) |
            ((bytes[offset + 6] & 0x7f) << 7) |
            (bytes[offset + 7] & 0x7f);
          offset += 10;
        } else {
          frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
          offset += 10;
        }

        if (frameSize <= 0 || offset + frameSize > end) break;

        const isArtist = frameId === 'TPE1' || frameId === 'TP1';
        const isTitle  = frameId === 'TIT2' || frameId === 'TT2';

        if (isArtist || isTitle) {
          const encoding = bytes[offset];
          const textBytes = bytes.slice(offset + 1, offset + frameSize);
          let text = '';
          if (encoding === 1 || encoding === 2) {
            text = new TextDecoder('utf-16le').decode(textBytes);
          } else {
            text = decoder.decode(textBytes);
          }
          text = text.replace(/\0/g, '').trim();
          if (isArtist) result.artist = text;
          if (isTitle)  result.title  = text;
        }

        offset += frameSize;
        if (result.artist && result.title) break;
      }
    } catch {
      // Silently ignore parse errors
    }
    return result;
  }

  private computePeaks(buffer: AudioBuffer, numBuckets: number): Float32Array {
    const numChannels = buffer.numberOfChannels;
    const totalSamples = buffer.length;
    const blockSize = Math.floor(totalSamples / numBuckets);
    const peaks = new Float32Array(numBuckets);
    for (let i = 0; i < numBuckets; i++) {
      let max = 0;
      const start = i * blockSize;
      // Include tail samples in the last bucket
      const end = (i === numBuckets - 1) ? totalSamples : start + blockSize;
      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let j = start; j < end; j++) {
          const abs = Math.abs(channelData[j]);
          if (abs > max) max = abs;
        }
      }
      peaks[i] = max;
    }
    return peaks;
  }

  drawWaveform(): void {
    const canvasEl = this.waveformCanvas?.nativeElement;
    if (!canvasEl || !this.waveformPeaks) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const peaks = this.waveformPeaks;
    const n = peaks.length;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, W, H);

    const barW = W / n;
    const midY = H / 2;

    for (let i = 0; i < n; i++) {
      const x = i * barW;
      const frac = i / n;
      const barH = Math.min(peaks[i] * this.volumeGain * midY * 0.95, midY);

      if (frac < this.cropStart || frac > this.cropEnd) {
        ctx.fillStyle = 'rgba(155, 89, 182, 0.25)';
      } else {
        const t = (frac - this.cropStart) / Math.max(this.cropEnd - this.cropStart, 0.001);
        const r = Math.round(155 + (231 - 155) * t);
        const g = Math.round(89 + (76 - 89) * t);
        const b = Math.round(182 + (60 - 182) * t);
        ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      }

      ctx.fillRect(x, midY - barH, Math.max(barW - 0.5, 0.5), barH * 2);
    }
  }

  onWaveformMousedown(event: MouseEvent): void {
    const canvasEl = this.waveformCanvas?.nativeElement;
    if (!canvasEl || !this.audioBuffer) return;
    const rect = canvasEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.seekPreviewTo(frac * this.previewDuration);
    this.focusedCropHandle = null;
    this.waveformSection?.nativeElement?.focus();
  }

  private seekPreviewTo(timeSec: number): void {
    const wasPlaying = this.previewIsPlaying;
    if (wasPlaying) this.stopPreviewPlayback();
    this.previewOffsetSec = Math.max(this.cropStart * this.previewDuration,
      Math.min(this.cropEnd * this.previewDuration, timeSec));
    this.previewCurrentTime = this.previewOffsetSec;
    this.previewPlayheadPos = this.previewDuration > 0 ? this.previewOffsetSec / this.previewDuration : 0;
    if (wasPlaying) this.startPreviewPlayback();
  }

  togglePreviewPlayback(): void {
    if (this.previewIsPlaying) {
      this.pausePreviewPlayback();
    } else {
      this.startPreviewPlayback();
    }
    setTimeout(() => this.waveformSection?.nativeElement?.focus(), 0);
  }

  restartPreviewFromCropStart(): void {
    this.stopPreviewPlayback();
    this.previewOffsetSec = this.cropStart * this.previewDuration;
    this.previewCurrentTime = this.previewOffsetSec;
    this.previewPlayheadPos = this.cropStart;
    this.startPreviewPlayback();
    setTimeout(() => this.waveformSection?.nativeElement?.focus(), 0);
  }

  private startPreviewPlayback(): void {
    if (!this.audioCtx || !this.audioBuffer) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    // Cancel peak decay animation — live drawing takes over
    if (this.peakDecayAnimFrame !== null) {
      cancelAnimationFrame(this.peakDecayAnimFrame);
      this.peakDecayAnimFrame = null;
    }

    const startOffset = this.previewOffsetSec;
    const cropEndSec = this.cropEnd * this.previewDuration;
    const duration = cropEndSec - startOffset;
    if (duration <= 0) {
      this.previewOffsetSec = this.cropStart * this.previewDuration;
      return this.startPreviewPlayback();
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.audioBuffer;
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = this.volumeGain;
    if (this.analyserNode) {
      source.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.audioCtx.destination);
    } else {
      source.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    }
    source.start(0, startOffset, duration);
    source.onended = () => {
      this.ngZone.run(() => {
        if (this.previewIsPlaying) {
          this.previewIsPlaying = false;
          this.previewOffsetSec = this.cropStart * this.previewDuration;
          this.previewCurrentTime = this.previewOffsetSec;
          this.previewPlayheadPos = this.cropStart;
          this.drawWaveform();
          this.startPeakDecay();
          this.cdr.detectChanges();
        }
      });
    };

    this.previewSourceNode = source;
    this.previewStartedAt = this.audioCtx.currentTime;
    this.previewIsPlaying = true;
    this.schedulePlayheadAnimation();
  }

  private pausePreviewPlayback(): void {
    if (!this.previewIsPlaying || !this.audioCtx) return;
    const elapsed = this.audioCtx.currentTime - this.previewStartedAt;
    this.previewOffsetSec = Math.min(
      this.previewOffsetSec + elapsed,
      this.cropEnd * this.previewDuration
    );
    this.stopPreviewPlayback();
    this.startPeakDecay();
  }

  private stopPreviewPlayback(): void {
    if (this.previewSourceNode) {
      try { this.previewSourceNode.onended = null; this.previewSourceNode.stop(); } catch {}
      this.previewSourceNode = null;
    }
    this.previewIsPlaying = false;
    this.isClipping = false;
    if (this.previewAnimFrame !== null) {
      cancelAnimationFrame(this.previewAnimFrame);
      this.previewAnimFrame = null;
    }
  }

  private schedulePlayheadAnimation(): void {
    if (this.previewAnimFrame !== null) {
      cancelAnimationFrame(this.previewAnimFrame);
    }
    const tick = () => {
      if (!this.previewIsPlaying || !this.audioCtx) return;
      const elapsed = this.audioCtx.currentTime - this.previewStartedAt;
      const currentSec = Math.min(this.previewOffsetSec + elapsed, this.cropEnd * this.previewDuration);
      this.ngZone.run(() => {
        this.previewCurrentTime = currentSec;
        this.previewPlayheadPos = this.previewDuration > 0 ? currentSec / this.previewDuration : 0;
        this.drawWaveform();
        this.drawFrequencyScope();
      });
      this.previewAnimFrame = requestAnimationFrame(tick);
    };
    this.previewAnimFrame = requestAnimationFrame(tick);
  }

  startCropDrag(event: MouseEvent, handle: 'start' | 'end'): void {
    event.preventDefault();
    event.stopPropagation();
    this.cropDragHandle = handle;
    this.focusedCropHandle = handle;

    this.cropDragBound = (e: MouseEvent) => this.onCropDragMove(e);
    this.cropDragEndBound = () => this.onCropDragEnd();

    document.addEventListener('mousemove', this.cropDragBound);
    document.addEventListener('mouseup', this.cropDragEndBound);

    this.waveformSection?.nativeElement?.focus();
  }

  private onCropDragMove(event: MouseEvent): void {
    const canvasEl = this.waveformCanvas?.nativeElement;
    if (!canvasEl || !this.cropDragHandle) return;
    const rect = canvasEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));

    if (this.cropDragHandle === 'start') {
      this.cropStart = Math.min(frac, this.cropEnd - 0.01);
      if (this.previewPlayheadPos < this.cropStart) {
        this.previewOffsetSec = this.cropStart * this.previewDuration;
        this.previewPlayheadPos = this.cropStart;
        this.previewCurrentTime = this.previewOffsetSec;
      }
    } else {
      this.cropEnd = Math.max(frac, this.cropStart + 0.01);
      if (this.previewPlayheadPos > this.cropEnd) {
        this.previewOffsetSec = this.cropEnd * this.previewDuration;
        this.previewPlayheadPos = this.cropEnd;
        this.previewCurrentTime = this.previewOffsetSec;
      }
    }
    this.cropStateChanged.emit({ start: this.cropStart, end: this.cropEnd, duration: this.previewDuration });
    this.updateCroppedPeakAmplitude();
    this.drawWaveform();
  }

  private onCropDragEnd(): void {
    this.cropDragHandle = null;
    this.removeCropDragListeners();
  }

  private removeCropDragListeners(): void {
    if (this.cropDragBound) {
      document.removeEventListener('mousemove', this.cropDragBound);
      this.cropDragBound = null;
    }
    if (this.cropDragEndBound) {
      document.removeEventListener('mouseup', this.cropDragEndBound);
      this.cropDragEndBound = null;
    }
  }

  resetCrop(): void {
    this.cropStart = 0;
    this.cropEnd = 1;
    this.cropStateChanged.emit({ start: 0, end: 1, duration: this.previewDuration });
    this.updateCroppedPeakAmplitude();
    this.drawWaveform();
  }

  blurCropHandles(): void {
    if (this.focusedCropHandle !== null) {
      this.focusedCropHandle = null;
    }
  }

  applyCrop(): void {
    if (!this.audioBuffer || !this.audioCtx || this.isCropping) return;
    if (this.cropStart === 0 && this.cropEnd === 1) return;

    this.isCropping = true;
    this.stopPreviewPlayback();

    const sampleRate = this.audioBuffer.sampleRate;
    const numChannels = this.audioBuffer.numberOfChannels;
    const startSample = Math.floor(this.cropStart * this.audioBuffer.length);
    const endSample   = Math.ceil(this.cropEnd   * this.audioBuffer.length);
    const newLength   = endSample - startSample;

    if (!this.originalFile) {
      this.originalFile = this.file;
      this.originalAudioBuffer = this.audioBuffer;
      this.originalFileChanged.emit(this.originalFile);
    }

    const croppedBuffer = this.audioCtx.createBuffer(numChannels, newLength, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
      const src = this.audioBuffer.getChannelData(ch);
      const dst = croppedBuffer.getChannelData(ch);
      dst.set(src.subarray(startSample, endSample));
    }

    this.audioBuffer = croppedBuffer;
    this.previewDuration = croppedBuffer.duration;

    this.cropStart = 0;
    this.cropEnd = 1;
    this.previewOffsetSec = 0;
    this.previewCurrentTime = 0;
    this.previewPlayheadPos = 0;

    this.waveformPeaks = this.computePeaks(croppedBuffer, 600);
    this.updateCroppedPeakAmplitude();
    this.scopeMaxFreq = 20000;

    // Auto-renormalize if volume was already at max — use true peak from raw buffer
    if (this.isNormalized) {
      const truePeak = this.findPeakAmplitude(croppedBuffer);
      if (truePeak > 0) {
        this.croppedPeakAmplitude = truePeak;
        this.volumeGain = 1.0 / truePeak;
        this.volumeSliderMax = Math.max(300, Math.ceil(this.volumeGain * 100));
        if (this.gainNode) {
          this.gainNode.gain.value = this.volumeGain;
        }
      }
    }

    const wavBlob = this.audioBufferToWav(croppedBuffer, this.volumeGain);
    const originalName = this.file?.name ?? 'cropped.wav';
    const baseName = this.fileNameWithoutExtension(originalName);
    const newFile = new File([wavBlob], `${baseName}.wav`, { type: 'audio/wav' });

    this.isCropping = false;
    this.durationChanged.emit(croppedBuffer.duration);
    this.cropStateChanged.emit({ start: 0, end: 1, duration: croppedBuffer.duration });
    this.skipNextFileChange = true;
    this.fileChanged.emit(newFile);
    this.startPeakDecay();
    this.cdr.detectChanges();
    setTimeout(() => this.drawWaveform(), 0);
  }

  resetToOriginal(): void {
    if (!this.originalFile || !this.originalAudioBuffer) return;

    this.stopPreviewPlayback();

    const restoredFile = this.originalFile;
    this.audioBuffer = this.originalAudioBuffer;
    this.previewDuration = this.originalAudioBuffer.duration;

    this.originalFile = null;
    this.originalAudioBuffer = null;

    this.cropStart = 0;
    this.cropEnd = 1;
    this.previewOffsetSec = 0;
    this.previewCurrentTime = 0;
    this.previewPlayheadPos = 0;
    this.focusedCropHandle = null;

    this.waveformPeaks = this.computePeaks(this.audioBuffer, 600);
    this.scopeMaxFreq = 20000;
    this.updateCroppedPeakAmplitude();

    // Auto-renormalize if volume was already at max — use true peak from raw buffer
    if (this.isNormalized) {
      const truePeak = this.findPeakAmplitude(this.audioBuffer);
      if (truePeak > 0) {
        this.croppedPeakAmplitude = truePeak;
        this.volumeGain = 1.0 / truePeak;
        this.volumeSliderMax = Math.max(300, Math.ceil(this.volumeGain * 100));
        if (this.gainNode) {
          this.gainNode.gain.value = this.volumeGain;
        }
      }
    }

    this.durationChanged.emit(this.audioBuffer.duration);
    this.cropStateChanged.emit({ start: 0, end: 1, duration: this.audioBuffer.duration });
    this.skipNextFileChange = true;
    this.fileChanged.emit(restoredFile);
    this.originalFileChanged.emit(null);
    this.startPeakDecay();
    this.cdr.detectChanges();
    setTimeout(() => this.drawWaveform(), 0);
  }

  private audioBufferToWav(buffer: AudioBuffer, gain: number = 1.0): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate  = buffer.sampleRate;
    const numSamples  = buffer.length;
    const bytesPerSample = 2;
    const blockAlign  = numChannels * bytesPerSample;
    const dataSize    = numSamples * blockAlign;
    const headerSize  = 44;

    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4,  36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i] * gain));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  private drawFrequencyScope(): void {
    const canvasEl = this.frequencyCanvas?.nativeElement;
    if (!canvasEl || !this.analyserNode || !this.frequencyData || !this.audioCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const scaleH = 14;
    const specH = H - scaleH;

    // @ts-ignore
    this.analyserNode.getByteFrequencyData(this.frequencyData);

    // Detect actual clipping from time-domain signal (samples exceeding 1.0)
    // The analyser sees the post-gain signal, so values >= 1.0 mean the DAC will clip
    let isClipping = false;
    if (this.timeDomainData) {
      // @ts-ignore
      this.analyserNode.getFloatTimeDomainData(this.timeDomainData);
      for (let i = 0; i < this.timeDomainData.length; i++) {
        if (Math.abs(this.timeDomainData[i]) > 1.0) {
          isClipping = true;
          break;
        }
      }
    }
    // Expose clipping state to the template for the warning indicator
    this.isClipping = isClipping;

    // Manage "Clipping Detected" warning below waveform with hold+fade matching peak indicators
    if (isClipping) {
      // Clipping is active — show warning immediately, cancel any pending fade-out
      if (this.clippingWarningTimeout !== null) {
        clearTimeout(this.clippingWarningTimeout);
        this.clippingWarningTimeout = null;
      }
      this.showClippingWarning = true;
      this.clippingWarningFading = false;
    } else if (this.showClippingWarning && !this.clippingWarningFading) {
      // Clipping just stopped — start the hold period (400ms), then fade (600ms via CSS transition)
      this.clippingWarningFading = false;
      this.clippingWarningTimeout = setTimeout(() => {
        this.ngZone.run(() => {
          // After 400ms hold, start the CSS fade-out (600ms)
          this.clippingWarningFading = true;
          this.cdr.detectChanges();
          this.clippingWarningTimeout = setTimeout(() => {
            this.ngZone.run(() => {
              // After 600ms fade, hide the element entirely
              this.showClippingWarning = false;
              this.clippingWarningFading = false;
              this.clippingWarningTimeout = null;
              this.cdr.detectChanges();
            });
          }, 600);
        });
      }, 400);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, W, H);

    const bins = this.frequencyData.length;
    const nyquist = this.audioCtx.sampleRate / 2;
    const maxBin = Math.min(bins, Math.ceil(this.scopeMaxFreq / nyquist * bins));
    const barW = W / maxBin;

    // Fold bins above 20kHz into the last visible bar
    let lastBarExtra = 0;
    for (let i = maxBin; i < bins; i++) {
      const v = this.frequencyData[i] / 255;
      if (v > lastBarExtra) lastBarExtra = v;
    }

    // Draw bars and peaks for visible frequency range
    for (let i = 0; i < maxBin; i++) {
      let value = this.frequencyData[i] / 255;
      // Last bar includes the max of all bins above 20kHz
      if (i === maxBin - 1 && lastBarExtra > value) {
        value = lastBarExtra;
      }
      const barH = value * specH;
      const t = i / maxBin;
      const r = Math.round(155 + (231 - 155) * t);
      const g = Math.round(89 + (76 - 89) * t);
      const b = Math.round(182 + (60 - 182) * t);
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.fillRect(i * barW, specH - barH, Math.max(barW - 0.5, 0.5), barH);

      if (this.frequencyPeaks && this.frequencyPeakClipped && this.frequencyPeakClipTime) {
        // For the last bar, also track peaks from bins above 20kHz
        if (i === maxBin - 1) {
          for (let j = maxBin; j < bins; j++) {
            const extraVal = this.frequencyData![j] / 255;
            if (extraVal > value) value = extraVal;
            if (extraVal > this.frequencyPeaks[i]) {
              this.frequencyPeaks[i] = extraVal;
            }
          }
        }
        if (value > this.frequencyPeaks[i]) {
          this.frequencyPeaks[i] = value;
        }
        // Only mark bins as clipped when actual time-domain clipping is detected
        const now = performance.now();
        if (isClipping && value > 0.15) {
          this.frequencyPeakClipped[i] = 1;
          this.frequencyPeakClipTime[i] = now;
        }
        const peakVal = this.frequencyPeaks[i];
        const peakY = specH - peakVal * specH;
        // Fade clipped indicators from red back to white after a hold period
        const clipHoldMs = 400;   // stay fully red for this long
        const clipFadeMs = 600;   // then fade to white over this duration
        if (this.frequencyPeakClipped[i]) {
          const elapsed = now - this.frequencyPeakClipTime[i];
          if (elapsed > clipHoldMs + clipFadeMs) {
            // Fade complete — clear clipped state
            this.frequencyPeakClipped[i] = 0;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          } else if (elapsed > clipHoldMs) {
            // Fading from red to white
            const fadeProgress = (elapsed - clipHoldMs) / clipFadeMs;
            const redAmount = Math.min(1, peakVal / 0.98) * (1 - fadeProgress);
            ctx.fillStyle = `rgba(255,${Math.round((1 - redAmount) * 255)},${Math.round((1 - redAmount) * 255)},0.9)`;
          } else {
            // Still in hold period — fully red
            const redAmount = Math.min(1, peakVal / 0.98);
            ctx.fillStyle = `rgba(255,${Math.round((1 - redAmount) * 255)},${Math.round((1 - redAmount) * 255)},0.9)`;
          }
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        }
        ctx.fillRect(i * barW, peakY, Math.max(barW - 0.5, 0.5), 2);
      }
    }

    // Track peaks for all bins but only decay visible ones visually matters
    if (this.frequencyPeaks && this.frequencyPeakClipped && this.frequencyPeakClipTime) {
      const nowDecay = performance.now();
      const dt = (nowDecay - this.lastPeakDecayTime) / 1000;
      this.lastPeakDecayTime = nowDecay;
      const decayRate = 0.12;
      const clipTotalMs = 400 + 600; // hold + fade
      for (let i = 0; i < this.frequencyPeaks.length; i++) {
        let liveVal = this.frequencyData![i] / 255;
        // For the last visible bar, include energy from bins above 20kHz
        if (i === maxBin - 1) {
          for (let j = maxBin; j < bins; j++) {
            const extraVal = this.frequencyData![j] / 255;
            if (extraVal > liveVal) liveVal = extraVal;
          }
        }
        this.frequencyPeaks[i] = Math.max(liveVal, this.frequencyPeaks[i] - decayRate * dt);
        // Clear clipped state if peak has dropped very low OR clip fade has completed
        if (this.frequencyPeakClipped[i]) {
          const clipElapsed = nowDecay - this.frequencyPeakClipTime[i];
          if (this.frequencyPeaks[i] < 0.15 || clipElapsed > clipTotalMs) {
            this.frequencyPeakClipped[i] = 0;
          }
        }
      }
    }

    this.drawFrequencyScale(ctx, W, specH);
  }

  /** Draw frequency scale labels and tick lines at the bottom of the scope */
  private drawFrequencyScale(ctx: CanvasRenderingContext2D, W: number, specH: number): void {
    const maxFreq = this.scopeMaxFreq;

    // Separator line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, specH);
    ctx.lineTo(W, specH);
    ctx.stroke();

    const freqs = [100, 200, 500, 1000, 2000, 3000, 4000, 5000, 8000, 10000, 12000, 14000, 16000, 20000];
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const freq of freqs) {
      if (freq > maxFreq) continue;
      const x = (freq / maxFreq) * W;
      if (x < 12 || x > W - 12) continue;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(x, specH);
      ctx.lineTo(x, specH + 3);
      ctx.stroke();

      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillText(label, x, specH + 3);
    }
  }

  private startPeakDecay(): void {
    if (this.peakDecayAnimFrame !== null) return;
    this.lastPeakDecayTime = performance.now();
    const clipTotalMs = 400 + 600; // hold + fade
    const decay = (now: number) => {
      if (!this.frequencyPeaks) return;
      const dt = (now - this.lastPeakDecayTime) / 1000;
      this.lastPeakDecayTime = now;
      const decayRate = 0.18;
      let anyAlive = false;
      for (let i = 0; i < this.frequencyPeaks.length; i++) {
        if (this.frequencyPeaks[i] > 0) {
          this.frequencyPeaks[i] = Math.max(0, this.frequencyPeaks[i] - decayRate * dt);
          if (this.frequencyPeaks[i] > 0.001) anyAlive = true;
          if (this.frequencyPeakClipped && this.frequencyPeakClipped[i]) {
            const clipElapsed = this.frequencyPeakClipTime
              ? now - this.frequencyPeakClipTime[i] : Infinity;
            if (this.frequencyPeaks[i] < 0.15 || clipElapsed > clipTotalMs) {
              this.frequencyPeakClipped[i] = 0;
            }
          }
        }
      }
      this.drawFrequencyScopeStatic();
      if (anyAlive) {
        this.peakDecayAnimFrame = requestAnimationFrame(decay);
      } else {
        this.peakDecayAnimFrame = null;
      }
    };
    this.peakDecayAnimFrame = requestAnimationFrame(decay);
  }

  /** Draw frequency scope with only peak indicators (no live data) — used during decay after playback stops. */
  private drawFrequencyScopeStatic(): void {
    const canvasEl = this.frequencyCanvas?.nativeElement;
    if (!canvasEl || !this.frequencyPeaks || !this.audioCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const scaleH = 14;
    const specH = H - scaleH;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, W, H);

    const bins = this.frequencyPeaks.length;
    const nyquist = this.audioCtx.sampleRate / 2;
    const maxBin = Math.min(bins, Math.ceil(this.scopeMaxFreq / nyquist * bins));
    const barW = W / maxBin;

    const now = performance.now();
    const clipHoldMs = 400;
    const clipFadeMs = 600;
    for (let i = 0; i < maxBin; i++) {
      if (this.frequencyPeaks[i] > 0.001) {
        const peakVal = this.frequencyPeaks[i];
        const peakY = specH - peakVal * specH;
        if (this.frequencyPeakClipped && this.frequencyPeakClipped[i] && this.frequencyPeakClipTime) {
          const elapsed = now - this.frequencyPeakClipTime[i];
          if (elapsed > clipHoldMs + clipFadeMs) {
            this.frequencyPeakClipped[i] = 0;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          } else if (elapsed > clipHoldMs) {
            const fadeProgress = (elapsed - clipHoldMs) / clipFadeMs;
            const redAmount = Math.min(1, peakVal / 0.98) * (1 - fadeProgress);
            ctx.fillStyle = `rgba(255,${Math.round((1 - redAmount) * 255)},${Math.round((1 - redAmount) * 255)},0.9)`;
          } else {
            const redAmount = Math.min(1, peakVal / 0.98);
            ctx.fillStyle = `rgba(255,${Math.round((1 - redAmount) * 255)},${Math.round((1 - redAmount) * 255)},0.9)`;
          }
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        }
        ctx.fillRect(i * barW, peakY, Math.max(barW - 0.5, 0.5), 2);
      }
    }

    this.drawFrequencyScale(ctx, W, specH);
  }

  // ── Peak amplitude tracking ───────────────────────────────────────────────

  /** Update croppedPeakAmplitude from waveformPeaks across the entire sound */
  private updateCroppedPeakAmplitude(): void {
    if (!this.waveformPeaks) {
      this.croppedPeakAmplitude = 0;
      return;
    }
    let peak = 0;
    for (let i = 0; i < this.waveformPeaks.length; i++) {
      if (this.waveformPeaks[i] > peak) peak = this.waveformPeaks[i];
    }
    this.croppedPeakAmplitude = peak;
  }

  /** Position of the max-without-clipping marker on the volume slider (0-100%) */
  get peakMarkerPercent(): number {
    if (this.croppedPeakAmplitude <= 0) return 101;
    return (100 / this.croppedPeakAmplitude) / this.volumeSliderMax * 100;
  }

  onPreviewKeydown(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      event.preventDefault();
      this.blurCropHandles();
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      this.restartPreviewFromCropStart();
      return;
    }

    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault();
      const step = event.shiftKey ? 0.01 : 0.001;
      const delta = event.code === 'ArrowLeft' ? -step : step;

      if (this.focusedCropHandle === 'start') {
        this.cropStart = Math.max(0, Math.min(this.cropEnd - 0.001, this.cropStart + delta));
        this.cropStateChanged.emit({ start: this.cropStart, end: this.cropEnd, duration: this.previewDuration });
        this.updateCroppedPeakAmplitude();
        this.drawWaveform();
      } else if (this.focusedCropHandle === 'end') {
        this.cropEnd = Math.max(this.cropStart + 0.001, Math.min(1, this.cropEnd + delta));
        this.cropStateChanged.emit({ start: this.cropStart, end: this.cropEnd, duration: this.previewDuration });
        this.updateCroppedPeakAmplitude();
        this.drawWaveform();
      }
      return;
    }

    if (event.code === 'Tab') {
      event.preventDefault();
      if (this.focusedCropHandle === null || this.focusedCropHandle === 'end') {
        this.focusedCropHandle = 'start';
      } else {
        this.focusedCropHandle = 'end';
      }
    }
  }

  // ── Volume controls ──────────────────────────────────────────────────────

  onVolumeSliderInput(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.volumeGain = value / 100;
    this.isNormalized = false;
    if (this.gainNode) {
      this.gainNode.gain.value = this.volumeGain;
    }
    this.drawWaveform();
  }

  onVolumeSliderChange(): void {
    this.emitCurrentFile();
  }

  normalizeVolume(): void {
    if (!this.audioBuffer) return;
    // Always use the true peak from the raw audio buffer (all channels, full resolution)
    // to avoid under-estimating the peak from the downsampled waveformPeaks
    const truePeak = this.findPeakAmplitude(this.audioBuffer);
    const peak = truePeak > 0 ? truePeak : this.croppedPeakAmplitude;
    if (peak > 0) {
      this.volumeGain = 1.0 / peak;
      // Update croppedPeakAmplitude to match the true peak so the peak marker is accurate
      this.croppedPeakAmplitude = peak;
        this.volumeSliderMax = Math.max(300, Math.ceil(this.volumeGain * 100));
      this.isNormalized = true;
      if (this.gainNode) {
        this.gainNode.gain.value = this.volumeGain;
      }
      this.drawWaveform();
      this.emitCurrentFile();
    }
  }

  resetVolume(): void {
    this.volumeGain = 1.0;
    this.volumeSliderMax = 300;
    this.isNormalized = false;
    if (this.gainNode) {
      this.gainNode.gain.value = this.volumeGain;
    }
    this.drawWaveform();
    this.emitCurrentFile();
  }

  private findPeakAmplitude(buffer: AudioBuffer): number {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    return peak;
  }

  private emitCurrentFile(): void {
    if (!this.audioBuffer) return;
    const wavBlob = this.audioBufferToWav(this.audioBuffer, this.volumeGain);
    const originalName = this.file?.name ?? 'sound.wav';
    const baseName = this.fileNameWithoutExtension(originalName);
    const newFile = new File([wavBlob], `${baseName}.wav`, { type: 'audio/wav' });
    this.skipNextFileChange = true;
    this.fileChanged.emit(newFile);
  }

  formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private fileNameWithoutExtension(name: string): string {
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  }
}
