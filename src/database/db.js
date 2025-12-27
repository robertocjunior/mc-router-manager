const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Garante que a pasta data existe
const dataDir = path.join('/app/data');
if (!fs.existsSync(dataDir)){
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Tabela de Usuários
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);

    // Tabela de Rotas
    // CORREÇÃO: Removemos o UNIQUE de listeningPort para permitir várias rotas na porta 25565
    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceDomain TEXT,
        listeningPort INTEGER, 
        destHost TEXT,
        destPort INTEGER,
        description TEXT
    )`);
});

module.exports = db;