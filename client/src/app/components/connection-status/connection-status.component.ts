import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-connection-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="connection-status"
      [class.connected]="isConnected"
      [class.disconnected]="!isConnected"
      [title]="isConnected ? 'Connected to Soundpad' : 'Disconnected'"
    >
      <div class="status-indicator"></div>
    </div>
  `,
  styles: [`
    .connection-status {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      transition: all 0.3s ease;
      cursor: default;
    }

    .connection-status.connected {
      background: rgba(46, 204, 113, 0.15);
    }

    .connection-status.disconnected {
      background: rgba(231, 76, 60, 0.15);
    }

    .status-indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      transition: all 0.3s ease;
    }

    .connected .status-indicator {
      background: #2ecc71;
      box-shadow: 0 0 8px rgba(46, 204, 113, 0.6);
      animation: pulse-green 2s ease-in-out infinite;
    }

    .disconnected .status-indicator {
      background: #e74c3c;
      box-shadow: 0 0 8px rgba(231, 76, 60, 0.6);
    }

    @keyframes pulse-green {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `]
})
export class ConnectionStatusComponent {
  @Input() isConnected = false;
}
