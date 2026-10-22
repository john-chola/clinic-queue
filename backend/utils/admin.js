// Pure helpers for the admin screens: cleaning what an admin typed. No database.
const httpError = require('./httpError');

const MAX_ROOMS = 20;
const MAX_ROOM_LENGTH = 30;

// Only the fields a form is allowed to change, so a request cannot set anything else
const pick = (body, keys) =>
  Object.fromEntries(keys.filter((k) => body && Object.prototype.hasOwnProperty.call(body, k)).map((k) => [k, body[k]]));

// [" Room 1 ", "", "Room  2"] → ["Room 1", "Room 2"]; refuses an empty list or the same room twice
const cleanRooms = (rooms) => {
  if (!Array.isArray(rooms)) throw httpError(400, 'Rooms must be a list');
  const names = rooms.map((r) => String(r ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!names.length) throw httpError(400, 'A service needs at least one room or counter');
  if (names.length > MAX_ROOMS) throw httpError(400, `A service can have at most ${MAX_ROOMS} rooms`);
  const tooLong = names.find((n) => n.length > MAX_ROOM_LENGTH);
  if (tooLong) throw httpError(400, `"${tooLong}" is too long: keep room names under ${MAX_ROOM_LENGTH} characters`);
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n.toLowerCase())) throw httpError(400, `"${n}" is listed twice`);
    seen.add(n.toLowerCase());
  }
  return names;
};

// A checkbox value must be a real true/false, not "false" (which is truthy)
const checkBoolean = (value, label) => {
  if (typeof value !== 'boolean') throw httpError(400, `${label} must be true or false`);
  return value;
};

module.exports = { MAX_ROOMS, pick, cleanRooms, checkBoolean };
