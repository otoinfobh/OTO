const userStates = new Map();

const STATE = {
  IDLE: 'IDLE',
  BOOKING_NAME: 'BOOKING_NAME',
  BOOKING_DOCTOR: 'BOOKING_DOCTOR',
  BOOKING_DATE: 'BOOKING_DATE',
  BOOKING_TIME: 'BOOKING_TIME',
  BOOKING_CONFIRM: 'BOOKING_CONFIRM',
  REGISTRATION: 'REGISTRATION',
  AWAITING_CPR_IMAGE: 'AWAITING_CPR_IMAGE',
};

function getState(userId) {
  return userStates.get(userId) || { state: STATE.IDLE, lang: 'ar', data: {} };
}

function setState(userId, stateData) {
  userStates.set(userId, stateData);
}

function clearState(userId) {
  const current = getState(userId);
  userStates.set(userId, { state: STATE.IDLE, lang: current.lang, data: {} });
}

module.exports = { getState, setState, clearState, STATE };
