import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import BeeLoader from '../components/BeeLoader';
import useSmoothLoader from '../hooks/useSmoothLoader';
import './GigDetailPage.css';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5L8 12L15 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface Gig {
  _id: string;
  title: string;
  description: string;
  type: string;
  paymentStatus: string;
  skillsRequired: string[];
  location?: string;
  duration?: string;
  compensation?: string;
  status: string;
  creatorId: {
    _id: string;
    name: string;
    profession: string;
    bio?: string;
  };
  applicants: string[];
  acceptedApplicants: any[];
  createdAt: string;
}

interface Application {
  _id: string;
  applicantId: {
    _id: string;
    name: string;
    profession: string;
    bio?: string;
    skills?: string[];
  };
  coverLetter?: string;
  status: string;
  appliedAt: string;
}

const GigDetailPage = () => {
  const { gigId } = useParams<{ gigId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [gig, setGig] = useState<Gig | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const { showLoader, complete, handleLoaderComplete } = useSmoothLoader(loading);
  const [applying, setApplying] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [coverLetter, setCoverLetter] = useState('');
  const [isCreator, setIsCreator] = useState(false);
  const [hasApplied, setHasApplied] = useState(false);
  const [myApplication, setMyApplication] = useState<Application | null>(null);

  const API_URL = getApiBaseUrl();
  const currentUserId = localStorage.getItem('userId');

  useEffect(() => {
    fetchGigDetails();
    
    // Check if we should open apply modal
    if (searchParams.get('apply') === 'true') {
      setShowApplyModal(true);
    }
  }, [gigId]);

  useEffect(() => {
    if (isCreator && gig) {
      fetchApplications();
    }
  }, [isCreator, gig]);

  const fetchGigDetails = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/gigs/${gigId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setGig(data.gig);
        setIsCreator(data.gig.creatorId._id === currentUserId);
        
        // Check if current user has applied
        const applied = data.gig.applicants.includes(currentUserId);
        setHasApplied(applied);
        
        if (applied) {
          fetchMyApplication();
        }
      } else {
        navigate('/home');
      }
    } catch (error) {
      console.error('Failed to fetch gig:', error);
      navigate('/home');
    } finally {
      setLoading(false);
    }
  };

  const fetchApplications = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/gigs/${gigId}/applications`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setApplications(data.applications || []);
      }
    } catch (error) {
      console.error('Failed to fetch applications:', error);
    }
  };

  const fetchMyApplication = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/gigs/applications/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        const app = data.applications.find((a: any) => a.gigId._id === gigId);
        if (app) {
          setMyApplication(app);
        }
      }
    } catch (error) {
      console.error('Failed to fetch my application:', error);
    }
  };

  const handleApply = async () => {
    if (!coverLetter.trim()) {
      alert('Please write a cover letter');
      return;
    }

    setApplying(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/gigs/${gigId}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ coverLetter })
      });

      if (response.ok) {
        setShowApplyModal(false);
        setHasApplied(true);
        fetchGigDetails();
        alert('Application submitted successfully!');
      } else {
        const errorData = await response.json();
        alert(errorData.error?.message || 'Failed to apply');
      }
    } catch (error) {
      console.error('Apply error:', error);
      alert('An error occurred. Please try again.');
    } finally {
      setApplying(false);
    }
  };

  const handleRespondToApplication = async (applicationId: string, action: 'accept' | 'reject') => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_URL}/api/gigs/${gigId}/applications/${applicationId}/respond`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ action })
        }
      );

      if (response.ok) {
        fetchApplications();
        fetchGigDetails(); // Refresh to get updated accepted applicants
        if (action === 'accept') {
          alert('Application accepted! A group chat has been created for collaboration.');
        } else {
          alert('Application rejected.');
        }
      } else {
        const errorData = await response.json();
        alert(errorData.error?.message || `Failed to ${action} application`);
      }
    } catch (error) {
      console.error('Respond error:', error);
      alert('An error occurred. Please try again.');
    }
  };

  const handleEdit = () => {
    navigate(`/gig/${gigId}/edit`);
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this gig?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/gigs/${gigId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        navigate('/home');
      } else {
        alert('Failed to delete gig');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('An error occurred. Please try again.');
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'job': return '💼';
      case 'startup': return '🚀';
      case 'project': return '📁';
      case 'hackathon': return '⚡';
      default: return '📌';
    }
  };

  if (showLoader) {
    return (
      <div className="gig-detail-page">
        <BeeLoader message="Loading opportunity..." compact complete={complete} onComplete={handleLoaderComplete} />
      </div>
    );
  }

  if (!gig) {
    return null;
  }

  return (
    <div className="gig-detail-page">
      <div className="gig-detail-container">
        <button className="back-button" onClick={() => navigate(-1)} aria-label="Go back">
          <BackIcon />
        </button>

        <div className="gig-detail-header">
          <div className="gig-type-badge">
            <span className="type-icon">{getTypeIcon(gig.type)}</span>
            <span className="type-text">{gig.type}</span>
          </div>
          <span className={`payment-badge ${gig.paymentStatus}`}>
            {gig.paymentStatus === 'paid' ? '💰 Paid' : '🤝 Unpaid'}
          </span>
        </div>

        <h1 className="gig-title">{gig.title}</h1>

        <div className="gig-meta-info">
          <div className="creator-info">
            <span className="creator-name">{gig.creatorId.name}</span>
            <span className="creator-profession">{gig.creatorId.profession}</span>
          </div>
          <span className="gig-date">
            Posted {new Date(gig.createdAt).toLocaleDateString()}
          </span>
        </div>

        {gig.location && (
          <div className="gig-location">📍 {gig.location}</div>
        )}

        <div className="gig-description">
          <h3>Description</h3>
          <p>{gig.description}</p>
        </div>

        <div className="gig-details-grid">
          {gig.duration && (
            <div className="detail-item">
              <span className="detail-label">Duration</span>
              <span className="detail-value">{gig.duration}</span>
            </div>
          )}
          {gig.compensation && (
            <div className="detail-item">
              <span className="detail-label">Compensation</span>
              <span className="detail-value">{gig.compensation}</span>
            </div>
          )}
          <div className="detail-item">
            <span className="detail-label">Status</span>
            <span className={`detail-value status-${gig.status}`}>
              {gig.status}
            </span>
          </div>
        </div>

        <div className="gig-skills-section">
          <h3>Skills Required</h3>
          <div className="skills-list">
            {gig.skillsRequired.map((skill, index) => (
              <span key={index} className="skill-badge">{skill}</span>
            ))}
          </div>
        </div>

        {!isCreator && (
          <div className="gig-actions">
            {hasApplied ? (
              <div className="applied-status">
                <span className="applied-badge">✓ Applied</span>
                {myApplication && (
                  <span className="application-status">
                    Status: {myApplication.status}
                  </span>
                )}
              </div>
            ) : (
              <button
                className="apply-button"
                onClick={() => setShowApplyModal(true)}
                disabled={gig.status !== 'open'}
              >
                {gig.status === 'open' ? 'Apply Now' : 'Applications Closed'}
              </button>
            )}
          </div>
        )}

        {isCreator && (
          <div className="creator-actions">
            <button className="edit-button" onClick={handleEdit}>
              Edit Gig
            </button>
            <button className="delete-button" onClick={handleDelete}>
              Delete Gig
            </button>
          </div>
        )}

        {isCreator && applications.length > 0 && (
          <div className="applications-section">
            <h2>Applications ({applications.length})</h2>
            <div className="applications-list">
              {applications.map((app) => (
                <div key={app._id} className="application-card">
                  <div className="applicant-header">
                    <div className="applicant-info">
                      <h4>{app.applicantId.name}</h4>
                      <p className="applicant-profession">{app.applicantId.profession}</p>
                    </div>
                    <span className={`app-status status-${app.status}`}>
                      {app.status}
                    </span>
                  </div>

                  {app.applicantId.bio && (
                    <p className="applicant-bio">{app.applicantId.bio}</p>
                  )}

                  {app.applicantId.skills && app.applicantId.skills.length > 0 && (
                    <div className="applicant-skills">
                      {app.applicantId.skills.slice(0, 5).map((skill, idx) => (
                        <span key={idx} className="skill-badge-small">{skill}</span>
                      ))}
                    </div>
                  )}

                  {app.coverLetter && (
                    <div className="cover-letter">
                      <strong>Cover Letter:</strong>
                      <p>{app.coverLetter}</p>
                    </div>
                  )}

                  {app.status === 'pending' && (
                    <div className="application-actions">
                      <button
                        className="accept-button"
                        onClick={() => handleRespondToApplication(app._id, 'accept')}
                      >
                        Accept
                      </button>
                      <button
                        className="reject-button"
                        onClick={() => handleRespondToApplication(app._id, 'reject')}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {gig.acceptedApplicants && gig.acceptedApplicants.length > 0 && (
          <div className="accepted-section">
            <h2>Team Members ({gig.acceptedApplicants.length + 1})</h2>
            <p className="team-subtitle">
              Collaborate with your team in the group chat
            </p>
            <button 
              className="group-chat-button"
              onClick={() => navigate('/chat')}
            >
              💬 Open Group Chat
            </button>
          </div>
        )}

        {!isCreator && myApplication && myApplication.status === 'accepted' && (
          <div className="accepted-section">
            <h2>🎉 You're part of the team!</h2>
            <p className="team-subtitle">
              Your application was accepted. Connect with the team in the group chat.
            </p>
            <button 
              className="group-chat-button"
              onClick={() => navigate('/chat')}
            >
              💬 Open Group Chat
            </button>
          </div>
        )}
      </div>

      {showApplyModal && (
        <div className="modal-overlay" onClick={() => setShowApplyModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Apply to {gig.title}</h2>
            <p className="modal-subtitle">Tell the creator why you're a great fit</p>
            
            <textarea
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              placeholder="Write your cover letter here..."
              rows={8}
              className="cover-letter-input"
            />

            <div className="modal-actions">
              <button
                className="cancel-button"
                onClick={() => setShowApplyModal(false)}
              >
                Cancel
              </button>
              <button
                className="submit-button"
                onClick={handleApply}
                disabled={applying}
              >
                {applying ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GigDetailPage;
