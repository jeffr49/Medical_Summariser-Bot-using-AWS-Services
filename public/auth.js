const AUTH_API_BASE = window.location.origin;

async function signup(email, password, attributes = {}) {
    try {
        const response = await fetch(`${AUTH_API_BASE}/api/auth/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                password,
                ...attributes
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            return { success: true, ...data };
        } else {
            return { success: false, error: data.error || 'Sign up failed' };
        }
    } catch (error) {
        return { success: false, error: error.message || 'Network error' };
    }
}

async function confirmSignup(email, code) {
    try {
        const response = await fetch(`${AUTH_API_BASE}/api/auth/confirm`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                code
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            return { success: true, ...data };
        } else {
            return { success: false, error: data.error || 'Verification failed' };
        }
    } catch (error) {
        return { success: false, error: error.message || 'Network error' };
    }
}

async function login(email, password) {
    try {
        const response = await fetch(`${AUTH_API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                password
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            if (data.requiresNewPassword) {
                return {
                    success: false,
                    requiresNewPassword: true,
                    session: data.session,
                    challengeParameters: data.challengeParameters,
                    error: data.message || 'NEW_PASSWORD_REQUIRED'
                };
            }
            return { success: true, ...data };
        } else {
            return { success: false, error: data.error || 'Login failed' };
        }
    } catch (error) {
        return { success: false, error: error.message || 'Network error' };
    }
}

async function getCurrentUser() {
    try {
        const token = localStorage.getItem('accessToken');
        if (!token) {
            return { success: false, error: 'No token found' };
        }

        const response = await fetch(`${AUTH_API_BASE}/api/auth/me`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        
        if (response.ok) {
            return { success: true, user: data };
        } else {
            if (response.status === 401 || response.status === 403) {
                logout();
            }
            return { success: false, error: data.error || 'Failed to get user' };
        }
    } catch (error) {
        return { success: false, error: error.message || 'Network error' };
    }
}

async function logout() {
    try {
        const token = localStorage.getItem('accessToken');
        
        if (token) {
            await fetch(`${AUTH_API_BASE}/api/auth/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        }
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('idToken');
        localStorage.removeItem('refreshToken');
        window.location.href = 'login.html';
    }
}

function isAuthenticated() {
    return !!localStorage.getItem('accessToken');
}

function getAuthToken() {
    return localStorage.getItem('accessToken');
}

async function authenticatedFetch(url, options = {}) {
    const token = getAuthToken();
    
    if (!token) {
        throw new Error('Not authenticated');
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (response.status === 401 || response.status === 403) {
        logout();
        throw new Error('Authentication failed');
    }

    return response;
}

