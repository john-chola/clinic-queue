// SMS delivery for OTP codes.
// SMS_PROVIDER picks the gateway:
//   console        – print the message in the server log (default; no cost)
//   africastalking – Africa's Talking (live in Zambia: MTN, Airtel, Zamtel)
//   twilio         – Twilio (trial accounts only reach verified numbers)
// Uses the built-in fetch (Node 18+), so no SDK is needed.

const TIMEOUT_MS = 15000;

const provider = () => String(process.env.SMS_PROVIDER || 'console').trim().toLowerCase();

const env = (name) => String(process.env[name] || '').trim().replace(/^["']|["']$/g, '');

const REQUIRED = {
  console: [],
  africastalking: ['AT_USERNAME', 'AT_API_KEY'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
};

// A delivery failure the user can be told about (the route answers 502)
class SmsError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.name = 'SmsError';
    this.statusCode = 502;
    this.detail = detail;
  }
}

// "0971234567" or "+260971234567" → "+260971234567"
const toInternational = (phone) => {
  const digits = String(phone).replace(/[^\d+]/g, '');
  if (digits.startsWith('+260')) return digits;
  if (digits.startsWith('260')) return `+${digits}`;
  if (digits.startsWith('0')) return `+260${digits.slice(1)}`;
  return digits;
};

// What /api/health reports
const smsStatus = () => {
  const name = provider();
  if (!REQUIRED[name]) return `unknown provider "${name}"`;
  const missing = REQUIRED[name].filter((k) => !env(k));
  if (missing.length) return `${name} (NOT configured: missing ${missing.join(', ')})`;
  return name === 'console' ? 'console (codes printed in the server log)' : `${name} (configured)`;
};

const post = async (url, headers, form) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(form).toString(),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    const why = err.name === 'AbortError' ? 'timed out' : err.message;
    throw new SmsError('The SMS service could not be reached. Try again in a minute.', why);
  } finally {
    clearTimeout(timer);
  }
};

const senders = {
  console: async (to, message) => {
    console.log('\n──────────────────────────────────────');
    console.log(`SMS to ${to}: ${message}`);
    console.log('──────────────────────────────────────\n');
    return { provider: 'console', messageId: null };
  },

  africastalking: async (to, message) => {
    const username = env('AT_USERNAME');
    const sandbox = username === 'sandbox';
    const url = sandbox
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';
    const form = { username, to, message };
    if (env('AT_SENDER_ID')) form.from = env('AT_SENDER_ID');

    const { ok, status, body } = await post(url, { apiKey: env('AT_API_KEY') }, form);
    const recipient = body?.SMSMessageData?.Recipients?.[0];
    // 100 Processed, 101 Sent, 102 Queued are successes
    if (!ok || !recipient || ![100, 101, 102].includes(Number(recipient.statusCode))) {
      const detail = recipient?.status || body?.SMSMessageData?.Message || body?.raw || `HTTP ${status}`;
      throw new SmsError('The code could not be sent by SMS. Check the number and try again.', detail);
    }
    return { provider: 'africastalking', messageId: recipient.messageId };
  },

  twilio: async (to, message) => {
    const sid = env('TWILIO_ACCOUNT_SID');
    const auth = Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64');
    const { ok, status, body } = await post(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      { Authorization: `Basic ${auth}` },
      { To: to, From: env('TWILIO_FROM'), Body: message }
    );
    if (!ok) {
      throw new SmsError('The code could not be sent by SMS. Check the number and try again.',
        body?.message || body?.raw || `HTTP ${status}`);
    }
    return { provider: 'twilio', messageId: body.sid };
  },
};

// Send one SMS. Throws SmsError when the gateway refuses or cannot be reached.
const sendSms = async (phone, message) => {
  const name = provider();
  const send = senders[name];
  if (!send) throw new SmsError('SMS is not set up on the server.', `unknown SMS_PROVIDER "${name}"`);
  const missing = REQUIRED[name].filter((k) => !env(k));
  if (missing.length) throw new SmsError('SMS is not set up on the server.', `missing ${missing.join(', ')}`);

  const to = toInternational(phone);
  try {
    return await send(to, message);
  } catch (err) {
    if (err instanceof SmsError) console.error(`SMS to ${to} failed (${name}): ${err.detail}`);
    throw err;
  }
};

module.exports = { sendSms, smsStatus, toInternational, isConsole: () => provider() === 'console', SmsError };
