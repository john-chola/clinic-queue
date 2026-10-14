// A short chime, and the ticket read aloud ("A 0 2 4, Room 2"), for the waiting-room screen.
// Browsers only allow sound after someone taps the page once.
let ctx = null

export function enableSound() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return true
  } catch { return false }
}

export function chime() {
  if (!ctx) return
  const now = ctx.currentTime
  ;[660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + i * 0.25)
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.25 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + i * 0.25)
    osc.stop(now + i * 0.25 + 0.45)
  })
}

// "A-024" → "A, 0, 2, 4": read digit by digit so it is clear in a noisy room
export function speakCall(code, room) {
  if (!('speechSynthesis' in window)) return
  const spoken = code.replace('-', ' ').split('').join(' ')
  const u = new SpeechSynthesisUtterance(`Ticket ${spoken}. Please go to ${room}.`)
  u.lang = 'en-GB'
  u.rate = 0.9
  window.speechSynthesis.speak(u)
}
