/**
 * Simple HTML sanitizer to prevent XSS attacks
 * Escapes HTML special characters and removes dangerous tags/attributes
 */

// Characters that need to be escaped in HTML
const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
};

/**
 * Escape special HTML characters to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string
 */
export function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"'/]/g, char => HTML_ESCAPE_MAP[char]);
}

/**
 * Sanitize text for safe display
 * Removes potential script injections while preserving basic formatting
 * @param {string} html - The HTML string to sanitize
 * @returns {string} - Sanitized string safe for display
 */
export function sanitizeForDisplay(html) {
    if (typeof html !== 'string') return '';

    // First escape all HTML
    let safe = escapeHtml(html);

    // Optionally convert common safe patterns back (like <mark> for highlighting)
    // Only allow specific safe tags with no attributes
    safe = safe.replace(/&lt;mark class=&quot;text-warning&quot;&gt;/g, '<mark class="text-warning">');
    safe = safe.replace(/&lt;\/mark&gt;/g, '</mark>');

    return safe;
}

/**
 * Create highlighted text without using dangerouslySetInnerHTML
 * @param {string} text - The text to render
 * @param {Array} highlightValues - Values to highlight
 * @returns {Array} - Array of React elements
 */
export function createHighlightedElements(text, highlightValues = []) {
    if (!text || !highlightValues || highlightValues.length === 0) {
        return [text];
    }

    const elements = [];
    let remainingText = String(text);
    let keyIndex = 0;

    // Sort highlight values by length (longest first) to avoid partial matches
    const sortedHighlights = [...highlightValues]
        .filter(v => v !== null && v !== undefined)
        .map(v => String(v))
        .sort((a, b) => b.length - a.length);

    // Find and mark all highlight positions
    for (const value of sortedHighlights) {
        if (!value) continue;

        const parts = remainingText.split(value);
        if (parts.length > 1) {
            // Found the value - reconstruct with highlighting
            const newElements = [];
            parts.forEach((part, idx) => {
                if (part) {
                    newElements.push(part);
                }
                if (idx < parts.length - 1) {
                    // Add highlighted span
                    newElements.push(
                        { type: 'highlight', value: value, key: `hl-${keyIndex++}` }
                    );
                }
            });

            // Join back for next iteration
            remainingText = parts.join(`\0HIGHLIGHT_${value}\0`);
        }
    }

    // If we found highlights, parse them out
    if (remainingText.includes('\0HIGHLIGHT_')) {
        const regex = /\0HIGHLIGHT_(.+?)\0/g;
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(remainingText)) !== null) {
            // Add text before the match
            if (match.index > lastIndex) {
                elements.push(remainingText.substring(lastIndex, match.index));
            }
            // Add the highlighted element
            elements.push({ type: 'highlight', value: match[1], key: `hl-${keyIndex++}` });
            lastIndex = regex.lastIndex;
        }

        // Add remaining text
        if (lastIndex < remainingText.length) {
            elements.push(remainingText.substring(lastIndex));
        }
    } else {
        elements.push(remainingText);
    }

    return elements;
}

export default {
    escapeHtml,
    sanitizeForDisplay,
    createHighlightedElements,
};
