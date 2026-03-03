import { useCallback, useEffect, useState } from 'react';

export const useSmoothLoader = (loading: boolean) => {
  const [showLoader, setShowLoader] = useState<boolean>(loading);
  const [complete, setComplete] = useState<boolean>(false);

  useEffect(() => {
    if (loading) {
      setShowLoader(true);
      setComplete(false);
      return;
    }

    if (showLoader) {
      setComplete(true);
    }
  }, [loading, showLoader]);

  const handleLoaderComplete = useCallback(() => {
    setShowLoader(false);
    setComplete(false);
  }, []);

  return {
    showLoader,
    complete,
    handleLoaderComplete
  };
};

export default useSmoothLoader;
