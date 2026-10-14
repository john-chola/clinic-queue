const { Server } = require('socket.io');

let io = null;

// Rooms: "service:<id>" for one queue (ticket page, staff page), "display" for the waiting-room screen
const initSocket = (httpServer, origins) => {
  io = new Server(httpServer, { cors: { origin: origins, credentials: true } });
  io.on('connection', (socket) => {
    socket.on('watch:service', (serviceId) => {
      if (typeof serviceId === 'string' && /^[a-f0-9]{24}$/.test(serviceId)) socket.join(`service:${serviceId}`);
    });
    socket.on('watch:display', () => socket.join('display'));
  });
  return io;
};

// Tell everyone watching a service that its queue changed. Clients re-fetch
// what they are allowed to see, so no patient details travel over the socket.
const emitQueueChanged = (serviceId, extra = {}) => {
  if (!io) return;
  const payload = { serviceId: String(serviceId), at: Date.now(), ...extra };
  io.to(`service:${serviceId}`).emit('queue:changed', payload);
  io.to('display').emit('queue:changed', payload);
};

module.exports = { initSocket, emitQueueChanged };
