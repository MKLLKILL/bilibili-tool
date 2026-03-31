import { useState, useEffect, useCallback } from 'react'
import { getAuthStatus, getRooms } from './api'
import { useSSE } from './useSSE'
import StatusBar from './components/StatusBar'
import Sidebar from './components/Sidebar'
import DanmakuFeed from './components/DanmakuFeed'
import UserStats from './components/UserStats'
import './App.css'

// 每 10s 向后端发送心跳，浏览器关闭时后端自动退出
function useHeartbeat() {
  useEffect(() => {
    function beat() { fetch('/api/heartbeat', { method: 'POST' }).catch(() => {}) }
    beat()
    const t = setInterval(beat, 10000)
    return () => clearInterval(t)
  }, [])
}

export default function App() {
  useHeartbeat()
  const [auth, setAuth] = useState(null)
  const [rooms, setRooms] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [statsTick, setStatsTick] = useState(0)

  const loadRooms = useCallback(async () => {
    try {
      const data = await getRooms()
      setRooms(data.rooms || [])
      // 自动选择第一个房间
      setSelectedId(prev => {
        if (prev) return prev
        return data.rooms?.[0]?.room_id || null
      })
    } catch (_) {}
  }, [])

  useEffect(() => {
    getAuthStatus().then(setAuth).catch(() => setAuth({ loggedIn: false }))
    loadRooms()
    // 每 15 秒轮询房间状态
    const t = setInterval(loadRooms, 15000)
    return () => clearInterval(t)
  }, [loadRooms])

  const events = useSSE(selectedId)

  // 收到礼物/SC/上舰事件时触发用户统计刷新
  useEffect(() => {
    const last = events[events.length - 1]
    if (last && ['gift', 'sc', 'guard'].includes(last.event)) {
      setStatsTick(t => t + 1)
    }
  }, [events])

  const selectedRoom = rooms.find(r => r.room_id === selectedId)

  return (
    <>
      <StatusBar auth={auth} rooms={rooms} />
      <div className="app-body">
        <Sidebar
          rooms={rooms}
          selectedId={selectedId}
          onSelect={id => { setSelectedId(id); setStatsTick(t => t + 1) }}
          onRoomsChange={loadRooms}
        />
        <main className="app-main">
          {!selectedId ? (
            <div className="app-main__placeholder">
              请在左侧添加或选择一个直播间
            </div>
          ) : (
            <>
              <div className="app-main__title">
                房间 {selectedId}
                <span className={`room-status room-status--${selectedRoom?.status}`}>
                  {selectedRoom?.status === 'running' ? '采集中' :
                   selectedRoom?.status === 'connecting' ? '连接中' : '已停止'}
                </span>
              </div>
              <div className="app-main__panels">
                <DanmakuFeed events={events} />
                <UserStats roomId={selectedId} refreshTick={statsTick} />
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}
