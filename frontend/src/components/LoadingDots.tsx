import './LoadingDots.css';

interface LoadingDotsProps {
  label?: string;
  className?: string;
  centered?: boolean;
}

const LoadingDots = ({ label = 'Loading', className = '', centered = false }: LoadingDotsProps) => {
  return (
    <div className={`loading-dots ${centered ? 'loading-dots--centered' : ''} ${className}`.trim()} role="status" aria-live="polite">
      <span className="loading-dots__label">{label}</span>
      <span className="loading-dots__trail" aria-hidden="true">
        <span className="loading-dots__dot" />
        <span className="loading-dots__dot" />
        <span className="loading-dots__dot" />
      </span>
    </div>
  );
};

export default LoadingDots;
