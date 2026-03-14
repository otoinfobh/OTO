const { google }    = require('googleapis');
const { sendText, sendInteractiveButtons } = require('./whatsapp');
const { getState, setState, STATE }        = require('./state');
const config = require('./config');

const TZ = 'Asia/Bahrain';

function getCalendarClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
  return google.calendar({ version: 'v3', auth });
}

// Get tomorrow's date range in Bahrain time
function getTomorrowRange() {
  const now       = new Date();
  const bhNow     = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const tomorrow  = new Date(bhNow);
  tomorrow.setUTCDate(bhNow.getUTCDate() + 1);

  const start = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), -3, 0, 0)); // 00:00 BH
  const end   = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 20, 59, 59)); // 23:59 BH
  return { start, end };
}

// Parse phone number from event description
function extractPhone(description) {
  if (!description) return null;
  const match = description.match(/Phone:\s*\+?(\d+)/);
  return match ? match[1] : null;
}

// Format a UTC date to Bahrain 12h display
function formatBHTime(dateStr, isAr) {
  const d   = new Date(dateStr);
  const bh  = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const h   = bh.getUTCHours();
  const m   = bh.getUTCMinutes();
  const h12 = h % 12 || 12;
  const pad = String(m).padStart(2, '0');
  if (isAr) {
    const toAr   = n => String(n).split('').map(c => '٠١٢٣٤٥٦٧٨٩'[c] ?? c).join('');
    const period = h < 12 ? 'صباحاً' : 'مساءً';
    return `${toAr(h12)}:${toAr(pad)} ${period}`;
  }
  return `${h12}:${pad} ${h < 12 ? 'AM' : 'PM'}`;
}

function formatBHDate(dateStr, isAr) {
  const d   = new Date(dateStr);
  const bh  = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const dd  = String(bh.getUTCDate()).padStart(2, '0');
  const mm  = String(bh.getUTCMonth() + 1).padStart(2, '0');
  const yy  = bh.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

// Delete a calendar event
async function deleteEvent(calendarId, eventId) {
  const calendar = getCalendarClient();
  console.log(`🗑 Deleting event ${eventId} from calendar ${calendarId}`);
  try {
    await calendar.events.delete({ calendarId, eventId });
    console.log('🗑 Event deleted successfully');
    return true;
  } catch (err) {
    console.error('deleteEvent error:', err.message, '| calendarId:', calendarId, '| eventId:', eventId);
    return false;
  }
}

// Send reminders for all tomorrow's appointments across all doctor calendars
async function sendDailyReminders(phoneNumberId) {
  const calendar         = getCalendarClient();
  const { start, end }   = getTomorrowRange();
  let   totalSent        = 0;

  for (const doctor of config.doctors) {
    try {
      const res = await calendar.events.list({
        calendarId:   doctor.calendarId,
        timeMin:      start.toISOString(),
        timeMax:      end.toISOString(),
        singleEvents: true,
        orderBy:      'startTime',
      });

      const events = res.data.items || [];
      console.log(`📅 ${doctor.name_en}: ${events.length} appointments tomorrow`);

      for (const event of events) {
        if (!event.start?.dateTime) continue;
        const phone = extractPhone(event.description);
        if (!phone) {
          console.log(`⚠️ No phone found in event: ${event.summary}`);
          continue;
        }

        // Detect language from stored state, fallback to Arabic
        const userState = getState(phone);
        const lang      = userState?.lang || 'ar';
        const isAr      = lang === 'ar';

        const timeDisplay = formatBHTime(event.start.dateTime, isAr);
        const dateDisplay = formatBHDate(event.start.dateTime, isAr);

        // Store reminder context in state so we can handle button responses
        // Parse patient info from event description
        const desc = event.description || '';
        const parsedName     = (desc.match(/👤 Name:\s*(.+)/)     || desc.match(/Patient:\s*(.+)/))?.[1]?.trim() || '-';
        const parsedCpr      = (desc.match(/🪪 CPR:\s*(.+)/))?.[1]?.trim() || '-';
        const parsedDob      = (desc.match(/🎂 DOB:\s*(.+)/))?.[1]?.trim() || '-';
        const parsedNat      = (desc.match(/🌍 Nationality:\s*(.+)/))?.[1]?.trim() || '-';
        const parsedPhone    = (desc.match(/📞 Phone:\s*\+?(\d+)/))?.[1]?.trim() || phone;
        const parsedProc     = (desc.match(/🦷 Procedure:\s*(.+)/))?.[1]?.trim() || '';

        setState(phone, {
          ...userState,
          reminderPending: {
            eventId:     event.id,
            calendarId:  doctor.calendarId,
            doctor,
            timeDisplay,
            dateDisplay,
            summary:     event.summary,
            patientInfo: { fullName: parsedName, cpr: parsedCpr, dob: parsedDob, nationality: parsedNat, phone: parsedPhone },
            procedureName: parsedProc,
          }
        });

        await sendInteractiveButtons(phone, phoneNumberId,
          isAr
            ? `🦷 *تذكير بموعدك غداً*\n\n👨‍⚕️ ${doctor.name_ar}\n📅 ${dateDisplay}\n🕐 ${timeDisplay}\n\nنراك غداً! 😊`
            : `🦷 *Appointment Reminder*\n\n👨‍⚕️ ${doctor.name_en}\n📅 ${dateDisplay}\n🕐 ${timeDisplay}\n\nSee you tomorrow! 😊`,
          [
            { id: 'reminder_confirm',    title: isAr ? '✅ تأكيد الحضور'   : '✅ Confirm'          },
            { id: 'reminder_reschedule', title: isAr ? '🔄 تغيير الموعد'   : '🔄 Reschedule'       },
          ]
        );

        totalSent++;
        console.log(`✅ Reminder sent to ${phone} for ${event.summary}`);

        // Small delay between messages to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`Reminder error for ${doctor.name_en}:`, err.message);
    }
  }

  console.log(`📬 Reminders done. Sent: ${totalSent}`);
  return totalSent;
}

module.exports = { sendDailyReminders, deleteEvent };
