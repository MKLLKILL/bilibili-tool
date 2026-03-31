import { useEffect, useRef } from 'react'
import EventBadge, { guardLabel } from './EventBadge'
import './EventBadge.css'
import './DanmakuFeed.css'

function formatTime(ts) {
  const d = ts ? new Date(ts * 1000) : new Date()
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function MedalTag({ medal, guardLevel }) {
  const guard = guardLabel(guardLevel)
  if (guard) {
    return <span className="medal-tag" style={{ color: guard.color, borderColor: guard.color }}>{guard.text}</span>
  }
  if (medal) {
    return <span className="medal-tag">{medal.name} {medal.level}</span>
  }
  return null
}

function DanmakuRow({ ev }) {
  const { data } = ev

  if (ev.event !== 'danmaku') {
    return (
      <div className="feed-row feed-row--event">
        <span className="feed-row__time">{formatTime(data.ts)}</span>
        <EventBadge event={ev} />
      </div>
    )
  }

  return (
    <div className="feed-row">
      <span className="feed-row__time">{formatTime(data.ts)}</span>
      <MedalTag medal={data.medal} guardLevel={data.guard_level} />
      <span className="feed-row__uname">{data.uname}</span>
      <span className="feed-row__colon">：</span>
      <span className="feed-row__content">{data.content}</span>
    </div>
  )
}

export default function DanmakuFeed({ events }) {
  const bottomRef = useRef(null)
  const containerRef = useRef(null)
  const autoScrollRef = useRef(true)

  // 检测用户是否手动向上滚动
  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    autoScrollRef.current = atBottom
  }

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events])

  return (
    <div className="danmaku-feed">
      <div className="danmaku-feed__header">
        <span>实时弹幕</span>
        <span className="danmaku-feed__count">{events.length} 条</span>
      </div>
      <div
        className="danmaku-feed__list"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {events.length === 0 && (
          <div className="danmaku-feed__empty">等待弹幕...</div>
        )}
        {events.map(ev => <DanmakuRow key={ev._id} ev={ev} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
