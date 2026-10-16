require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const { createApp, allowedOrigins } = require('./app');
const { initSocket } = require('./utils/socket');

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('❌ Set MONGODB_URI and JWT_SECRET in backend/.env (see .env.example)');
  process.exit(1);
}

const app = createApp();
const server = http.createServer(app);
initSocket(server, allowedOrigins());

const PORT = process.env.PORT || 5050;
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(PORT, () => console.log(`🏥 Clinic Queue API on http://localhost:${PORT}`));
  })
  .catch((err) => { console.error('❌ MongoDB connection failed:', err.message); process.exit(1); });
