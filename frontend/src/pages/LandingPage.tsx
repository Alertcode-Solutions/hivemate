import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import usePwaInstallPrompt from '../hooks/usePwaInstallPrompt';
import './LandingPage.css';

interface RadarDot {
  id: number;
  x: number;
  y: number;
  distance: number;
  angle: number;
  color: string;
  name: string;
}

const LandingPage = () => {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [radarDots, setRadarDots] = useState<RadarDot[]>([]);
  const [scanAngle, setScanAngle] = useState(0);
  const [hoveredDot, setHoveredDot] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { canInstall, triggerInstall } = usePwaInstallPrompt();

  useEffect(() => {
    const hasRememberedSession = localStorage.getItem('rememberMe') === 'true' && !!localStorage.getItem('token');
    if (hasRememberedSession) {
      navigate('/home');
      return;
    }

    setIsVisible(true);

    // Generate random preview dots (landing only)
    const dots: RadarDot[] = [];
    const colors = ['#4f7dff', '#6a8df5', '#7c5aed', '#2f67d9'];
    const names = ['Aarav', 'Isha', 'Kabir', 'Maya', 'Riya', 'Neel', 'Arjun', 'Sana', 'Rahul', 'Anaya'];

    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * 360;
      const distance = 20 + Math.random() * 26;
      const radians = angle * Math.PI / 180;

      dots.push({
        id: i,
        x: 50 + Math.cos(radians) * distance,
        y: 50 + Math.sin(radians) * distance,
        distance,
        angle,
        color: colors[Math.floor(Math.random() * colors.length)],
        name: names[i % names.length]
      });
    }
    setRadarDots(dots);
  }, [navigate]);

  useEffect(() => {
    const interval = setInterval(() => {
      setScanAngle(prev => (prev + 2) % 360);
    }, 30);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!canInstall) return;
    // Trigger immediately on page visit/refresh.
    void triggerInstall();
    const intervalId = window.setInterval(() => {
      void triggerInstall();
    }, 120000);
    return () => window.clearInterval(intervalId);
  }, [canInstall, triggerInstall]);

  // Draw radar on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 28;

    ctx.clearRect(0, 0, width, height);

    // Rings
    ctx.strokeStyle = 'rgba(99, 135, 232, 0.24)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, (radius / 3) * i, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshair
    ctx.strokeStyle = 'rgba(99, 135, 232, 0.3)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX, centerY + radius);
    ctx.moveTo(centerX - radius, centerY);
    ctx.lineTo(centerX + radius, centerY);
    ctx.stroke();

    // Scan beam
    const scanRad = (scanAngle * Math.PI) / 180;
    const gradient = ctx.createLinearGradient(
      centerX,
      centerY,
      centerX + Math.cos(scanRad) * radius,
      centerY + Math.sin(scanRad) * radius
    );
    gradient.addColorStop(0, 'rgba(99, 135, 232, 0)');
    gradient.addColorStop(0.5, 'rgba(99, 135, 232, 0.34)');
    gradient.addColorStop(1, 'rgba(99, 135, 232, 0.9)');

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(scanRad) * radius,
      centerY + Math.sin(scanRad) * radius
    );
    ctx.stroke();

    // Trail
    ctx.strokeStyle = 'rgba(99, 135, 232, 0.12)';
    ctx.lineWidth = radius;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius / 2, scanRad - 0.5, scanRad);
    ctx.stroke();

  }, [scanAngle]);

  const handleDotClick = () => {
    navigate('/register');
  };

  return (
    <div className="landing-page">
      <div className="landing-orb landing-orb-left"></div>
      <div className="landing-orb landing-orb-right"></div>
      <div className="landing-grid"></div>

      <div className={`landing-content ${isVisible ? 'visible' : ''}`}>
        <header className="landing-topbar">
          <div className="landing-brand">
            <span className="landing-brand-main">Hive</span>
            <span className="landing-brand-accent">Mate</span>
          </div>
          <div className="landing-topbar-actions">
            {canInstall && (
              <button
                className="landing-btn-secondary landing-install-btn"
                onClick={() => {
                  void triggerInstall();
                }}
              >
                Install App
              </button>
            )}
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-copy">
            <p className="landing-eyebrow">NETWORKING, REIMAGINED</p>
            <h1 className="landing-title">
              Meet people nearby before the moment pass.
            </h1> 
            <p className="landing-subtitle">
              Discover collaborators, teammates and meaningful connections around you in real time.
            </p>

            <div className="landing-cta-row">
              <button className="landing-btn-primary landing-btn-lg" onClick={() => navigate('/register')}>
                Create Your Profile
              </button>
              <button className="landing-btn-secondary landing-btn-lg" onClick={() => navigate('/login')}>
                I Already Have an Account
              </button>
            </div>

            <div className="landing-highlights">
              <div className="landing-highlight">Explore / Vanish modes</div>
              <div className="landing-highlight">Encrypted chat + calls</div>
              <div className="landing-highlight">Partner + Team Mate discovery</div>
            </div>
          </div>

          <div className="landing-radar-card">
            <div className="landing-radar-head">
              <h3>Live Radar Preview</h3>
              <span className="landing-live-pill">Updating</span>
            </div>
            <div className="landing-radar-wrap">
              <div className="radar-container">
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={560}
                  className="radar-canvas"
                />
                <div className="radar-dots">
                  {radarDots.map(dot => (
                    <button
                      key={dot.id}
                      type="button"
                      className="radar-dot"
                      style={{
                        left: `${dot.x}%`,
                        top: `${dot.y}%`,
                        backgroundColor: dot.color
                      }}
                      onClick={handleDotClick}
                      onMouseEnter={() => setHoveredDot(dot.id)}
                      onMouseLeave={() => setHoveredDot(null)}
                      onTouchStart={() => setHoveredDot(dot.id)}
                      onTouchEnd={() => setHoveredDot(null)}
                      aria-label={`Preview ${dot.name}`}
                    >
                      {hoveredDot === dot.id && (
                        <span className="dot-tooltip">{dot.name}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="radar-center"></div>
              </div>
            </div>
            <p className="landing-radar-note">Tap any profile to start your journey.</p>
          </div>
        </section>

        <section className="landing-features">
          <article className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                <circle cx="12" cy="9" r="2.5"/>
              </svg>
            </div>
            <h4>Nearby Discovery</h4>
            <p>Discover nearby people and build meaningful connections.</p>
          </article>
          <article className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h4>Privacy First</h4>
            <p>End to end encrypted chat and explore/vanish  profile visibility controls.</p>
          </article>
          <article className="landing-feature-card">
            <div className="landing-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
            </div>
            <h4>Build and Grow</h4>
            <p>Find teammates or partner, create opportunities and grow your network in one platform.</p>
          </article>
        </section>
      </div>
    </div>
  );
};

export default LandingPage;
