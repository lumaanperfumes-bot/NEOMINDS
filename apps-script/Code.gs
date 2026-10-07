const SETTINGS = {
  spreadsheetName: 'NeoMinds Tech Hub Requests',
  sheets: {
    contact: 'Contact requests',
    ambassador: 'Ambassador applications'
  },
  username: 'neominds',
  password: 'neominds@hyd',
  sessionSeconds: 21600
};

const COLUMNS = ['Request ID', 'Submitted At', 'Name', 'Email', 'Phone', 'College', 'Program', 'Message', 'Status', 'Last Reply', 'Replied At'];

function setupNeoMindsBackend() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  let spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(SETTINGS.spreadsheetName);
    spreadsheetId = spreadsheet.getId();
    properties.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  Object.values(SETTINGS.sheets).forEach(name => {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(COLUMNS);
      sheet.setFrozenRows(1);
    }
  });

  const salt = properties.getProperty('ADMIN_SALT') || Utilities.getUuid();
  properties.setProperties({
    ADMIN_USERNAME: properties.getProperty('ADMIN_USERNAME') || SETTINGS.username,
    ADMIN_SALT: salt,
    ADMIN_PASSWORD_HASH: properties.getProperty('ADMIN_PASSWORD_HASH') || passwordHash_(SETTINGS.password, salt)
  });

  return { spreadsheetUrl: spreadsheet.getUrl() };
}

function resetAdminCredentials() {
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    ADMIN_USERNAME: SETTINGS.username,
    ADMIN_SALT: salt,
    ADMIN_PASSWORD_HASH: passwordHash_(SETTINGS.password, salt)
  });
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle('NeoMinds Admin Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const requestData = JSON.parse(e.postData.contents);
    const result = saveRequest_(requestData);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function processBridgeRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('Invalid request.');

  switch (request.action) {
    case 'submit':
      return saveRequest_(request);
    case 'login':
      return login_(request);
    case 'list':
      requireSession_(request.token);
      return listRequests_();
    case 'reply':
      requireSession_(request.token);
      return sendReply_(request);
    case 'logout':
      CacheService.getScriptCache().remove('session:' + String(request.token || ''));
      return { ok: true };
    default:
      throw new Error('Unknown request.');
  }
}

function saveRequest_(request) {
  if (request.website) return { ok: true, emailSent: true };

  const type = request.type === 'ambassador' ? 'ambassador' : 'contact';
  const name = clean_(request.name, 120);
  const email = clean_(request.email, 254).toLowerCase();
  const phone = clean_(request.phone, 40);
  const college = clean_(request.college, 200);
  const program = clean_(request.program, 160);
  const message = clean_(request.message, 5000);
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please check your name, email, and message.');
  }
  if (type === 'ambassador' && !college) throw new Error('Please enter your college.');

  const sheet = getSheet_(type);
  const id = Utilities.getUuid();
  const submittedAt = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.appendRow([id, submittedAt, safeCell_(name), safeCell_(email), safeCell_(phone), safeCell_(college), safeCell_(program), safeCell_(message), 'New', '', '']);
  } finally {
    lock.releaseLock();
  }

  let emailSent = false;
  try {
    const subject = type === 'ambassador' ? 'We received your NeoMinds ambassador application' : 'We received your message to NeoMinds';
    const body = `Hi ${name},\n\n${type === 'ambassador' ? 'Your campus ambassador application' : 'Your message'} has been received by NeoMinds Tech Hub. Our team will review it and get back to you soon.\n\nRegards,\nNeoMinds Tech Hub`;
    MailApp.sendEmail({ to: email, subject: subject, body: body, name: 'NeoMinds Tech Hub' });
    emailSent = true;
  } catch (error) {
    console.error('Receipt email failed for request %s: %s', id, error.message);
  }

  return { ok: true, emailSent: emailSent };
}

function login_(request) {
  const properties = PropertiesService.getScriptProperties();
  const salt = properties.getProperty('ADMIN_SALT');
  const username = String(request.username || '');
  const password = String(request.password || '');
  if (!salt || username !== properties.getProperty('ADMIN_USERNAME') || passwordHash_(password, salt) !== properties.getProperty('ADMIN_PASSWORD_HASH')) {
    throw new Error('Username or password is incorrect.');
  }

  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, 'admin', SETTINGS.sessionSeconds);
  return { ok: true, token: token };
}

function listRequests_() {
  const requests = [];
  Object.entries(SETTINGS.sheets).forEach(([type, sheetName]) => {
    const sheet = getSpreadsheet_().getSheetByName(sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const rows = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
    rows.forEach(row => requests.push({
      id: row[0],
      submittedAt: row[1] instanceof Date ? row[1].toISOString() : String(row[1]),
      name: row[2],
      email: row[3],
      phone: row[4],
      college: row[5],
      program: row[6],
      message: row[7],
      status: row[8],
      lastReply: row[9],
      repliedAt: row[10] instanceof Date ? row[10].toISOString() : String(row[10]),
      type: type
    }));
  });
  return requests.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, 250);
}

function sendReply_(request) {
  const id = clean_(request.id, 80);
  const body = clean_(request.message, 8000);
  if (!id || !body) throw new Error('Choose a request and enter a message.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    for (const [type] of Object.entries(SETTINGS.sheets)) {
      const sheet = getSheet_(type);
      const found = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
        .createTextFinder(id).matchEntireCell(true).findNext();
      if (!found) continue;
      const row = found.getRow();
      const values = sheet.getRange(row, 1, 1, COLUMNS.length).getValues()[0];
      MailApp.sendEmail({
        to: values[3],
        subject: 'A reply from NeoMinds Tech Hub',
        body: `Hi ${values[2]},\n\n${body}\n\nRegards,\nNeoMinds Tech Hub`,
        name: 'NeoMinds Tech Hub'
      });
      sheet.getRange(row, 9, 1, 3).setValues([['Replied', safeCell_(body), new Date()]]);
      return { ok: true };
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error('That request could not be found. Refresh the dashboard and try again.');
}

function requireSession_(token) {
  if (!token || CacheService.getScriptCache().get('session:' + String(token)) !== 'admin') {
    throw new Error('Your admin session expired. Please sign in again.');
  }
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Backend is not initialized. Run setupNeoMindsBackend first.');
  return SpreadsheetApp.openById(id);
}

function getSheet_(type) {
  const name = SETTINGS.sheets[type];
  if (!name) throw new Error('Invalid request type.');
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('A request sheet is missing. Run setupNeoMindsBackend again.');
  return sheet;
}

function clean_(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeCell_(value) {
  const text = String(value || '');
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function passwordHash_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}