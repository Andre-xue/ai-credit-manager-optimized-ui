/** 通用数字分页器（v0.1.345）：上一页/页码（首尾+当前±1，中间省略号）/下一页 + 第 X/Y 页 · 共 N */
export function Pager({ page, pageCount, total, unit = '项', onPage }: {
  page: number
  pageCount: number
  total: number
  unit?: string
  onPage: (n: number) => void
}) {
  if (pageCount <= 1) return null
  const win = [...new Set([1, pageCount, page - 1, page, page + 1].filter(n => n >= 1 && n <= pageCount))].sort((a, b) => a - b)
  const nums: (number | '…')[] = []
  win.forEach((n, i) => {
    if (i > 0 && n - win[i - 1] > 1) nums.push('…')
    nums.push(n)
  })
  return (
    <div className="fm-pager">
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      {nums.map((n, i) => n === '…'
        ? <span key={`e${i}`} className="pg-ellipsis">…</span>
        : <button key={n} className={`btn sm pg-num ${n === page ? 'on' : ''}`} onClick={() => onPage(n)}>{n}</button>)}
      <button className="btn sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>下一页</button>
      <span>第 {page} / {pageCount} 页 · 共 {total} {unit}</span>
    </div>
  )
}
