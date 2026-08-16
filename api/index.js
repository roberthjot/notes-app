let app;
try {
  app = require('../server');
} catch (err) {
  console.error('FATAL: No se pudo cargar server.js:', err.message, err.stack);
  module.exports = (req, res) => res.status(500).json({ error: 'Failed to load: ' + err.message });
  return;
}
module.exports = app;