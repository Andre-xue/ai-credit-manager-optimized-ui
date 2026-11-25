import { describe, it, expect } from 'vitest'
import { parseMinimaxStatus, parseWorkbuddyStatus } from './checkin'

describe('checkin.parseMinimaxStatus', () => {
  const days = [
    { day_no: 1, is_today: false, points: 400, bonus_points: 0, status: 3 },
    { day_no: 2, is_today: false, points: 400, bonus_points: 0, status: 3 },
    { day_no: 3, is_today: true, points: 400, bonus_points: 0, status: 2 },
    { day_no: 4, is_today: false, points: 400, bonus_points: 600, status: 1 },
  ]
  it('可签到：解析今日点数与连签', () => {
    const st = parseMinimaxStatus({ base_resp: { status_code: 0 }, data: { days } })
    expect(st.state).toBe('claimable')
    expect(st.points).toBe(400)
    expect(st.streakDays).toBe(2)
    expect(st.days?.[3].points).toBe(1000)
  })
  it('已签到', () => {
    const d2 = days.map(d => d.is_today ? { ...d, status: 3 } : d)
    const st = parseMinimaxStatus({ data: { days: d2 } })
    expect(st.state).toBe('claimed')
    expect(st.streakDays).toBe(3)
  })
  it('上游错误码抛错', () => {
    expect(() => parseMinimaxStatus({ base_resp: { status_code: 1004, status_msg: 'invalid token' } })).toThrow(/1004/)
  })
  it('没有今天数据时报不可用', () => {
    expect(parseMinimaxStatus({ data: { days: [] } }).state).toBe('unavailable')
  })
})

describe('checkin.parseWorkbuddyStatus', () => {
  it('可签到', () => {
    const st = parseWorkbuddyStatus({ data: { todayCheckedIn: false, active: true, streakDays: 5, dailyCredit: 100 } })
    expect(st.state).toBe('claimable')
    expect(st.points).toBe(100)
    expect(st.streakDays).toBe(5)
  })
  it('已签到', () => {
    expect(parseWorkbuddyStatus({ data: { todayCheckedIn: true, dailyCredit: 100 } }).state).toBe('claimed')
  })
  it('活动未开启', () => {
    expect(parseWorkbuddyStatus({ data: { active: false } }).state).toBe('unavailable')
  })
})
