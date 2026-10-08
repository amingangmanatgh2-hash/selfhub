/* SelfHub — تایپ‌های Telegram Bot API (زیرمجموعه‌ای که واقعاً استفاده می‌کنیم)
 * فقط type — بدون هیچ کد اجرایی.
 */

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel'

export interface TgUser {
  id: number
  is_bot: boolean
  /** فقط برای getMe ربات */
  can_read_all_group_messages?: boolean
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TgChat {
  id: number
  type: ChatType
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

export type MessageType =
  | 'text'
  | 'photo'
  | 'sticker'
  | 'document'
  | 'video'
  | 'voice'
  | 'audio'
  | 'animation'
  | 'video_note'
  | 'contact'
  | 'location'
  | 'venue'
  | 'poll'
  | 'dice'
  | 'service'

export interface TgEntity {
  type: string
  offset: number
  length: number
  url?: string
}

export interface TgMessage {
  message_id: number
  from?: TgUser
  sender_chat?: TgChat
  chat: TgChat
  date: number
  text?: string
  caption?: string
  entities?: TgEntity[]
  forward_origin?: unknown
  new_chat_members?: TgUser[]
  left_chat_member?: TgUser
  migrate_to_chat_id?: number
  pinned_message?: TgMessage
  poll?: unknown
  contact?: unknown
  location?: unknown
  venue?: unknown
  photo?: unknown[]
  document?: unknown
  video?: unknown
  voice?: unknown
  audio?: unknown
  animation?: unknown
  sticker?: unknown
  video_note?: unknown
  dice?: unknown
  successful_payment?: unknown
  reply_parameters?: { message_id: number }
  reply_to_message?: TgMessage
  author_signature?: string
  connected_website?: string
}

export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  inline_message_id?: string
  chat_instance: string
  data?: string
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
  channel_post?: TgMessage
  edited_channel_post?: TgMessage
  callback_query?: TgCallbackQuery
  my_chat_member?: { chat: TgChat; from: TgUser; date: number; new_chat_member: TgChatMember; old_chat_member: TgChatMember }
  chat_member?: { chat: TgChat; from?: TgUser; date: number; new_chat_member: TgChatMember; old_chat_member: TgChatMember }
}

export type MemberStatus = 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'

export interface TgChatMember {
  status: MemberStatus
  user: TgUser
  until_date?: number
  can_be_edited?: boolean
  can_restrict_members?: boolean
  can_delete_messages?: boolean
  can_manage_chat?: boolean
  custom_title?: string
}

export interface InlineKeyboardButton {
  text: string
  callback_data?: string
  url?: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

export interface ReplyParameters {
  message_id: number
  allow_sending_without_reply?: boolean
}

/* ---------- مدل داده‌های خودِ SelfHub ---------- */

export type Action = 'none' | 'delete' | 'warn' | 'mute' | 'kick' | 'ban'

export interface ChatSettings {
  /** تنظیمات پیش‌فرض ربات برای این چت */
  title: string
  type: ChatType
  moderation: boolean
  adminOnlyCommands: boolean
  /** پاسخ خودکار به کلیدواژه‌ها */
  autoreply: boolean
  /** پاسخ به پرایویت (فقط کاربران مجاز در admins سراسری) */
  welcome: boolean
  welcomeText: string
  leaveMsg: boolean
  rulesText: string
  captcha: boolean
  captchaTimeoutMin: number
  flood: { on: boolean; windowSec: number; max: number; action: Action; muteMin: number }
  words: { on: boolean; patterns: string[]; action: Action; muteMin: number }
  links: { on: boolean; allowInvite: boolean; allowOwnChannel: boolean; action: Action }
  caps: { on: boolean; minChars: number; maxRatio: number; action: Action }
  media: { on: boolean; blocked: MessageType[] }
  duplicate: { on: boolean; windowSec: number; max: number; action: Action }
  joinBan: { on: boolean; namePatterns: string[] }
  length: { on: boolean; maxChars: number; action: Action }
  warnLimit: number
  warnAction: Action
  warnActionMuteMin: number
  /** عضو «لیست پخش اطلاعیه» — با /sub فعال می‌شود */
  broadcast: boolean
  logChatId: number | null
}

export interface GlobalSettings {
  /** آفست زمانی دقیقه‌ای برای تفسیر ساعت در زمان‌بند (۳۳۰ = تهران) */
  tzOffsetMin: number
  /** شناسه‌های کاربری که در پنل و دستورات ادمین مجازند */
  admins: number[]
  /** پیش‌فرض تنظیمات چت‌های جدید */
  defaults: ChatSettings
  /** سقف اطلاعیه در هر ارسال (تعداد چت) */
  broadcastMaxPerTick: number
  /** فاصله‌ی ایمن بین دو اطلاعیه (میلی‌ثانیه) */
  broadcastGapMs: number
  /** پاسخ کوتاه‌تر/بلندتر بودن دستورات */
  helpFooter: string
}

export interface KeywordRule {
  id: number
  chatId: number
  pattern: string
  reply: string
  mode: 'contains' | 'exact' | 'regex' | 'starts'
  enabled: boolean
  hits: number
}

export interface Note {
  chatId: number
  name: string
  text: string
  createdBy: number
  createdAt: number
  hits: number
}

export interface ScheduledJob {
  id: number
  chatId: number
  text: string
  /** epoch ثانیه */
  at: number
  everyMin: number
  enabled: boolean
  note: string
  createdBy: number
  lastSent: number
  sentCount: number
}

export interface WarnRow {
  chatId: number
  userId: number
  points: number
  reason: string
  updatedAt: number
}

export interface ModlogRow {
  id: number
  chatId: number
  action: string
  targetId: number | null
  targetName: string
  moderator: string
  reason: string
  ts: number
}

export interface StatsDay {
  chatId: number
  day: string
  msgs: number
  members: number
  deleted: number
  warns: number
  mutes: number
  bans: number
  replies: number
  commands: number
}

export interface UserRow {
  chatId: number
  userId: number
  name: string
  username: string
  firstSeen: number
  lastSeen: number
  msgs: number
}

export interface BotProfile {
  id: number
  username: string
  first_name: string
  can_read_all_group_messages: boolean
  supports_inline_queries?: boolean
}

export interface HubInfo {
  installed: boolean
  tokenOk: boolean
  webhook: { url: string; is_running: boolean; pending_update_count: number; last_error_message?: string; has_secret: boolean } | null
  me: BotProfile | null
  version: string
  createdAt: number
  lastTick: number
  lastError: string | null
}
