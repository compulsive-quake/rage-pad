import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-connect-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './connect-modal.component.html',
  styleUrls: ['./connect-modal.component.scss']
})
export class ConnectModalComponent {
  @Output() connected = new EventEmitter<string>();

  serverHost = '';
  serverPort = '8088';
  isConnecting = false;
  error = '';

  constructor() {
    const saved = localStorage.getItem('ragepad-server-url');
    if (saved) {
      try {
        const url = new URL(saved);
        this.serverHost = url.hostname;
        this.serverPort = url.port || '8088';
      } catch {}
    }
  }

  async connect(): Promise<void> {
    const host = this.serverHost.trim();
    if (!host) {
      this.error = 'Enter the server IP address';
      return;
    }

    const port = this.serverPort.trim() || '8088';
    const url = `http://${host}:${port}`;

    this.isConnecting = true;
    this.error = '';

    try {
      const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      if (data.connected !== undefined) {
        localStorage.setItem('ragepad-server-url', url);
        this.connected.emit(url);
      } else {
        this.error = 'Server responded but doesn\'t look like RagePad';
      }
    } catch {
      this.error = `Can't reach server at ${url}`;
    } finally {
      this.isConnecting = false;
    }
  }
}
