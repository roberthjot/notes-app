try {
  const app = require('../server');
  module.exports = (req, res) => res.json({ status: 'ok', modules: 'all loaded' });
} catch (err) {
  module.exports = (req, res) => res.status(500).json({ error: err.message, stack: err.stack });
}
