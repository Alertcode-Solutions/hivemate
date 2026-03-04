import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { INDIA_CITY_OPTIONS } from '../constants/indiaCities';
import './CreateProfilePage.css';

const API_URL = getApiBaseUrl();

const MAX_IMAGE_DIMENSION = 1280;
const MAX_BASE64_BYTES = 4.5 * 1024 * 1024;
const RELIGION_OPTIONS = [
  'hinduism',
  'muslim',
  'christian',
  'sikh',
  'buddhist',
  'jain',
  'jewish',
  'atheist',
  'agnostic',
  'other'
];
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

const normalizeUsername = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const sanitizeIndianPhone = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  const withoutCountryCode = digits.startsWith('91') ? digits.slice(2) : digits;
  const local = withoutCountryCode.slice(0, 10);
  return `+91 ${local}`;
};

const CreateProfilePage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    dob: '',
    gender: '',
    religion: '',
    religionOther: '',
    phone: '+91 ',
    place: '',
    profession: '',
    skills: '',
    bio: '',
    photo: '',
    websiteUrl: '',
    college: '',
    company: '',
    achievements: ''
  });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [selectedPhotoName, setSelectedPhotoName] = useState('');
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameMessage, setUsernameMessage] = useState('');
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.remove('route-chat-lock');
    body.classList.remove('route-chat-lock');
    html.style.removeProperty('overflow');
    body.style.removeProperty('overflow');
  }, []);

  const filteredLocations = INDIA_CITY_OPTIONS.filter((option) =>
    option.toLowerCase().includes((locationQuery || formData.place).toLowerCase())
  ).slice(0, 12);

  useEffect(() => {
    const normalized = normalizeUsername(formData.username);

    if (!normalized) {
      setUsernameAvailable(null);
      setUsernameMessage('');
      setUsernameSuggestions([]);
      setUsernameChecking(false);
      return;
    }

    if (!USERNAME_REGEX.test(normalized)) {
      setUsernameAvailable(false);
      setUsernameMessage('Use 3-20 chars: a-z, 0-9, underscore');
      setUsernameSuggestions([]);
      setUsernameChecking(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        setUsernameChecking(true);
        const response = await axios.get(`${API_URL}/api/profiles/username/check`, {
          params: { username: normalized },
          headers: { Authorization: `Bearer ${token}` }
        });
        setUsernameAvailable(Boolean(response.data?.available));
        setUsernameSuggestions(response.data?.suggestions || []);
        setUsernameMessage(
          response.data?.available ? 'Username is available' : 'Username is already taken'
        );
      } catch {
        setUsernameAvailable(false);
        setUsernameMessage('Unable to validate username right now');
        setUsernameSuggestions([]);
      } finally {
        setUsernameChecking(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [formData.username]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setFormData((prev) => ({
        ...prev,
        phone: sanitizeIndianPhone(value)
      }));
    } else {
      setFormData({
        ...formData,
        [name]: value
      });
    }
    setError('');
    setInfo('');
  };

  const calculateAgeFromDob = (dob: string): number => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleNext = () => {
    // Validate current step
    if (step === 1) {
      if (!formData.name || !formData.username || !formData.dob || !formData.gender || !formData.religion || !formData.phone || !formData.place) {
        setError('Please fill in all required fields');
        return;
      }
      if (!USERNAME_REGEX.test(normalizeUsername(formData.username))) {
        setError('Please enter a valid username');
        return;
      }
      if (usernameChecking) {
        setError('Please wait while username availability is checked');
        return;
      }
      if (usernameAvailable === false) {
        setError('Please choose an available username');
        return;
      }
      if (usernameAvailable !== true) {
        setError('Please wait for username availability and select an available username');
        return;
      }
      if (formData.religion === 'other' && !formData.religionOther.trim()) {
        setError('Please specify religion when selecting Other');
        return;
      }
      const phoneDigits = formData.phone.replace(/\D/g, '');
      if (phoneDigits.length !== 12 || !phoneDigits.startsWith('91')) {
        setError('Please enter a valid Indian phone number');
        return;
      }
      const age = calculateAgeFromDob(formData.dob);
      if (Number.isNaN(age) || age < 18 || age > 120) {
        setError('You must be between 18 and 120 years old');
        return;
      }
    } else if (step === 2) {
      if (!formData.profession || !formData.skills) {
        setError('Please fill in all required fields');
        return;
      }
    }

    setError('');
    setStep(step + 1);
  };

  const handleBack = () => {
    setError('');
    setStep(step - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.bio || !formData.photo) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const calculatedAge = calculateAgeFromDob(formData.dob);

      const profileData = {
        name: formData.name,
        username: normalizeUsername(formData.username),
        age: calculatedAge,
        gender: formData.gender,
        religion: formData.religion,
        religionOther: formData.religion === 'other' ? formData.religionOther : undefined,
        phone: sanitizeIndianPhone(formData.phone),
        place: formData.place,
        profession: formData.profession,
        skills: formData.skills.split(',').map(s => s.trim()),
        bio: formData.bio,
        photo: formData.photo,
        photos: [formData.photo],
        websiteUrl: formData.websiteUrl || undefined,
        college: formData.college || undefined,
        company: formData.company || undefined,
        achievements: formData.achievements
          ? formData.achievements.split(',').map((a) => a.trim()).filter(Boolean)
          : undefined
      };

      await axios.post(`${API_URL}/api/profiles`, profileData, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Redirect to homepage
      navigate('/home');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to create profile');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedPhotoName(file.name);

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please upload a JPEG, PNG, WebP, or GIF image');
      return;
    }

    const maxFileSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxFileSize) {
      setError('File size must be under 10MB');
      return;
    }

    setUploading(true);
    setError('');

    compressImageToBase64(file)
      .then((optimizedBase64) => {
        const bytes = estimateBase64Bytes(optimizedBase64);
        if (bytes > MAX_BASE64_BYTES) {
          setError('Image is still too large after compression. Please choose a smaller image.');
          return;
        }
        setFormData((prev) => ({ ...prev, photo: optimizedBase64 }));
        setInfo('Photo processed successfully');
      })
      .catch(() => {
        setError('Failed to process selected image. Please try another image.');
      })
      .finally(() => {
        setUploading(false);
      });
  };

  const estimateBase64Bytes = (dataUrl: string): number => {
    const base64 = dataUrl.split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  };

  const compressImageToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
            const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context unavailable'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = String(reader.result || '');
      };

      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });

  const handleFieldFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const isFormControl =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (!isFormControl) return;

    window.setTimeout(() => {
      target.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth'
      });
    }, 120);
  };

  return (
    <div
      className="create-profile-page"
      ref={pageScrollRef}
      onFocusCapture={handleFieldFocusCapture}
    >
      <div className="profile-container">
        <div className="profile-header">
          <div className="profile-logo">
            <div className="profile-logo-ring"></div>
            <div className="profile-logo-pulse"></div>
          </div>
          <h1>Create Your Profile</h1>
          <p>Build your public identity for meaningful networking.</p>
        </div>

        <div className="progress-shell">
          <div className="progress-bar">
            <div className={`progress-step ${step >= 1 ? 'active' : ''}`}>1</div>
            <div className={`progress-line ${step >= 2 ? 'active' : ''}`}></div>
            <div className={`progress-step ${step >= 2 ? 'active' : ''}`}>2</div>
            <div className={`progress-line ${step >= 3 ? 'active' : ''}`}></div>
            <div className={`progress-step ${step >= 3 ? 'active' : ''}`}>3</div>
          </div>
          <div className="progress-labels">
            <span className={step === 1 ? 'active' : ''}>Basics</span>
            <span className={step === 2 ? 'active' : ''}>Professional</span>
            <span className={step === 3 ? 'active' : ''}>Profile</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="profile-form">
          {error && <div className="error-message">{error}</div>}
          {info && <div className="info-message">{info}</div>}

          {step === 1 && (
            <div className="form-step">
              <h2>Basic Information</h2>
              
              <div className="form-group">
                <label htmlFor="name">Full Name *</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="John Doe"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="username">Username *</label>
                <div className="username-input-wrap">
                  <span className="username-prefix">@</span>
                  <input
                    type="text"
                    id="username"
                    name="username"
                    value={formData.username}
                    onChange={(e) => {
                      const normalized = normalizeUsername(e.target.value.replace(/^@+/, ''));
                      setFormData((prev) => ({ ...prev, username: normalized }));
                      setError('');
                      setInfo('');
                    }}
                    placeholder="john_doe"
                    required
                  />
                </div>
                <div className="username-status-row">
                  {usernameChecking && <span className="username-checking">Checking availability...</span>}
                  {!usernameChecking && usernameMessage && (
                    <span className={usernameAvailable ? 'username-available' : 'username-unavailable'}>
                      {usernameAvailable ? '✓ ' : '✕ '}
                      {usernameMessage}
                    </span>
                  )}
                </div>
                {usernameSuggestions.length > 0 && (
                  <div className="username-suggestions">
                    {usernameSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="username-suggestion-pill"
                        onClick={() => setFormData((prev) => ({ ...prev, username: suggestion }))}
                      >
                        @{suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="dob">Date of Birth *</label>
                <input
                  type="date"
                  id="dob"
                  name="dob"
                  value={formData.dob}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="gender">Gender *</label>
                <select
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="place">Location *</label>
                <input
                  type="text"
                  id="place"
                  name="place"
                  value={formData.place}
                  onChange={(e) => {
                    setLocationQuery(e.target.value);
                    setShowLocationSuggestions(true);
                    handleChange(e);
                  }}
                  onFocus={() => setShowLocationSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowLocationSuggestions(false), 120)}
                  placeholder="City"
                  required
                />
                {showLocationSuggestions && filteredLocations.length > 0 && (
                  <div className="location-suggestions" role="listbox">
                    {filteredLocations.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="location-suggestion-item"
                        onClick={() => {
                          setFormData((prev) => ({ ...prev, place: option }));
                          setLocationQuery(option);
                          setShowLocationSuggestions(false);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="religion">Religion *</label>
                <select
                  id="religion"
                  name="religion"
                  value={formData.religion}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select religion</option>
                  {RELIGION_OPTIONS.map((religion) => (
                    <option key={religion} value={religion}>
                      {religion.charAt(0).toUpperCase() + religion.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {formData.religion === 'other' && (
                <div className="form-group">
                  <label htmlFor="religionOther">Specify Religion *</label>
                  <input
                    type="text"
                    id="religionOther"
                    name="religionOther"
                    value={formData.religionOther}
                    onChange={handleChange}
                    placeholder="Type your religion"
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="phone">Phone Number *</label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="+91 9876543210"
                  required
                />
                
              </div>

              <button type="button" onClick={handleNext} className="next-button">
                Next
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="form-step">
              <h2>Professional Details</h2>
              
              <div className="form-group">
                <label htmlFor="profession">Profession *</label>
                <input
                  type="text"
                  id="profession"
                  name="profession"
                  value={formData.profession}
                  onChange={handleChange}
                  placeholder="Software Engineer"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="skills">Skills * (comma-separated)</label>
                <input
                  type="text"
                  id="skills"
                  name="skills"
                  value={formData.skills}
                  onChange={handleChange}
                  placeholder="JavaScript, React, Node.js"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="achievements">Achievements (optional)</label>
                <input
                  type="text"
                  id="achievements"
                  name="achievements"
                  value={formData.achievements}
                  onChange={handleChange}
                  placeholder="Hackathon winner, Open-source contributor"
                />
              </div>

              <div className="form-group">
                <label htmlFor="company">Company (optional)</label>
                <input
                  type="text"
                  id="company"
                  name="company"
                  value={formData.company}
                  onChange={handleChange}
                  placeholder="Tech Corp"
                />
              </div>

              <div className="form-group">
                <label htmlFor="college">College (optional)</label>
                <input
                  type="text"
                  id="college"
                  name="college"
                  value={formData.college}
                  onChange={handleChange}
                  placeholder="Stanford University"
                />
              </div>

              <div className="button-group">
                <button type="button" onClick={handleBack} className="back-button">
                  Back
                </button>
                <button type="button" onClick={handleNext} className="next-button">
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="form-step">
              <h2>About You</h2>
              
              <div className="form-group">
                <label htmlFor="bio">Bio * (max 500 characters)</label>
                <textarea
                  id="bio"
                  name="bio"
                  value={formData.bio}
                  onChange={handleChange}
                  placeholder="Tell us about yourself..."
                  maxLength={500}
                  rows={4}
                  required
                />
                <span className="char-count">{formData.bio.length}/500</span>
              </div>

              <div className="form-group">
                <label htmlFor="photoUpload">Upload Profile Photo *</label>
                <input
                  type="file"
                  id="photoUpload"
                  className="file-input-hidden"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handlePhotoFileSelect}
                />
                <label htmlFor="photoUpload" className="file-upload-trigger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>{selectedPhotoName ? 'Change photo' : 'Choose photo'}</span>
                </label>
                {selectedPhotoName && <p className="selected-file-name">{selectedPhotoName}</p>}
                {uploading && <p className="status-note">Processing image...</p>}
              </div>

              <div className="form-group">
                <label htmlFor="photo">Or Paste Profile Photo URL</label>
                <input
                  type="url"
                  id="photo"
                  name="photo"
                  value={formData.photo}
                  onChange={handleChange}
                  placeholder="https://example.com/photo.jpg"
                  required
                />
                {formData.photo && (
                  <div className="photo-preview">
                    <img src={formData.photo} alt="Preview" onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }} />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="websiteUrl">Website (optional)</label>
                <input
                  type="url"
                  id="websiteUrl"
                  name="websiteUrl"
                  value={formData.websiteUrl}
                  onChange={handleChange}
                  placeholder="https://yourwebsite.com"
                />
              </div>

              <div className="button-group">
                <button type="button" onClick={handleBack} className="back-button">
                  Back
                </button>
                <button type="submit" className="submit-button" disabled={loading}>
                  {loading ? 'Creating Profile...' : 'Complete Profile'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default CreateProfilePage;
