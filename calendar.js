const { google } = require('googleapis');
const config     = require('./config');

const TZ = 'Asia/Bahrain';

// Bahrain is always UTC+3, no DST
// Create a Date object for a specific clock time in Bahrain
function bhDate(y, m, d, hour = 0, minute = 0) {
  return new Date(Date.UTC(y, m - 1, d, hour - 3, minute, 0));
}

function getCalendarClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
  return google.calendar({ version: 'v3', auth });
}

// Fetch ALL booked slots for a doctor on a given date from their own calendar
async function getBookedSlots(doctorId, date) {
  const calendar = getCalendarClient();
  const doctor   = config.doctors.find(d => d.id === doctorId);
  if (!doctor) return [];

  const [y, m, d2] = date.split('-').map(Number);
  const dayStart   = bhDate(y, m, d2, 0, 0);
  const dayEnd     = bhDate(y, m, d2, 23, 59);

  try {
    const res = await calendar.events.list({
      calendarId:   doctor.calendarId,
      timeMin:      dayStart.toISOString(),
      timeMax:      dayEnd.toISOString(),
      singleEvents: true,
      orderBy:      'startTime',
    });

    console.log(`📅 ${doctor.name_en} on ${date}: ${res.data.items?.length || 0} events fetched`);
    res.data.items?.forEach(e => console.log(`  - ${e.summary || 'No title'}: ${e.start?.dateTime} → ${e.end?.dateTime}`));

    return (res.data.items || [])
      .filter(e => e.start?.dateTime)
      .map(e => ({
        start: new Date(e.start.dateTime),
        end:   new Date(e.end.dateTime),
      }));
  } catch (err) {
    console.error(`getBookedSlots error for ${doctor.name_en}:`, err.message);
    return [];
  }
}

// Returns available time slots for a doctor on a date given procedure duration
async function getAvailableSlots(doctorId, date, durationMinutes) {
  const booked     = await getBookedSlots(doctorId, date);
  const [y, m, d2] = date.split('-').map(Number);
  const slots      = [];

  const { startHour, endHour } = config.clinic;
  let cursor = bhDate(y, m, d2, startHour, 0);
  const end  = bhDate(y, m, d2, endHour, 0);

  while (cursor < end) {
    const slotEnd = new Date(cursor.getTime() + durationMinutes * 60000);
    if (slotEnd > end) break;

    const blocked = booked.some(b => cursor < b.end && slotEnd > b.start);
    if (!blocked) slots.push(new Date(cursor));

    cursor = new Date(cursor.getTime() + 30 * 60000);
  }

  console.log(`🕐 Available slots for doctor ${doctorId} on ${date}: ${slots.map(s => formatTime(s)).join(', ')}`);
  return slots;
}

// Returns up to 10 dates (within 30 days) that have at least one free slot
async function getAvailableDates(doctorId, durationMinutes) {
  const { workDays } = config.clinic;
  const dates = [];
  for (let i = 1; i <= 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (!workDays.includes(d.getDay())) continue;

    const dateStr = toDateStr(d);
    const slots   = await getAvailableSlots(doctorId, dateStr, durationMinutes);
    if (slots.length > 0) dates.push(dateStr);
    if (dates.length >= 10) break;
  }
  return dates;
}

// Returns the soonest available date+slot for a doctor within 30 days
async function findSoonestSlot(doctorId, durationMinutes) {
  const { workDays } = config.clinic;
  for (let i = 1; i <= 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (!workDays.includes(d.getDay())) continue;

    const dateStr = toDateStr(d);
    const slots   = await getAvailableSlots(doctorId, dateStr, durationMinutes);
    if (slots.length > 0) return { date: dateStr, slot: slots[0] };
  }
  return null;
}

// For "any doctor" — pick the non-senior doctor with the soonest availability
async function findBestDoctor(durationMinutes) {
  const nonSenior = config.doctors.filter(d => !d.senior);
  let best = null, bestDate = null;

  for (const doc of nonSenior) {
    const result = await findSoonestSlot(doc.id, durationMinutes);
    if (!result) continue;
    if (!bestDate || result.date < bestDate) {
      bestDate = result.date;
      best     = { doctor: doc, date: result.date, slot: result.slot };
    }
  }
  return best;
}

function toDateStr(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatTime(date) {
  // Convert UTC date to Bahrain time string HH:MM
  const bh = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${String(bh.getUTCHours()).padStart(2, '0')}:${String(bh.getUTCMinutes()).padStart(2, '0')}`;
}

function formatTimeDisplay(date, isAr) {
  // Convert UTC date to Bahrain clock time
  const bh  = new Date(date.getTime() + 3 * 60 * 60 * 1000);
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

async function createAppointment({ patientName, patientPhone, doctorId, doctorName, date, time, procedure, patientInfo }) {
  const calendar = getCalendarClient();
  const doctor   = config.doctors.find(d => d.id === doctorId);
  const duration = procedure?.duration || 30;

  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute]     = time.split(':').map(Number);

  // Create start time in Bahrain timezone
  const startTime = bhDate(year, month, day, hour, minute);
  const endTime   = new Date(startTime.getTime() + duration * 60000);

  console.log(`📆 Creating appointment: ${date} ${time} BH time → UTC: ${startTime.toISOString()}`);

  const event = {
    summary:     `🦷 ${patientName} - ${procedure?.name_en || ''}`,
    description: [
      `👤 Name: ${patientName}`,
      `📞 Phone: +${patientPhone}`,
      `🪪 CPR: ${patientInfo?.cpr || '-'}`,
      `🎂 DOB: ${patientInfo?.dob || '-'}`,
      `🌍 Nationality: ${patientInfo?.nationality || '-'}`,
      `👨‍⚕️ Doctor: ${doctorName}`,
      `🦷 Procedure: ${procedure?.name_en || '-'}`,
      `⏱ Duration: ${duration} min`,
    ].join('\n'),
    start:       { dateTime: startTime.toISOString(), timeZone: TZ },
    end:         { dateTime: endTime.toISOString(),   timeZone: TZ },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60       },
      ],
    },
  };

  try {
    const res = await calendar.events.insert({
      calendarId: doctor?.calendarId || process.env.GOOGLE_CALENDAR_ID,
      resource:   event,
    });
    return { success: true, eventId: res.data.id };
  } catch (err) {
    console.error('createAppointment error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  createAppointment,
  getAvailableSlots,
  getAvailableDates,
  findSoonestSlot,
  findBestDoctor,
  findNextAppointment,
  formatTime,
  formatTimeDisplay,
};

// Find next appointment for a patient by their phone number
async function findNextAppointment(patientPhone) {
  const calendar = getCalendarClient();
  const now      = new Date();
  const future   = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  let   soonest  = null;

  for (const doctor of config.doctors) {
    try {
      const res = await calendar.events.list({
        calendarId:   doctor.calendarId,
        timeMin:      now.toISOString(),
        timeMax:      future.toISOString(),
        singleEvents: true,
        orderBy:      'startTime',
      });

      for (const event of (res.data.items || [])) {
        if (!event.start?.dateTime) continue;
        const desc  = event.description || '';
        const phone = desc.match(/📞 Phone:\s*\+?(\d+)/)?.[1] || desc.match(/Phone:\s*\+?(\d+)/)?.[1];
        if (phone && patientPhone.endsWith(phone.slice(-8))) {
          if (!soonest || new Date(event.start.dateTime) < new Date(soonest.start.dateTime)) {
            soonest = { event, doctor };
          }
        }
      }
    } catch (err) {
      console.error(`findNextAppointment error for ${doctor.name_en}:`, err.message);
    }
  }
  return soonest;
}
