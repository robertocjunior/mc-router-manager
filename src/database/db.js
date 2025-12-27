const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra'); // Necessário para criar a pasta se não existir

// Caminho para a pasta e para o arquivo
const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'mc-router.sqlite');

// GARANTIA: Cria a pasta 'data' se ela não existir
fs.ensureDirSync(dataDir);

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Tabela de Usuários
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de Rotas
    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceDomain TEXT,      -- Endereço de entrada
        listeningPort INTEGER,  -- Porta de entrada
        destHost TEXT,          -- IP do Server
        destPort INTEGER,       -- Porta do Server
        description TEXT,
        is_online BOOLEAN DEFAULT 1,
        UNIQUE(listeningPort)
    )`);
});

module.exports = db;