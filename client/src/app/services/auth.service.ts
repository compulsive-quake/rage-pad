import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AuthUser {
  userId: number;
  username: string;
  email?: string;
  profilePicture?: string;
}

export interface LoginResponse {
  id: number;
  token: string;
  username: string;
  email: string;
}

export interface RegisterResponse {
  id: number;
  token: string;
  username: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly TOKEN_KEY = 'rage_auth_token';
  private readonly STORE_URL_KEY = 'rage_store_url';

  private loggedIn$ = new BehaviorSubject<boolean>(this.hasToken());
  private currentUser$ = new BehaviorSubject<AuthUser | null>(null);

  get isLoggedIn$(): Observable<boolean> {
    return this.loggedIn$.asObservable();
  }

  get isLoggedIn(): boolean {
    return this.loggedIn$.value;
  }

  get user$(): Observable<AuthUser | null> {
    return this.currentUser$.asObservable();
  }

  get user(): AuthUser | null {
    return this.currentUser$.value;
  }

  get token(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  get storeServerUrl(): string {
    return localStorage.getItem(this.STORE_URL_KEY) || environment.storeServerUrl;
  }

  set storeServerUrl(url: string) {
    localStorage.setItem(this.STORE_URL_KEY, url);
  }

  constructor(private http: HttpClient) {}

  private hasToken(): boolean {
    return !!localStorage.getItem(this.TOKEN_KEY);
  }

  private get apiUrl(): string {
    return `${this.storeServerUrl}/api`;
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/login`, { username, password }).pipe(
      tap(res => {
        localStorage.setItem(this.TOKEN_KEY, res.token);
        this.loggedIn$.next(true);
        this.syncAuthTokenToServer(res.token);
      })
    );
  }

  register(username: string, email: string, password: string): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.apiUrl}/auth/register`, { username, email, password }).pipe(
      tap(res => {
        localStorage.setItem(this.TOKEN_KEY, res.token);
        this.loggedIn$.next(true);
        this.syncAuthTokenToServer(res.token);
      })
    );
  }

  verifyToken(): Observable<AuthUser | null> {
    const token = this.token;
    if (!token) {
      this.loggedIn$.next(false);
      return of(null);
    }

    return this.http.get<AuthUser>(`${this.apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    }).pipe(
      tap(user => {
        this.loggedIn$.next(true);
        this.currentUser$.next(user);
        this.syncAuthTokenToServer(token);
      }),
      catchError(() => {
        this.logout();
        return of(null);
      })
    );
  }

  private get authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  updateEmail(email: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/auth/profile/email`, { email }, {
      headers: this.authHeaders
    }).pipe(
      tap(() => {
        const user = this.currentUser$.value;
        if (user) {
          this.currentUser$.next({ ...user, email });
        }
      })
    );
  }

  updatePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/auth/profile/password`, {
      currentPassword, newPassword
    }, { headers: this.authHeaders });
  }

  updateProfilePicture(profilePicture: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/auth/profile/picture`, { profilePicture }, {
      headers: this.authHeaders
    }).pipe(
      tap(() => {
        const user = this.currentUser$.value;
        if (user) {
          this.currentUser$.next({ ...user, profilePicture });
        }
      })
    );
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    this.loggedIn$.next(false);
    this.currentUser$.next(null);
    this.syncAuthTokenToServer('');
  }

  /** Persist the store auth token to the rage-pad server so store-sync can use it */
  private syncAuthTokenToServer(token: string): void {
    this.http.put('/api/settings', { storeAuthToken: token }).subscribe({
      error: () => { /* best-effort */ }
    });
  }
}
