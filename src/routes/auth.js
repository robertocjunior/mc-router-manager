const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const router = express.Router();

// Login Page
router.get('/login', (req, res) => {
    res.render('login');
});

// Post Login
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user) {
            return res.render('login', { error: 'Invalid username or password' });
        }

        if (bcrypt.compareSync(password, user.password)) {
            req.session.user = user;
            return res.redirect('/');
        } else {
            return res.render('login', { error: 'Invalid username or password' });
        }
    });
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Setup Page (First Run)
router.get('/setup', (req, res) => {
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (row.count > 0) return res.redirect('/login');
        res.render('setup');
    });
});

router.post('/setup', (req, res) => {
    const { username, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.render('setup', { error: 'Passwords do not match' });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], (err) => {
        if (err) return res.render('setup', { error: 'Error creating user' });
        res.redirect('/login');
    });
});

module.exports = router;