import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, AuthUser } from '../../services/auth.service';
import { Subject, take, takeUntil } from 'rxjs';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-modal.component.html',
  styleUrls: ['./profile-modal.component.scss']
})
export class ProfileModalComponent implements OnInit, OnDestroy {
  @Input() user: AuthUser | null = null;
  @Output() closed = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  // Email
  email = '';
  emailSaving = false;
  emailSuccess = '';
  emailError = '';

  // Password
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  passwordSaving = false;
  passwordSuccess = '';
  passwordError = '';

  // Profile picture
  pictureSaving = false;
  pictureError = '';

  constructor(private authService: AuthService, private ngZone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.resetState();
    if (this.user) {
      this.email = this.user.email || '';
    }

    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.user = user;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private resetState(): void {
    this.emailSuccess = '';
    this.emailError = '';
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.passwordSuccess = '';
    this.passwordError = '';
    this.pictureError = '';
  }

  get profilePictureUrl(): string {
    if (this.user?.profilePicture) {
      return `data:image/png;base64,${this.user.profilePicture}`;
    }
    return '';
  }

  close(): void {
    this.closed.emit();
  }

  saveEmail(): void {
    if (!this.email.trim()) {
      this.emailError = 'Email is required';
      return;
    }
    this.emailSaving = true;
    this.emailError = '';
    this.emailSuccess = '';

    this.authService.updateEmail(this.email.trim()).pipe(take(1)).subscribe({
      next: () => {
        this.emailSaving = false;
        this.emailSuccess = 'Email updated';
      },
      error: (err) => {
        this.emailSaving = false;
        this.emailError = err?.error?.error || 'Failed to update email';
      }
    });
  }

  savePassword(): void {
    this.passwordError = '';
    this.passwordSuccess = '';

    if (!this.currentPassword) {
      this.passwordError = 'Current password is required';
      return;
    }
    if (!this.newPassword || this.newPassword.length < 4) {
      this.passwordError = 'New password must be at least 4 characters';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError = 'Passwords do not match';
      return;
    }

    this.passwordSaving = true;

    this.authService.updatePassword(this.currentPassword, this.newPassword).pipe(take(1)).subscribe({
      next: () => {
        this.passwordSaving = false;
        this.passwordSuccess = 'Password updated';
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
      },
      error: (err) => {
        this.passwordSaving = false;
        this.passwordError = err?.error?.error || 'Failed to update password';
      }
    });
  }

  onProfilePictureSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      this.pictureError = 'Please select an image file';
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.pictureError = 'Image must be under 2 MB';
      return;
    }

    this.pictureError = '';
    this.pictureSaving = true;

    const reader = new FileReader();
    reader.onload = () => {
      this.ngZone.run(() => {
        const base64 = (reader.result as string).split(',')[1];
        this.authService.updateProfilePicture(base64).pipe(take(1)).subscribe({
          next: () => {
            this.pictureSaving = false;
            this.cdr.detectChanges();
          },
          error: (err) => {
            this.pictureSaving = false;
            this.pictureError = err?.error?.error || 'Failed to update profile picture';
            this.cdr.detectChanges();
          }
        });
      });
    };
    reader.readAsDataURL(file);

    // Reset input so the same file can be re-selected
    input.value = '';
  }

  removeProfilePicture(): void {
    this.pictureSaving = true;
    this.pictureError = '';

    this.authService.updateProfilePicture('').pipe(take(1)).subscribe({
      next: () => {
        this.pictureSaving = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.pictureSaving = false;
        this.pictureError = err?.error?.error || 'Failed to remove profile picture';
        this.cdr.detectChanges();
      }
    });
  }
}
