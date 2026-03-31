import { useState } from 'react'
import { addRoom, deleteRoom } from '../api'
import './Sidebar.css'

const STATUS_LABEL = { running: '运行中', connecting: '连接中', idle: '已停止', stopping: '停止中' }
const STATUS_DOT   = { running: 'dot--green', connecting: 'dot--blue', idle: 'dot--gray', stopping: 'dot--gray' }

export default function Sidebar({ rooms, selectedId, onSelect, onRoomsChange }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleAdd(e) {
    e.preventDefault()
    const val = input.trim()
    if (!val) return
    setLoading(true); setError('')
    try {
      await addRoom(val)
      setInput('')
      onRoomsChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(e, roomId) {
    e.stopPropagation()
    if (!confirm(`确认停止并删除房间 ${roomId}？`)) return
    try {
      await deleteRoom(roomId)
      onRoomsChange()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__header">直播间</div>

      <form className="sidebar__add" onSubmit={handleAdd}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="房间号或链接"
          disabled={loading}
        />
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? '…' : '+'}
        </button>
      </form>
      {error && <div className="sidebar__error">{error}</div>}

      <ul className="sidebar__list">
        {rooms.length === 0 && (
          <li className="sidebar__empty">暂无房间</li>
        )}
        {rooms.map(room => (
          <li
            key={room.room_id}
            className={`sidebar__item ${room.room_id === selectedId ? 'sidebar__item--active' : ''}`}
            onClick={() => onSelect(room.room_id)}
          >
            <span className={`dot ${STATUS_DOT[room.status] || 'dot--gray'}`} />
            <span className="sidebar__item-id">{room.room_id}</span>
            <span className="sidebar__item-status">{STATUS_LABEL[room.status] || room.status}</span>
            <button
              className="btn-ghost btn-danger sidebar__item-del"
              onClick={e => handleDelete(e, room.room_id)}
              title="删除"
            >×</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
