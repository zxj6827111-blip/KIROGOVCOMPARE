// @ts-ignore
import { diff_match_patch } from 'diff-match-patch';

export interface DiffPart {
    value: string;
    added?: boolean;
    removed?: boolean;
}

// Instantiate the diff_match_patch library
const dmp = new diff_match_patch();

/**
 * Tokenize text into words/characters to avoid per-character diffs for CJK.
 * Matches frontend logic:
 * - group digits and latin words
 * - group contiguous CJK characters
 * - keep punctuation/others as single tokens
 */
const tokenizeText = (text: string): string[] => {
    if (!text) return [];
    const regex = /(\d+)|([a-zA-Z]+)|([\u4e00-\u9fff]+)|([\s\S])/g;
    const tokens: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        tokens.push(match[0]);
    }
    return tokens;
};

/**
 * Calculate diffs between two texts using token-based approach.
 * Returns an array of DiffPart objects compatible with the frontend rendering logic.
 */
export const calculateDiffs = (oldText: string, newText: string): DiffPart[] => {
    if (!oldText && !newText) return [];
    if (!oldText) return [{ value: newText, added: true }];
    if (!newText) return [{ value: oldText, removed: true }];

    // 1. Manually tokenize inputs
    const tokensA = tokenizeText(oldText);
    const tokensB = tokenizeText(newText);

    // 2. Map tokens to internal characters for usage with diff-match-patch's char-based algorithm
    // This is a standard technique when using dmp on words/tokens.
    const tokenMap: Map<string, string> = new Map();
    const revTokenMap: Map<string, string> = new Map();
    let charCode = 0;

    const getTokenChar = (token: string): string => {
        if (!tokenMap.has(token)) {
            const char = String.fromCharCode(charCode++);
            tokenMap.set(token, char);
            revTokenMap.set(char, token);
        }
        return tokenMap.get(token)!;
    };

    const charsA = tokensA.map(getTokenChar).join('');
    const charsB = tokensB.map(getTokenChar).join('');

    // 3. Compute Diff
    const diffs = dmp.diff_main(charsA, charsB);
    dmp.diff_cleanupSemantic(diffs);

    // 4. Reconstruct diffs with original tokens
    const result: DiffPart[] = [];

    // @ts-ignore
    diffs.forEach(([op, text]: [number, string]) => {
        // text is a string of our custom characters
        let originalText = '';
        for (let i = 0; i < text.length; i++) {
            originalText += revTokenMap.get(text[i]) || '';
        }

        if (op === 1) { // INSERT
            result.push({ value: originalText, added: true });
        } else if (op === -1) { // DELETE
            result.push({ value: originalText, removed: true });
        } else { // EQUAL
            result.push({ value: originalText });
        }
    });

    return result;
};

/**
 * Render diffs to HTML string with inline styles/classes for the EJS template.
 */
export const renderDiffHtml = (diffs: DiffPart[], highlightIdentical: boolean = false): string => {
    return diffs.map(part => {
        if (part.removed) return ''; // Do not show removed text in the "New" view, similar to frontend right column

        const text = part.value; // Escaping should be handled by EJS usually, but if we return raw HTML string, be careful.
        // Simple HTML entity escape for safety
        const escapedText = text.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        if (part.added) {
            return `<span class="bg-red-200 text-red-900 border-b-2 border-red-400 border-dotted" title="差异内容">${escapedText}</span>`;
        } else {
            const className = highlightIdentical ? "bg-yellow-200 text-gray-900" : "text-gray-500";
            return `<span class="${className}">${escapedText}</span>`;
        }
    }).join('');
}
