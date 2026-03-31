import { useState, useEffect, useRef } from 'react'

const MAX_EVENTS = 200

export function useSSE(roomId) {
  const [events, setEvents] = useState([])
  const esRef = useRef(null)

  useEffect(() => {
    if (!roomId) {
      setEvents([])
      return
    }

    // 关闭旧连接
    if (esRef.current) {
      esRef.current.close()
    }

    setEvents([])
    const es = new EventSource(`/api/rooms/${roomId}/stream`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data)
        setEvents(prev => {
          const next = [...prev, { ...payload, _id: Date.now() + Math.random() }]
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
        })
      } catch (_) {}
    }

    es.onerror = () => {
      // SSE 断线后浏览器会自动重连，无需处理
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [roomId])

  return events
}
