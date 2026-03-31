const BASE = '/api'

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

/** 从链接或纯数字中提取房间号 */
function parseRoomId(input) {
  const m = String(input).match(/live\.bilibili\.com\/(\d+)/)
  if (m) return m[1]
  const digits = String(input).replace(/\D/g, '')
  return digits || null
}

export const getAuthStatus  = ()        => req('/auth/status')
export const getRooms       = ()        => req('/rooms')
export const addRoom        = (input)   => {
  const roomId = parseRoomId(input)
  if (!roomId) throw new Error('无效的房间号或链接')
  return req('/rooms', {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId }),
  })
}
export const deleteRoom     = (roomId)  => req(`/rooms/${roomId}`, { method: 'DELETE' })
export const getRoomStatus  = (roomId)  => req(`/rooms/${roomId}/status`)
export const getRoomUsers   = (roomId)  => req(`/rooms/${roomId}/users`)
export const getUser        = (uid)     => req(`/users/${uid}`)
export const getDashboard   = ()        => req('/dashboard')
