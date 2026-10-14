/** Shapes shared by the pdfplumber sidecar client and the grid mapper. */

export interface LatticeTable {
    table_index: number;
    row_count: number;
    col_count: number;
    /** null means the cell is absorbed by a merged cell, not that it is empty. */
    rows: (string | null)[][];
    bbox: number[] | null;
}

export interface LatticePage {
    page_number: number;
    width: number;
    height: number;
    tables: LatticeTable[];
}

export interface LatticeExtractionSuccess {
    ok: true;
    engine: string;
    version: string | null;
    strategy: string;
    page_count: number;
    elapsed_ms: number;
    pages: LatticePage[];
}

export interface LatticeExtractionFailure {
    ok: false;
    engine: string;
    version: string | null;
    error: string;
    message: string;
    pages: [];
}

export type LatticeExtraction = LatticeExtractionSuccess | LatticeExtractionFailure;
