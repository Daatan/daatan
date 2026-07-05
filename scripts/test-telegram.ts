import { notifyForecastPublished } from '../src/lib/services/telegram'

async function main() {
  console.log('--- Telegram Notification Test ---')
  console.log('Bot Token:', process.env.TELEGRAM_BOT_TOKEN ? 'Set' : 'MISSING')
  console.log('Chat ID:', process.env.TELEGRAM_CHAT_ID ? 'Set' : 'MISSING')
  console.log('Env:', process.env.APP_ENV)

  const mockPrediction = {
    id: 'test-123',
    claimText: 'This is a test notification from the manual test script.'
  }

  const mockUser = {
    name: 'Test Runner',
    username: 'testrunner'
  }

  console.log('Sending notification...')
  notifyForecastPublished(mockPrediction, mockUser)
  
  // Wait a bit because sendChannelNotification is fire-and-forget (not awaited in notifyForecastPublished)
  await new Promise(resolve => setTimeout(resolve, 3000))
  console.log('Done. Check your Telegram channel.')
}

main()
