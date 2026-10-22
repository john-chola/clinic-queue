const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const staffSchema = new mongoose.Schema(
  {
    name:     { type: String, required: [true, 'Give the staff member a name'], trim: true, maxlength: [60, 'Keep the name under 60 characters'] },
    phone:    { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    // receptionist: adds walk-ins; clinician: calls patients to a room; admin: everything
    role:     { type: String, enum: ['admin', 'receptionist', 'clinician'], default: 'receptionist' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

staffSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

staffSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Staff', staffSchema);
