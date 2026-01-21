/**
 * LibRead Auth Client
 * Handles user authentication and session management
 */

class AuthClient {
    constructor() {
        this.baseUrl = '/api/auth';
        this.token = localStorage.getItem('libread_token');
        this.user = JSON.parse(localStorage.getItem('libread_user') || 'null');
        this.listeners = [];
    }

    // Add listener for auth state changes
    onAuthChange(callback) {
        this.listeners.push(callback);
    }

    notifyListeners() {
        this.listeners.forEach(cb => cb(this.user, this.isLoggedIn()));
    }

    isLoggedIn() {
        return !!this.token && !!this.user;
    }

    getToken() {
        return this.token;
    }

    getUser() {
        return this.user;
    }

    getAuthHeaders() {
        if (!this.token) return {};
        return { 'Authorization': `Bearer ${this.token}` };
    }

    async register(email, username, password) {
        try {
            const response = await fetch(`${this.baseUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, username, password })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }

            this.setSession(data.token, data.user);
            return { success: true, user: data.user };

        } catch (error) {
            console.error('[Auth] Registration error:', error);
            return { success: false, error: error.message };
        }
    }

    async login(login, password) {
        try {
            const response = await fetch(`${this.baseUrl}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login, password })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            this.setSession(data.token, data.user);
            return { success: true, user: data.user };

        } catch (error) {
            console.error('[Auth] Login error:', error);
            return { success: false, error: error.message };
        }
    }

    async getProfile() {
        try {
            const response = await fetch(`${this.baseUrl}/me`, {
                headers: this.getAuthHeaders()
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    this.logout();
                }
                throw new Error('Failed to get profile');
            }

            const data = await response.json();
            this.user = data.user;
            localStorage.setItem('libread_user', JSON.stringify(data.user));
            
            return { success: true, user: data.user, stats: data.stats };

        } catch (error) {
            console.error('[Auth] Get profile error:', error);
            return { success: false, error: error.message };
        }
    }

    async updatePreferences(preferences) {
        try {
            const response = await fetch(`${this.baseUrl}/preferences`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify(preferences)
            });

            if (!response.ok) {
                throw new Error('Failed to update preferences');
            }

            // Update local user data
            if (this.user) {
                this.user.preferences = { ...this.user.preferences, ...preferences };
                localStorage.setItem('libread_user', JSON.stringify(this.user));
            }

            return { success: true };

        } catch (error) {
            console.error('[Auth] Update preferences error:', error);
            return { success: false, error: error.message };
        }
    }

    async changePassword(currentPassword, newPassword) {
        try {
            const response = await fetch(`${this.baseUrl}/change-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to change password');
            }

            return { success: true };

        } catch (error) {
            console.error('[Auth] Change password error:', error);
            return { success: false, error: error.message };
        }
    }

    async verifyToken() {
        if (!this.token) return false;

        try {
            const response = await fetch(`${this.baseUrl}/verify`, {
                headers: this.getAuthHeaders()
            });

            if (!response.ok) {
                this.logout();
                return false;
            }

            return true;

        } catch (error) {
            console.error('[Auth] Token verification error:', error);
            return false;
        }
    }

    setSession(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('libread_token', token);
        localStorage.setItem('libread_user', JSON.stringify(user));
        this.notifyListeners();
    }

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('libread_token');
        localStorage.removeItem('libread_user');
        this.notifyListeners();
    }
}

/**
 * Library Client
 * Handles library operations (books, progress, bookmarks, stats)
 */
class LibraryClient {
    constructor(authClient) {
        this.baseUrl = '/api/library';
        this.auth = authClient;
    }

    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...this.auth.getAuthHeaders()
        };

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers }
        });

        if (response.status === 401 || response.status === 403) {
            this.auth.logout();
            throw new Error('Session expired. Please log in again.');
        }

        return response;
    }

    // Library management
    async getLibrary(status = null, sort = 'updated_at', order = 'desc') {
        try {
            const params = new URLSearchParams({ sort, order });
            if (status) params.append('status', status);

            const response = await this.request(`?${params}`);
            if (!response.ok) throw new Error('Failed to get library');

            return await response.json();

        } catch (error) {
            console.error('[Library] Get library error:', error);
            return { books: [], total: 0 };
        }
    }

    async addBook(novelUrl, novelTitle, novelCover, author, totalChapters) {
        try {
            const response = await this.request('', {
                method: 'POST',
                body: JSON.stringify({ novelUrl, novelTitle, novelCover, author, totalChapters })
            });

            const data = await response.json();
            if (!response.ok) {
                if (response.status === 409) {
                    return { success: false, error: 'Book already in library', libraryId: data.libraryId };
                }
                throw new Error(data.error);
            }

            return { success: true, ...data };

        } catch (error) {
            console.error('[Library] Add book error:', error);
            return { success: false, error: error.message };
        }
    }

    async getBook(libraryId) {
        try {
            const response = await this.request(`/${libraryId}`);
            if (!response.ok) throw new Error('Failed to get book');

            return await response.json();

        } catch (error) {
            console.error('[Library] Get book error:', error);
            return null;
        }
    }

    async updateBook(libraryId, updates) {
        try {
            const response = await this.request(`/${libraryId}`, {
                method: 'PATCH',
                body: JSON.stringify(updates)
            });

            if (!response.ok) throw new Error('Failed to update book');
            return { success: true };

        } catch (error) {
            console.error('[Library] Update book error:', error);
            return { success: false, error: error.message };
        }
    }

    async removeBook(libraryId) {
        try {
            const response = await this.request(`/${libraryId}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Failed to remove book');
            return { success: true };

        } catch (error) {
            console.error('[Library] Remove book error:', error);
            return { success: false, error: error.message };
        }
    }

    // Get library entry by novel URL
    async findBookByUrl(novelUrl) {
        const { books } = await this.getLibrary();
        return books.find(b => b.novelUrl === novelUrl);
    }

    // Reading progress
    async updateProgress(libraryId, chapterIndex, chapterTitle, chapterUrl, scrollPosition) {
        try {
            const response = await this.request(`/${libraryId}/progress`, {
                method: 'PUT',
                body: JSON.stringify({ chapterIndex, chapterTitle, chapterUrl, scrollPosition })
            });

            if (!response.ok) throw new Error('Failed to update progress');
            return { success: true };

        } catch (error) {
            console.error('[Library] Update progress error:', error);
            return { success: false, error: error.message };
        }
    }

    // Bookmarks
    async getBookmarks(libraryId) {
        try {
            const response = await this.request(`/${libraryId}/bookmarks`);
            if (!response.ok) throw new Error('Failed to get bookmarks');

            return await response.json();

        } catch (error) {
            console.error('[Library] Get bookmarks error:', error);
            return { bookmarks: [] };
        }
    }

    async addBookmark(libraryId, chapterIndex, chapterTitle, position, note) {
        try {
            const response = await this.request(`/${libraryId}/bookmarks`, {
                method: 'POST',
                body: JSON.stringify({ chapterIndex, chapterTitle, position, note })
            });

            if (!response.ok) throw new Error('Failed to add bookmark');
            return await response.json();

        } catch (error) {
            console.error('[Library] Add bookmark error:', error);
            return { success: false, error: error.message };
        }
    }

    async removeBookmark(libraryId, bookmarkId) {
        try {
            const response = await this.request(`/${libraryId}/bookmarks/${bookmarkId}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Failed to remove bookmark');
            return { success: true };

        } catch (error) {
            console.error('[Library] Remove bookmark error:', error);
            return { success: false, error: error.message };
        }
    }

    // Statistics
    async updateStats(libraryId, timeSpent, wordsRead, chaptersRead) {
        try {
            const response = await this.request(`/${libraryId}/stats`, {
                method: 'POST',
                body: JSON.stringify({ timeSpent, wordsRead, chaptersRead })
            });

            if (!response.ok) throw new Error('Failed to update stats');
            return { success: true };

        } catch (error) {
            console.error('[Library] Update stats error:', error);
            return { success: false, error: error.message };
        }
    }

    async getStats(days = 30) {
        try {
            const response = await this.request(`/stats/summary?days=${days}`);
            if (!response.ok) throw new Error('Failed to get stats');

            return await response.json();

        } catch (error) {
            console.error('[Library] Get stats error:', error);
            return null;
        }
    }

    // Import/Export
    async exportData() {
        try {
            const response = await this.request('/export');
            if (!response.ok) throw new Error('Failed to export data');

            return await response.json();

        } catch (error) {
            console.error('[Library] Export error:', error);
            return null;
        }
    }

    async importData(data) {
        try {
            const response = await this.request('/import', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            if (!response.ok) throw new Error('Failed to import data');
            return await response.json();

        } catch (error) {
            console.error('[Library] Import error:', error);
            return { success: false, error: error.message };
        }
    }
}

// Initialize global instances
const authClient = new AuthClient();
const libraryClient = new LibraryClient(authClient);

// Export for use in app.js
window.authClient = authClient;
window.libraryClient = libraryClient;
