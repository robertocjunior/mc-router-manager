const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs');

// --- LOGIN ---
router.get('/login', (req, res) => {
    // Se não tem usuários, manda pro setup
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (!err && row.count === 0) return res.redirect('/setup');
        res.render('login', { error: req.query.error });
    });
});

router.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user) {
            return res.render('login', { error: 'Invalid credentials' });
        }
        
        // Verifica a senha
        if (!bcrypt.compareSync(password, user.password)) {
             return res.render('login', { error: 'Invalid credentials' });
        }

        // Salva a sessão completa
        req.session.user = user;
        req.session.save(() => {
            res.redirect('/');
        });
    });
});

// --- SETUP (PRIMEIRO USO) ---
router.get('/setup', (req, res) => {
    // Se já tem usuário, não deixa criar outro
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row && row.count > 0) return res.redirect('/login');
        res.render('setup', { error: req.query.error });
    });
});

router.post('/setup', (req, res) => {
    // Verificação de segurança dupla
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row && row.count > 0) return res.redirect('/login');

        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.render('setup', { error: 'Missing fields' });
        }

        const hash = bcrypt.hashSync(password, 10);

        db.run("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", 
            [name, email, hash], 
            function(err) {
                if (err) {
                    return res.render('setup', { error: err.message });
                }
                
                // Cria a sessão e loga automaticamente
                req.session.user = { id: this.lastID, name, email };
                req.session.save(() => {
                    res.redirect('/');
                });
            }
        );
    });
});

// --- LOGOUT ---
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;