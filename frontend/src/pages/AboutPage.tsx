import { useNavigate } from 'react-router-dom';
import './AboutPage.css';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const featureItems = [
  {
    title: 'Radar Discovery',
    description: 'Find people nearby in real-time using explore mode and smart range controls.'
  },
  {
    title: 'Privacy First',
    description: 'Vanish mode, visibility control, and permissioned profile sharing.'
  },
  {
    title: 'Secure Chat',
    description: 'Encrypted conversations designed for safe and focused networking.'
  },
  {
    title: 'Collaboration Gigs',
    description: 'Create and discover jobs, projects, startups, and hackathons.'
  },
  {
    title: 'Connection Progression',
    description: 'Features unlock as trust increases between connected users.'
  },
  {
    title: 'Search by Username',
    description: 'Find people directly with username search across the platform.'
  }
];

const steps = [
  {
    title: 'Create your profile',
    description: 'Set up your identity with skills, intent, and a discoverable username.'
  },
  {
    title: 'Enable explore mode',
    description: 'Appear on radar and discover professionals around you.'
  },
  {
    title: 'Connect with intent',
    description: 'Send connection requests and build meaningful professional relationships.'
  },
  {
    title: 'Collaborate and grow',
    description: 'Start chats, join gigs, and expand your trusted network.'
  }
];

const AboutPage = () => {
  const navigate = useNavigate();

  return (
    <div className="about-page">
      <div className="about-shell">
        <header className="about-header">
          <button className="about-back-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <BackIcon />
          </button>
          <h1>About HiveMate</h1>
          <p>Professional networking with proximity, privacy, and purpose.</p>
        </header>

        <main className="about-content">
          <section className="about-card about-card-hero">
            <h2>What HiveMate Is</h2>
            <p>
              HiveMate is a networking-first platform. It combines local radar discovery, profile-based
              matching, secure messaging, and collaboration workflows so users can meet the right people
              and build real professional outcomes.
            </p>
          </section>

          <section className="about-card">
            <h2>Our Mission</h2>
            <p>
              Build a trusted networking graph where location awareness and strong privacy controls help
              people discover opportunities faster and collaborate better.
            </p>
          </section>

          <section className="about-card">
            <h2>Core Features</h2>
            <div className="about-feature-grid">
              {featureItems.map((item) => (
                <article key={item.title} className="about-feature-item">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="about-card">
            <h2>How It Works</h2>
            <ol className="about-steps">
              {steps.map((step, index) => (
                <li key={step.title} className="about-step-item">
                  <span className="about-step-num">{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="about-card">
            <h2>Security and Privacy</h2>
            <p>
              Messages are encrypted, sessions are authenticated, and profile visibility is intentionally
              scoped. Public view and connected view are separated so sensitive profile details are not
              overexposed.
            </p>
          </section>

          <section className="about-card about-card-footer">
            <h2>Contact</h2>
            <p>
              Email: <a href="mailto:support@hivemate.com">support@hivemate.com</a>
            </p>
            <p className="about-meta">Version 1.0.0</p>
            <p className="about-meta">Copyright 2026 HiveMate</p>
          </section>
        </main>
      </div>
    </div>
  );
};

export default AboutPage;
