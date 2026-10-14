const mongoose = require('mongoose');

// A queue at the clinic: OPD, Pharmacy, Laboratory...
// Each service has its own ticket letter (A-001, P-001) and its own rooms or counters.
const serviceSchema = new mongoose.Schema(
  {
    name:   { type: String, required: true, trim: true, maxlength: 60 },
    prefix: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]$/ },
    rooms:  { type: [String], default: ['Room 1'] },
    // Used for the wait estimate until the clinic has served enough patients today
    defaultMinutes: { type: Number, default: 5, min: 1, max: 120 },
    isOpen: { type: Boolean, default: true },
    order:  { type: Number, default: 0 },
  },
  { timestamps: true }
);

serviceSchema.index({ prefix: 1 }, { unique: true });

module.exports = mongoose.model('Service', serviceSchema);
