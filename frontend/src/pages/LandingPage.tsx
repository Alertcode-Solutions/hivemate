import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePwaInstallPrompt from '../hooks/usePwaInstallPrompt';
import './LandingPage.css';

interface AvatarProfile {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  delay: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const LandingPage = () => {
  const navigate = useNavigate();
  const { canInstall, triggerInstall } = usePwaInstallPrompt();

  const pageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLElement>(null);
  const [timelineLineX, setTimelineLineX] = useState(22);
  const [timelineSeg1Start, setTimelineSeg1Start] = useState(22);
  const [timelineSeg1Height, setTimelineSeg1Height] = useState(0);
  const [timelineSeg2Start, setTimelineSeg2Start] = useState(22);
  const [timelineSeg2Height, setTimelineSeg2Height] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [heroStart, setHeroStart] = useState(0);
  const [featuresStart, setFeaturesStart] = useState(0);

  const updateTimelineGeometry = useCallback(() => {
    const featuresEl = featuresRef.current;
    if (!featuresEl) return;

    const markers = featuresEl.querySelectorAll<HTMLElement>('.landing-feature-marker');
    if (markers.length < 3) return;

    const parentRect = featuresEl.getBoundingClientRect();
    const firstRect = markers[0].getBoundingClientRect();
    const secondRect = markers[1].getBoundingClientRect();
    const thirdRect = markers[2].getBoundingClientRect();

    const centerX = firstRect.left + firstRect.width / 2 - parentRect.left;
    const firstCenter = firstRect.top + firstRect.height / 2 - parentRect.top;
    const secondCenter = secondRect.top + secondRect.height / 2 - parentRect.top;
    const thirdCenter = thirdRect.top + thirdRect.height / 2 - parentRect.top;
    const firstRadius = firstRect.height / 2;
    const secondRadius = secondRect.height / 2;
    const thirdRadius = thirdRect.height / 2;

    // Draw as two segments so the line touches icon boundaries without crossing through circles.
    const seg1Start = firstCenter + firstRadius;
    const seg1End = secondCenter - secondRadius;
    const seg2Start = secondCenter + secondRadius;
    const seg2End = thirdCenter - thirdRadius;
    const nextSeg1Height = Math.max(0, seg1End - seg1Start);
    const nextSeg2Height = Math.max(0, seg2End - seg2Start);

    setTimelineLineX(prev => (Math.abs(prev - centerX) > 0.25 ? Math.max(0, centerX) : prev));
    setTimelineSeg1Start(prev => (Math.abs(prev - seg1Start) > 0.25 ? Math.max(0, seg1Start) : prev));
    setTimelineSeg1Height(prev => (Math.abs(prev - nextSeg1Height) > 0.25 ? nextSeg1Height : prev));
    setTimelineSeg2Start(prev => (Math.abs(prev - seg2Start) > 0.25 ? Math.max(0, seg2Start) : prev));
    setTimelineSeg2Height(prev => (Math.abs(prev - nextSeg2Height) > 0.25 ? nextSeg2Height : prev));
  }, []);

  useEffect(() => {
    setIsVisible(true);

    const updateViewport = () => {
      setViewportHeight(window.innerHeight || 900);
      setViewportWidth(window.innerWidth || 1280);
      if (heroRef.current) {
        setHeroStart(heroRef.current.offsetTop);
      }
      if (featuresRef.current) {
        setFeaturesStart(featuresRef.current.offsetTop);
      }
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);

    return () => {
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    if (heroRef.current) {
      setHeroStart(heroRef.current.offsetTop);
    }
    if (featuresRef.current) {
      setFeaturesStart(featuresRef.current.offsetTop);
    }
  }, [isVisible, viewportHeight]);

  useEffect(() => {
    updateTimelineGeometry();
    window.addEventListener('resize', updateTimelineGeometry);

    return () => {
      window.removeEventListener('resize', updateTimelineGeometry);
    };
  }, [isVisible, viewportHeight, updateTimelineGeometry]);

  useEffect(() => {
    updateTimelineGeometry();
  }, [scrollY, updateTimelineGeometry]);

  useEffect(() => {
    const container = pageRef.current;
    if (!container) return;

    let rafId = 0;

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        setScrollY(container.scrollTop);
        rafId = 0;
      });
    };

    setScrollY(container.scrollTop);
    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  useEffect(() => {
    if (!canInstall) return;

    void triggerInstall();
    const intervalId = window.setInterval(() => {
      void triggerInstall();
    }, 120000);

    return () => window.clearInterval(intervalId);
  }, [canInstall, triggerInstall]);

  const profiles = useMemo<AvatarProfile[]>(
    () => [
      { id: 1, name: 'Aarav', x: 20, y: 50, hue: 184, delay: 0.1 },
      { id: 2, name: 'Neel', x: 25, y: 67, hue: 256, delay: 0.45 },
      { id: 3, name: 'Isha', x: 47, y: 74, hue: 214, delay: 0.8 },
      { id: 4, name: 'Kabir', x: 52, y: 60, hue: 340, delay: 1.2 },
      { id: 5, name: 'Maya', x: 77, y: 54, hue: 302, delay: 1.55 },
      { id: 6, name: 'Sana', x: 72, y: 42, hue: 28, delay: 1.95 }
    ],
    []
  );

  const signalLinks = useMemo(
    () => [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6]
    ],
    []
  );

  const profileById = useMemo(() => {
    const map = new Map<number, AvatarProfile>();
    profiles.forEach(profile => map.set(profile.id, profile));
    return map;
  }, [profiles]);

  const headingPhase = viewportHeight * 0.52;
  const risePhase = viewportHeight * 0.34;
  const ctaPhase = viewportHeight * 0.2;
  const heroTimeline = headingPhase + risePhase + ctaPhase;
  const heroScroll = clamp(scrollY - heroStart, 0, heroTimeline);
  const headingProgress = clamp(heroScroll / headingPhase, 0, 1);
  const headingWords = ['Meet', 'people', 'nearby', 'before', 'the', 'moment', 'passes.'];
  const headingWordProgress = headingProgress * headingWords.length;
  const postHeadingProgress = clamp((heroScroll - headingPhase) / risePhase, 0, 1);
  const ctaProgress = clamp((heroScroll - headingPhase - risePhase) / ctaPhase, 0, 1);
  const headingLift = postHeadingProgress * Math.min(190, viewportHeight * 0.23);
  const mapStartOffset = clamp(viewportHeight * 0.2, 120, 210);
  const mapEnterOffset = (1 - postHeadingProgress) * mapStartOffset;
  const mapOpacity = 0.74 + postHeadingProgress * 0.26;
  const maxScrollY = Math.max(
    (pageRef.current?.scrollHeight ?? 0) - (pageRef.current?.clientHeight ?? viewportHeight),
    1
  );
  const featuresRevealStart = featuresStart - viewportHeight * 0.82;
  // Use real remaining scroll room so the timeline can reach 100% on short mobile pages.
  const featuresRevealRange = Math.max(maxScrollY - featuresRevealStart, viewportHeight * 0.24);
  const isDesktopLayout = viewportWidth >= 1024;
  const featuresProgressByScroll =
    featuresStart > 0 ? clamp((scrollY - featuresRevealStart) / featuresRevealRange, 0, 1) : 0;
  const featuresProgressByViewport =
    featuresStart > 0
      ? clamp((scrollY + viewportHeight - featuresStart) / (viewportHeight * (isDesktopLayout ? 0.48 : 0.65)), 0, 1)
      : 0;
  const featuresProgress = Math.max(featuresProgressByScroll, featuresProgressByViewport);
  const totalTimelineLength = Math.max(timelineSeg1Height + timelineSeg2Height, 1);
  const timelineTravel = featuresProgress * totalTimelineLength;
  const segment1Progress = timelineSeg1Height > 0 ? clamp(timelineTravel / timelineSeg1Height, 0, 1) : 0;
  const segment2Progress =
    timelineSeg2Height > 0 ? clamp((timelineTravel - timelineSeg1Height) / timelineSeg2Height, 0, 1) : 0;
  const desktopLineAB = clamp(featuresProgress * 2, 0, 1);
  const desktopLineBC = clamp(featuresProgress * 2 - 1, 0, 1);
  const mobileIconTouchA = clamp(segment1Progress / 0.12, 0, 1);
  const mobileIconTouchB = Math.max(
    clamp((segment1Progress - 0.9) / 0.1, 0, 1),
    clamp(segment2Progress / 0.12, 0, 1)
  );
  const mobileIconTouchC = clamp((segment2Progress - 0.9) / 0.1, 0, 1);
  const desktopIconTouchA = clamp(featuresProgress / 0.12, 0, 1);
  const desktopIconTouchB = Math.max(
    clamp((desktopLineAB - 0.9) / 0.1, 0, 1),
    clamp(desktopLineBC / 0.12, 0, 1)
  );
  const desktopIconTouchC = clamp((desktopLineBC - 0.9) / 0.1, 0, 1);
  const iconTouchA = isDesktopLayout ? desktopIconTouchA : mobileIconTouchA;
  const iconTouchB = isDesktopLayout ? desktopIconTouchB : mobileIconTouchB;
  const iconTouchC = isDesktopLayout ? desktopIconTouchC : mobileIconTouchC;
  const getFeatureProgress = (index: number) => clamp(featuresProgress * 3 - index, 0, 1);
  const getFeatureTransform = (progress: number) =>
    isDesktopLayout
      ? `translateY(${(1 - progress) * 10}px) scale(${0.985 + progress * 0.015})`
      : `translateX(${(1 - progress) * 34}px) scale(${0.96 + progress * 0.04})`;
  const featureA = getFeatureProgress(0);
  const featureB = getFeatureProgress(1);
  const featureC = getFeatureProgress(2);
  const showContent = isVisible;

  return (
    <div className="landing-page" ref={pageRef}>
      <div className="landing-bg-gradient" aria-hidden="true" />
      <div className="landing-bg-noise" aria-hidden="true" />

      <div className={`landing-content ${showContent ? 'visible' : ''}`}>
        <header className="landing-topbar">
          <div className="landing-brand">
            <span className="landing-brand-main">Hive</span>
            <span className="landing-brand-accent">Mate</span>
          </div>
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
        </header>

        <section
          ref={heroRef}
          className="landing-signal-hero"
          style={{ ['--hero-scroll-space' as string]: `${Math.round(heroTimeline)}px` }}
        >
          <div className="landing-hero-stage">
            <h1 className="landing-hero-sentence" style={{ transform: `translateY(${-headingLift}px)` }}>
              {headingWords.map((word, index) => (
                <span
                  key={`${word}-${index}`}
                  className="landing-hero-word"
                  style={{ ['--word-visible' as string]: `${clamp(headingWordProgress - index, 0, 1)}` }}
                >
                  {word}
                </span>
              ))}
            </h1>
            <div
              className="landing-city-map"
              style={{
                transform: 'translateY(0)',
                opacity: 1
              }}
            >
              <div
                className="city-stage"
                style={{
                  transform: `translateY(${mapEnterOffset}px)`,
                  opacity: `${mapOpacity}`
                }}
              >
                <div className="city-sky" aria-hidden="true">
                  <span className="city-moon" />
                  {[
                    { x: '12%', y: '12%', size: '2.4px', delay: '0s' },
                    { x: '22%', y: '20%', size: '2px', delay: '0.8s' },
                    { x: '34%', y: '9%', size: '2.8px', delay: '1.2s' },
                    { x: '48%', y: '16%', size: '2px', delay: '0.4s' },
                    { x: '58%', y: '11%', size: '2.6px', delay: '1.6s' },
                    { x: '68%', y: '18%', size: '2px', delay: '0.6s' },
                    { x: '79%', y: '10%', size: '2.4px', delay: '1.1s' },
                    { x: '87%', y: '22%', size: '2px', delay: '1.8s' }
                  ].map((star, idx) => (
                    <span
                      key={`sky-star-${idx}`}
                      className="city-star"
                      style={{
                        left: star.x,
                        top: star.y,
                        width: star.size,
                        height: star.size,
                        animationDelay: star.delay
                      }}
                    />
                  ))}
                </div>
                <div className="city-buildings" aria-hidden="true">
                  <div className="city-building city-building-tall">
                    {Array.from({ length: 24 }).map((_, idx) => (
                      <span key={`tall-${idx}`} className={`building-window ${(idx + 1) % 5 === 0 || idx % 7 === 0 ? 'lit' : ''}`} />
                    ))}
                  </div>
                  <div className="city-building city-building-short">
                    {Array.from({ length: 14 }).map((_, idx) => (
                      <span key={`short-${idx}`} className={`building-window ${idx % 3 === 0 || idx % 8 === 0 ? 'lit' : ''}`} />
                    ))}
                  </div>
                  <div className="city-building city-building-mid">
                    {Array.from({ length: 20 }).map((_, idx) => (
                      <span key={`mid-${idx}`} className={`building-window ${(idx + 2) % 4 === 0 || idx % 9 === 0 ? 'lit' : ''}`} />
                    ))}
                  </div>
                </div>
                {signalLinks.map(([fromId, toId], index) => {
                  const from = profileById.get(fromId);
                  const to = profileById.get(toId);
                  if (!from || !to) return null;
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const length = Math.hypot(dx, dy);
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                  return (
                    <span
                      key={`${fromId}-${toId}`}
                      className="signal-link"
                      style={{
                        left: `${from.x}%`,
                        top: `${from.y}%`,
                        width: `${length}%`,
                        transform: `translateY(-50%) rotate(${angle}deg)`,
                        animationDelay: `${index * 0.24}s`
                      }}
                      aria-hidden="true"
                    />
                  );
                })}

                {profiles.map(profile => (
                  <button
                    key={profile.id}
                    type="button"
                    className="signal-node"
                    style={{
                      left: `${profile.x}%`,
                      top: `${profile.y}%`,
                      ['--node-hue' as string]: profile.hue,
                      animationDelay: `${profile.delay}s`
                    }}
                    onClick={() => navigate('/register')}
                    aria-label={`Connect with ${profile.name}`}
                  >
                    <span className="signal-node-dot" />
                    <span className="signal-node-label">{profile.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              className="landing-cta-row"
              style={{
                opacity: ctaProgress,
                transform: `translateY(${(1 - ctaProgress) * 34}px) scale(${0.94 + ctaProgress * 0.06})`
              }}
            >
              <button className="landing-btn-primary landing-btn-lg" onClick={() => navigate('/register')}>
                Create Your Profile
              </button>
              <button className="landing-btn-secondary landing-btn-lg" onClick={() => navigate('/login')}>
                I Already Have an Account
              </button>
            </div>
          </div>
        </section>

        <section
          ref={featuresRef}
          className="landing-features"
          style={{
            ['--timeline-progress' as string]: `${featuresProgress}`,
            ['--timeline-line-x' as string]: `${timelineLineX}px`,
            ['--timeline-seg1-start' as string]: `${timelineSeg1Start}px`,
            ['--timeline-seg1-height' as string]: `${timelineSeg1Height}px`,
            ['--timeline-seg2-start' as string]: `${timelineSeg2Start}px`,
            ['--timeline-seg2-height' as string]: `${timelineSeg2Height}px`,
            ['--timeline-seg1-progress' as string]: `${segment1Progress}`,
            ['--timeline-seg2-progress' as string]: `${segment2Progress}`
          }}
        >
          <article
            className="landing-feature-card"
            style={{
              ['--feature-progress' as string]: `${featureA}`,
              ['--line-progress' as string]: `${desktopLineAB}`,
              ['--icon-touch' as string]: `${iconTouchA}`,
              opacity: 0.58 + featureA * 0.42,
              transform: getFeatureTransform(featureA)
            }}
          >
            <div className="landing-feature-marker" aria-hidden="true">
              <span className="landing-feature-marker-core">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
              </span>
            </div>
            <div className="landing-feature-copy">
              <h4>Nearby Discovery</h4>
              <p>Discover nearby people and build meaningful connections.</p>
            </div>
          </article>
          <article
            className="landing-feature-card"
            style={{
              ['--feature-progress' as string]: `${featureB}`,
              ['--line-progress' as string]: `${desktopLineBC}`,
              ['--icon-touch' as string]: `${iconTouchB}`,
              opacity: 0.58 + featureB * 0.42,
              transform: getFeatureTransform(featureB)
            }}
          >
            <div className="landing-feature-marker" aria-hidden="true">
              <span className="landing-feature-marker-core">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
            </div>
            <div className="landing-feature-copy">
              <h4>Privacy First</h4>
              <p>End to end encrypted chat and explore/vanish  profile visibility controls.</p>
            </div>
          </article>
          <article
            className="landing-feature-card"
            style={{
              ['--feature-progress' as string]: `${featureC}`,
              ['--icon-touch' as string]: `${iconTouchC}`,
              opacity: 0.58 + featureC * 0.42,
              transform: getFeatureTransform(featureC)
            }}
          >
            <div className="landing-feature-marker" aria-hidden="true">
              <span className="landing-feature-marker-core">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
              </span>
            </div>
            <div className="landing-feature-copy">
              <h4>Build and Grow</h4>
              <p>Find teammates or partner, create opportunities and grow your network in one platform.</p>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
};

export default LandingPage;
