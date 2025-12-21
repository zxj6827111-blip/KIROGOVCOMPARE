import React, { useEffect, useState, useRef } from 'react';
import * as Diff from 'diff';
import { tokenizeText } from './DiffUtils';

const DiffText = ({ oldText, newText, highlightIdentical, highlightDiff }) => {
  const containerRef = useRef(null);
  const [diffs, setDiffs] = useState(null);
  const [shouldCompute, setShouldCompute] = useState(false);

  useEffect(() => {
    setDiffs(null);
    setShouldCompute(false);

    const el = containerRef.current;
    if (!el || typeof window === 'undefined') {
      setShouldCompute(true);
      return;
    }

    // Compute only when the block is near viewport to prevent CPU spikes.
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setShouldCompute(true);
        }
      },
      { root: null, rootMargin: '800px 0px', threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [oldText, newText]);

  useEffect(() => {
    if (!shouldCompute) return;

    let cancelled = false;

    const compute = () => {
      try {
        const tokensA = tokenizeText(oldText || '');
        const tokensB = tokenizeText(newText || '');
        const nextDiffs = Diff.diffArrays(tokensA, tokensB);
        if (!cancelled) setDiffs(nextDiffs);
      } catch (err) {
        if (!cancelled) setDiffs([]);
      }
    };

    const w = window;
    if (typeof w.requestIdleCallback === 'function') {
      const handle = w.requestIdleCallback(compute, { timeout: 500 });
      return () => {
        cancelled = true;
        if (typeof w.cancelIdleCallback === 'function') {
          w.cancelIdleCallback(handle);
        }
      };
    }

    const timer = window.setTimeout(compute, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [oldText, newText, shouldCompute]);

  if (!diffs) {
    // Show content immediately; upgrade to highlighted diff when ready.
    return (
      <div
        ref={containerRef}
        className="font-serif-sc text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-600"
      >
        {newText}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="font-serif-sc text-sm leading-relaxed whitespace-pre-wrap break-words">
      {diffs.map((part, index) => {
        if (part.removed) return null; 
        if (part.added) {
           const text = part.value.join('');
           return (
             <span 
               key={index} 
               className={highlightDiff ? "bg-red-200 text-red-900 decoration-red-400 underline decoration-dotted" : ""} 
               title="差异内容"
             >
               {text}
             </span>
           );
        } else {
           const text = part.value.join('');
           return (
             <span 
               key={index} 
               className={highlightIdentical ? "bg-yellow-200 text-gray-900" : "text-gray-500"}
             >
               {text}
             </span>
           );
        }
      })}
    </div>
  );
};

export default DiffText;
