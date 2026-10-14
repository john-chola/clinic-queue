// Tickets this phone has taken today, so the patient can find their ticket again.
const KEY = 'cq_my_tickets'
const DAY_MS = 16 * 60 * 60 * 1000

export function myTickets() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY)) || []
    return list.filter((t) => Date.now() - t.at < DAY_MS)
  } catch { return [] }
}

export function rememberTicket(publicId, code, serviceName) {
  const list = myTickets().filter((t) => t.publicId !== publicId)
  list.unshift({ publicId, code, serviceName, at: Date.now() })
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5))) } catch { /* private mode */ }
}

export function forgetTicket(publicId) {
  try { localStorage.setItem(KEY, JSON.stringify(myTickets().filter((t) => t.publicId !== publicId))) } catch { /* private mode */ }
}
