const express = require('express');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const routerService = require('./services/routerService');
const indexRouter = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// Segurança e Logs
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "cdn.jsdelivr.net"]
        }
    }
}));
app.use(morgan('common'));

// Configuração de View Engine
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Rotas
app.use('/', indexRouter);

// Inicialização
app.listen(PORT, () => {
    console.log(`Web Interface rodando na porta ${PORT}`);
    // Inicia o mc-router junto com o servidor web
    routerService.start();
});

// Tratamento de encerramento gracioso
process.on('SIGTERM', () => {
    routerService.stop();
    process.exit(0);
});