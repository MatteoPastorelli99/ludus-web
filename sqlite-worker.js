// Il database di Ludus nel browser. Riceve dal driver androidx.sqlite (WebWorkerSQLiteDriver) le
// richieste open / prepare / step / close e le esegue con SQLite compilato per il web.
// I dati stanno nello spazio privato del sito (OPFS, VFS "opfs-sahpool": non servono header
// speciali, quindi funziona anche su GitHub Pages). Se il browser non lo permette (finestra
// privata, Firefox senza OPFS) si ripiega sulla memoria: i dati durano solo finche' la pagina e' aperta.
import sqlite3InitModule from './sqlite3.mjs';

const SQLITE_NULL = 5;

const pronto = (async () => {
    const sqlite3 = await sqlite3InitModule();
    let pool = null;
    try {
        pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'ludus-opfs', clearOnInit: false });
    } catch (e) {
        console.warn('Ludus: archivio persistente non disponibile, uso la memoria.', e);
    }
    return { sqlite3, pool };
})();

const database = new Map();
const istruzioni = new Map();
let prossimoId = 1;

function normalizza(v) {
    return typeof v === 'bigint' ? Number(v) : v;
}

function apri({ sqlite3, pool }, { fileName }) {
    const db = pool
        ? new pool.OpfsSAHPoolDb('/' + fileName)
        : new sqlite3.oo1.DB(':memory:', 'c');
    const databaseId = prossimoId++;
    database.set(databaseId, { db, istruzioni: new Set() });
    return { databaseId };
}

function prepara({ sqlite3 }, { databaseId, sql }) {
    const voce = database.get(databaseId);
    const stmt = voce.db.prepare(sql);
    const statementId = prossimoId++;
    istruzioni.set(statementId, { stmt, databaseId });
    voce.istruzioni.add(statementId);
    const columnNames = [];
    for (let i = 0; i < stmt.columnCount; i++) columnNames.push(stmt.getColumnName(i));
    return { statementId, parameterCount: stmt.parameterCount, columnNames };
}

function esegui({ sqlite3 }, { statementId, bindings }) {
    const { stmt } = istruzioni.get(statementId);
    stmt.reset(true);
    for (let i = 0; i < bindings.length; i++) {
        const v = bindings[i];
        if (v !== undefined) stmt.bind(i + 1, v);
    }
    const rows = [];
    let columnTypes = [];
    try {
        while (stmt.step()) {
            if (rows.length === 0) {
                for (let i = 0; i < stmt.columnCount; i++) {
                    columnTypes.push(sqlite3.capi.sqlite3_column_type(stmt.pointer, i));
                }
            }
            rows.push(stmt.get([]).map(normalizza));
        }
    } finally {
        stmt.reset();
    }
    if (columnTypes.length === 0) {
        for (let i = 0; i < stmt.columnCount; i++) columnTypes.push(SQLITE_NULL);
    }
    return { rows, columnTypes };
}

function chiudi({ statementId, databaseId }) {
    if (statementId != null) {
        const voce = istruzioni.get(statementId);
        if (voce) {
            voce.stmt.finalize();
            istruzioni.delete(statementId);
            database.get(voce.databaseId)?.istruzioni.delete(statementId);
        }
    }
    if (databaseId != null) {
        const voce = database.get(databaseId);
        if (voce) {
            voce.istruzioni.forEach((id) => {
                istruzioni.get(id)?.stmt.finalize();
                istruzioni.delete(id);
            });
            voce.db.close();
            database.delete(databaseId);
        }
    }
    return null;
}

self.onmessage = async (evento) => {
    const { id, data } = evento.data;
    try {
        const contesto = await pronto;
        let risultato;
        switch (data.cmd) {
            case 'open': risultato = apri(contesto, data); break;
            case 'prepare': risultato = prepara(contesto, data); break;
            case 'step': risultato = esegui(contesto, data); break;
            case 'close': risultato = chiudi(data); break;
            default: throw new Error('Comando sconosciuto: ' + data.cmd);
        }
        self.postMessage({ id, data: risultato, error: null });
    } catch (e) {
        self.postMessage({ id, data: null, error: String(e && e.message ? e.message : e) });
    }
};
