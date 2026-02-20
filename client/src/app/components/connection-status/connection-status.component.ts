import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-connection-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="connection-status" [class.connected]="isConnected" [class.disconnected]="!isConnected">
      <div class="status-indicator"></div>
      <span class="status-text">
        {{ isConnected ? 'Connected to Soundpad' : 'Disconnected' }}
      </span>
    </div>
  `,
  styles: [`
    .connection-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.3s ease;
    }

    .connection-status.connected {
      background: rgba(46, 204, 113, 0.2);
      color: #2ecc71;
    }

    .connection-status.disconnected {
      background: rgba(231, 76, 60, 0.2);
      color: #e74c3c;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: all 0.3s ease;
    }

    .connected .status-indicator {
      background: #2ecc71;
      box-shadow: 0 0 10px rgba(46, 204, 113, 0.5);
      animation: pulse-green 2s ease-in-out infinite;
    }

    .disconnected .status-indicator {
      background: #e74c3c;
      box-shadow: 0 0 10px rgba(231, 76, 60, 0.5);
    }

    @keyframes pulse-green {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .status-text {
      white-space: nowrap;
    }
  `]
})
export class ConnectionStatusComponent {
  @Input() isConnected = false;
}
