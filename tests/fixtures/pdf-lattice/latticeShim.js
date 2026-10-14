/**
 * Stand-in for scripts/pdf_lattice_extract.py so the Node side of the sidecar contract
 * (timeout, kill, abort, malformed stdout) is testable without Python on the machine.
 * Behaviour is chosen by LATTICE_SHIM_MODE; it is spawned with process.execPath.
 */
const mode = process.env.LATTICE_SHIM_MODE || 'ok';

function payload(extra) {
    return JSON.stringify(
        Object.assign(
            {
                ok: true,
                engine: 'pdfplumber',
                version: '0.0.0-shim',
                strategy: 'lattice',
                page_count: 1,
                elapsed_ms: 1,
                pages: [
                    {
                        page_number: 1,
                        width: 600,
                        height: 800,
                        tables: [
                            {
                                table_index: 0,
                                row_count: 1,
                                col_count: 2,
                                rows: [['规章', '1']],
                                bbox: [0, 0, 10, 10],
                            },
                        ],
                    },
                ],
            },
            extra || {}
        )
    );
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
    if (mode === 'ok') {
        process.stdout.write(payload() + '\n');
        process.exit(0);
    }
    if (mode === 'fail') {
        process.stderr.write('[shim] engine unavailable\n');
        process.stdout.write(JSON.stringify({ ok: false, engine: 'pdfplumber', version: null, error: 'ImportError', message: 'pdfplumber not installed', pages: [] }) + '\n');
        process.exit(1);
    }
    if (mode === 'garbage') {
        process.stdout.write('this is not json\n');
        process.exit(0);
    }
    if (mode === 'silent') {
        process.exit(0);
    }
    if (mode === 'wrongshape') {
        process.stdout.write(JSON.stringify({ ok: true, engine: 'pdfplumber', version: 'x' }) + '\n');
        process.exit(0);
    }
    if (mode === 'slow') {
        await sleep(5000);
        process.stdout.write(payload() + '\n');
        process.exit(0);
    }
    process.stdout.write(payload() + '\n');
})();
