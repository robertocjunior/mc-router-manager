const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'mc-router.sqlite');

// Garante pastas essenciais
fs.ensureDirSync(dataDir);
fs.ensureDirSync(path.join(dataDir, 'instances')); 

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

    // Tabela de Rotas (Proxy)
    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceDomain TEXT,
        listeningPort INTEGER,
        destHost TEXT,
        destPort INTEGER,
        description TEXT,
        is_online BOOLEAN DEFAULT 1
    )`);

    // NOVA: Tabela de Instâncias (Servidores Minecraft)
    db.run(`CREATE TABLE IF NOT EXISTS instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,      -- Nome do Node (ex: survival01)
        domain TEXT,           -- Domínio (ex: vanilla.minecraft.com)
        port INTEGER,          -- Porta interna (ex: 25566)
        jarFile TEXT,          -- Nome do arquivo .jar
        startCommand TEXT,     -- Comando customizado
        status TEXT DEFAULT 'stopped',
        pid INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;