import React, { useEffect, useState, useRef } from 'react';
import * as Diff from 'diff';
import { tokenizeText } from './DiffUtils';

const DiffText = ({ oldText, newText, highlightIdentical, highlightDiff }) => {
  const containerRef = useRef(null);
  const [diffs, setDiffs] = useState(null);
  const [shouldCompute, setShouldCompute] = useState(false);

  useEffect(() => {
    setDiffs(null);
    // Force computation immediately to ensure it's ready for print/export
    // The previous IntersectionObserver logic caused off-screen diffs (like sections 5/6) 
    // to arguably not render in time for window.print() if not scrolled into view.
    setShouldCompute(true);
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
