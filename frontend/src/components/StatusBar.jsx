import './StatusBar.css'

export default function StatusBar({ auth, rooms }) {
  const running = rooms.filter(r => r.status === 'running').length

  return (
    <header className="status-bar">
      <span className="status-bar__logo">BiliInsight</span>
      <div className="status-bar__info">
        {auth?.loggedIn ? (
          <span className="status-bar__user">
            <span className="dot dot--green" /> 已登录：{auth.uname}
          </span>
        ) : (
          <span className="status-bar__user status-bar__user--warn">
            <span className="dot dot--red" /> 未登录
          </span>
        )}
        {rooms.length > 0 && (
          <span className="status-bar__rooms">
            采集中：{running} / {rooms.length} 个房间
          </span>
        )}
      </div>
    </header>
  )
}
