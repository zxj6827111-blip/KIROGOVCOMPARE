import React, { useEffect, useState, useRef } from 'react';
import * as Diff from 'diff';
import { tokenizeText, isPunctuation } from './DiffUtils';

const DiffText = ({ oldText, newText, highlightIdentical, highlightDiff }) => {
  const containerRef = useRef(null);
  const [diffs, setDiffs] = useState(null);
  const [shouldCompute, setShouldCompute] = useState(false);

  useEffect(() => {
    setDiffs(null);
    setShouldCompute(true);
  }, [oldText, newText]);

  useEffect(() => {
    if (!shouldCompute) return;

    let cancelled = false;

    const compute = () => {
      try {
        const tokensA = tokenizeText(oldText || '');
        const tokensB = tokenizeText(newText || '');
        // 使用 diffArrays 对 token 数组进行比对
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
      {diffs.map((part, partIndex) => {
        if (part.removed) return null;

        const isAdded = part.added;
        const isIdentical = !part.added && !part.removed;

        // Optimization: Merge continuous tokens with same style
        const renderedSpans = [];
        let currentBuffer = "";
        let currentClass = null;

        const flush = () => {
          if (currentBuffer) {
            renderedSpans.push(
              <span key={`${partIndex}-${renderedSpans.length}`} className={currentClass}>
                {currentBuffer}
              </span>
            );
          }
          currentBuffer = "";
          currentClass = null;
        };

        part.value.forEach((token) => {
          let tokenClass = "text-gray-500";

          if (!isPunctuation(token)) {
            if (isAdded && highlightDiff) {
              tokenClass = "bg-red-200 text-red-900 border-b border-red-400 border-dotted";
            } else if (isIdentical && highlightIdentical) {
              tokenClass = "bg-yellow-200 text-gray-900";
            }
          }

          // Initial
          if (currentClass === null) {
            currentClass = tokenClass;
            currentBuffer = token;
          }
          // Same class -> append
          else if (currentClass === tokenClass) {
            currentBuffer += token;
          }
          // Different class -> flush and start new
          else {
            flush();
            currentClass = tokenClass;
            currentBuffer = token;
          }
        });
        flush();

        return (
          <React.Fragment key={partIndex}>
            {renderedSpans}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default React.memo(DiffText);
