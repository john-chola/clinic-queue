// Zambian numbers stored as +260XXXXXXXXX (same rule as ZamMarket)
const PHONE_RE = /^\+260(9[5-7]|7[6-9])\d{7}$/;

const normalizePhone = (phone) => {
  const raw = String(phone || '').trim().replace(/[\s()-]/g, '');
  if (/^260\d{9}$/.test(raw)) return `+${raw}`;
  if (/^0\d{9}$/.test(raw)) return `+260${raw.slice(1)}`;
  return raw;
};

const isValidPhone = (phone) => PHONE_RE.test(normalizePhone(phone));

module.exports = { normalizePhone, isValidPhone };
