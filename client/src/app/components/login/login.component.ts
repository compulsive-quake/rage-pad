import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  @Output() loggedIn = new EventEmitter<void>();

  isRegisterMode = false;
  username = '';
  email = '';
  password = '';
  confirmPassword = '';
  storeServerUrl: string;
  error = '';
  isLoading = false;

  constructor(private authService: AuthService) {
    this.storeServerUrl = authService.storeServerUrl;
  }

  toggleMode(): void {
    this.isRegisterMode = !this.isRegisterMode;
    this.error = '';
  }

  onSubmit(): void {
    this.error = '';

    // Save server URL
    this.authService.storeServerUrl = this.storeServerUrl.trim() || 'http://localhost:9090';

    if (this.isRegisterMode) {
      this.doRegister();
    } else {
      this.doLogin();
    }
  }

  private doLogin(): void {
    if (!this.username.trim() || !this.password) {
      this.error = 'Username and password are required';
      return;
    }

    this.isLoading = true;
    this.authService.login(this.username.trim(), this.password).subscribe({
      next: () => {
        this.isLoading = false;
        this.loggedIn.emit();
      },
      error: (err) => {
        this.isLoading = false;
        if (err.status === 0) {
          this.error = 'Could not connect to server. Check that the server is running and the URL is correct.';
        } else {
          this.error = err?.error?.error || 'Invalid username or password.';
        }
      }
    });
  }

  private doRegister(): void {
    if (!this.username.trim() || !this.email.trim() || !this.password) {
      this.error = 'All fields are required';
      return;
    }

    if (this.password.length < 4) {
      this.error = 'Password must be at least 4 characters';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match';
      return;
    }

    this.isLoading = true;
    this.authService.register(this.username.trim(), this.email.trim(), this.password).subscribe({
      next: () => {
        this.isLoading = false;
        this.loggedIn.emit();
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.error || 'Registration failed. Check your server URL.';
      }
    });
  }
}
