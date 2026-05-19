import React, { useEffect, useRef, useState } from 'react';

interface StableChartFrameProps {
  children: React.ReactNode;
  className?: string;
  minWidth?: number;
  minHeight?: number;
  placeholderClassName?: string;
}

export const StableChartFrame: React.FC<StableChartFrameProps> = ({
  children,
  className = '',
  minWidth = 240,
  minHeight = 220,
  placeholderClassName = 'flex items-center justify-center text-xs text-slate-400',
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const updateReady = () => {
      const rect = node.getBoundingClientRect();
      setIsReady(rect.width > 0 && rect.height > 0);
    };

    updateReady();

    if (typeof ResizeObserver === 'undefined') {
      const id = window.setTimeout(updateReady, 0);
      window.addEventListener('resize', updateReady);
      return () => {
        window.clearTimeout(id);
        window.removeEventListener('resize', updateReady);
      };
    }

    const observer = new ResizeObserver(updateReady);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`govinsight-chart-frame ${className}`.trim()}
      style={{ minWidth, minHeight }}
    >
      {isReady ? children : <div className={`h-full w-full ${placeholderClassName}`}>图表加载中...</div>}
    </div>
  );
};

export const stableResponsiveProps = (minWidth = 240, minHeight = 220) => ({
  width: '100%' as const,
  height: '100%' as const,
  minWidth,
  minHeight,
  initialDimension: { width: minWidth, height: minHeight },
});

export default StableChartFrame;
