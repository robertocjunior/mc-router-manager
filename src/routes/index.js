const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const serverController = require('../controllers/serverController');

const upload = multer({ dest: 'temp_uploads/' });

router.use(authMiddleware);

// --- DASHBOARD ---
router.get('/', serverController.dashboard);

// --- SERVER INSTANCE VIEWS ---
router.get('/server/:uuid', serverController.getServer);
router.get('/server/:uuid/logs', serverController.getLogs);
router.get('/server/:uuid/status', serverController.getStatus);

// --- SERVER ACTIONS ---
router.post('/instances/create', upload.single('serverJar'), serverController.createInstance);
router.post('/server/:uuid/start', serverController.startInstance);
router.post('/server/:uuid/stop', serverController.stopInstance);
router.post('/server/:uuid/delete', serverController.deleteInstance);
router.post('/server/:uuid/properties', serverController.saveProperties);
router.post('/server/:uuid/settings', serverController.updateSettings);
router.post('/server/:uuid/command', serverController.sendCommand);

// --- WORLD MANAGER ---
router.get('/server/:uuid/world/download', serverController.downloadWorld);
router.post('/server/:uuid/world/upload', upload.single('worldZip'), serverController.uploadWorld);
router.post('/server/:uuid/world/reset', serverController.resetWorld);

// --- FILE MANAGER API ---
router.get('/server/:uuid/files/list', serverController.listFiles);
router.get('/server/:uuid/files/content', serverController.getFileContent);
router.post('/server/:uuid/files/save', serverController.saveFileContent);
router.post('/server/:uuid/files/mkdir', serverController.mkdir);
router.post('/server/:uuid/files/delete', serverController.deleteFile);
router.post('/server/:uuid/files/rename', serverController.renameFile);
router.post('/server/:uuid/files/upload', upload.single('file'), serverController.uploadFile);
router.get('/server/:uuid/files/download', serverController.downloadFile);

module.exports = router;