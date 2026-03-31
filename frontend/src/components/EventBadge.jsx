// 格式化守护等级为标签文字
export function guardLabel(level) {
  if (level === 1) return { text: '总督', color: 'var(--guard-1)' }
  if (level === 2) return { text: '提督', color: 'var(--guard-2)' }
  if (level === 3) return { text: '舰长', color: 'var(--guard-3)' }
  return null
}

export default function EventBadge({ event }) {
  const { event: type, data } = event

  if (type === 'gift') {
    return (
      <span className="ev-badge ev-badge--gift">
        🎁 {data.uname} 送了 {data.giftName}
        {data.num > 1 ? ` ×${data.num}` : ''}
      </span>
    )
  }

  if (type === 'sc') {
    const uname = data.user_info?.uname || data.uname || '未知'
    return (
      <span className="ev-badge ev-badge--sc">
        💬 {uname} SC ¥{data.price}：{data.message || data.content || ''}
      </span>
    )
  }

  if (type === 'guard') {
    const label = guardLabel(data.guard_level)
    return (
      <span className="ev-badge ev-badge--guard" style={{ borderColor: label?.color }}>
        ⚓ {data.username || data.uname} 开通了
        {label ? <span style={{ color: label.color, fontWeight: 700 }}> {label.text}</span> : ' 大航海'}
      </span>
    )
  }

  if (type === 'enter') {
    return (
      <span className="ev-badge ev-badge--enter">
        → {data.uname} 进入直播间
      </span>
    )
  }

  return null
}
