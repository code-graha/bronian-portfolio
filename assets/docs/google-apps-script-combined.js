/**
 * Google Apps Script — Combined Portfolio API
 * Handles Projects, Reviews, and Contact Form in a single deployment.
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Go to Google Sheets (https://sheets.google.com) and create a new spreadsheet
 * 2. Name it "Portfolio" (or any name you prefer)
 * 3. The script will auto-create sheet tabs (Projects, Reviews, Contacts) on first use
 * 4. Go to Extensions > Apps Script
 * 5. Delete any existing code and paste this entire script
 * 6. Replace YOUR_GOOGLE_SHEET_ID_HERE below with your Sheet ID
 *    (found in the URL: https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit)
 * 7. Click "Deploy" > "New deployment"
 * 8. Select type: "Web app"
 * 9. Set "Execute as": "Me"
 * 10. Set "Who has access": "Anyone"
 * 11. Click "Deploy" and authorize when prompted
 * 12. Copy the Web App URL
 * 13. Paste the URL in your portfolio-data.json under "sheetURL"
 *
 * IMPORTANT: After making changes, you must create a NEW deployment for changes to take effect.
 *
 * API ROUTING:
 *   GET  ?type=projects             → Returns all projects
 *   GET  ?type=reviews              → Returns approved reviews only
 *   GET  ?type=reviews&mode=all     → Returns ALL reviews (for admin page)
 *   GET  ?type=contacts             → Returns all contacts (for admin page)
 *   GET  (no type)                  → Health check
 *
 *   POST { type: "projects", action: "add"|"update"|"delete", project: {...} }
 *   POST { type: "reviews",  action: "add"|"update"|"delete", review: {...} }
 *   POST { type: "contacts", name, email, service, message, timestamp }
 *   POST { type: "contacts", action: "update", contact: { id, read, replied } }
 *
 * SHEET TABS:
 *   Projects  → id | title | category | year | description | image | aspect
 *   Reviews   → id | name | email | role | rating | quote | image | featured | approved | timestamp
 *   Contacts  → id | Timestamp | Name | Email | Service | Message | Read | Replied
 */

// ==========================================
// CONFIGURATION
// ==========================================
var SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';

// ==========================================
// HELPERS
// ==========================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(name, headers, columnWidths) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
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

// ==========================================
// MAIN ROUTER — GET
// ==========================================
function doGet(e) {
  try {
    var type = (e && e.parameter && e.parameter.type) ? e.parameter.type : '';

    if (type === 'projects') return getProjects();
    if (type === 'reviews')  return getReviews(e);
    if (type === 'contacts') return getContacts();

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

    if (type === 'projects') return handleProject(body);
    if (type === 'reviews')  return handleReview(body);
    if (type === 'contacts') return handleContact(body);

    return jsonResponse({ status: 'error', message: 'Unknown type: ' + type });
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
  var action = body.action || 'add';
  var project = body.project || {};
  var sheet = getProjectsSheet();

  if (action === 'add') {
    var id = project.id || 'project_' + Date.now();
    sheet.appendRow([
      id,
      project.title || '',
      project.category || '',
      project.year || new Date().getFullYear().toString(),
      project.description || '',
      project.image || '',
      project.aspect || '1/1'
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
          project.title || data[i][1],
          project.category || data[i][2],
          project.year || data[i][3],
          project.description || data[i][4],
          project.image || data[i][5],
          project.aspect || data[i][6]
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
  var sheet = getReviewsSheet();
  var mode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode : '';

  if (sheet.getLastRow() <= 1) {
    return jsonResponse({ status: 'success', reviews: [] });
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var reviews = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
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
        rating: Number(review.rating),
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
  var review = body.review || {};
  var sheet = getReviewsSheet();

  if (action === 'add') {
    // Check for duplicate email
    var email = (review.email || '').trim().toLowerCase();
    if (email) {
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var emailCol = headers.indexOf('email');
      if (emailCol !== -1) {
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][emailCol]).trim().toLowerCase() === email) {
            return jsonResponse({ status: 'error', message: 'A review from this email already exists' });
          }
        }
      }
    }

    var imageValue = review.imageData || review.image || '';

    sheet.appendRow([
      review.id || 'review_' + Date.now(),
      review.name || '',
      email,
      review.role || '',
      review.rating || 5,
      review.quote || '',
      imageValue,
      review.featured || false,
      review.approved || false,
      review.timestamp || new Date().toISOString()
    ]);

    return jsonResponse({ status: 'success', message: 'Review added' });
  }

  if (action === 'update') {
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(review.id)) {
        var row = i + 1;
        for (var j = 0; j < headers.length; j++) {
          var key = headers[j];
          if (review.hasOwnProperty(key) && key !== 'id') {
            sheet.getRange(row, j + 1).setValue(review[key]);
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
function getContacts() {
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
  var sheet = getContactsSheet();
  var action = body.action || 'add';

  if (action === 'add') {
    var id = 'contact_' + Date.now();
    sheet.appendRow([
      id,
      body.timestamp || new Date().toISOString(),
      body.name || '',
      body.email || '',
      body.service || '',
      body.message || '',
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
