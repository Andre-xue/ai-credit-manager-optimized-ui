// 签到平台的官方图标（本地打包，不依赖网络加载）：取自各平台官网 favicon。
import type { CheckinPlatformId } from '../core/checkinPlatforms'
import workbuddy from '../assets/platforms/workbuddy.png'
import minimax from '../assets/platforms/minimax.png'
import doubao from '../assets/platforms/doubao.png'
import lingxi from '../assets/platforms/lingxi.png'
import dumate from '../assets/platforms/dumate.png'
import xiaohuanxiong from '../assets/platforms/xiaohuanxiong.png'
import teleagent from '../assets/platforms/teleagent.png'
import qoderCn from '../assets/platforms/qoder-cn.png'
import qoderIntl from '../assets/platforms/qoder-intl.png'

const ICONS: Record<CheckinPlatformId, string> = {
  workbuddy, minimax, doubao, lingxi, dumate, xiaohuanxiong, teleagent,
  'qoder-cn': qoderCn, 'qoder-intl': qoderIntl,
}

export function PlatformIcon({ id, size = 44 }: { id: CheckinPlatformId; size?: number }) {
  return (
    <img src={ICONS[id]} alt="" width={size} height={size}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), objectFit: 'cover', flexShrink: 0, background: 'var(--panel-2)' }} />
  )
}
