import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { loadGoogleIdentityScript } from '../utils/googleIdentity';
import './AuthPages.css';

const API_URL = getApiBaseUrl();
const FALLBACK_GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '694472453686-36otnr1ml8rb9ellksorm79u3ubl1m1g.apps.googleusercontent.com';

const LoginPage = () => {
  const navigate = useNavigate();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  const [forgotData, setForgotData] = useState({
    email: '',
    otp: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [forgotStep, setForgotStep] = useState<'request' | 'reset'>('request');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(FALLBACK_GOOGLE_CLIENT_ID);
  const [googleButtonVisible, setGoogleButtonVisible] = useState(false);
  const [googleButtonInitializing, setGoogleButtonInitializing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  useEffect(() => {
    const hasRememberedSession = localStorage.getItem('rememberMe') === 'true' && !!localStorage.getItem('token');
    if (hasRememberedSession) {
      navigate('/home');
    }
  }, [navigate]);

  useEffect(() => {
    const fetchGoogleConfig = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/auth/google/config`);
        if (response.data?.clientId) {
          setGoogleClientId(response.data.clientId);
        }
      } catch {
        setGoogleClientId((prev: string) => prev || FALLBACK_GOOGLE_CLIENT_ID);
      }
    };
    fetchGoogleConfig();
  }, []);

  useEffect(() => {
    if (!googleClientId) return;
    let cancelled = false;
    setGoogleButtonInitializing(true);

    loadGoogleIdentityScript()
      .then(() => {
        if (!cancelled) {
          setGoogleReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleReady(false);
          setGoogleButtonInitializing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [googleClientId]);

  useEffect(() => {
    if (!googleReady || !googleButtonRef.current || !window.google?.accounts?.id || !googleClientId || showForgotPassword) {
      setGoogleButtonVisible(false);
      return;
    }

    const container = googleButtonRef.current;
    container.innerHTML = '';
    setGoogleButtonVisible(false);
    setGoogleButtonInitializing(true);

    const initializeAndRender = () => {
      if (!container || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setError('');
          setSuccess('');
          setGoogleLoading(true);
          try {
            const response = await axios.post(`${API_URL}/api/auth/google`, {
              idToken: credential,
              rememberMe: true
            });

            localStorage.setItem('token', response.data.token);
            localStorage.setItem('userId', response.data.user.id);
            localStorage.setItem('rememberMe', 'true');

            try {
              await axios.get(`${API_URL}/api/profiles/${response.data.user.id}`, {
                headers: { Authorization: `Bearer ${response.data.token}` }
              });
              navigate('/home');
            } catch {
              navigate('/create-profile');
            }
          } catch (err: any) {
            setError(err.response?.data?.error?.message || err.message || 'Google sign in failed');
          } finally {
            setGoogleLoading(false);
          }
        }
      });

      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        text: 'signin_with',
        shape: 'pill',
        size: 'large'
      });
    };

    initializeAndRender();
    let checks = 0;
    const maxChecks = 80; // up to 8s
    const checkInterval = window.setInterval(() => {
      checks += 1;
      const visible = container.childElementCount > 0;
      if (visible) {
        setGoogleButtonVisible(true);
        setGoogleButtonInitializing(false);
        window.clearInterval(checkInterval);
        return;
      }

      if (checks === 8 || checks === 20 || checks === 40) {
        initializeAndRender();
      }

      if (checks >= maxChecks) {
        setGoogleButtonInitializing(false);
        window.clearInterval(checkInterval);
      }
    }, 100);

    return () => window.clearInterval(checkInterval);
  }, [googleReady, googleClientId, navigate, showForgotPassword, formData.rememberMe]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
    setError('');
    setSuccess('');
  };

  const handleForgotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForgotData((prev) => ({ ...prev, [name]: value }));
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.email || !formData.password) {
      setError('All fields are required');
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        identifier: formData.email,
        password: formData.password,
        rememberMe: formData.rememberMe
      });

      // Store token
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('userId', response.data.user.id);
      localStorage.setItem('rememberMe', formData.rememberMe ? 'true' : 'false');

      // Check if user has profile
      try {
        await axios.get(`${API_URL}/api/profiles/${response.data.user.id}`, {
          headers: { Authorization: `Bearer ${response.data.token}` }
        });
        // Profile exists, go to homepage
        navigate('/home');
      } catch {
        // No profile, go to profile creation
        navigate('/create-profile');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!forgotData.email) {
      setError('Email is required');
      return;
    }

    setForgotLoading(true);
    try {
      await axios.post(`${API_URL}/api/auth/forgot-password/request-otp`, {
        email: forgotData.email
      });
      setForgotStep('reset');
      setSuccess('OTP sent. Check your email.');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Could not send OTP');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!forgotData.otp || !forgotData.newPassword || !forgotData.confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (forgotData.newPassword !== forgotData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setForgotLoading(true);
    try {
      await axios.post(`${API_URL}/api/auth/forgot-password/reset`, {
        email: forgotData.email,
        otp: forgotData.otp,
        newPassword: forgotData.newPassword
      });
      setForgotStep('request');
      setShowForgotPassword(false);
      setForgotData({ email: '', otp: '', newPassword: '', confirmPassword: '' });
      setSuccess('Password reset successful. Please login.');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Password reset failed');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="auth-page auth-page--login">
      {googleLoading && (
        <div className="auth-google-overlay" role="status" aria-live="polite" aria-label="Signing in with Google">
          <div className="auth-google-overlay__card">
            <div className="auth-google-overlay__spinner" aria-hidden="true" />
            <p className="auth-google-overlay__title">Signing in with Google</p>
            <p className="auth-google-overlay__subtitle">Completing authentication...</p>
          </div>
        </div>
      )}
      <div className="auth-container auth-container--login">
        <div className="auth-logo">
          <div className="auth-logo-ring"></div>
          <div className="auth-logo-pulse"></div>
        </div>

        <h1>
          Welcome to <span className="auth-title-highlight">HiveMate</span>
        </h1>
        <p className="auth-subtitle">Sign in to continue building your network.</p>

        {!showForgotPassword ? (
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <div className="form-group">
            <label htmlFor="email">Email Or Username</label>
            <input
              type="text"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com or username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <label className="auth-checkbox">
            <input
              type="checkbox"
              name="rememberMe"
              checked={formData.rememberMe}
              onChange={handleChange}
            />
            <span>Remember me</span>
          </label>

          <button
            type="button"
            className="auth-text-button"
            onClick={() => {
              setShowForgotPassword(true);
              setError('');
              setSuccess('');
              setForgotData((prev) => ({ ...prev, email: formData.email }));
            }}
          >
            Forgot password?
          </button>

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Signing In...' : 'Sign In'}
          </button>

          <div className="auth-social-divider">
            <span>or</span>
          </div>
          {googleClientId ? (
            <div className={`google-signin-shell${googleLoading ? ' google-signin-shell--busy' : ''}`}>
              <div ref={googleButtonRef} className="google-signin-button" />
              {!googleButtonVisible && googleButtonInitializing && (
                <p className="status-note status-note--animated" role="status" aria-live="polite">
                  <span className="status-note-spinner" aria-hidden="true" />
                  Loading Google sign in...
                </p>
              )}
            </div>
          ) : null}
        </form>
        ) : (
          <form onSubmit={forgotStep === 'request' ? handleForgotRequestOtp : handleForgotReset} className="auth-form">
            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <div className="form-group">
              <label htmlFor="forgotEmail">Email Address</label>
              <input
                type="email"
                id="forgotEmail"
                name="email"
                value={forgotData.email}
                onChange={handleForgotChange}
                placeholder="your@email.com"
                required
              />
            </div>

            {forgotStep === 'reset' && (
              <>
                <div className="form-group">
                  <label htmlFor="otp">OTP</label>
                  <input
                    type="text"
                    id="otp"
                    name="otp"
                    value={forgotData.otp}
                    onChange={handleForgotChange}
                    placeholder="6-digit code"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <input
                    type={showForgotPassword ? (showPassword ? 'text' : 'password') : 'password'}
                    id="newPassword"
                    name="newPassword"
                    value={forgotData.newPassword}
                    onChange={handleForgotChange}
                    placeholder="Enter new password"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirmNewPassword">Confirm New Password</label>
                  <input
                    type={showForgotPassword ? (showPassword ? 'text' : 'password') : 'password'}
                    id="confirmNewPassword"
                    name="confirmPassword"
                    value={forgotData.confirmPassword}
                    onChange={handleForgotChange}
                    placeholder="Confirm new password"
                    required
                  />
                </div>
              </>
            )}

            <button type="submit" className="auth-button" disabled={forgotLoading}>
              {forgotLoading
                ? forgotStep === 'request' ? 'Sending OTP...' : 'Resetting...'
                : forgotStep === 'request' ? 'Send OTP' : 'Reset Password'}
            </button>

            <div className="auth-actions-row">
              {forgotStep === 'reset' && (
                <button
                  type="button"
                  className="auth-text-button"
                  onClick={() => setForgotStep('request')}
                >
                  Resend OTP
                </button>
              )}
              <button
                type="button"
                className="auth-text-button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setForgotStep('request');
                  setError('');
                  setSuccess('');
                }}
              >
                Back to login
              </button>
            </div>
          </form>
        )}

        <p className="auth-link">
          Don't have an account? <span onClick={() => navigate('/register')}>Sign Up</span>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
