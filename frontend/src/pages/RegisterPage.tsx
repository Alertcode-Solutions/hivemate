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

const RegisterPage = () => {
  const navigate = useNavigate();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState<'register' | 'verify'>('register');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [otp, setOtp] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [devOtpHint, setDevOtpHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(FALLBACK_GOOGLE_CLIENT_ID);
  const [googleButtonVisible, setGoogleButtonVisible] = useState(false);
  const [googleButtonInitializing, setGoogleButtonInitializing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

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
    if (!googleReady || !googleButtonRef.current || !window.google?.accounts?.id || !googleClientId || step !== 'register') {
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
          setInfoMessage('');
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
            setError(err.response?.data?.error?.message || err.message || 'Google sign up failed');
          } finally {
            setGoogleLoading(false);
          }
        }
      });

      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        text: 'signup_with',
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
  }, [googleReady, googleClientId, step, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
    setInfoMessage('');
  };

  const getPasswordStrength = (password: string) => {
    if (password.length === 0) return 0;
    if (password.length < 6) return 1;
    if (password.length < 10) return 2;
    if (password.length >= 10 && /[A-Z]/.test(password) && /[0-9]/.test(password)) return 4;
    return 3;
  };

  const passwordStrength = getPasswordStrength(formData.password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    setDevOtpHint('');

    // Validation
    if (!formData.email || !formData.password || !formData.confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/auth/register`, {
        email: formData.email,
        password: formData.password
      });

      setPendingEmail(response.data.user.email || formData.email);
      setStep('verify');
      if (response.data?.otpDelivered === false && response.data?.devOtp) {
        setInfoMessage('Email sending failed in development. Use this OTP.');
        setDevOtpHint(`Dev OTP: ${response.data.devOtp}`);
      } else {
        setInfoMessage('OTP sent to your email. Enter it to verify your account.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (!otp) {
      setError('OTP is required');
      return;
    }

    setVerifyLoading(true);
    try {
      const response = await axios.post(`${API_URL}/api/auth/verify-email`, {
        email: pendingEmail,
        otp,
        rememberMe
      });

      localStorage.setItem('token', response.data.token);
      localStorage.setItem('userId', response.data.user.id);
      localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
      navigate('/create-profile');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'OTP verification failed');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    setInfoMessage('');
    setDevOtpHint('');
    if (!pendingEmail) return;

    setVerifyLoading(true);
    try {
      const response = await axios.post(`${API_URL}/api/auth/resend-signup-otp`, {
        email: pendingEmail
      });
      if (response.data?.otpDelivered === false && response.data?.devOtp) {
        setInfoMessage('Email sending failed in development. Use this OTP.');
        setDevOtpHint(`Dev OTP: ${response.data.devOtp}`);
      } else {
        setInfoMessage('OTP sent again. Check your email.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Failed to resend OTP');
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="auth-page auth-page--register">
      {googleLoading && (
        <div className="auth-google-overlay" role="status" aria-live="polite" aria-label="Signing up with Google">
          <div className="auth-google-overlay__card">
            <div className="auth-google-overlay__spinner" aria-hidden="true" />
            <p className="auth-google-overlay__title">Signing up with Google</p>
            <p className="auth-google-overlay__subtitle">Completing authentication...</p>
          </div>
        </div>
      )}
      <div className="auth-container auth-container--register">
        <div className="auth-logo">
          <div className="auth-logo-ring"></div>
          <div className="auth-logo-pulse"></div>
        </div>

        <h1>
          {step === 'register' ? (
            <>Join <span className="auth-title-highlight">HiveMate</span></>
          ) : (
            <>Verify <span className="auth-title-highlight">Your Email</span></>
          )}
        </h1>
        <p className="auth-subtitle">
          {step === 'register'
            ? 'Create your profile and start discovering people nearby.'
            : `Enter the OTP sent to ${pendingEmail}`}
        </p>

        {step === 'register' ? (
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="error-message">{error}</div>}
          {infoMessage && <div className="success-message">{infoMessage}</div>}
          {devOtpHint && <div className="dev-otp-hint">{devOtpHint}</div>}

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
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
                placeholder="At least 8 characters"
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
            {formData.password && (
              <div className="password-strength">
                <div className={`strength-bar ${passwordStrength >= 1 ? 'active weak' : ''}`}></div>
                <div className={`strength-bar ${passwordStrength >= 2 ? 'active medium' : ''}`}></div>
                <div className={`strength-bar ${passwordStrength >= 3 ? 'active' : ''}`}></div>
                <div className={`strength-bar ${passwordStrength >= 4 ? 'active strong' : ''}`}></div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <div className="password-input-wrapper">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Re-enter password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? (
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

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Creating Account...' : 'Create Account'}
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
                  Loading Google sign up...
                </p>
              )}
            </div>
          ) : null}
        </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="auth-form">
            {error && <div className="error-message">{error}</div>}
            {infoMessage && (
              <>
                <div className="success-message">{infoMessage}</div>
                <div className="otp-spam-note">Info: Check your spam folder for emails from MojoAuth.</div>
              </>
            )}
            {devOtpHint && <div className="dev-otp-hint">{devOtpHint}</div>}
            <div className="form-group">
              <label htmlFor="otp">OTP</label>
              <input
                type="text"
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit code"
                required
              />
            </div>

            <label className="auth-checkbox">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me on this device</span>
            </label>

            <button type="submit" className="auth-button" disabled={verifyLoading}>
              {verifyLoading ? 'Verifying...' : 'Verify Email'}
            </button>

            <div className="auth-actions-row">
              <button type="button" className="auth-text-button" onClick={handleResendOtp} disabled={verifyLoading}>
                Resend OTP
              </button>
              <button
                type="button"
                className="auth-text-button"
                onClick={() => {
                  setStep('register');
                  setOtp('');
                  setError('');
                  setInfoMessage('');
                  setDevOtpHint('');
                }}
                disabled={verifyLoading}
              >
                Back
              </button>
            </div>
          </form>
        )}

        <p className="auth-link">
          Already have an account? <span onClick={() => navigate('/login')}>Sign In</span>
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
