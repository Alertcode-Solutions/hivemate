import { useEffect, useState } from 'react';
import './BeeLoader.css';

interface BeeLoaderProps {
  message?: string;
  fullscreen?: boolean;
  compact?: boolean;
  inline?: boolean;
  complete?: boolean;
  onComplete?: () => void;
  className?: string;
}

const BeeLoader = ({
  message = 'Loading...',
  fullscreen = false,
  compact = false,
  inline = false,
  complete = false,
  onComplete,
  className = ''
}: BeeLoaderProps) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let doneEmitted = false;
    const interval = window.setInterval(() => {
      setProgress((prev) => {
        if (complete) {
          const next = Math.min(100, prev + Math.max(2, (100 - prev) * 0.22));
          if (next >= 100 && !doneEmitted) {
            doneEmitted = true;
            window.setTimeout(() => onComplete?.(), 120);
          }
          return next;
        }

        if (prev >= 92) return 92;
        const step = prev < 40 ? 1.3 : prev < 70 ? 0.8 : 0.35;
        return Math.min(92, prev + step);
      });
    }, 42);

    return () => window.clearInterval(interval);
  }, [complete, onComplete]);

  return (
    <div
      className={[
        'bee-loader',
        fullscreen ? 'bee-loader--fullscreen' : '',
        compact ? 'bee-loader--compact' : '',
        inline ? 'bee-loader--inline' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="bee-loader__panel">
        <div className="bee-loader__stage" style={{ ['--bee-progress' as string]: `${Math.round(progress)}%` }}>
          <div className="bee-loader__ring" aria-hidden="true" />
          <div className="bee-loader__bee-motion">
            <img src="/logo.svg" alt="" className="bee-loader__logo" />
          </div>
        </div>
        <div className="bee-loader__percent">{Math.round(progress)}%</div>
        <p className="bee-loader__message">{message}</p>
      </div>
    </div>
  );
};

export default BeeLoader;
