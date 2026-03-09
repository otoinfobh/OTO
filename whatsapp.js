const axios = require('axios');

const BASE_URL = 'https://graph.facebook.com/v18.0';

async function sendMessage(to, phoneNumberId, message) {
  try {
    await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      message,
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        }
      }
    );
  } catch (error) {
    console.error('WhatsApp send error:', error.response?.data || error.message);
  }
}

async function sendText(to, phoneNumberId, text) {
  await sendMessage(to, phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text }
  });
}

async function sendInteractiveButtons(to, phoneNumberId, body, buttons) {
  await sendMessage(to, phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(btn => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.substring(0, 20) }
        }))
      }
    }
  });
}

async function sendList(to, phoneNumberId, header, body, buttonText, sections) {
  await sendMessage(to, phoneNumberId, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: header },
      body: { text: body },
      action: { button: buttonText, sections }
    }
  });
}

module.exports = { sendText, sendInteractiveButtons, sendList };
