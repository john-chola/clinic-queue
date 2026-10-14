const mongoose = require('mongoose');

// Audit log: every change to a ticket, who made it and when.
// Also the raw data for daily reports later.
const queueEventSchema = new mongoose.Schema(
  {
    ticket:  { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    action:  { type: String, enum: ['joined', 'called', 'recalled', 'done', 'no_show', 'cancelled', 'returned'], required: true },
    staff:   { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    room:    { type: String, default: '' },
  },
  { timestamps: true }
);

queueEventSchema.index({ service: 1, createdAt: -1 });

module.exports = mongoose.model('QueueEvent', queueEventSchema);
