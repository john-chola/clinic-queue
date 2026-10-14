// The logged-in staff member is kept in this browser (each counter or room has its own device).
const KEY = 'cq_staff'

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null }
}

export const getStaff = () => read()?.staff || null
export const getToken = () => read()?.token || null
export const saveStaff = (token, staff) => {
  try { localStorage.setItem(KEY, JSON.stringify({ token, staff })) } catch { /* private mode */ }
}
export const clearStaff = () => {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}
