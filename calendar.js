const { google } = require('googleapis');
const config     = require('./config');

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

// Returns all booked slots for a doctor on a given date (YYYY-MM-DD)
// Each slot: { start: Date, end: Date }
async function getBookedSlots(doctorId, date) {
  const calendar = getCalendarClient();
  const doctor   = config.doctors.find(d => d.id === doctorId);
  if (!doctor) return [];

  const [y, m, d] = date.split('-').map(Number);
  const dayStart  = new Date(y, m - 1, d, 0, 0, 0);
  const dayEnd    = new Date(y, m - 1, d, 23, 59, 59);

  try {
    const res = await calendar.events.list({
      calendarId:   process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeMin:      dayStart.toISOString(),
      timeMax:      dayEnd.toISOString(),
      singleEvents: true,
      orderBy:      'startTime',
      q:            doctor.name_en, // filter by doctor name in event title
    });

    return (res.data.items || [])
      .filter(e => e.start?.dateTime)
      .map(e => ({
        start: new Date(e.start.dateTime),
        end:   new Date(e.end.dateTime),
      }));
  } catch (err) {
    console.error('getBookedSlots error:', err.message);
    return [];
  }
}

// Returns available time slots for a doctor on a date, given procedure duration
async function getAvailableSlots(doctorId, date, durationMinutes) {
  const booked    = await getBookedSlots(doctorId, date);
  const [y, m, d] = date.split('-').map(Number);
  const slots     = [];

  const { startHour, endHour } = config.clinic;
  let cursor = new Date(y, m - 1, d, startHour, 0, 0);
  const end  = new Date(y, m - 1, d, endHour, 0, 0);

  while (cursor < end) {
    const slotEnd = new Date(cursor.getTime() + durationMinutes * 60000);
    if (slotEnd > end) break;

    // Check overlap with any booked event
    const blocked = booked.some(b => cursor < b.end && slotEnd > b.start);
    if (!blocked) {
      slots.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 30 * 60000); // advance 30 min
  }

  return slots;
}

// Returns the first available date+time for a doctor within 30 days
async function findSoonestSlot(doctorId, durationMinutes) {
  const { workDays } = config.clinic;
  for (let i = 1; i <= 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (!workDays.includes(d.getDay())) continue;

    const dateStr = toDateStr(d);
    const slots   = await getAvailableSlots(doctorId, dateStr, durationMinutes);
    if (slots.length > 0) {
      return { date: dateStr, slot: slots[0] };
    }
  }
  return null;
}

// Returns dates that have at least one free slot within next 30 days
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
    if (dates.length >= 10) break; // max 10 dates to show
  }
  return dates;
}

// For "any doctor" — pick doctor with most availability on soonest date
async function findBestDoctor(durationMinutes) {
  const nonSenior = config.doctors.filter(d => !d.senior);
  let best = null, bestCount = -1;

  for (const doc of nonSenior) {
    const result = await findSoonestSlot(doc.id, durationMinutes);
    if (!result) continue;
    const slots = await getAvailableSlots(doc.id, result.date, durationMinutes);
    if (slots.length > bestCount) {
      bestCount = slots.length;
      best      = { doctor: doc, date: result.date, slot: result.slot };
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
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTimeDisplay(date, isAr) {
  let h = date.getHours(), m = date.getMinutes();
  const mins = m === 0 ? '٠٠' : String(m).padStart(2, '0');
  if (isAr) {
    const arabicNums = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    const toAr = n => String(n).split('').map(d => arabicNums[d] || d).join('');
    const period = h < 12 ? 'صباحاً' : 'مساءً';
    const h12    = h % 12 || 12;
    return `${toAr(h12)}:${toAr(m).padStart(2,'٠')} ${period}`;
  } else {
    const period = h < 12 ? 'AM' : 'PM';
    const h12    = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${period}`;
  }
}

async function createAppointment({ patientName, patientPhone, doctorName, date, time, procedure }) {
  const calendar = getCalendarClient();
  const duration = procedure?.duration || 30;

  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute]     = time.split(':').map(Number);

  const startTime = new Date(year, month - 1, day, hour, minute || 0);
  const endTime   = new Date(startTime.getTime() + duration * 60000);

  const procName = procedure ? ` - ${procedure.name_en}` : '';
  const event = {
    summary:     `🦷 ${patientName} - ${doctorName}${procName}`,
    description: `Patient: ${patientName}\nPhone: +${patientPhone}\nDoctor: ${doctorName}\nProcedure: ${procedure?.name_en || '-'}\nDuration: ${duration} min`,
    start:       { dateTime: startTime.toISOString(), timeZone: TZ },
    end:         { dateTime: endTime.toISOString(),   timeZone: TZ },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email',  minutes: 24 * 60 },
        { method: 'popup',  minutes: 60       },
      ],
    },
  };

  try {
    const res = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      resource:   event,
    });
    return { success: true, eventId: res.data.id };
  } catch (err) {
    console.error('Calendar createAppointment error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  createAppointment,
  getAvailableSlots,
  getAvailableDates,
  findSoonestSlot,
  findBestDoctor,
  formatTime,
  formatTimeDisplay,
};
