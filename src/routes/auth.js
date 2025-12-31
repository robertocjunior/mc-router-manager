const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs'); // Você precisará: npm install bcryptjs (se não tiver)

// Página de Login
router.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

// Processar Login
router.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user) {
            return res.redirect('/login?error=Invalid credentials');
        }

        // Verifica senha (simples ou hash)
        // Recomendado usar bcrypt.compareSync se estiver salvando hash
        // Para simplificar o teste inicial sem hash:
        /* if (user.password !== password) ... */
        
        // Com Hash (Recomendado):
        if (!bcrypt.compareSync(password, user.password)) {
             return res.redirect('/login?error=Invalid credentials');
        }

        req.session.user = user;
        res.redirect('/');
    });
});

// Página de Setup (Primeiro Acesso)
router.get('/setup', (req, res) => {
    res.render('setup', { error: req.query.error });
});

// Processar Setup
router.post('/auth/setup', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.redirect('/setup?error=Missing fields');
    }

    // Criptografa senha
    const hash = bcrypt.hashSync(password, 10);

    db.run("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", 
        [name, email, hash], 
        function(err) {
            if (err) {
                return res.redirect('/setup?error=' + encodeURIComponent(err.message));
            }
            // Loga automaticamente após criar
            req.session.user = { id: this.lastID, name, email };
            res.redirect('/');
        }
    );
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;