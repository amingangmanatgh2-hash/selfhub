/* SelfHub — کلاینت Bot API رسمی تلگرام
 * بدون سوکت دائمی: هر صدا یک HTTP است. یعنی روی Workers کاملاً پایدار است.
 * - مدیریت 429 با retry_after تلگرام و backoff
 * - بدون لاگ توکن در خطاها
 * - ورودی/خروجی تایپ‌شده (no any)
 */

import type {
  InlineKeyboardMarkup,
  MemberStatus,
  ReplyParameters,
  TgChatMember,
  TgMessage,
  TgUser,
} from './types.ts'
import { delay } from './util.ts'

export interface TgResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

export class TelegramError extends Error {
  status: number
  payload: TgResponse<unknown>
  constructor(status: number, payload: TgResponse<unknown>) {
    super(payload.description ?? `Telegram HTTP ${status}`)
    this.name = 'TelegramError'
    this.status = status
    this.payload = payload
  }
  get retryAfter(): number {
    return Number(this.payload.parameters?.retry_after ?? 0)
  }
  /** خطای «مجاز نیست» را نباید به کاربر نشان داد به‌صورت خام */
  get benign(): boolean {
    const d = String(this.payload.description ?? '')
    return /message to edit not found|message is not modified|button data is empty|chat not found|user is deactivated|bot was kicked|bot was blocked|have no rights/i.test(d)
  }
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface BotOptions {
  fetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  /** برای تست: baseUrl را روی سرور ساختگی بگذارید */
  baseUrl?: string
}

export interface SendTextOptions {
  disablePreview?: boolean
  replyTo?: number
  replyMarkup?: InlineKeyboardMarkup
  silent?: boolean
  /** پیش‌فرض HTML */
  parseMode?: 'HTML' | 'MarkdownV2' | null
}

export class TelegramBot {
  readonly token: string
  private base: string
  private doFetch: FetchLike
  private nap: (ms: number) => Promise<void>
  private retries: number

  constructor(token: string, opts: BotOptions = {}) {
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('قالب Bot Token نامعتبر است')
    this.token = token
    this.base = opts.baseUrl ?? 'https://api.telegram.org'
    // ⚠️ bind لازم است: صدازدن fetch با this ربات در Workers خطای Illegal invocation می‌دهد
    this.doFetch = (opts.fetch ?? (globalThis.fetch.bind(globalThis) as unknown as FetchLike))
    this.nap = opts.sleep ?? delay
    this.retries = opts.maxRetries ?? 3
  }

  get botUsername(): string {
    return this.token.split(':')[1]?.split('-')[0] ?? ''
  }

  /** یک فراخوانی متد Bot API با مدیریت flood-wait */
  async call<T>(method: string, payload: Record<string, unknown> = {}, attempt = 0): Promise<T> {
    const url = `${this.base}/bot${this.token}/${method}`
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (e) {
      if (attempt < this.retries) {
        await this.nap(400 * 2 ** attempt)
        return this.call<T>(method, payload, attempt + 1)
      }
      throw new Error(`ارتباط با تلگرام برقرار نشد: ${String((e as Error)?.message ?? e)}`)
    }

    let data: TgResponse<T>
    try {
      data = (await res.json()) as TgResponse<T>
    } catch {
      throw new TelegramError(res.status, { ok: false, description: `پاسخ غیرJSON (HTTP ${res.status})` })
    }

    if (data.ok) return data.result as T

    if (data.error_code === 429 && attempt < this.retries) {
      const wait = Math.min(30, Math.max(1, data.parameters?.retry_after ?? 1))
      await this.nap(wait * 1000 + 250)
      return this.call<T>(method, payload, attempt + 1)
    }
    throw new TelegramError(res.status, data as TgResponse<unknown>)
  }

  /* ---------------- متدها ---------------- */

  getMe(): Promise<TgUser> {
    return this.call<TgUser>('getMe')
  }

  sendMessage(chatId: number | string, text: string, o: SendTextOptions = {}): Promise<TgMessage> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, 4096),
      disable_web_page_preview: o.disablePreview ?? true,
      disable_notification: o.silent ?? false,
    }
    if (o.parseMode !== null) payload.parse_mode = o.parseMode ?? 'HTML'
    if (o.replyTo) payload.reply_parameters = { message_id: o.replyTo, allow_sending_without_reply: true } satisfies ReplyParameters
    if (o.replyMarkup) payload.reply_markup = o.replyMarkup
    return this.call<TgMessage>('sendMessage', payload)
  }

  /** ارسال امن: اگر کاربر بوت را بلاک کرده باشد خطا نمی‌دهد */
  async trySend(chatId: number | string, text: string, o: SendTextOptions = {}): Promise<TgMessage | null> {
    try {
      return await this.sendMessage(chatId, text, o)
    } catch (e) {
      if (e instanceof TelegramError && e.benign) return null
      throw e
    }
  }

  editMessageText(chatId: number | string, messageId: number, text: string, markup?: InlineKeyboardMarkup): Promise<TgMessage> {
    return this.call<TgMessage>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, 4096),
      parse_mode: 'HTML',
      ...(markup ? { reply_markup: markup } : {}),
    })
  }

  deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
    return this.call<boolean>('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => false)
  }

  answerCallbackQuery(id: string, text = '', showAlert = false): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', { callback_query_id: id, ...(text ? { text, show_alert: showAlert } : {}) }).catch(() => false)
  }

  getChat(chatId: number | string): Promise<{ id: number; type: string; title?: string; username?: string; description?: string }> {
    return this.call('getChat', { chat_id: chatId })
  }

  getChatMemberCount(chatId: number | string): Promise<number> {
    return this.call<number>('getChatMemberCount', { chat_id: chatId })
  }

  getChatMember(chatId: number | string, userId: number): Promise<TgChatMember> {
    return this.call<TgChatMember>('getChatMember', { chat_id: chatId, user_id: userId })
  }

  async isStaff(chatId: number | string, userId: number): Promise<MemberStatus | 'unknown'> {
    try {
      const m = await this.getChatMember(chatId, userId)
      return m.status
    } catch {
      return 'unknown'
    }
  }

  /** سکوت موقت (can_send_messages=false) — اگر untilDate صفر باشد تا ابد */
  restrict(chatId: number | string, userId: number, untilDate: number): Promise<boolean> {
    return this.call<boolean>('restrictChatMember', {
      chat_id: chatId,
      user_id: userId,
      until_date: untilDate || undefined,
      permissions: { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_add_web_page_previews: false, can_change_info: false, can_invite_users: false, can_pin_messages: false, can_manage_topics: false },
    }).catch(() => false)
  }

  unrestrict(chatId: number | string, userId: number): Promise<boolean> {
    return this.call<boolean>('restrictChatMember', {
      chat_id: chatId,
      user_id: userId,
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_add_web_page_previews: true,
      },
    }).catch(() => false)
  }

  kick(chatId: number | string, userId: number): Promise<boolean> {
    return this.call<boolean>('banChatMember', { chat_id: chatId, user_id: userId }).catch(() => false)
  }

  ban(chatId: number | string, userId: number, revoke: boolean): Promise<boolean> {
    return this.call<boolean>('banChatMember', { chat_id: chatId, user_id: userId, revoke_messages: revoke }).catch(() => false)
  }

  pardon(chatId: number | string, userId: number): Promise<boolean> {
    return this.call<boolean>('unbanChatMember', { chat_id: chatId, user_id: userId }).catch(() => false)
  }

  pin(chatId: number | string, messageId: number, silent = true): Promise<boolean> {
    return this.call<boolean>('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: silent }).catch(() => false)
  }

  unpin(chatId: number | string, messageId?: number): Promise<boolean> {
    return this.call<boolean>('unpinChatMessage', { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}) }).catch(() => false)
  }

  leave(chatId: number | string): Promise<boolean> {
    return this.call<boolean>('leaveChat', { chat_id: chatId }).catch(() => false)
  }

  sendPoll(chatId: number | string, question: string, options: string[], anon = true): Promise<TgMessage> {
    return this.call<TgMessage>('sendPoll', {
      chat_id: chatId,
      question: question.slice(0, 300),
      options: JSON.stringify(options.slice(0, 10).map(o => o.slice(0, 100))),
      is_anonymous: anon,
      type: 'regular',
    })
  }

  setTyping(chatId: number | string): Promise<boolean> {
    return this.call<boolean>('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => false)
  }

  setWebhook(url: string, secretToken: string): Promise<boolean> {
    return this.call<boolean>('setWebhook', {
      url,
      secret_token: secretToken,
      drop_pending_updates: true,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member'],
    })
  }

  deleteWebhook(): Promise<boolean> {
    return this.call<boolean>('deleteWebhook', { drop_pending_updates: false })
  }

  getWebhookInfo(): Promise<{ url: string; has_custom_certificate: boolean; pending_update_count: number; last_error_message?: string; last_error_date?: number; max_connections?: number }> {
    return this.call('getWebhookInfo')
  }
}

/** ساخت شیار دکمه‌های درون‌خطی */
export function kb(rows: [string, string][][]): InlineKeyboardMarkup {
  // تلگرام حداکثر حدود ۸ دکمه در هر ردیف و ۱۰۰ دکمه در هر شیار را نگه می‌دارد
  return {
    inline_keyboard: rows
      .slice(0, 12)
      .map(r => r.slice(0, 8).map(([text, data]) => ({ text: text.slice(0, 64), callback_data: data.slice(0, 64) })))
      .filter(r => r.length > 0),
  }
}
