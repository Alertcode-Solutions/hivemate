import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import './CreateGigPage.css';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5L8 12L15 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface GigFormData {
  title: string;
  description: string;
  skillsRequired: string[];
  type: 'job' | 'startup' | 'project' | 'hackathon';
  paymentStatus: 'paid' | 'unpaid';
  location: string;
  duration: string;
  compensation: string;
}

const CreateGigPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<GigFormData>({
    title: '',
    description: '',
    skillsRequired: [],
    type: 'project',
    paymentStatus: 'unpaid',
    location: '',
    duration: '',
    compensation: ''
  });
  const [skillInput, setSkillInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const API_URL = getApiBaseUrl();

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleAddSkill = () => {
    const skill = skillInput.trim();
    if (skill && !formData.skillsRequired.includes(skill)) {
      setFormData((prev) => ({
        ...prev,
        skillsRequired: [...prev.skillsRequired, skill]
      }));
      setSkillInput('');
      if (errors.skillsRequired) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors.skillsRequired;
          return newErrors;
        });
      }
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      skillsRequired: prev.skillsRequired.filter((skill) => skill !== skillToRemove)
    }));
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSkill();
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    } else if (formData.title.length < 3) {
      newErrors.title = 'Title must be at least 3 characters';
    }

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    } else if (formData.description.length < 10) {
      newErrors.description = 'Description must be at least 10 characters';
    }

    if (formData.skillsRequired.length === 0) {
      newErrors.skillsRequired = 'At least one skill is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/gigs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const data = await response.json();
        navigate(`/gig/${data.gig.id}`);
      } else {
        const errorData = await response.json();
        setErrors({ submit: errorData.error?.message || 'Failed to create gig' });
      }
    } catch (error) {
      console.error('Create gig error:', error);
      setErrors({ submit: 'An error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-gig-page">
      <div className="create-gig-container">
        <div className="create-gig-header">
          <button className="back-button" onClick={() => navigate(-1)} aria-label="Go back">
            <BackIcon />
          </button>
          <h1>Create New Opportunity</h1>
        </div>

        <form onSubmit={handleSubmit} className="gig-form">
          <div className="form-group">
            <label htmlFor="title">Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="e.g., Full Stack Developer Needed"
              className={errors.title ? 'error' : ''}
            />
            {errors.title && <span className="error-message">{errors.title}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="type">Type *</label>
            <select
              id="type"
              name="type"
              value={formData.type}
              onChange={handleChange}
            >
              <option value="project">📁 Project</option>
              <option value="job">💼 Job</option>
              <option value="startup">🚀 Startup</option>
              <option value="hackathon">⚡ Hackathon</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="paymentStatus">Payment Status *</label>
            <select
              id="paymentStatus"
              name="paymentStatus"
              value={formData.paymentStatus}
              onChange={handleChange}
            >
              <option value="unpaid">🤝 Unpaid</option>
              <option value="paid">💰 Paid</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="description">Description *</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe the opportunity, requirements, and what you're looking for..."
              rows={6}
              className={errors.description ? 'error' : ''}
            />
            {errors.description && <span className="error-message">{errors.description}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="skillInput">Skills Required *</label>
            <div className="skill-input-container">
              <input
                type="text"
                id="skillInput"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a skill and press Enter"
                className={errors.skillsRequired ? 'error' : ''}
              />
              <button
                type="button"
                onClick={handleAddSkill}
                className="add-skill-button"
              >
                Add
              </button>
            </div>
            {errors.skillsRequired && (
              <span className="error-message">{errors.skillsRequired}</span>
            )}
            <div className="skills-list">
              {formData.skillsRequired.map((skill) => (
                <span key={skill} className="skill-tag">
                  {skill}
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="remove-skill"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="location">Location (Optional)</label>
            <input
              type="text"
              id="location"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="e.g., Remote, New York, Hybrid"
            />
          </div>

          <div className="form-group">
            <label htmlFor="duration">Duration (Optional)</label>
            <input
              type="text"
              id="duration"
              name="duration"
              value={formData.duration}
              onChange={handleChange}
              placeholder="e.g., 3 months, Full-time, Part-time"
            />
          </div>

          <div className="form-group">
            <label htmlFor="compensation">Compensation (Optional)</label>
            <input
              type="text"
              id="compensation"
              name="compensation"
              value={formData.compensation}
              onChange={handleChange}
              placeholder="e.g., $50/hour, Equity, Revenue share"
            />
          </div>

          {errors.submit && (
            <div className="submit-error">{errors.submit}</div>
          )}

          <div className="form-actions">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="cancel-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="submit-button"
            >
              {loading ? 'Creating...' : 'Create Opportunity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGigPage;
