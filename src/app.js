const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const SQLiteStore = require('connect-sqlite3')(session);

// Inicializa Banco de Dados
require('./database/db');

const app = express();
const port = process.env.PORT || 3000;

// Configuração da View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middlewares de Parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- CORREÇÃO DE SEGURANÇA (CSP) ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Permite scripts inline (onclick) e conexões da mesma origem (AJAX)
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        // IMPORTANTE: Remove a regra que força HTTPS (corrige o loop de redirecionamento)
        "upgrade-insecure-requests": null, 
      },
    },
    // Desabilita HSTS para evitar forçar HTTPS em rede local
    hsts: false, 
  })
);

// Arquivos Estáticos (CSS, JS, Imagens)
app.use(express.static(path.join(__dirname, '../public')));

// Configuração da Sessão
app.use(session({
    store: new SQLiteStore({
        dir: './data',
        db: 'sessions.sqlite'
    }),
    secret: 'mc-router-secret-key-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 semana
        httpOnly: true,
        // Garante que secure seja false em localhost/http para não bloquear cookies
        secure: false 
    }
}));

// Variáveis Globais para as Views (Usuário Logado)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Rotas
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');

app.use('/', indexRoutes);
app.use('/', authRoutes);

// Iniciar Servidor
app.listen(port, () => {
    console.log(`Interface rodando na porta ${port}`);
    
    // Inicia o serviço de roteamento (Proxy)
    const routerService = require('./services/routerService');
    routerService.start();
});