const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../data/mc-router.sqlite'); 
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Tabela de Usuários (Mantida)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de Rotas (Adicionado sourceDomain)
    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceDomain TEXT,
        listeningPort INTEGER UNIQUE,
        serverAddress TEXT,
        description TEXT,
        is_online BOOLEAN DEFAULT 1
    )`);
});

module.exports = db;