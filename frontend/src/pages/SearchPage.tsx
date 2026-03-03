import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { goToProfile, resolveProfileTarget } from '../utils/profileRouting';
import LoadingDots from '../components/LoadingDots';
import './SearchPage.css';

interface SearchFilters {
  query: string;
  skills: string[];
  profession: string;
  locations: string[];
}

interface Profile {
  _id: string;
  userId: string;
  name: string;
  username?: string;
  profession: string;
  skills: string[];
  photos: string[];
}

interface RecentProfile {
  userId: string;
  name: string;
  username?: string;
  photo?: string;
}

type SearchMode = 'profiles' | 'gigs';

const RECENT_SEARCHES_KEY = 'recentProfileSearches';

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M10.5 3.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm9.5 17.5-4.2-4.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const FilterIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ComingSoonIcon = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <rect x="8" y="14" width="48" height="36" rx="8" fill="none" stroke="currentColor" strokeWidth="2.5" />
    <path d="M20 24h24M20 32h16M20 40h10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="50" cy="18" r="6" fill="#3f68e3" />
  </svg>
);

const SearchPage = () => {
  const navigate = useNavigate();
  const API_URL = getApiBaseUrl();
  const currentUserId = String(localStorage.getItem('userId') || '');

  const [searchMode, setSearchMode] = useState<SearchMode>('profiles');
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    skills: [],
    profession: '',
    locations: []
  });
  const [skillInput, setSkillInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [skillSuggestions, setSkillSuggestions] = useState<string[]>([]);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [profileResults, setProfileResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [recentProfiles, setRecentProfiles] = useState<RecentProfile[]>([]);
  const keyboardBaseScrollYRef = useRef(0);
  const keyboardLiftAppliedRef = useRef(false);
  const keyboardWasOpenRef = useRef(false);

  const commonSkills = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'React', 'Node.js', 'Angular', 'Vue.js',
    'MongoDB', 'PostgreSQL', 'AWS', 'Docker', 'Kubernetes', 'Machine Learning', 'Data Science',
    'UI/UX Design', 'Product Management', 'Marketing', 'Sales', 'Business Development'
  ];
  const commonLocations = [
    'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata',
    'Ahmedabad', 'Jaipur', 'Lucknow', 'New York', 'San Francisco', 'Los Angeles',
    'Chicago', 'Seattle', 'London', 'Toronto', 'Singapore', 'Dubai'
  ];

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((item: any) => ({
            userId: resolveProfileTarget(item?.userId || item),
            name: String(item?.name || 'Unknown User'),
            username: item?.username ? String(item.username) : undefined,
            photo: item?.photo ? String(item.photo) : ''
          }))
          .filter((item) => Boolean(item.userId));
        setRecentProfiles(normalized);
      }
    } catch {
      setRecentProfiles([]);
    }
  }, []);

  const saveRecentProfiles = (profiles: RecentProfile[]) => {
    setRecentProfiles(profiles);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(profiles));
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.skills.length > 0) count++;
    if (filters.profession.trim()) count++;
    if (filters.locations.length > 0) count++;
    return count;
  }, [filters]);

  const hasSearchInput = useMemo(() => {
    if (searchMode === 'gigs') return false;
    return Boolean(
      filters.query.trim() ||
      filters.skills.length > 0 ||
      filters.profession.trim() ||
      filters.locations.length > 0
    );
  }, [filters, searchMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchMode !== 'profiles') {
        setProfileResults([]);
        return;
      }

      if (hasSearchInput) {
        performSearch();
      } else {
        setProfileResults([]);
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [filters, searchMode, hasSearchInput]);

  const performSearch = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const body: any = { page: 1, limit: 30 };
      const rawQuery = filters.query.trim();

      if (rawQuery) {
        body.query = rawQuery;
        body.username = rawQuery.startsWith('@') ? rawQuery.slice(1) : rawQuery;
      }
      if (filters.skills.length > 0) body.skills = filters.skills;
      if (filters.profession.trim()) body.profession = filters.profession.trim();
      if (filters.locations.length > 0) body.locations = filters.locations;

      const response = await fetch(`${API_URL}/api/search/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error('Profile search failed');
      const data = await response.json();
      const incomingProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      const filteredProfiles = incomingProfiles.filter((profile: Profile) => String(profile.userId) !== currentUserId);
      setProfileResults(filteredProfiles);
    } catch (error) {
      console.error('Search error:', error);
      setProfileResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSkillInput = (value: string) => {
    setSkillInput(value);
    if (!value.trim()) {
      setSkillSuggestions([]);
      return;
    }
    const filtered = commonSkills.filter((skill) => {
      return skill.toLowerCase().includes(value.toLowerCase()) && !filters.skills.includes(skill);
    });
    setSkillSuggestions(filtered.slice(0, 6));
  };

  const addSkill = (skill: string) => {
    const clean = skill.trim();
    if (!clean || filters.skills.includes(clean)) return;
    setFilters((prev) => ({ ...prev, skills: [...prev.skills, clean] }));
    setSkillInput('');
    setSkillSuggestions([]);
  };

  const removeSkill = (skill: string) => {
    setFilters((prev) => ({ ...prev, skills: prev.skills.filter((s) => s !== skill) }));
  };

  const handleLocationInput = (value: string) => {
    setLocationInput(value);
    if (!value.trim()) {
      setLocationSuggestions([]);
      return;
    }
    const normalized = value.toLowerCase();
    const filtered = commonLocations.filter((location) => {
      return location.toLowerCase().includes(normalized) && !filters.locations.includes(location);
    });
    setLocationSuggestions(filtered.slice(0, 6));
  };

  const addLocation = (location: string) => {
    const clean = location.trim();
    if (!clean) return;
    const exists = filters.locations.some((item) => item.toLowerCase() === clean.toLowerCase());
    if (exists) return;
    setFilters((prev) => ({ ...prev, locations: [...prev.locations, clean] }));
    setLocationInput('');
    setLocationSuggestions([]);
  };

  const removeLocation = (location: string) => {
    setFilters((prev) => ({
      ...prev,
      locations: prev.locations.filter((item) => item.toLowerCase() !== location.toLowerCase())
    }));
  };

  const clearFilters = () => {
    setFilters({
      query: '',
      skills: [],
      profession: '',
      locations: []
    });
    setSkillInput('');
    setLocationInput('');
    setSkillSuggestions([]);
    setLocationSuggestions([]);
    setProfileResults([]);
  };

  const addRecentProfile = (profile: Profile) => {
    const resolvedUserId = resolveProfileTarget(profile);
    if (!resolvedUserId) return;

    const item: RecentProfile = {
      userId: resolvedUserId,
      name: profile.name || 'Unknown User',
      username: profile.username,
      photo: profile.photos?.[0] || ''
    };
    const next = [
      item,
      ...recentProfiles.filter((existing) => String(existing.userId) !== String(item.userId))
    ].slice(0, 8);
    saveRecentProfiles(next);
  };

  const removeRecentProfile = (userId: string) => {
    const next = recentProfiles.filter((item) => String(item.userId) !== String(userId));
    saveRecentProfiles(next);
  };

  const promoteRecentProfile = (userId: string) => {
    const next = [
      ...recentProfiles.filter((item) => String(item.userId) === String(userId)),
      ...recentProfiles.filter((item) => String(item.userId) !== String(userId))
    ];
    saveRecentProfiles(next);
  };

  const getInitial = (name: string) => (name?.charAt(0).toUpperCase() || 'U');

  useEffect(() => {
    const isTypingField = (element: Element | null) => {
      const target = element as HTMLElement | null;
      if (!target) return false;
      return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.getAttribute('contenteditable') === 'true'
      );
    };

    const getKeyboardOffset = () => {
      const viewport = window.visualViewport;
      if (!viewport) return 0;
      return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    };

    const syncKeyboardScroll = () => {
      const active = document.activeElement;
      const hasTypingFocus = isTypingField(active);
      const keyboardOffset = getKeyboardOffset();
      const keyboardOpen = keyboardOffset > 120;
      keyboardWasOpenRef.current = keyboardOpen;

      if (keyboardOpen && hasTypingFocus && !keyboardLiftAppliedRef.current) {
        keyboardLiftAppliedRef.current = true;
        window.scrollTo({ top: keyboardBaseScrollYRef.current + 180, behavior: 'smooth' });
      } else if (!keyboardOpen && keyboardLiftAppliedRef.current) {
        keyboardLiftAppliedRef.current = false;
        window.scrollTo(0, keyboardBaseScrollYRef.current);
        window.setTimeout(() => window.scrollTo(0, keyboardBaseScrollYRef.current), 90);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTypingField(event.target as Element | null)) return;
      keyboardBaseScrollYRef.current = window.scrollY;
      keyboardLiftAppliedRef.current = false;
      window.setTimeout(syncKeyboardScroll, 80);
    };

    const handleFocusOut = () => {
      window.setTimeout(() => {
        const keyboardOffset = getKeyboardOffset();
        if (keyboardOffset <= 120 || !keyboardWasOpenRef.current) {
          keyboardLiftAppliedRef.current = false;
          window.scrollTo(0, keyboardBaseScrollYRef.current);
        }
      }, 120);
    };

    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', syncKeyboardScroll);
    viewport?.addEventListener('scroll', syncKeyboardScroll);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      viewport?.removeEventListener('resize', syncKeyboardScroll);
      viewport?.removeEventListener('scroll', syncKeyboardScroll);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const toggleFilters = () => {
    setShowFilters((prev) => !prev);
  };

  return (
    <div className="search-page">
      <header className="search-header">
        <button className="back-button back-arrow-only" onClick={() => navigate('/home')} aria-label="Go back">
          <BackIcon />
        </button>
        <div className="search-mode-toggle" role="tablist" aria-label="Search mode">
          <button className={searchMode === 'profiles' ? 'active' : ''} onClick={() => setSearchMode('profiles')}>
            People
          </button>
          <button className={searchMode === 'gigs' ? 'active' : ''} onClick={() => setSearchMode('gigs')}>
            Gigs
          </button>
        </div>
      </header>

      <div className="search-container">

        <div className="search-bar-container">
          <div className="search-input-wrap">
            <SearchIcon />
            <input
              type="text"
              className="search-bar"
              placeholder={searchMode === 'profiles' ? 'Search by name or @username' : 'Gigs coming soon'}
              value={filters.query}
              onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
              disabled={searchMode === 'gigs'}
            />
          </div>
        </div>

        <div className="search-filters-row">
          <button
            type="button"
            className="filter-toggle-button"
            onClick={toggleFilters}
            disabled={searchMode !== 'profiles'}
            aria-expanded={showFilters}
            aria-controls="search-filter-panel"
          >
            <FilterIcon />
            <span>{showFilters ? 'Hide Filters' : 'Filters'}</span>
            {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
          </button>
        </div>

        {showFilters && searchMode === 'profiles' && (
          <div id="search-filter-panel" className="filter-panel">
            <div className="filter-header">
              <h3>Filter Results</h3>
              <button className="clear-filters" onClick={clearFilters}>
                Reset
              </button>
            </div>

            <div className="filter-grid">
              <div className="filter-section">
                <label>Skills</label>
                <div className="skill-input-container">
                  <input
                    type="text"
                    placeholder="Add skill"
                    value={skillInput}
                    onChange={(e) => handleSkillInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && skillInput.trim()) addSkill(skillInput);
                    }}
                  />
                  {skillSuggestions.length > 0 && (
                    <div className="autocomplete-suggestions">
                      {skillSuggestions.map((skill) => (
                        <button key={skill} type="button" className="suggestion-item" onClick={() => addSkill(skill)}>
                          {skill}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="selected-skills">
                  {filters.skills.map((skill) => (
                    <span key={skill} className="skill-tag">
                      {skill}
                      <button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}>
                        x
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="filter-section">
                <label>Profession</label>
                <input
                  type="text"
                  placeholder="Role"
                  value={filters.profession}
                  onChange={(e) => setFilters((prev) => ({ ...prev, profession: e.target.value }))}
                />
              </div>

              <div className="filter-section">
                <label>Locations</label>
                <div className="skill-input-container">
                  <input
                    type="text"
                    placeholder="Add location"
                    value={locationInput}
                    onChange={(e) => handleLocationInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && locationInput.trim()) addLocation(locationInput);
                    }}
                  />
                  {locationSuggestions.length > 0 && (
                    <div className="autocomplete-suggestions">
                      {locationSuggestions.map((location) => (
                        <button
                          key={location}
                          type="button"
                          className="suggestion-item"
                          onClick={() => addLocation(location)}
                        >
                          {location}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="selected-skills">
                  {filters.locations.map((location) => (
                    <span key={location} className="skill-tag">
                      {location}
                      <button type="button" onClick={() => removeLocation(location)} aria-label={`Remove ${location}`}>
                        x
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="search-results">
          {searchMode === 'gigs' ? (
            <div className="coming-soon-card">
              <ComingSoonIcon />
              <h3>Gigs Search Is Under Development</h3>
              <p>This section is coming soon.</p>
            </div>
          ) : (
            <>
              {!loading && !hasSearchInput && recentProfiles.length > 0 && (
                <section className="recent-searches">
                  <div className="recent-searches-header">
                    <h3>Recent Searches</h3>
                  </div>
                  <div className="profile-results">
                    {recentProfiles.map((profile) => (
                      <div key={profile.userId} className="profile-card profile-card-recent">
                        <button
                          className="profile-card-main"
                          type="button"
                          onClick={() => {
                            promoteRecentProfile(profile.userId);
                            goToProfile(navigate, profile.userId);
                          }}
                        >
                          <div className="profile-avatar">
                            {profile.photo ? (
                              <img src={profile.photo} alt={profile.name} />
                            ) : (
                              <span className="profile-avatar-fallback">{getInitial(profile.name)}</span>
                            )}
                          </div>
                          <div className="profile-info">
                            <h3>{profile.name || 'Unknown User'}</h3>
                            <p className="username">{profile.username ? `@${profile.username}` : '@user'}</p>
                          </div>
                        </button>
                        <button
                          className="recent-remove-btn"
                          type="button"
                          aria-label={`Remove ${profile.name} from recent searches`}
                          onClick={() => removeRecentProfile(profile.userId)}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {loading ? (
                <div className="loading">
                  <LoadingDots label="Searching" centered />
                </div>
              ) : profileResults.length > 0 ? (
                <div className="profile-results">
                  {profileResults.map((profile) => (
                    <button
                      key={profile._id}
                      className="profile-card"
                      onClick={() => {
                        addRecentProfile(profile);
                        goToProfile(navigate, resolveProfileTarget(profile));
                      }}
                      type="button"
                    >
                      <div className="profile-avatar">
                        {profile.photos?.[0] ? (
                          <img src={profile.photos[0]} alt={profile.name} />
                        ) : (
                          <span className="profile-avatar-fallback">{getInitial(profile.name)}</span>
                        )}
                      </div>
                      <div className="profile-info">
                        <h3>{profile.name || 'Unknown User'}</h3>
                        <p className="username">{profile.username ? `@${profile.username}` : '@user'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : hasSearchInput ? (
                <div className="no-results">
                  <p>No people found</p>
                  <p className="no-results-subtitle">Try changing filters or search query.</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchPage;
