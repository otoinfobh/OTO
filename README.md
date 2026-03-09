# 🦷 Dr. Ali Jawad Dental Clinic — WhatsApp Bot

A fully automated WhatsApp chatbot with:
- Bilingual Arabic/English support (auto-detects)
- Appointment booking → saved to Google Calendar
- FAQ responses (hours, services, prices)
- Claude AI for intelligent fallback replies
- Human handover option

---

## Step 1 — Get your API keys

You need 3 accounts. All have free tiers.

### A) Meta WhatsApp Business API
1. Go to developers.facebook.com → create a new App → choose "Business"
2. Add "WhatsApp" product to your app
3. Go to WhatsApp → API Setup
4. Copy your **Phone Number ID** and **Temporary Access Token**
5. For production: generate a permanent token in System Users

### B) Claude API Key
1. Go to console.anthropic.com
2. Create an account and generate an API key

### C) Google Calendar
1. Go to console.cloud.google.com
2. Create a new project
3. Enable the Google Calendar API
4. Create a Service Account → download the JSON key file
5. Copy `client_email` and `private_key` from the JSON file
6. In Google Calendar, share your calendar with the service account email (give it "Make changes to events" permission)

---

## Step 2 — Deploy to Render (free)

1. Go to render.com and create a free account
2. Click "New" → "Web Service"
3. Connect your GitHub (upload this folder to a GitHub repo first)
4. Set the following:
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
5. Add Environment Variables (from .env.example) in the Render dashboard
6. Deploy — Render gives you a URL like: `https://your-bot.onrender.com`

---

## Step 3 — Connect webhook to Meta

1. In Meta Developer Console → WhatsApp → Configuration
2. Set Webhook URL to: `https://your-bot.onrender.com/webhook`
3. Set Verify Token to: whatever you put in `WEBHOOK_VERIFY_TOKEN`
4. Subscribe to: `messages`
5. Click Verify — if it says "Verified" you're live ✅

---

## What the bot does

```
Patient messages → 
  Bot shows menu (Arabic or English based on their message)
    ├── 📅 Book Appointment
    │     └── Name → Doctor → Date → Time → Confirm → Google Calendar ✅
    ├── 🕐 Hours & Location
    ├── 💰 Services & Prices  
    └── 👨‍⚕️ Speak to Staff → shows phone number
  
  Any other question → Claude AI answers intelligently
```

---

## Clinic details (edit in config.js)

To use this for a different clinic, just update `config.js` with their details.
