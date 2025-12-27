const express = require('express');
const router = express.Router();
const db = require('../database/db');
const bcrypt = require('bcryptjs');

router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.render('login', { error: 'Credenciais inválidas' });
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        res.redirect('/');
    });
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;