/* SelfHub — انواع محیط اجرا */

import type { HubDO } from './hub.do'
import type { SelfDO } from './self.do'

export interface Env {
  HUB: DurableObjectNamespace<HubDO>
  SELF: DurableObjectNamespace<SelfDO>
}
