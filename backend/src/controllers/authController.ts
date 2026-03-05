import { Request, Response } from 'express';
import User from '../models/User';
import { hashPassword, comparePassword, validatePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { SessionService } from '../services/sessionService';
import { OtpService } from '../services/otpService';
import { EmailService } from '../services/emailService';
import { OAuth2Client } from 'google-auth-library';

const DEFAULT_SESSION_TTL = 86400; // 24 hours
const REMEMBER_ME_SESSION_TTL = parseInt(process.env.REMEMBER_ME_SESSION_TTL_SECONDS || `${30 * 24 * 60 * 60}`, 10);
const REMEMBER_ME_JWT_EXPIRES_IN = process.env.REMEMBER_ME_JWT_EXPIRES_IN || '30d';
const FALLBACK_GOOGLE_CLIENT_ID = '694472453686-36otnr1ml8rb9ellksorm79u3ubl1m1g.apps.googleusercontent.com';
const getGoogleClientId = () => process.env.GOOGLE_CLIENT_ID || FALLBACK_GOOGLE_CLIENT_ID;
const getGoogleClient = () => {
  const clientId = getGoogleClientId();
  return clientId ? new OAuth2Client(clientId) : null;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeUsername = (username: string) => username.trim().toLowerCase();
const isProduction = process.env.NODE_ENV === 'production';

const sendOtpWithEnvFallback = async (email: string, otp: string, purpose: 'signup' | 'forgot_password' | 'change_password') => {
  if (OtpService.usesManagedProvider() && !otp) {
    return { delivered: true as const, devOtp: null as string | null };
  }

  try {
    await EmailService.sendOtpEmail(email, otp, purpose);
    return { delivered: true as const, devOtp: null as string | null };
  } catch (error: any) {
    if (!isProduction) {
      console.warn(`OTP email delivery failed for ${purpose} (${email}) in non-production. Falling back to API response OTP.`, error?.message);
      return { delivered: false as const, devOtp: otp };
    }
    throw error;
  }
};

export const getGoogleConfig = async (_req: Request, res: Response) => {
  const clientId = getGoogleClientId();
  return res.json({
    enabled: Boolean(clientId),
    clientId: clientId || null
  });
};

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email || '');

    // Validation
    if (!normalizedEmail || !password) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_EMAIL',
          message: 'Invalid email format',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: passwordValidation.message,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      if (!existingUser.emailVerified) {
        const otp = await OtpService.createOtp(existingUser.email, 'signup');
        const delivery = await sendOtpWithEnvFallback(existingUser.email, otp, 'signup');

        return res.status(200).json({
          message: 'Account exists but email is not verified. OTP sent again.',
          user: {
            id: existingUser._id,
            email: existingUser.email,
            emailVerified: false
          },
          requiresEmailVerification: true,
          otpDelivered: delivery.delivered,
          devOtp: delivery.devOtp
        });
      }

      return res.status(409).json({
        error: {
          code: 'USER_EXISTS',
          message: 'User with this email already exists',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = new User({
      email: normalizedEmail,
      passwordHash,
      emailVerified: false,
      createdAt: new Date(),
      lastLogin: new Date()
    });

    await user.save();

    // Send mandatory verification OTP
    const otp = await OtpService.createOtp(user.email, 'signup');
    const delivery = await sendOtpWithEnvFallback(user.email, otp, 'signup');

    res.status(201).json({
      message: 'Registration successful. Verify your email with OTP to continue.',
      user: {
        id: user._id,
        email: user.email,
        createdAt: user.createdAt,
        emailVerified: false
      },
      requiresEmailVerification: true,
      otpDelivered: delivery.delivered,
      devOtp: delivery.devOtp
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred during registration',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, identifier, password, rememberMe } = req.body;
    const rawIdentifier = String(identifier || email || '').trim();
    const normalizedIdentifier = rawIdentifier.toLowerCase();

    // Validation
    if (!normalizedIdentifier || !password) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email/username and password are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Find user by email or username
    const identifierFilter = normalizedIdentifier.includes('@')
      ? { email: normalizeEmail(normalizedIdentifier) }
      : { username: normalizeUsername(normalizedIdentifier) };

    const user = await User.findOne(identifierFilter);
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Mandatory email verification
    if (!user.emailVerified) {
      return res.status(403).json({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email with OTP before logging in',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const useRememberMe = Boolean(rememberMe);
    const tokenExpiry = useRememberMe ? REMEMBER_ME_JWT_EXPIRES_IN : undefined;
    const token = generateToken({
      userId: user._id.toString(),
      email: user.email
    }, tokenExpiry);

    // Store session in Redis
    await SessionService.createSession(
      user._id.toString(),
      token,
      useRememberMe ? REMEMBER_ME_SESSION_TTL : DEFAULT_SESSION_TTL
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        lastLogin: user.lastLogin
      },
      rememberMe: useRememberMe,
      token
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred during login',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    if (userId) {
      // Remove session from Redis
      await SessionService.deleteSession(userId);
    }

    res.json({
      message: 'Logout successful'
    });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred during logout',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const googleLogin = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Google ID token is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const googleClientId = getGoogleClientId();
    const googleClient = getGoogleClient();
    if (!googleClient || !googleClientId) {
      return res.status(500).json({
        error: {
          code: 'GOOGLE_NOT_CONFIGURED',
          message: 'Google login is not configured on server',
          timestamp: new Date().toISOString()
        }
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: googleClientId
    });
    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email || '');

    if (!email) {
      return res.status(400).json({
        error: {
          code: 'INVALID_GOOGLE_TOKEN',
          message: 'Google token does not contain a valid email',
          timestamp: new Date().toISOString()
        }
      });
    }

    let user = await User.findOne({ email });
    if (!user) {
      const passwordHash = await hashPassword(`google-oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      user = new User({
        email,
        passwordHash,
        emailVerified: true,
        createdAt: new Date(),
        lastLogin: new Date(),
        status: 'active'
      });
      await user.save();
    } else {
      if (user.status !== 'active') {
        return res.status(403).json({
          error: {
            code: 'ACCOUNT_SUSPENDED',
            message: 'Your account has been suspended',
            timestamp: new Date().toISOString()
          }
        });
      }
      if (!user.emailVerified) {
        user.emailVerified = true;
      }
      user.lastLogin = new Date();
      await user.save();
    }

    // Google sign-in should stay active until explicit logout.
    const useRememberMe = true;
    const tokenExpiry = useRememberMe ? REMEMBER_ME_JWT_EXPIRES_IN : undefined;
    const token = generateToken({
      userId: user._id.toString(),
      email: user.email
    }, tokenExpiry);

    await SessionService.createSession(
      user._id.toString(),
      token,
      useRememberMe ? REMEMBER_ME_SESSION_TTL : DEFAULT_SESSION_TTL
    );

    return res.json({
      message: 'Google login successful',
      user: {
        id: user._id,
        email: user.email,
        lastLogin: user.lastLogin
      },
      rememberMe: useRememberMe,
      token
    });
  } catch (error: any) {
    console.error('Google login error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred during Google login',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const verifyEmailOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp, rememberMe } = req.body;
    const normalizedEmail = normalizeEmail(email || '');

    if (!normalizedEmail || !otp) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and OTP are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isValidOtp = await OtpService.verifyOtp(normalizedEmail, 'signup', otp);
    if (!isValidOtp) {
      return res.status(400).json({
        error: {
          code: 'INVALID_OTP',
          message: 'Invalid or expired OTP',
          timestamp: new Date().toISOString()
        }
      });
    }

    user.emailVerified = true;
    user.lastLogin = new Date();
    await user.save();

    const useRememberMe = Boolean(rememberMe);
    const token = generateToken(
      { userId: user._id.toString(), email: user.email },
      useRememberMe ? REMEMBER_ME_JWT_EXPIRES_IN : undefined
    );
    await SessionService.createSession(
      user._id.toString(),
      token,
      useRememberMe ? REMEMBER_ME_SESSION_TTL : DEFAULT_SESSION_TTL
    );

    return res.json({
      message: 'Email verified successfully',
      user: {
        id: user._id,
        email: user.email,
        emailVerified: user.emailVerified,
        lastLogin: user.lastLogin
      },
      rememberMe: useRememberMe,
      token
    });
  } catch (error: any) {
    console.error('Verify email OTP error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while verifying OTP',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const resendSignupOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const normalizedEmail = normalizeEmail(email || '');

    if (!normalizedEmail) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'Email is already verified',
          timestamp: new Date().toISOString()
        }
      });
    }

    const otp = await OtpService.createOtp(user.email, 'signup');
    const delivery = await sendOtpWithEnvFallback(user.email, otp, 'signup');

    return res.json({
      message: 'OTP sent successfully',
      otpDelivered: delivery.delivered,
      devOtp: delivery.devOtp
    });
  } catch (error: any) {
    console.error('Resend signup OTP error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while resending OTP',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const requestForgotPasswordOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const normalizedEmail = normalizeEmail(email || '');

    if (!normalizedEmail) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (user && user.status === 'active' && user.emailVerified) {
      const otp = await OtpService.createOtp(user.email, 'forgot_password');
      await sendOtpWithEnvFallback(user.email, otp, 'forgot_password');
    }

    return res.json({
      message: 'If this email is registered, an OTP has been sent'
    });
  } catch (error: any) {
    console.error('Request forgot password OTP error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while requesting password reset OTP',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const resetPasswordWithOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp, newPassword } = req.body;
    const normalizedEmail = normalizeEmail(email || '');

    if (!normalizedEmail || !otp || !newPassword) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email, OTP, and new password are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: passwordValidation.message,
          timestamp: new Date().toISOString()
        }
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isValidOtp = await OtpService.verifyOtp(normalizedEmail, 'forgot_password', otp);
    if (!isValidOtp) {
      return res.status(400).json({
        error: {
          code: 'INVALID_OTP',
          message: 'Invalid or expired OTP',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isSameAsOld = await comparePassword(newPassword, user.passwordHash);
    if (isSameAsOld) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_REUSE_NOT_ALLOWED',
          message: 'New password cannot be the same as previous password',
          timestamp: new Date().toISOString()
        }
      });
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    await SessionService.deleteAllUserSessions(user._id.toString());

    return res.json({ message: 'Password reset successful. Please login again.' });
  } catch (error: any) {
    console.error('Reset password with OTP error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while resetting password',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const requestChangePasswordOtp = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const otp = await OtpService.createOtp(user.email, 'change_password');
    const delivery = await sendOtpWithEnvFallback(user.email, otp, 'change_password');

    return res.json({
      message: 'OTP sent to your email',
      otpDelivered: delivery.delivered,
      devOtp: delivery.devOtp
    });
  } catch (error: any) {
    console.error('Request change password OTP error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while sending OTP',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const changePasswordWithOtp = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { currentPassword, newPassword, otp } = req.body;

    if (!currentPassword || !newPassword || !otp) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Current password, new password, and OTP are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: passwordValidation.message,
          timestamp: new Date().toISOString()
        }
      });
    }

    const isCurrentPasswordValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Current password is incorrect',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isSameAsOld = await comparePassword(newPassword, user.passwordHash);
    if (isSameAsOld) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_REUSE_NOT_ALLOWED',
          message: 'New password cannot be the same as previous password',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isValidOtp = await OtpService.verifyOtp(user.email, 'change_password', otp);
    if (!isValidOtp) {
      return res.status(400).json({
        error: {
          code: 'INVALID_OTP',
          message: 'Invalid or expired OTP',
          timestamp: new Date().toISOString()
        }
      });
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    await SessionService.deleteAllUserSessions(user._id.toString());

    const token = generateToken({
      userId: user._id.toString(),
      email: user.email
    });
    await SessionService.createSession(user._id.toString(), token, DEFAULT_SESSION_TTL);

    return res.json({
      message: 'Password changed successfully',
      token
    });
  } catch (error: any) {
    console.error('Change password with OTP error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while changing password',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const email = (req as any).email;

    // Generate new token
    const token = generateToken({ userId, email });

    // Update session in Redis
    await SessionService.refreshSession(userId, token, DEFAULT_SESSION_TTL);

    res.json({
      message: 'Token refreshed successfully',
      token
    });
  } catch (error: any) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred during token refresh',
        timestamp: new Date().toISOString()
      }
    });
  }
};
