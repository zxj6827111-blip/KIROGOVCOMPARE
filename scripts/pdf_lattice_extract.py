#!/usr/bin/env python3
"""PDF lattice extraction sidecar (Channel B).

stdout carries exactly one JSON object and nothing else; every diagnostic goes to
stderr. Node must be able to parse stdout even when this script fails, so failures
are reported as {"ok": false, ...} instead of an unhandled traceback.

Usage:
    python3 pdf_lattice_extract.py <pdf-path> [--strategy lattice|text] [--max-pages N]
"""

import argparse
import json
import sys
import time
import traceback

ENGINE = "pdfplumber"


def emit(payload):
    # ensure_ascii keeps stdout pure-ASCII: a Windows console on a non-UTF-8 codepage
    # mangles Chinese cell text otherwise, and mangled JSON is an unusable channel.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, allow_nan=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write("[pdf_lattice_extract] %s\n" % msg)
    sys.stderr.flush()


def cell_to_text(value):
    """Normalise one pdfplumber cell.

    pdfplumber returns None for cells absorbed by a merge, and may return a list of
    text fragments; the merged-cell nulls are the signal the mapper needs, so they
    must survive as null rather than becoming "".
    """
    if value is None:
        return None
    if isinstance(value, list):
        value = " ".join(str(item) for item in value)
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    text = " ".join(line.strip() for line in text.split("\n")).strip()
    return text


def extract(pdf_path, strategy, max_pages):
    import pdfplumber

    # CLI speaks lattice/text; pdfplumber speaks lines/text.
    detection = "lines" if strategy == "lattice" else strategy
    table_settings = {
        "vertical_strategy": detection,
        "horizontal_strategy": detection,
        "snap_tolerance": 4,
        "intersection_tolerance": 15,
        "text_x_tolerance": 1,
        "text_y_tolerance": 2,
    }

    pages_out = []
    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        limit = page_count if max_pages <= 0 else min(page_count, max_pages)
        for index in range(limit):
            page = pdf.pages[index]
            # find_tables gives both the grid and the table bbox; the bbox is what the
            # mapper needs to tell a page-header strip from a real table body.
            found = page.find_tables(table_settings) or []
            tables = []
            for table_index, detected in enumerate(found):
                rows = detected.extract() or []
                # A 0-row detection is noise, not a table.
                if not rows:
                    continue
                normalised = [[cell_to_text(cell) for cell in row] for row in rows]
                col_count = max((len(row) for row in normalised), default=0)
                bbox = list(detected.bbox) if detected.bbox else None
                tables.append({
                    "table_index": table_index,
                    "row_count": len(normalised),
                    "col_count": col_count,
                    "rows": normalised,
                    "bbox": [round(float(v), 2) for v in bbox] if bbox else None,
                })
            pages_out.append({
                "page_number": index + 1,
                "width": round(float(page.width), 2),
                "height": round(float(page.height), 2),
                "tables": tables,
            })

    return {
        "ok": True,
        "engine": ENGINE,
        "version": getattr(pdfplumber, "__version__", "unknown"),
        "strategy": strategy,
        "page_count": page_count,
        "pages": pages_out,
    }


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("pdf_path")
    parser.add_argument("--engine", default=ENGINE)
    parser.add_argument("--strategy", default="lattice", choices=["lattice", "text"])
    parser.add_argument("--max-pages", type=int, default=0)
    args, unknown = parser.parse_known_args()

    if unknown:
        log("ignoring unknown args: %s" % " ".join(unknown))

    if args.max_pages < 0:
        args.max_pages = 0

    started = time.time()
    try:
        import os

        # Fail explicitly rather than quietly ignoring PDF_LATTICE_ENGINE, so a typo in
        # production env is visible in the verdict instead of looking like a working engine.
        if args.engine != ENGINE:
            raise ValueError("unsupported engine: %s (only %s is implemented)" % (args.engine, ENGINE))
        if not os.path.isfile(args.pdf_path):
            raise FileNotFoundError(args.pdf_path)
        payload = extract(args.pdf_path, args.strategy, args.max_pages)
    except Exception as error:  # noqa: BLE001 - the sidecar must never crash noisily
        log("extraction failed: %s: %s" % (type(error).__name__, error))
        log(traceback.format_exc())
        emit({
            "ok": False,
            "engine": ENGINE,
            "version": None,
            "error": type(error).__name__,
            "message": str(error),
            "pages": [],
        })
        return 1

    payload["elapsed_ms"] = int((time.time() - started) * 1000)
    emit(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
