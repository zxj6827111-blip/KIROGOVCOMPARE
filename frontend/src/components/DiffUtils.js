import * as Diff from 'diff';

// ---- Tokenization & Similarity Algorithm ----
export const tokenizeText = (text) => {
  if (!text) return [];
  // Reduce token count:
  // - group digits and latin words
  // - group contiguous CJK characters (instead of per-char)
  // - keep punctuation/others as single tokens
  const regex = /(\d+)|([a-zA-Z]+)|([\u4e00-\u9fff]+)|([\s\S])/g;
  const tokens = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
};

export const isPunctuation = (str) => {
  return /[，。、；：？！“”‘’（）《》【】—…\.,;:\?!'"\(\)\[\]\-\s]/.test(str);
};

export function calculateTextSimilarity(text1, text2) {
  if (!text1 && !text2) return 100;
  if (!text1 || !text2) return 0;
  
  // Clean text if it comes in as object/array
  const s1 = typeof text1 === 'string' ? text1 : JSON.stringify(text1);
  const s2 = typeof text2 === 'string' ? text2 : JSON.stringify(text2);
  
  const t1 = tokenizeText(s1).filter(t => !isPunctuation(t));
  const t2 = tokenizeText(s2).filter(t => !isPunctuation(t));
  
  if (t1.length === 0 && t2.length === 0) return 100;
  if (t1.length === 0 || t2.length === 0) return 0;

  const diffs = Diff.diffArrays(t1, t2);
  let commonLen = 0;
  let len1 = t1.reduce((acc, cur) => acc + cur.length, 0);
  let len2 = t2.reduce((acc, cur) => acc + cur.length, 0);

  if (len1 + len2 === 0) return 100;

  diffs.forEach(part => {
    if (!part.added && !part.removed) {
      part.value.forEach(token => {
        commonLen += token.length;
      });
    }
  });

  // Calculate similarity based on common length ratio
  return Math.round((2.0 * commonLen) / (len1 + len2) * 100);
}
