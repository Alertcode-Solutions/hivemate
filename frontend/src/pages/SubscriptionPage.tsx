import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import BeeLoader from '../components/BeeLoader';
import useSmoothLoader from '../hooks/useSmoothLoader';
import './SubscriptionPage.css';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface Subscription {
  id: string;
  plan: 'free' | 'premium';
  status: 'active' | 'cancelled' | 'expired' | 'past_due';
  startDate: string;
  endDate?: string;
}

const premiumFeatures = [
  {
    title: 'Video Calls Unlocked',
    description: 'Start video calls in your conversations with premium access.'
  },
  {
    title: 'Shared Benefit',
    description: 'Connected users in your conversation can also join video calls.'
  },
  {
    title: 'Stronger Trust Building',
    description: 'Voice and video improve collaboration quality and decision speed.'
  },
  {
    title: 'Everything In Free',
    description: 'Keep radar, search, encrypted chat, voice calls, and gig features.'
  }
];

const freeFeatures = [
  'Radar-based nearby discovery',
  'Encrypted direct messaging',
  'Voice call support',
  'Gig posting and collaboration',
  'Advanced profile search',
  'Unlimited connections'
];

const faqItems = [
  {
    q: 'How does shared benefit work?',
    a: 'If you are premium, video calling is enabled for your active conversations.'
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. You can cancel anytime. Premium remains active until the current period ends.'
  },
  {
    q: 'What happens after cancellation?',
    a: 'Video calls stop unless the other person has active premium. All free features remain.'
  }
];

const SubscriptionPage = () => {
  const navigate = useNavigate();
  const API_URL = getApiBaseUrl();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const { showLoader, complete, handleLoaderComplete } = useSmoothLoader(loading);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetchSubscription();
  }, []);

  const fetchSubscription = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${API_URL}/api/subscriptions/current`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setSubscription(data.subscription);
      } else {
        throw new Error('Failed to fetch subscription');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    try {
      setProcessing(true);
      setError(null);
      setNotice('');

      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${API_URL}/api/subscriptions/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setSubscription(data.subscription);
        setNotice('Premium activated. Video calls are now unlocked.');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to create subscription');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to subscribe');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel premium subscription?')) {
      return;
    }

    try {
      setProcessing(true);
      setError(null);
      setNotice('');

      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login');
        return;
      }

      const response = await fetch(`${API_URL}/api/subscriptions/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setSubscription(data.subscription);
        setNotice('Premium cancelled successfully.');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to cancel subscription');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel subscription');
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

  if (showLoader) {
    return (
      <div className="subscription-page">
        <BeeLoader message="Loading subscription details..." compact complete={complete} onComplete={handleLoaderComplete} />
      </div>
    );
  }

  const isPremium = subscription?.plan === 'premium' && subscription?.status === 'active';
  const planName = subscription?.plan === 'premium' ? 'Premium' : 'Free';

  return (
    <div className="subscription-page">
      <div className="subscription-shell">
        <header className="subscription-hero">
          <button className="subscription-back-btn" onClick={() => navigate('/home')} aria-label="Go back">
            <BackIcon />
          </button>
          <h1>Subscription</h1>
          <p>Unlock video-first networking while keeping your existing workflow unchanged.</p>
        </header>

        {error && <div className="subscription-alert subscription-alert-error">{error}</div>}
        {notice && <div className="subscription-alert subscription-alert-success">{notice}</div>}

        <main className="subscription-content">
          <section className="subscription-card subscription-status-card">
            <div className="subscription-status-top">
              <h2>Current Plan</h2>
              <span className={`subscription-pill ${subscription?.status || 'active'}`}>
                {subscription?.status || 'active'}
              </span>
            </div>
            <h3 className="subscription-plan-name">{planName}</h3>
            <div className="subscription-meta-grid">
              <div>
                <span>Member Since</span>
                <strong>{subscription?.startDate ? formatDate(subscription.startDate) : 'Not available'}</strong>
              </div>
              <div>
                <span>Next Renewal</span>
                <strong>{subscription?.endDate ? formatDate(subscription.endDate) : 'Not scheduled'}</strong>
              </div>
            </div>
          </section>

          <section className="subscription-card subscription-premium-card">
            <div className="subscription-premium-head">
              <div>
                <h2>HiveMate Premium</h2>
                <p>One plan, clear value, zero clutter.</p>
              </div>
              <div className="subscription-price">
                <strong>$9.99</strong>
                <span>/ month</span>
              </div>
            </div>

            <div className="subscription-feature-grid">
              {premiumFeatures.map((feature) => (
                <article key={feature.title} className="subscription-feature-item">
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>

            <div className="subscription-actions">
              {!isPremium ? (
                <button
                  className="subscription-btn subscription-btn-primary"
                  onClick={handleSubscribe}
                  disabled={processing}
                >
                  {processing ? 'Processing...' : 'Subscribe Now'}
                </button>
              ) : (
                <button
                  className="subscription-btn subscription-btn-danger"
                  onClick={handleCancel}
                  disabled={processing}
                >
                  {processing ? 'Processing...' : 'Cancel Premium'}
                </button>
              )}
            </div>
          </section>

          {!isPremium && (
            <section className="subscription-card">
              <h2>Included In Free Plan</h2>
              <ul className="subscription-free-list">
                {freeFeatures.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="subscription-card">
            <h2>FAQ</h2>
            <div className="subscription-faq-list">
              {faqItems.map((item) => (
                <article key={item.q} className="subscription-faq-item">
                  <h3>{item.q}</h3>
                  <p>{item.a}</p>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default SubscriptionPage;
