const mongoose = require('mongoose');

// Daily ticket counter per service. Incremented atomically with $inc,
// so two patients joining at the same moment never get the same number.
const counterSchema = new mongoose.Schema({
  _id: { type: String },          // "<serviceId>:<dateKey>"
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);
