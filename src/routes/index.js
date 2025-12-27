const express = require('express');
const router = express.Router();
const db = require('../database/db');
const routerService = require('../services/routerService');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// Dashboard: Lista rotas
router.get('/', (req, res) => {
    db.all("SELECT * FROM routes", (err, rows) => {
        res.render('dashboard', { 
            routes: rows, 
            user: req.session.user 
        });
    });
});

// Adicionar Rota
router.post('/routes/add', (req, res) => {
    const { sourceDomain, listeningPort, serverAddress, description } = req.body;
    
    // Validação básica
    if (!listeningPort || !serverAddress) {
        return res.redirect('/?error=Campos obrigatórios faltando');
    }

    db.run(
        "INSERT INTO routes (sourceDomain, listeningPort, serverAddress, description) VALUES (?, ?, ?, ?)",
        [sourceDomain, listeningPort, serverAddress, description],
        (err) => {
            if (err) {
                console.error(err);
                // Pode adicionar tratamento de erro de porta duplicada aqui
            } else {
                routerService.syncAndRestart();
            }
            res.redirect('/');
        }
    );
});

// Deletar Rota
router.post('/routes/delete/:id', (req, res) => {
    db.run("DELETE FROM routes WHERE id = ?", [req.params.id], (err) => {
        if (!err) routerService.syncAndRestart();
        res.redirect('/');
    });
});

module.exports = router;