const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../database/db');
const instanceService = require('../services/instanceService');
const authMiddleware = require('../middleware/auth');
const fs = require('fs-extra'); // Necessário para limpeza de temp se desejar

// Configuração do Upload
const upload = multer({ dest: 'temp_uploads/' });
const ROUTER_PORT = process.env.MC_ROUTER_PORT || 25565;

router.use(authMiddleware);

// --- ROTA: Dashboard (Lista Servidores) ---
router.get('/', (req, res) => {
    db.all("SELECT * FROM instances", (err, instances) => {
        res.render('dashboard', { 
            instances: instances || [], 
            user: req.session.user,
            routerPort: ROUTER_PORT,
            query: req.query // Passa erros da URL para a view
        });
    });
});

// --- ROTA: Detalhes do Servidor (Painel de Controle) ---
router.get('/server/:id', async (req, res) => {
    const id = req.params.id;
    
    // Busca conteúdo do server.properties para a aba de edição
    let properties = "";
    try {
        properties = await instanceService.getProperties(id);
    } catch (e) {
        console.error("Erro ao ler properties", e);
        properties = "# Error reading file or file does not exist yet.";
    }

    db.get("SELECT * FROM instances WHERE id = ?", [id], (err, instance) => {
        if (err || !instance) return res.redirect('/');
        res.render('server', { 
            instance, 
            user: req.session.user,
            routerPort: ROUTER_PORT,
            properties, // Conteúdo do arquivo
            query: req.query // Para exibir alertas de sucesso/erro
        });
    });
});

// --- ROTA: API de Logs (Para o terminal) ---
router.get('/server/:id/logs', async (req, res) => {
    const logs = await instanceService.getLogs(req.params.id);
    res.send(logs);
});

// --- AÇÃO: Criar Novo Servidor ---
router.post('/instances/create', upload.single('serverJar'), async (req, res) => {
    try {
        const { name, domain, startCommand } = req.body;
        const file = req.file;
        if (!file || !name || !domain) return res.redirect('/?error=Missing fields');

        const newInstance = await instanceService.createInstance(name, domain, file, startCommand);
        await instanceService.startInstance(newInstance.id);
        
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.redirect('/?error=' + encodeURIComponent(error.message));
    }
});

// --- AÇÃO: Iniciar Servidor ---
router.post('/server/:id/start', async (req, res) => {
    try {
        await instanceService.startInstance(req.params.id);
        res.redirect('/server/' + req.params.id);
    } catch (error) {
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error));
    }
});

// --- AÇÃO: Parar Servidor ---
router.post('/server/:id/stop', async (req, res) => {
    instanceService.stopInstance(req.params.id);
    // Pequeno delay para dar tempo do DB atualizar o status
    setTimeout(() => res.redirect('/server/' + req.params.id), 1000);
});

// --- AÇÃO: Deletar Servidor ---
router.post('/server/:id/delete', async (req, res) => {
    try {
        await instanceService.deleteInstance(req.params.id);
        res.redirect('/');
    } catch (error) {
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error));
    }
});

// --- AÇÃO: Salvar Properties e Reiniciar ---
router.post('/server/:id/properties', async (req, res) => {
    try {
        const { content } = req.body;
        await instanceService.saveProperties(req.params.id, content);
        
        // Reinicia para aplicar mudanças
        await instanceService.restartInstance(req.params.id);
        
        res.redirect('/server/' + req.params.id + '?success=Properties saved. Server restarting...');
    } catch (error) {
        console.error(error);
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error.message));
    }
});

// --- AÇÃO: Download do Mundo (Dump) ---
router.get('/server/:id/world/download', async (req, res) => {
    try {
        const zipPath = await instanceService.downloadWorld(req.params.id);
        res.download(zipPath, 'world-backup.zip', (err) => {
            if (err) console.error("Erro no download:", err);
            // Opcional: Apagar o zip temporário após envio para economizar espaço
            // fs.unlink(zipPath, () => {}); 
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error creating world dump: " + error.message);
    }
});

// --- AÇÃO: Upload do Mundo (Restore) ---
router.post('/server/:id/world/upload', upload.single('worldZip'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.redirect('/server/' + req.params.id + '?error=No file uploaded');
        }
        
        // Verificação básica de tipo
        if (file.mimetype !== 'application/zip' && !file.originalname.endsWith('.zip')) {
             return res.redirect('/server/' + req.params.id + '?error=Only .zip files are allowed');
        }

        await instanceService.restoreWorld(req.params.id, file);
        res.redirect('/server/' + req.params.id + '?success=World restored successfully. Server restarting...');
    } catch (error) {
        console.error(error);
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error.message));
    }
});

module.exports = router;