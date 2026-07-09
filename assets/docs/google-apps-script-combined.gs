/**
 * Google Apps Script — Combined Portfolio API
 * Handles Projects, Reviews, and Contact Form in a single deployment.
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Go to Google Sheets (https://sheets.google.com) and create a new spreadsheet
 * 2. Name it "Portfolio" (or any name you prefer)
 * 3. The script will auto-create sheet tabs (Projects, Reviews, Contacts) on first use
 * 4. Go to Extensions > Apps Script (this binds the script to this spreadsheet,
 *    so no Sheet ID needs to be configured — see CONFIGURATION below)
 * 5. Delete any existing code and paste this entire script
 * 6. Click "Deploy" > "New deployment"
 * 7. Select type: "Web app"
 * 8. Set "Execute as": "Me"
 * 9. Set "Who has access": "Anyone"
 * 10. Click "Deploy" and authorize when prompted
 * 11. Copy the Web App URL
 * 12. Paste the URL in your portfolio-data.json under "sheetURL"
 *
 * IMPORTANT: After making changes, you must create a NEW deployment for changes to take effect.
 *
 * API ROUTING:
 *   GET  ?type=projects                 → Returns all projects
 *   GET  ?type=reviews                  → Returns approved reviews only
 *   GET  ?type=reviews&mode=all&token=  → Returns ALL reviews (admin, requires token)
 *   GET  ?type=contacts&token=          → Returns all contacts (admin, requires token)
 *   GET  (no type)                      → Health check
 *
 *   POST { type: "auth", action: "login", password: "..." }
 *     → { status: "success", token: "..." } or { status: "error", message: "..." }
 *
 *   POST { type: "projects", action: "add"|"update"|"delete", project: {...}, token: "..." }
 *   POST { type: "reviews",  action: "add", review: {...} }                      (public)
 *   POST { type: "reviews",  action: "update"|"delete", review: {...}, token: "..." }
 *   POST { type: "contacts", name, email, service, message, timestamp }         (public)
 *   POST { type: "contacts", action: "update"|"delete", contact: {...}, token: "..." }
 *
 * SHEET TABS:
 *   Projects  → id | title | category | year | description | image | aspect
 *   Reviews   → id | name | email | role | rating | quote | image | featured | approved | timestamp
 *   Contacts  → id | Timestamp | Name | Email | Service | Message | Read | Replied
 *   Password  → username | password  (base64-encoded — not exposed via any GET route)
 *
 * ADMIN AUTH:
 *   The Password tab and its first row (username "admin", password
 *   "admin123") are created automatically the first time this script runs —
 *   nothing to set up before deploying. Open the sheet afterward and replace
 *   that row's password with your own base64-encoded value (e.g. run
 *   btoa("yourPassword") in any browser console, or use an online base64
 *   encoder, and paste the result in) — do this before the deployment URL is
 *   shared anywhere, since "admin123" is a well-known default.
 *   NOTE: base64 is an encoding, not encryption — anyone who can open this
 *   sheet can decode it back to plaintext with atob(). It's only as private
 *   as the sheet's sharing settings; the Password tab itself is never
 *   exposed through any GET/POST route.
 *
 *   admin.html POSTs the plaintext password over HTTPS to this script, which
 *   base64-decodes the stored value and compares it, then hands back a
 *   signed, time-limited session token (signed with a secret kept in this
 *   script's Properties, not the sheet — fast to check and never visible to
 *   anyone opening the spreadsheet). That token (not the password) is what
 *   admin.html sends with every admin-only request afterward; requireAuth()
 *   verifies its signature and expiry before any contact/review/project data
 *   is read or changed.
 *
 * WRITE SAFETY:
 *   All POST requests acquire a script lock before touching the sheet, so two
 *   near-simultaneous submissions (e.g. two visitors submitting a review at
 *   once) can't interleave and corrupt row indices or clobber each other's
 *   writes. Untrusted text fields are also sanitized so a value like
 *   "=IMPORTXML(...)" typed into the contact form can't turn into a live
 *   formula when it lands in the sheet (spreadsheet formula injection).
 */

// ==========================================
// CONFIGURATION
// ==========================================
// No Sheet ID needed: this script must be created via the spreadsheet's own
// Extensions > Apps Script menu, which binds it to that spreadsheet so
// SpreadsheetApp.getActiveSpreadsheet() always resolves to it — even when run
// from a time-driven trigger or the web app, not just from the editor.
var LOCK_TIMEOUT_MS = 10000;
var SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour — keep in sync with SESSION_TIMEOUT in admin.html

// ==========================================
// HELPERS
// ==========================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Coerces to a trimmed string and neutralizes leading =, +, -, @ so Sheets
 * can't interpret user-supplied text (name, message, quote, etc.) as a formula.
 */
function sanitizeText(value) {
  var str = (value === undefined || value === null) ? '' : String(value).trim();
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'No bound spreadsheet found. This script must be created via ' +
      'Extensions > Apps Script from inside the target Google Sheet, ' +
      'not as a standalone script.'
    );
  }
  return ss;
}

function getOrCreateSheet(name, headers, columnWidths) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    // Format header row
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#FF4500');
    headerRange.setFontColor('#000000');
    // Set column widths if provided
    if (columnWidths) {
      for (var i = 0; i < columnWidths.length; i++) {
        sheet.setColumnWidth(i + 1, columnWidths[i]);
      }
    }
  }

  // Ensure headers exist on empty sheet
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

// ==========================================================================
//  ADMIN AUTH
// ==========================================================================

function toHex(bytes) {
  return bytes.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// Auto-generates and persists the HMAC secret used to sign session tokens —
// nothing to run manually, it just initializes itself on first login. Lives
// in Script Properties rather than a sheet: it's a fast, local key-value
// store (no spreadsheet round-trip), so it doesn't add latency to every
// single login and every admin-gated request the way a sheet read/write would.
function getTokenSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('tokenSecret');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('tokenSecret', secret);
  }
  return secret;
}

function signToken(expiry, secret) {
  return toHex(Utilities.computeHmacSha256Signature(String(expiry), secret));
}

function createSessionToken() {
  var secret = getTokenSecret();
  var expiry = Date.now() + SESSION_DURATION_MS;
  return expiry + '.' + signToken(expiry, secret);
}

function isValidToken(token) {
  if (!token || token.indexOf('.') === -1) return false;

  var parts = token.split('.');
  var expiry = Number(parts[0]);
  if (!expiry || Date.now() > expiry) return false;

  return signToken(expiry, getTokenSecret()) === parts[1];
}

/**
 * Returns an error response if the token is missing/invalid/expired, or null
 * if the caller is authorized to proceed.
 */
function requireAuth(token) {
  if (!isValidToken(token)) {
    return jsonResponse({ status: 'error', message: 'Unauthorized' });
  }
  return null;
}

var PASSWORD_HEADERS = ['username', 'password'];
var PASSWORD_WIDTHS  = [200, 300];
var DEFAULT_ADMIN_PASSWORD = 'admin123';

function getPasswordSheet() {
  var sheet = getOrCreateSheet('Password', PASSWORD_HEADERS, PASSWORD_WIDTHS);

  // First time this tab is created, seed a default login so the dashboard
  // works immediately — open the sheet and change this row to your own
  // base64-encoded password as soon as possible.
  if (sheet.getLastRow() <= 1) {
    sheet.appendRow(['admin', Utilities.base64Encode(DEFAULT_ADMIN_PASSWORD)]);
  }

  return sheet;
}

function base64Decode(value) {
  try {
    return Utilities.newBlob(Utilities.base64Decode(String(value))).getDataAsString();
  } catch (e) {
    return '';
  }
}

function handleAuth(body) {
  var action = body.action || 'login';
  if (action !== 'login') {
    return jsonResponse({ status: 'error', message: 'Invalid action: ' + action });
  }

  var sheet = getPasswordSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var userCol = headers.indexOf('username');
  var passCol = headers.indexOf('password');

  var username = String(body.username || 'admin').trim();
  var submittedPassword = String(body.password || '');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][userCol]).trim() === username) {
      var storedPassword = base64Decode(data[i][passCol]);
      if (storedPassword && storedPassword === submittedPassword) {
        return jsonResponse({ status: 'success', token: createSessionToken() });
      }
      return jsonResponse({ status: 'error', message: 'Invalid username or password' });
    }
  }

  return jsonResponse({ status: 'error', message: 'No matching username in the Password tab.' });
}

// ==========================================
// MAIN ROUTER — GET
// ==========================================
function doGet(e) {
  try {
    var type = (e && e.parameter && e.parameter.type) ? e.parameter.type : '';

    if (type === 'projects') return getProjects();
    if (type === 'reviews')  return getReviews(e);
    if (type === 'contacts') return getContacts(e);

    // Default: health check
    return jsonResponse({ status: 'ok', message: 'Portfolio API is running' });
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() });
  }
}

// ==========================================
// MAIN ROUTER — POST
// ==========================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var type = body.type || '';

    // Auth is a read-only credential lookup (it never touches Projects,
    // Reviews, or Contacts), so it skips the write lock below — logging in
    // shouldn't have to queue behind an unrelated contact/review submission
    // that's mid-write.
    if (type === 'auth') return handleAuth(body);

    if (type !== 'projects' && type !== 'reviews' && type !== 'contacts') {
      return jsonResponse({ status: 'error', message: 'Unknown type: ' + type });
    }

    // Writes are serialized with a script lock so concurrent submissions
    // can't interleave (e.g. two deletes racing and shifting row indices out
    // from under each other).
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(LOCK_TIMEOUT_MS);
    } catch (lockError) {
      return jsonResponse({ status: 'error', message: 'Server is busy, please try again' });
    }

    try {
      if (type === 'projects') return handleProject(body);
      if (type === 'reviews')  return handleReview(body);
      if (type === 'contacts') return handleContact(body);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.toString() });
  }
}


// ==========================================================================
//  PROJECTS
// ==========================================================================

var PROJECTS_HEADERS = ['id', 'title', 'category', 'year', 'description', 'image', 'aspect'];
var PROJECTS_WIDTHS  = [150, 200, 120, 70, 400, 250, 80];

function getProjectsSheet() {
  return getOrCreateSheet('Projects', PROJECTS_HEADERS, PROJECTS_WIDTHS);
}

/**
 * GET — return all projects
 */
function getProjects() {
  var sheet = getProjectsSheet();

  if (sheet.getLastRow() <= 1) {
    return jsonResponse({ status: 'success', projects: [] });
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var projects = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue; // skip empty rows

    var project = {};
    for (var j = 0; j < headers.length; j++) {
      project[headers[j]] = row[j] ? row[j].toString() : '';
    }
    projects.push(project);
  }

  return jsonResponse({ status: 'success', projects: projects });
}

/**
 * POST — add, update, or delete a project
 */
function handleProject(body) {
  var authError = requireAuth(body.token);
  if (authError) return authError;

  var action = body.action || 'add';
  var project = body.project || {};
  var sheet = getProjectsSheet();

  if (action === 'add') {
    if (!sanitizeText(project.title)) {
      return jsonResponse({ status: 'error', message: 'Project title is required' });
    }

    var id = project.id || 'project_' + Date.now();
    sheet.appendRow([
      id,
      sanitizeText(project.title),
      sanitizeText(project.category),
      sanitizeText(project.year) || new Date().getFullYear().toString(),
      sanitizeText(project.description),
      sanitizeText(project.image),
      sanitizeText(project.aspect) || '1/1'
    ]);
    return jsonResponse({ status: 'success', message: 'Project added', id: id });
  }

  if (action === 'update') {
    if (!project.id) return jsonResponse({ status: 'error', message: 'Project ID required' });

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(project.id)) {
        var row = i + 1;
        sheet.getRange(row, 1, 1, 7).setValues([[
          project.id,
          project.title ? sanitizeText(project.title) : data[i][1],
          project.category ? sanitizeText(project.category) : data[i][2],
          project.year ? sanitizeText(project.year) : data[i][3],
          project.description ? sanitizeText(project.description) : data[i][4],
          project.image ? sanitizeText(project.image) : data[i][5],
          project.aspect ? sanitizeText(project.aspect) : data[i][6]
        ]]);
        return jsonResponse({ status: 'success', message: 'Project updated' });
      }
    }
    return jsonResponse({ status: 'error', message: 'Project not found' });
  }

  if (action === 'delete') {
    if (!project.id) return jsonResponse({ status: 'error', message: 'Project ID required' });

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(project.id)) {
        sheet.deleteRow(i + 1);
        return jsonResponse({ status: 'success', message: 'Project deleted' });
      }
    }
    return jsonResponse({ status: 'error', message: 'Project not found' });
  }

  return jsonResponse({ status: 'error', message: 'Invalid action: ' + action });
}


// ==========================================================================
//  REVIEWS
// ==========================================================================

var REVIEWS_HEADERS = ['id', 'name', 'email', 'role', 'rating', 'quote', 'image', 'featured', 'approved', 'timestamp'];
var REVIEWS_WIDTHS  = [150, 150, 200, 180, 70, 400, 250, 80, 80, 180];

function getReviewsSheet() {
  return getOrCreateSheet('Reviews', REVIEWS_HEADERS, REVIEWS_WIDTHS);
}

/**
 * GET — return reviews
 * ?mode=all  → all reviews (for admin)
 * default    → approved reviews only (for portfolio)
 */
function getReviews(e) {
  var mode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode : '';

  if (mode === 'all') {
    var authError = requireAuth(e && e.parameter && e.parameter.token);
    if (authError) return authError;
  }

  var sheet = getReviewsSheet();

  if (sheet.getLastRow() <= 1) {
    return jsonResponse({ status: 'success', reviews: [] });
  }

  var data = sheet.getDataRange().getValues();
  // Normalize headers the same way getProjects does, so a stray space or
  // differently-cased header typed directly into the sheet doesn't silently
  // break lookups like review.approved / review.featured below.
  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var reviews = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue; // skip empty rows

    var review = {};
    for (var j = 0; j < headers.length; j++) {
      review[headers[j]] = row[j];
    }

    var approved = String(review.approved).toUpperCase();
    var isApproved = (approved === 'TRUE' || approved === 'YES');

    if (mode === 'all' || isApproved) {
      reviews.push({
        id: String(review.id),
        name: String(review.name),
        email: String(review.email || ''),
        role: String(review.role),
        rating: Number(review.rating) || 5,
        quote: String(review.quote),
        image: String(review.image),
        featured: String(review.featured).toUpperCase() === 'TRUE',
        approved: isApproved,
        timestamp: String(review.timestamp)
      });
    }
  }

  return jsonResponse({ status: 'success', reviews: reviews });
}

/**
 * POST — add, update, or delete a review
 */
function handleReview(body) {
  var action = body.action || 'add';

  // Adding a review is the public review-form flow; only moderating
  // (approve/feature/delete) is admin-only.
  if (action === 'update' || action === 'delete') {
    var authError = requireAuth(body.token);
    if (authError) return authError;
  }

  var review = body.review || {};
  var sheet = getReviewsSheet();

  if (action === 'add') {
    var name = sanitizeText(review.name);
    var quote = sanitizeText(review.quote);
    if (!name || !quote) {
      return jsonResponse({ status: 'error', message: 'Name and review text are required' });
    }

    // Check for duplicate email
    var email = sanitizeText(review.email).toLowerCase();
    if (email) {
      var data = sheet.getDataRange().getValues();
      var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
      var emailCol = headers.indexOf('email');
      if (emailCol !== -1) {
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][emailCol]).trim().toLowerCase() === email) {
            return jsonResponse({ status: 'error', message: 'A review from this email already exists' });
          }
        }
      }
    }

    var imageValue = sanitizeText(review.imageData || review.image || '');

    sheet.appendRow([
      review.id || 'review_' + Date.now(),
      name,
      email,
      sanitizeText(review.role),
      Number(review.rating) || 5,
      quote,
      imageValue,
      review.featured || false,
      review.approved || false,
      review.timestamp || new Date().toISOString()
    ]);

    return jsonResponse({ status: 'success', message: 'Review added' });
  }

  if (action === 'update') {
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(review.id)) {
        var row = i + 1;
        for (var j = 0; j < headers.length; j++) {
          var key = headers[j];
          if (review.hasOwnProperty(key) && key !== 'id') {
            var value = review[key];
            if (typeof value === 'string') value = sanitizeText(value);
            sheet.getRange(row, j + 1).setValue(value);
          }
        }
        return jsonResponse({ status: 'success', message: 'Review updated' });
      }
    }
    return jsonResponse({ status: 'error', message: 'Review not found' });
  }

  if (action === 'delete') {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(review.id)) {
        sheet.deleteRow(i + 1);
        return jsonResponse({ status: 'success', message: 'Review deleted' });
      }
    }
    return jsonResponse({ status: 'error', message: 'Review not found' });
  }

  return jsonResponse({ status: 'error', message: 'Invalid action: ' + action });
}


// ==========================================================================
//  CONTACTS
// ==========================================================================

var CONTACTS_HEADERS = ['id', 'Timestamp', 'Name', 'Email', 'Service', 'Message', 'Read', 'Replied'];
var CONTACTS_WIDTHS  = [150, 180, 150, 200, 150, 400, 80, 80];

function getContactsSheet() {
  return getOrCreateSheet('Contacts', CONTACTS_HEADERS, CONTACTS_WIDTHS);
}

/**
 * GET — return all contacts (for admin)
 */
function getContacts(e) {
  var authError = requireAuth(e && e.parameter && e.parameter.token);
  if (authError) return authError;

  var sheet = getContactsSheet();

  if (sheet.getLastRow() <= 1) {
    return jsonResponse({ status: 'success', contacts: [] });
  }

  var data = sheet.getDataRange().getValues();
  var contacts = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    contacts.push({
      id: String(row[0]),
      timestamp: String(row[1]),
      name: String(row[2]),
      email: String(row[3]),
      service: String(row[4]),
      message: String(row[5]),
      read: String(row[6]).toUpperCase() === 'TRUE',
      replied: String(row[7]).toUpperCase() === 'TRUE'
    });
  }

  // Return newest first
  contacts.reverse();

  return jsonResponse({ status: 'success', contacts: contacts });
}

/**
 * POST — save contact form submission or update contact status
 */
function handleContact(body) {
  var action = body.action || 'add';

  // Adding a contact is the public contact-form flow; only managing
  // read/replied status or deleting is admin-only.
  if (action === 'update' || action === 'delete') {
    var authError = requireAuth(body.token);
    if (authError) return authError;
  }

  var sheet = getContactsSheet();

  if (action === 'add') {
    var name = sanitizeText(body.name);
    var email = sanitizeText(body.email);
    var message = sanitizeText(body.message);
    if (!name || !email || !message) {
      return jsonResponse({ status: 'error', message: 'Name, email, and message are required' });
    }

    var id = 'contact_' + Date.now();
    sheet.appendRow([
      id,
      body.timestamp || new Date().toISOString(),
      name,
      email,
      sanitizeText(body.service),
      message,
      false,
      false
    ]);
    return jsonResponse({ status: 'success', message: 'Message saved', id: id });
  }

  if (action === 'update') {
    var contact = body.contact || {};
    if (!contact.id) return jsonResponse({ status: 'error', message: 'Contact ID required' });

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(contact.id)) {
        var row = i + 1;
        if (contact.hasOwnProperty('read')) {
          sheet.getRange(row, 7).setValue(contact.read);
        }
        if (contact.hasOwnProperty('replied')) {
          sheet.getRange(row, 8).setValue(contact.replied);
        }
        return jsonResponse({ status: 'success', message: 'Contact updated' });
      }
    }
    return jsonResponse({ status: 'error', message: 'Contact not found' });
  }

  if (action === 'delete') {
    var contact = body.contact || {};
    if (!contact.id) return jsonResponse({ status: 'error', message: 'Contact ID required' });

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(contact.id)) {
        sheet.deleteRow(i + 1);
        return jsonResponse({ status: 'success', message: 'Contact deleted' });
      }
    }
    return jsonResponse({ status: 'error', message: 'Contact not found' });
  }

  return jsonResponse({ status: 'error', message: 'Invalid action: ' + action });
}
