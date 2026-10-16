const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');

// Local dev addresses are always allowed; hosted frontends come from FRONTEND_URL (comma-separated)
const allowedOrigins = () => [
  'http://localhost:5180', 'http://127.0.0.1:5180',
  ...String(process.env.FRONTEND_URL || '').split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean),
];

const createApp = () => {
  const app = express();
  app.set('trust proxy', 1);   // Render and other hosts sit behind a proxy
  app.use(cors({ origin: allowedOrigins(), credentials: true }));
  app.use(express.json({ limit: '20kb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (req, res) => res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'not connected',
    time: new Date(),
  }));
  app.use('/api', routes);
  app.use('/api', (req, res) => res.status(404).json({ status: 'error', message: 'Not found' }));
  app.use(errorHandler);
  return app;
};

module.exports = { createApp, allowedOrigins };
