// Set up a demo clinic: services, staff accounts and (optionally) patients.
// Usage (from backend/):
//   npm run seed                 services and staff only
//   npm run seed -- --patients   also today's demo patients, so the screens have something to show
// Safe to run again: services and staff are updated, not duplicated.
require('dotenv').config();
const mongoose = require('mongoose');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');
const { issueTicket, callNext } = require('../services/queueService');
const { dateKey } = require('../utils/queue');

const PASSWORD = 'clinic123';

const SERVICES = [
  { name: 'OPD (Consultation)', prefix: 'A', rooms: ['Room 1', 'Room 2'], defaultMinutes: 8, order: 1 },
  { name: 'Pharmacy',           prefix: 'P', rooms: ['Window 1'],         defaultMinutes: 3, order: 2 },
  { name: 'Laboratory',         prefix: 'L', rooms: ['Lab'],              defaultMinutes: 6, order: 3 },
];

const STAFF = [
  { name: 'Clinic Admin',   phone: '+260970000001', role: 'admin' },
  { name: 'Mercy (Reception)', phone: '+260970000002', role: 'receptionist' },
  { name: 'Dr Banda',       phone: '+260970000003', role: 'clinician' },
];

const PATIENTS = ['Chanda M.', 'Mutale K.', 'Bwalya N.', 'Mwila S.', 'Natasha P.', 'Joseph T.', 'Grace L.', 'Peter Z.'];

(async () => {
  if (!process.env.MONGODB_URI) { console.error('Set MONGODB_URI in backend/.env first'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);

  const services = [];
  for (const s of SERVICES) {
    services.push(await Service.findOneAndUpdate({ prefix: s.prefix }, s, { upsert: true, new: true, setDefaultsOnInsert: true }));
  }
  for (const s of STAFF) {
    let staff = await Staff.findOne({ phone: s.phone });
    if (!staff) staff = new Staff(s);
    Object.assign(staff, s, { password: PASSWORD });
    await staff.save();
  }
  console.log(`✅ ${services.length} services and ${STAFF.length} staff accounts ready`);

  if (process.argv.includes('--patients')) {
    const today = dateKey();
    await Ticket.deleteMany({ dateKey: today });
    await Counter.deleteMany({ _id: { $regex: `:${today}$` } });
    const [opd, pharmacy] = services;
    for (const name of PATIENTS) await issueTicket(opd._id, { name }, { source: 'reception' });
    for (const name of PATIENTS.slice(0, 3)) await issueTicket(pharmacy._id, { name }, { source: 'reception' });
    const ago = (min) => new Date(Date.now() - min * 60000);
    // Spread the joining times over the last 70 minutes, in queue order, so nobody is called
    // before they joined. Through the raw collection: Mongoose will not change createdAt.
    for (const [service, from] of [[opd, 70], [pharmacy, 40]]) {
      const tickets = await Ticket.find({ service: service._id, dateKey: today }).sort({ number: 1 });
      for (const [i, t] of tickets.entries()) await Ticket.collection.updateOne({ _id: t._id }, { $set: { createdAt: ago(from - i * 8) } });
    }
    // Three patients already seen, taking 6 to 9 minutes each, so the wait estimate has real data
    for (let i = 0; i < 3; i++) {
      const t = await callNext(opd._id, 'Room 1');
      const start = 45 - i * 12;
      await Ticket.updateOne({ _id: t._id }, { status: 'done', calledAt: ago(start), doneAt: ago(start - (6 + i * 1.5)) });
    }
    await callNext(opd._id, 'Room 1');
    await callNext(opd._id, 'Room 2');
    console.log(`✅ Demo patients added for ${today}`);
  }

  console.log(`\nStaff logins (password "${PASSWORD}"):`);
  STAFF.forEach((s) => console.log(`  ${s.phone}  ${s.role.padEnd(12)} ${s.name}`));
  await mongoose.disconnect();
})().catch((err) => { console.error('❌', err.message); process.exit(1); });
