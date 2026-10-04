/**
 * Quizz In theme board.
 * Bound to the Google Sheet. Friends only ever open the web app URL.
 * @OnlyCurrentDoc
 *
 * Change HOST_PIN before you deploy. A value in Config!hostPin overrides it.
 */
var HOST_PIN = '1234';

var THEME_MAX = 28;
var DISPLAY_MAX = 32;
var INVITE_MAX = 40;
var HEADERS = ['id', 'inviteName', 'displayName', 'coming', 'theme', 'updatedAt'];
var COMING = ['in', 'out', 'unsure'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Quizz In')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Quizz In').addItem('Prepare sheets', 'setup').addToUi();
}

function setup() {
  ensure_();
}

function getBoard() {
  return withLock_(function () {
    return board_(ensure_());
  });
}

function savePlayer(id, displayName, coming, theme) {
  return withLock_(function () {
    var ctx = ensure_();
    var lockAt = lockAt_(ctx.config);
    if (isLockedDate_(today_(), lockAt)) throw new Error('The board is locked.');

    var players = readPlayers_(ctx.players);
    var found = findPlayer_(players, id);
    if (!found) throw new Error('That person is no longer on the list.');

    var next = {
      displayName: cleanName_(displayName, DISPLAY_MAX, 'Name'),
      coming: cleanComing_(coming),
      theme: cleanTheme_(theme),
    };
    if (!next.displayName) throw new Error('Enter a name.');

    writePlayer_(ctx.players, found.row, {
      id: found.id,
      inviteName: found.inviteName,
      displayName: next.displayName,
      coming: next.coming,
      theme: next.theme,
    });
    return board_(ctx);
  });
}

function hostUnlock(pin) {
  return withLock_(function () {
    var ctx = ensure_();
    assertPin_(ctx.config, pin);
    return board_(ctx);
  });
}

function hostAdd(pin, inviteName) {
  return withLock_(function () {
    var ctx = ensure_();
    assertPin_(ctx.config, pin);
    var name = cleanName_(inviteName, INVITE_MAX, 'Name');
    if (!name) throw new Error('Enter the name you know them by.');

    var players = readPlayers_(ctx.players);
    var key = nameKey_(name);
    for (var i = 0; i < players.length; i++) {
      if (nameKey_(players[i].inviteName) === key) {
        throw new Error(name + ' is already on the list.');
      }
    }

    var display = name.length > DISPLAY_MAX ? name.slice(0, DISPLAY_MAX) : name;
    ctx.players.appendRow([Utilities.getUuid(), cell_(name), cell_(display), 'unsure', '', stamp_()]);
    return board_(ctx);
  });
}

function hostRemove(pin, id) {
  return withLock_(function () {
    var ctx = ensure_();
    assertPin_(ctx.config, pin);
    var found = findPlayer_(readPlayers_(ctx.players), id);
    if (!found) throw new Error('That person is no longer on the list.');
    ctx.players.deleteRow(found.row);
    return board_(ctx);
  });
}

function hostSetLock(pin, lockAt) {
  return withLock_(function () {
    var ctx = ensure_();
    assertPin_(ctx.config, pin);
    var next = String(lockAt || '').trim();
    if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new Error('Enter a lock date.');
    setConfig_(ctx.config, 'lockAt', next);
    return board_(ctx);
  });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function ensure_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Open the script from the Google Sheet (Extensions → Apps Script), then deploy it again.');
  }

  var players = ss.getSheetByName('Players');
  if (!players) {
    players = ss.insertSheet('Players');
    players.appendRow(HEADERS);
    players.setFrozenRows(1);
    players.getRange('A:F').setNumberFormat('@');
  }

  var config = ss.getSheetByName('Config');
  if (!config) {
    config = ss.insertSheet('Config');
    config.appendRow(['key', 'value']);
    config.appendRow(['lockAt', '']);
    config.appendRow(['hostPin', '']);
    config.setFrozenRows(1);
    config.getRange('A:B').setNumberFormat('@');
  }
  return { players: players, config: config };
}

function board_(ctx) {
  var lockAt = lockAt_(ctx.config);
  return {
    locked: isLockedDate_(today_(), lockAt),
    lockAt: lockAt,
    players: readPlayers_(ctx.players).map(function (p) {
      return {
        id: p.id,
        inviteName: p.inviteName,
        displayName: p.displayName || p.inviteName,
        coming: p.coming,
        theme: p.theme,
      };
    }),
  };
}

function readPlayers_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var header = values[0].map(function (h) {
    return String(h).trim();
  });
  for (var c = 0; c < HEADERS.length; c++) {
    if (header[c] !== HEADERS[c]) {
      throw new Error('Players headers were changed. Put this in row 1: ' + HEADERS.join(', '));
    }
  }
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (!id) continue;
    out.push({
      row: i + 1,
      id: id,
      inviteName: String(values[i][1] || '').trim(),
      displayName: String(values[i][2] || '').trim(),
      coming: normalizeComing_(values[i][3]),
      theme: String(values[i][4] || '').replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

function writePlayer_(sheet, row, p) {
  sheet.getRange(row, 1, 1, 6).setValues([[
    p.id,
    cell_(p.inviteName),
    cell_(p.displayName),
    p.coming,
    cell_(p.theme),
    stamp_(),
  ]]);
}

function findPlayer_(players, id) {
  var wanted = String(id || '');
  for (var i = 0; i < players.length; i++) if (players[i].id === wanted) return players[i];
  return null;
}

function lockAt_(config) {
  return asDateString_(getConfig_(config, 'lockAt'));
}

function getConfig_(sheet, key) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) return values[i][1];
  }
  return '';
}

function setConfig_(sheet, key, value) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function assertPin_(config, pin) {
  var fromSheet = String(getConfig_(config, 'hostPin') || '').trim();
  var expected = fromSheet || String(HOST_PIN || '').trim();
  if (!expected || String(pin || '') !== expected) throw new Error('Wrong host PIN.');
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function asDateString_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/** Locked the day after lockAt. The lock date itself stays editable. */
function isLockedDate_(today, lockAt) {
  return Boolean(lockAt) && today > lockAt;
}

function cleanName_(value, max, label) {
  var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new Error(label + ' must be ' + max + ' characters or fewer.');
  return s;
}

function cleanTheme_(value) {
  var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (s.length > THEME_MAX) throw new Error('A theme must be ' + THEME_MAX + ' characters or fewer.');
  return s;
}

function cleanComing_(value) {
  var s = String(value || '').trim();
  if (COMING.indexOf(s) === -1) throw new Error('Pick whether you are coming.');
  return s;
}

function normalizeComing_(value) {
  var s = String(value || '').trim();
  return COMING.indexOf(s) === -1 ? 'unsure' : s;
}

function nameKey_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Sheets treats a leading = + - or @ as a formula. */
function cell_(value) {
  var s = String(value == null ? '' : value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
