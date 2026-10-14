const mongoose = require('mongoose');

const STATUSES = ['waiting', 'called', 'done', 'no_show', 'cancelled'];

// One patient's place in one service's queue for one day.
const ticketSchema = new mongoose.Schema(
  {
    service:  { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    dateKey:  { type: String, required: true },          // "2026-10-14" in Lusaka time; numbers restart daily
    number:   { type: Number, required: true },          // 24
    code:     { type: String, required: true },          // "A-024", what the patient hears and sees
    // Random, unguessable id used in the patient's link (/t/:publicId) instead of the database id
    publicId: { type: String, required: true, unique: true },

    name:  { type: String, trim: true, maxlength: 60, default: '' },
    phone: { type: String, trim: true, default: '' },
    source: { type: String, enum: ['reception', 'self'], default: 'self' },

    priority:       { type: Boolean, default: false },
    priorityReason: { type: String, trim: true, maxlength: 120, default: '' },

    status: { type: String, enum: STATUSES, default: 'waiting' },
    room:   { type: String, default: '' },
    calls:  { type: Number, default: 0 },                // how many times it has been announced

    calledAt: Date,
    doneAt:   Date,
  },
  { timestamps: true }
);

// The queue order: priority first, then first come, first served
ticketSchema.index({ service: 1, dateKey: 1, status: 1, priority: -1, createdAt: 1 });
ticketSchema.index({ service: 1, dateKey: 1, number: 1 }, { unique: true });

ticketSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('Ticket', ticketSchema);
