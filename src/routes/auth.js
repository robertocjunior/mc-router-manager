const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs');

// Rota de Login
router.get('/login', (req, res) => {
    // Antes de mostrar login, verifica se precisa de setup
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (!err && row.count === 0) return res.redirect('/setup');
        res.render('login', { error: null });
    });
});

router.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    // Busca por EMAIL
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            // TRADUZIDO
            return res.render('login', { error: 'Invalid email or password' });
        }
        
        // Salva na sessão
        req.session.userId = user.id;
        req.session.user = {
            name: user.name,
            email: user.email
        };
        res.redirect('/');
    });
});

// Rota de Setup (Primeiro Uso)
router.get('/setup', (req, res) => {
    // Segurança: Se já tem user, não deixa acessar setup
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row && row.count > 0) return res.redirect('/login');
        res.render('setup', { error: null });
    });
});

router.post('/setup', (req, res) => {
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row && row.count > 0) return res.redirect('/login');

        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            // TRADUZIDO
            return res.render('setup', { error: 'All fields are required' });
        }

        const hash = bcrypt.hashSync(password, 10);

        db.run("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", 
            [name, email, hash], 
            function(err) {
                if (err) {
                    console.error(err);
                    // TRADUZIDO
                    return res.render('setup', { error: 'Error creating user. Please try again.' });
                }
                // Loga o usuário automaticamente após criar
                req.session.userId = this.lastID;
                req.session.user = { name, email };
                res.redirect('/');
            }
        );
    });
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;