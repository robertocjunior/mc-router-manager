const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'mc-router.sqlite');

fs.ensureDirSync(dataDir);
fs.ensureDirSync(path.join(dataDir, 'instances')); 

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceDomain TEXT,
        listeningPort INTEGER,
        destHost TEXT,
        destPort INTEGER,
        description TEXT,
        is_online BOOLEAN DEFAULT 1
    )`);

    // ALTERADO: Adicionado campo 'uuid'
    db.run(`CREATE TABLE IF NOT EXISTS instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE,      -- Identificador Público (Hash)
        name TEXT UNIQUE,
        domain TEXT,
        port INTEGER,
        jarFile TEXT,
        startCommand TEXT,
        status TEXT DEFAULT 'stopped',
        pid INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;