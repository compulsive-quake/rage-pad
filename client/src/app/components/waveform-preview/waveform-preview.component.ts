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
  private analyserNode: AnalyserNode | null = null;
  private frequencyData: Uint8Array | null = null;
  private frequencyPeaks: Float32Array | null = null;
  private peakDecayAnimFrame: number | null = null;
  private lastPeakDecayTime = 0;

  constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['file']) {
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
    this.analyserNode = null;
    this.frequencyData = null;
    this.frequencyPeaks = null;
    if (this.peakDecayAnimFrame !== null) {
      cancelAnimationFrame(this.peakDecayAnimFrame);
      this.peakDecayAnimFrame = null;
    }
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
      this.audioCtx.decodeAudioData(arrayBuffer.slice(0))
        .then((buffer) => {
          this.ngZone.run(() => {
            this.audioBuffer = buffer;
            this.previewDuration = buffer.duration;
            this.previewLoading = false;
            this.durationChanged.emit(buffer.duration);
            this.waveformPeaks = this.computePeaks(buffer, 600);
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
    const channelData = buffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / numBuckets);
    const peaks = new Float32Array(numBuckets);
    for (let i = 0; i < numBuckets; i++) {
      let max = 0;
      const start = i * blockSize;
      const end = start + blockSize;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
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
      const barH = peaks[i] * midY * 0.95;

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
    if (this.analyserNode) {
      source.connect(this.analyserNode);
      this.analyserNode.connect(this.audioCtx.destination);
    } else {
      source.connect(this.audioCtx.destination);
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
  }

  private stopPreviewPlayback(): void {
    if (this.previewSourceNode) {
      try { this.previewSourceNode.onended = null; this.previewSourceNode.stop(); } catch {}
      this.previewSourceNode = null;
    }
    this.previewIsPlaying = false;
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

    const wavBlob = this.audioBufferToWav(croppedBuffer);
    const originalName = this.file?.name ?? 'cropped.wav';
    const baseName = this.fileNameWithoutExtension(originalName);
    const newFile = new File([wavBlob], `${baseName}.wav`, { type: 'audio/wav' });

    this.audioBuffer = croppedBuffer;
    this.previewDuration = croppedBuffer.duration;

    this.cropStart = 0;
    this.cropEnd = 1;
    this.previewOffsetSec = 0;
    this.previewCurrentTime = 0;
    this.previewPlayheadPos = 0;

    this.waveformPeaks = this.computePeaks(croppedBuffer, 600);
    this.isCropping = false;
    this.durationChanged.emit(croppedBuffer.duration);
    this.cropStateChanged.emit({ start: 0, end: 1, duration: croppedBuffer.duration });
    this.fileChanged.emit(newFile);
    this.cdr.detectChanges();
    setTimeout(() => this.drawWaveform(), 0);
  }

  resetToOriginal(): void {
    if (!this.originalFile || !this.originalAudioBuffer) return;

    this.stopPreviewPlayback();

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
    this.durationChanged.emit(this.audioBuffer.duration);
    this.cropStateChanged.emit({ start: 0, end: 1, duration: this.audioBuffer.duration });
    this.fileChanged.emit(this.file!);
    this.originalFileChanged.emit(null);
    this.cdr.detectChanges();
    setTimeout(() => this.drawWaveform(), 0);
  }

  private audioBufferToWav(buffer: AudioBuffer): Blob {
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
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  private drawFrequencyScope(): void {
    const canvasEl = this.frequencyCanvas?.nativeElement;
    if (!canvasEl || !this.analyserNode || !this.frequencyData) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    this.analyserNode.getByteFrequencyData(this.frequencyData);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, W, H);

    const bins = this.frequencyData.length;
    const barW = W / bins;

    for (let i = 0; i < bins; i++) {
      const value = this.frequencyData[i] / 255;
      const barH = value * H;
      const t = i / bins;
      const r = Math.round(155 + (231 - 155) * t);
      const g = Math.round(89 + (76 - 89) * t);
      const b = Math.round(182 + (60 - 182) * t);
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.fillRect(i * barW, H - barH, Math.max(barW - 0.5, 0.5), barH);

      // Update peak tracking
      if (this.frequencyPeaks) {
        if (value > this.frequencyPeaks[i]) {
          this.frequencyPeaks[i] = value;
        }
        // Draw peak indicator
        const peakY = H - this.frequencyPeaks[i] * H;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(i * barW, peakY, Math.max(barW - 0.5, 0.5), 2);
      }
    }

    // Decay peaks slowly during live playback
    if (this.frequencyPeaks) {
      const now = performance.now();
      const dt = (now - this.lastPeakDecayTime) / 1000;
      this.lastPeakDecayTime = now;
      const decayRate = 0.3;
      for (let i = 0; i < this.frequencyPeaks.length; i++) {
        this.frequencyPeaks[i] = Math.max(this.frequencyData![i] / 255, this.frequencyPeaks[i] - decayRate * dt);
      }
    }
  }

  private startPeakDecay(): void {
    if (this.peakDecayAnimFrame !== null) return;
    this.lastPeakDecayTime = performance.now();
    const decay = (now: number) => {
      if (!this.frequencyPeaks) return;
      const dt = (now - this.lastPeakDecayTime) / 1000;
      this.lastPeakDecayTime = now;
      const decayRate = 0.4;
      let anyAlive = false;
      for (let i = 0; i < this.frequencyPeaks.length; i++) {
        if (this.frequencyPeaks[i] > 0) {
          this.frequencyPeaks[i] = Math.max(0, this.frequencyPeaks[i] - decayRate * dt);
          if (this.frequencyPeaks[i] > 0.001) anyAlive = true;
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
    if (!canvasEl || !this.frequencyPeaks) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, W, H);

    const bins = this.frequencyPeaks.length;
    const barW = W / bins;

    for (let i = 0; i < bins; i++) {
      if (this.frequencyPeaks[i] > 0.001) {
        const peakY = H - this.frequencyPeaks[i] * H;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(i * barW, peakY, Math.max(barW - 0.5, 0.5), 2);
      }
    }
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
        this.drawWaveform();
      } else if (this.focusedCropHandle === 'end') {
        this.cropEnd = Math.max(this.cropStart + 0.001, Math.min(1, this.cropEnd + delta));
        this.cropStateChanged.emit({ start: this.cropStart, end: this.cropEnd, duration: this.previewDuration });
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
