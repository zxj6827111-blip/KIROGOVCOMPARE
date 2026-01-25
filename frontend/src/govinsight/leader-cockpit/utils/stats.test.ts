import { percentile, robustGapP90P10, maxMinGap } from './stats';

describe('stats.ts utility', () => {

    describe('percentile', () => {
        test('calculates correct P90 for sorted unique values', () => {
            const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // 10 items
            // Index 0.9 * 9 = 8.1
            // data[8] = 9, data[9] = 10
            // result = 9 + 0.1 * (10-9) = 9.1
            expect(percentile(data, 0.9)).toBeCloseTo(9.1);
        });

        test('handles single value', () => {
            expect(percentile([5], 0.9)).toBe(5);
        });

        test('handles empty array', () => {
            expect(percentile([], 0.9)).toBeNull();
        });
    });

    describe('robustGapP90P10', () => {
        test('calculates gap correctly for sufficient samples', () => {
            // 0...10 (11 items)
            const data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            // Pos 0.9 * 10 = 9 -> 9
            // Pos 0.1 * 10 = 1 -> 1
            // Gap = 9 - 1 = 8
            expect(robustGapP90P10(data, 5)).toBe(8);
        });

        test('returns null for insufficient samples', () => {
            const data = [1, 2, 3];
            expect(robustGapP90P10(data, 5)).toBeNull();
        });

        test('excludes non-numeric values (if any passed erroneously, though TS prevents it)', () => {
            // Testing runtime behavior for JS compatibility if needed, but in TS environment this is just robust check
            const data: any[] = [1, 2, 3, 4, 5, NaN];
            // Valid length 5.
            // Sorted: 1,2,3,4,5
            // P90 index 0.9 * 4 = 3.6 -> 3(4) + 0.6*(5-4) = 4.6
            // P10 index 0.1 * 4 = 0.4 -> 0(1) + 0.4*(2-1) = 1.4
            // Gap = 3.2
            expect(robustGapP90P10(data, 5)).toBeCloseTo(3.2);
        });
    });

    describe('maxMinGap', () => {
        test('basic max min', () => {
            expect(maxMinGap([1, 10, 5])).toBe(9);
        });
    });

});
