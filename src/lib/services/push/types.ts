export interface PushTarget {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushMessage {
  title: string
  body: string
  url: string
  type: string
}

export type PushSendResult = 'sent' | 'stale' | 'failed'

export interface PushProvider {
  isConfigured(): boolean
  send(target: PushTarget, message: PushMessage): Promise<PushSendResult>
}
