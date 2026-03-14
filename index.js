require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const { handleMessage }     = require('./flows');
const { sendDailyReminders } = require('./reminders');

const app = express();
app.use(bodyParser.json());

// Health check
app.get('/', (req, res) => res.send('Dr. Ali Jawad Dental Clinic Bot is running ✅'));

// Meta webhook verification
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified ✅');
    res.status(200).send(challenge);
  } else {
    console.error('Webhook verification failed ❌');
    res.sendStatus(403);
  }
});

// Deduplication cache — stores processed message IDs for 60 seconds
const processedIds = new Map();
function isDuplicate(id) {
  if (processedIds.has(id)) return true;
  processedIds.set(id, Date.now());
  // Clean up entries older than 60 seconds
  for (const [key, ts] of processedIds) {
    if (Date.now() - ts > 60000) processedIds.delete(key);
  }
  return false;
}

// Receive incoming WhatsApp messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Always respond immediately to Meta

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry    = body.entry?.[0];
    const changes  = entry?.changes?.[0];
    const value    = changes?.value;
    const messages = value?.messages;

    if (!messages?.length) return;

    const message       = messages[0];
    const from          = message.from;
    const phoneNumberId = value.metadata.phone_number_id;

    if (isDuplicate(message.id)) {
      console.log(`⚠️ Duplicate message ignored: ${message.id}`);
      return;
    }

    console.log(`📨 Message from ${from}: ${JSON.stringify(message)}`);
    await handleMessage(from, message, phoneNumberId);

  } catch (error) {
    console.error('Webhook processing error:', error);
  }
});

// Test endpoint — hit this in browser to trigger reminders immediately
app.get('/send-reminders', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(403).send('Unauthorized');
  }
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  const count = await sendDailyReminders(phoneNumberId);
  res.send(`✅ Reminders sent: ${count}`);
});

// Daily cron — checks every minute if it's 10:00 AM Bahrain time, then sends reminders
let lastReminderDate = null;
setInterval(async () => {
  const now    = new Date();
  const bhNow  = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const hour   = bhNow.getUTCHours();
  const minute = bhNow.getUTCMinutes();
  const today  = bhNow.toISOString().split('T')[0];

  if (hour === 10 && minute === 0 && lastReminderDate !== today) {
    lastReminderDate = today;
    console.log('⏰ 10:00 AM Bahrain — sending daily reminders...');
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    await sendDailyReminders(phoneNumberId);
  }
}, 60000); // check every minute

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦷 Dental clinic bot running on port ${PORT}`);
});
