import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import LoadingDots from './LoadingDots';
import './GigFeed.css';

interface Gig {
  _id: string;
  title: string;
  description: string;
  type: string;
  paymentStatus: string;
  skillsRequired: string[];
  creatorId: {
    _id: string;
    name: string;
    profession: string;
  };
  status: string;
  location?: string;
  duration?: string;
  compensation?: string;
  applicants: string[];
  createdAt: string;
}

interface GigFeedProps {
  onCreateGig?: () => void;
}

const GigFeed = ({ onCreateGig }: GigFeedProps) => {
  const navigate = useNavigate();
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const observerTarget = useRef<HTMLDivElement>(null);

  const API_URL = getApiBaseUrl();

  useEffect(() => {
    setPage(1);
    setGigs([]);
    fetchGigs(1, true);
  }, [filter, searchQuery, paymentFilter, skillFilter]);

  useEffect(() => {
    if (page > 1) {
      fetchGigs(page, false);
    }
  }, [page]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loading]);

  const fetchGigs = async (pageNum: number, reset: boolean) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      let url = `${API_URL}/api/gigs?page=${pageNum}&limit=12`;
      
      if (filter !== 'all') {
        url += `&type=${filter}`;
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        let newGigs = data.gigs || [];
        
        // Apply client-side filters
        if (searchQuery) {
          newGigs = newGigs.filter((gig: Gig) =>
            gig.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            gig.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            gig.skillsRequired.some(skill => 
              skill.toLowerCase().includes(searchQuery.toLowerCase())
            )
          );
        }

        if (paymentFilter) {
          newGigs = newGigs.filter((gig: Gig) => gig.paymentStatus === paymentFilter);
        }

        if (skillFilter) {
          newGigs = newGigs.filter((gig: Gig) =>
            gig.skillsRequired.some(skill =>
              skill.toLowerCase().includes(skillFilter.toLowerCase())
            )
          );
        }

        if (reset) {
          setGigs(newGigs);
        } else {
          setGigs((prev) => [...prev, ...newGigs]);
        }

        setHasMore(pageNum < (data.pagination?.pages || 1));
      }
    } catch (error) {
      console.error('Failed to fetch gigs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleGigClick = (gigId: string) => {
    navigate(`/gig/${gigId}`);
  };

  const handleApply = async (gigId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/gig/${gigId}?apply=true`);
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

  const clearFilters = () => {
    setFilter('all');
    setPaymentFilter('');
    setSkillFilter('');
    setSearchQuery('');
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filter !== 'all') count++;
    if (paymentFilter) count++;
    if (skillFilter) count++;
    if (searchQuery) count++;
    return count;
  };

  return (
    <div className="gig-feed">
      <div className="gig-header">
        <h2>Opportunities</h2>
        <button 
          className="create-gig-button"
          onClick={onCreateGig}
        >
          + Create Gig
        </button>
      </div>

      <div className="gig-search">
        <input
          type="text"
          placeholder="Search by title, description, or skills..."
          value={searchQuery}
          onChange={handleSearch}
          className="search-input"
        />
      </div>

      <div className="gig-filters">
        <button
          className={`filter-button ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`filter-button ${filter === 'job' ? 'active' : ''}`}
          onClick={() => setFilter('job')}
        >
          💼 Jobs
        </button>
        <button
          className={`filter-button ${filter === 'startup' ? 'active' : ''}`}
          onClick={() => setFilter('startup')}
        >
          🚀 Startups
        </button>
        <button
          className={`filter-button ${filter === 'project' ? 'active' : ''}`}
          onClick={() => setFilter('project')}
        >
          📁 Projects
        </button>
        <button
          className={`filter-button ${filter === 'hackathon' ? 'active' : ''}`}
          onClick={() => setFilter('hackathon')}
        >
          ⚡ Hackathons
        </button>
        <button
          className="filter-toggle-button"
          onClick={() => setShowFilters(!showFilters)}
        >
          🔍 More Filters {getActiveFilterCount() > 0 && `(${getActiveFilterCount()})`}
        </button>
      </div>

      {showFilters && (
        <div className="advanced-filters">
          <div className="filter-header">
            <h4>Advanced Filters</h4>
            {getActiveFilterCount() > 0 && (
              <button className="clear-all-btn" onClick={clearFilters}>
                Clear All
              </button>
            )}
          </div>

          <div className="filter-row">
            <div className="filter-field">
              <label>Payment Status</label>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="paid">💰 Paid</option>
                <option value="unpaid">🤝 Unpaid</option>
              </select>
            </div>

            <div className="filter-field">
              <label>Skill Required</label>
              <input
                type="text"
                placeholder="e.g., React, Python..."
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
              />
            </div>
          </div>

          {getActiveFilterCount() > 0 && (
            <div className="active-filters">
              <span className="active-filters-label">Active filters:</span>
              {filter !== 'all' && (
                <span className="filter-tag">
                  Type: {filter}
                  <button onClick={() => setFilter('all')}>×</button>
                </span>
              )}
              {paymentFilter && (
                <span className="filter-tag">
                  Payment: {paymentFilter}
                  <button onClick={() => setPaymentFilter('')}>×</button>
                </span>
              )}
              {skillFilter && (
                <span className="filter-tag">
                  Skill: {skillFilter}
                  <button onClick={() => setSkillFilter('')}>×</button>
                </span>
              )}
              {searchQuery && (
                <span className="filter-tag">
                  Search: {searchQuery}
                  <button onClick={() => setSearchQuery('')}>×</button>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {loading && page === 1 ? (
        <div className="gig-loading">
          <LoadingDots label="Loading opportunities" centered />
        </div>
      ) : gigs.length === 0 ? (
        <div className="no-gigs">
          <p>No opportunities found</p>
          <p className="no-gigs-subtitle">
            {searchQuery ? 'Try a different search term' : 'Be the first to create one!'}
          </p>
        </div>
      ) : (
        <>
          <div className="gig-list">
            {gigs.map((gig) => (
              <div 
                key={gig._id} 
                className="gig-card"
                onClick={() => handleGigClick(gig._id)}
              >
                <div className="gig-card-header">
                  <span className="gig-type-icon">{getTypeIcon(gig.type)}</span>
                  <div className="gig-meta">
                    <span className="gig-type">{gig.type}</span>
                    <span className={`gig-payment ${gig.paymentStatus}`}>
                      {gig.paymentStatus === 'paid' ? '💰 Paid' : '🤝 Unpaid'}
                    </span>
                  </div>
                </div>

                <h3 className="gig-title">{gig.title}</h3>
                <p className="gig-description">{gig.description}</p>

                {gig.location && (
                  <div className="gig-location">📍 {gig.location}</div>
                )}

                <div className="gig-skills">
                  {gig.skillsRequired.slice(0, 3).map((skill, index) => (
                    <span key={index} className="skill-badge">{skill}</span>
                  ))}
                  {gig.skillsRequired.length > 3 && (
                    <span className="skill-badge more">+{gig.skillsRequired.length - 3}</span>
                  )}
                </div>

                <div className="gig-footer">
                  <div className="gig-creator">
                    <span className="creator-name">{gig.creatorId.name}</span>
                    <span className="creator-profession">{gig.creatorId.profession}</span>
                  </div>
                  <button 
                    className="apply-button"
                    onClick={(e) => handleApply(gig._id, e)}
                  >
                    Apply
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Infinite scroll trigger */}
          {hasMore && (
            <div ref={observerTarget} className="load-more-trigger">
              {loading && (
                <div className="loading-more">
                  <LoadingDots label="Loading more" centered />
                </div>
              )}
            </div>
          )}

          {!hasMore && gigs.length > 0 && (
            <div className="end-of-list">
              You've reached the end of the list
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default GigFeed;
