import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="search-container">
      <div class="search-input-wrapper">
        <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input 
          type="text" 
          class="search-input"
          placeholder="Search sounds..."
          [(ngModel)]="searchQuery"
          (input)="onSearch()"
          (keyup.enter)="onSearch()"
        />
        <button 
          *ngIf="searchQuery" 
          class="clear-btn"
          (click)="clearSearch()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .search-container {
      width: 100%;
      max-width: 500px;
    }

    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 1rem;
      width: 20px;
      height: 20px;
      color: rgba(255, 255, 255, 0.5);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: 0.875rem 3rem;
      font-size: 1rem;
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 50px;
      outline: none;
      transition: all 0.3s ease;
    }

    .search-input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    .search-input:focus {
      background: rgba(255, 255, 255, 0.15);
      border-color: #9b59b6;
      box-shadow: 0 0 20px rgba(155, 89, 182, 0.3);
    }

    .clear-btn {
      position: absolute;
      right: 0.75rem;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .clear-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .clear-btn svg {
      width: 16px;
      height: 16px;
      color: rgba(255, 255, 255, 0.7);
    }
  `]
})
export class SearchBarComponent {
  searchQuery = '';
  @Output() search = new EventEmitter<string>();

  onSearch(): void {
    this.search.emit(this.searchQuery);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.search.emit('');
  }
}
