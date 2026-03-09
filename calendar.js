const { google } = require('googleapis');

function getCalendarClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/calendar']
  );
  return google.calendar({ version: 'v3', auth });
}

async function createAppointment({ patientName, patientPhone, doctorName, date, time }) {
  const calendar = getCalendarClient();

  const [year, month, day] = date.split('-');
  const [hour, minute] = time.split(':');

  const startTime = new Date(year, month - 1, day, parseInt(hour), parseInt(minute || 0));
  const endTime = new Date(startTime.getTime() + 30 * 60000); // 30 min slot

  const event = {
    summary: `🦷 ${patientName} - ${doctorName}`,
    description: `Patient: ${patientName}\nPhone: +${patientPhone}\nDoctor: ${doctorName}`,
    start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Bahrain' },
    end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Bahrain' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
      ],
    },
  };

  try {
    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      resource: event,
    });
    return { success: true, eventId: response.data.id };
  } catch (error) {
    console.error('Calendar error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { createAppointment };
