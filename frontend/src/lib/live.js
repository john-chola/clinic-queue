// Live updates. The server only says "this queue changed"; each page then
// re-fetches what it is allowed to see. A slow poll is the safety net if the
// socket drops (common on mobile data).
import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

let socket = null
const getSocket = () => {
  if (!socket) socket = io(import.meta.env.VITE_SOCKET_URL || undefined, { transports: ['websocket', 'polling'] })
  return socket
}

// watch: a service id, or 'display' for every queue
export function useQueueEvents(watch, onChange, { pollMs = 30000 } = {}) {
  const handler = useRef(onChange)
  useEffect(() => { handler.current = onChange })

  useEffect(() => {
    if (!watch) return undefined
    const s = getSocket()
    const join = () => (watch === 'display' ? s.emit('watch:display') : s.emit('watch:service', watch))
    const onEvent = (e) => { if (watch === 'display' || e.serviceId === watch) handler.current(e) }
    join()
    s.on('connect', join)            // re-join after a reconnect
    s.on('queue:changed', onEvent)
    const timer = setInterval(() => handler.current({ poll: true }), pollMs)
    return () => { s.off('connect', join); s.off('queue:changed', onEvent); clearInterval(timer) }
  }, [watch, pollMs])
}
