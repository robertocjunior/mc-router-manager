const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '../../mc-router.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Tabela de Usuários
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);

    // Tabela de Rotas
    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serverAddress TEXT,
        listeningPort INTEGER UNIQUE,
        description TEXT
    )`);

    // Cria usuário admin padrão se não existir
    db.get("SELECT * FROM users WHERE username = ?", ['admin'], (err, row) => {
        if (!row) {
            const hash = bcrypt.hashSync('changeme', 10);
            db.run("INSERT INTO users (username, password) VALUES (?, ?)", ['admin', hash]);
            console.log("Usuário padrão criado: admin / changeme");
        }
    });
});

module.exports = db;