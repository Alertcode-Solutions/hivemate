import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import RadarView from '../components/RadarView';
import NotificationBell from '../components/NotificationBell';
import AppContainer from '../components/ui/AppContainer';
import { goToProfile } from '../utils/profileRouting';
import './HomePage.css';

type ViewMode = 'partner' | 'teammate';
const VIEW_MODES: ViewMode[] = ['partner', 'teammate'];

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M16 16L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const UserIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="8.5" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M5.5 19.5c1.2-3.1 3.5-4.7 6.5-4.7s5.3 1.6 6.5 4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const FriendsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="9" cy="9" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="15.5" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M4.8 18.7c1-2.5 2.8-3.8 5.2-3.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M11.7 18.7c0.9-2.1 2.4-3.2 4.5-3.2 1.6 0 2.7 0.5 3.5 1.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const ConnectionIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9.3 8.8h-2A3.3 3.3 0 0 0 4 12a3.3 3.3 0 0 0 3.3 3.3h2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14.7 8.8h2A3.3 3.3 0 0 1 20 12a3.3 3.3 0 0 1-3.3 3.3h-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M9.2 12h5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 6.8h14v9.1H9.3L5 19.2V6.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 7h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <path d="M5 12h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <path d="M5 17h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

const StarIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m12 4.2 2.1 4.3 4.8.7-3.5 3.5.8 4.9L12 15.3 7.8 17.6l.8-4.9L5.1 9.2l4.8-.7L12 4.2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="8.2" r="1" fill="currentColor" />
    <path d="M12 11.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M10.5 4.8H6.8a1.9 1.9 0 0 0-1.8 1.9v10.6a1.9 1.9 0 0 0 1.8 1.9h3.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14.2 8.5 18 12l-3.8 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const HomePage = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('partner');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isPanelSwitching, setIsPanelSwitching] = useState(false);
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (desktopMenuRef.current && !desktopMenuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      const clickedInMobileNav = target instanceof Element && Boolean(target.closest('.mobile-bottom-nav'));
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target) && !clickedInMobileNav) {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('privateKey');
    localStorage.removeItem('publicKey');
    navigate('/login');
  };

  useEffect(() => {
    setIsPanelSwitching(true);
    const timeout = window.setTimeout(() => setIsPanelSwitching(false), 250);
    return () => window.clearTimeout(timeout);
  }, [viewMode]);

  const activateMode = (mode: ViewMode) => {
    setViewMode(mode);
  };

  const handleTabKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const nextIndex = (index + 1) % VIEW_MODES.length;
      tabRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prevIndex = (index - 1 + VIEW_MODES.length) % VIEW_MODES.length;
      tabRefs.current[prevIndex]?.focus();
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      tabRefs.current[0]?.focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      tabRefs.current[VIEW_MODES.length - 1]?.focus();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateMode(VIEW_MODES[index]);
    }
  };

  return (
    <div className="homepage home-screen-wrapper">
      <header className="homepage-header">
        <h1 className="app-name">
          Hive<span>Mate</span>
        </h1>

        <div className="header-actions" ref={desktopMenuRef}>
          <button
            className="search-button"
            onClick={() => navigate('/search')}
            title="Advanced Search"
            aria-label="Open advanced search"
          >
            <SearchIcon />
          </button>

          <NotificationBell />

          <button
            className="profile-button top-profile-button"
            onClick={() => goToProfile(navigate, localStorage.getItem('userId'))}
            title="Profile"
            aria-label="Open profile"
          >
            <UserIcon />
          </button>

          <button
            className="hamburger-menu desktop-menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>

          {menuOpen && (
            <div className="dropdown-menu">
              <button onClick={() => { goToProfile(navigate, localStorage.getItem('userId')); setMenuOpen(false); setMobileMenuOpen(false); }}>
                <span className="menu-icon"><UserIcon /></span>
                Profile
              </button>
              <button onClick={() => { navigate('/friends'); setMenuOpen(false); setMobileMenuOpen(false); }}>
                <span className="menu-icon"><FriendsIcon /></span>
                Friend List
              </button>
              <button onClick={() => { navigate('/connections'); setMenuOpen(false); setMobileMenuOpen(false); }}>
                <span className="menu-icon"><ConnectionIcon /></span>
                Connections
              </button>
              <button onClick={() => { navigate('/chat'); setMenuOpen(false); setMobileMenuOpen(false); }}>
                <span className="menu-icon"><ChatIcon /></span>
                Messages
              </button>
              <button onClick={() => { navigate('/subscription'); setMenuOpen(false); setMobileMenuOpen(false); }}>
                <span className="menu-icon"><StarIcon /></span>
                Subscription
              </button>
              <button onClick={() => { navigate('/about'); setMenuOpen(false); setMobileMenuOpen(false); }}>
                <span className="menu-icon"><InfoIcon /></span>
                About Us
              </button>
              <button onClick={() => { handleLogout(); setMenuOpen(false); setMobileMenuOpen(false); }} className="logout-button">
                <span className="menu-icon"><LogoutIcon /></span>
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <AppContainer className="home-shell">
        <section className="fused-tabs-shell" aria-label="Home discovery modes">
          <div className="mode-toggle-container">
            <div className={`mode-toggle mode-${viewMode}`} role="tablist" aria-label="Choose mode">
              <button
                className={`toggle-option ${viewMode === 'partner' ? 'active' : ''}`}
                onClick={() => activateMode('partner')}
                onKeyDown={(event) => handleTabKeyDown(0, event)}
                role="tab"
                id="home-tab-partner"
                aria-controls="home-panel-partner"
                aria-selected={viewMode === 'partner'}
                tabIndex={viewMode === 'partner' ? 0 : -1}
                ref={(el) => { tabRefs.current[0] = el; }}
              >
                Find a Friend
              </button>
              <button
                className={`toggle-option toggle-option-disabled ${viewMode === 'teammate' ? 'active' : ''}`}
                onClick={() => activateMode('teammate')}
                onKeyDown={(event) => handleTabKeyDown(1, event)}
                role="tab"
                id="home-tab-teammate"
                aria-controls="home-panel-teammate"
                aria-selected={viewMode === 'teammate'}
                aria-label="Find a Team Mate (under development)"
                tabIndex={viewMode === 'teammate' ? 0 : -1}
                ref={(el) => { tabRefs.current[1] = el; }}
              >
                Find a Team Mate
              </button>
            </div>
          </div>

          <main
            className={`homepage-content ${isPanelSwitching ? 'is-switching' : ''}`}
            role="tabpanel"
            id={viewMode === 'partner' ? 'home-panel-partner' : 'home-panel-teammate'}
            aria-labelledby={viewMode === 'partner' ? 'home-tab-partner' : 'home-tab-teammate'}
          >
            <div className="content-panel">
              {viewMode === 'partner' ? (
                <RadarView />
              ) : (
                <section className="teammate-soon-panel" aria-live="polite">
                  <div className="teammate-soon-card">
                    <h2>Find a Team Mate</h2>
                    <p>
                      This section is in active development. We are building a cleaner way to discover
                      verified collaborators for jobs, startups, projects, and hackathons.
                    </p>
                    <button className="teammate-soon-btn" onClick={() => setViewMode('partner')}>
                      Back to Find a Partner
                    </button>
                  </div>
                </section>
              )}
            </div>
          </main>
        </section>
      </AppContainer>

      {mobileMenuOpen && (
        <div className="mobile-menu-panel" id="mobile-home-menu" ref={mobileMenuRef}>
          <button onClick={() => { goToProfile(navigate, localStorage.getItem('userId')); setMobileMenuOpen(false); }}>
            <span className="menu-icon"><UserIcon /></span>
            Profile
          </button>
          <button onClick={() => { navigate('/connections'); setMobileMenuOpen(false); }}>
            <span className="menu-icon"><ConnectionIcon /></span>
            Requests
          </button>
          <button onClick={() => { navigate('/subscription'); setMobileMenuOpen(false); }}>
            <span className="menu-icon"><StarIcon /></span>
            Subscription
          </button>
          <button onClick={() => { navigate('/about'); setMobileMenuOpen(false); }}>
            <span className="menu-icon"><InfoIcon /></span>
            About Us
          </button>
          <button onClick={() => { handleLogout(); setMobileMenuOpen(false); }} className="logout-button">
            <span className="menu-icon"><LogoutIcon /></span>
            Logout
          </button>
        </div>
      )}

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button onClick={() => { navigate('/friends'); setMobileMenuOpen(false); }} aria-label="Friend list">
          <FriendsIcon />
        </button>
        <button onClick={() => { navigate('/search'); setMobileMenuOpen(false); }} aria-label="Search">
          <SearchIcon />
        </button>
        <button onClick={() => { navigate('/chat'); setMobileMenuOpen(false); }} aria-label="Messages">
          <ChatIcon />
        </button>
        <button
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label="Open menu"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-home-menu"
        >
          <MenuIcon />
        </button>
      </nav>
    </div>
  );
};

export default HomePage;
