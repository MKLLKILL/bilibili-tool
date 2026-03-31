import { useEffect, useState, useCallback } from 'react'
import { getRoomUsers } from '../api'
import { guardLabel } from './EventBadge'
import './UserStats.css'

function goldToYuan(gold) {
  if (!gold) return '—'
  const yuan = gold / 1000
  return yuan >= 1 ? `¥${yuan.toFixed(0)}` : `¥${yuan.toFixed(1)}`
}

export default function UserStats({ roomId, refreshTick }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState('total_spend_gold')

  const load = useCallback(async () => {
    if (!roomId) return
    setLoading(true)
    try {
      const data = await getRoomUsers(roomId)
      setUsers(data.users || [])
    } catch (_) {}
    setLoading(false)
  }, [roomId])

  useEffect(() => { load() }, [load, refreshTick])

  const sorted = [...users].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0))

  const cols = [
    { key: 'uname',           label: '用户名',   render: u => u.uname || u.uid },
    { key: 'danmu_count',     label: '弹幕数',   render: u => u.danmu_count || 0 },
    { key: 'total_spend_gold',label: '消费',     render: u => goldToYuan(u.total_spend_gold) },
    { key: 'sc_count',        label: 'SC',       render: u => u.sc_count || 0 },
    { key: 'guard_level',     label: '守护',     render: u => {
      const g = guardLabel(u.guard_level)
      return g ? <span style={{ color: g.color, fontWeight: 700 }}>{g.text}</span> : '—'
    }},
    { key: 'medal_level',     label: '勋章等级', render: u => u.medal_level || '—' },
  ]

  return (
    <div className="user-stats">
      <div className="user-stats__header">
        <span>用户统计</span>
        <div className="user-stats__meta">
          {loading ? '加载中…' : `${users.length} 人`}
          <button className="btn-ghost" onClick={load} title="刷新">↻</button>
        </div>
      </div>
      <div className="user-stats__table-wrap">
        <table className="user-stats__table">
          <thead>
            <tr>
              {cols.map(c => (
                <th
                  key={c.key}
                  className={sortKey === c.key ? 'active' : ''}
                  onClick={() => setSortKey(c.key)}
                >
                  {c.label}{sortKey === c.key ? ' ↓' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={cols.length} className="user-stats__empty">暂无数据</td></tr>
            )}
            {sorted.map(u => (
              <tr key={u.uid}>
                {cols.map(c => <td key={c.key}>{c.render(u)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
