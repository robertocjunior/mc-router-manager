const db = require('../database/db');

module.exports = (req, res, next) => {
    // 1. Libera arquivos estáticos e API de arquivos (para o File Manager não travar)
    if (req.path.startsWith('/css') || 
        req.path.startsWith('/js') || 
        req.path.startsWith('/images') ||
        req.path.startsWith('/favicon')) {
        return next();
    }

    // 2. Se o usuário já está logado na sessão
    if (req.session && req.session.user) {
        // Se tentar acessar login ou setup estando logado, manda pro dashboard
        if (req.path === '/login' || req.path === '/setup') {
            return res.redirect('/');
        }
        return next();
    }

    // 3. Verifica se existem usuários no banco
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (err) return next(err);

        const userExists = row && row.count > 0;
        
        // As rotas que o "Visitante" pode acessar
        const isSetupRoute = req.path === '/setup';
        const isLoginRoute = req.path === '/login';

        // CENÁRIO 1: Nenhum usuário cadastrado (Modo Setup)
        if (!userExists) {
            if (isSetupRoute) return next(); // Deixa acessar /setup (GET e POST)
            return res.redirect('/setup');
        }

        // CENÁRIO 2: Existem usuários, mas não está logado (Modo Login)
        if (userExists) {
            if (isLoginRoute) return next(); // Deixa acessar /login (GET e POST)
            return res.redirect('/login');
        }
    });
};