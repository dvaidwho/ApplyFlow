import { scrapePageContent } from '../utils/parser.js';
import { getOrCreateSheet, appendToSheet } from '../utils/sheets.js';

// On load
document.addEventListener('DOMContentLoaded', async () => { 
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  document.getElementById('link').value = tab.url;

  // attempt to scrape the job page, and populate the form
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePageContent,
    });

    console.log('Scrape result:', JSON.stringify(result));
    if (result && !result.error) {
      populateForm(result);
      if (!result.isJobPage) {
        document.getElementById('no-job-banner').classList.remove('hidden');
      }
    }
    if (result?.error) console.error('Scraper error:', result.error, result.stack);
  } catch (err) {
    console.warn('Scraper unavailable on this page:', err.message);
    document.getElementById('no-job-banner').classList.remove('hidden');
  }

  checkDuplicate(tab.url);  // check local storage to check if this URL has already been tracked
});

// Populate the form
function populateForm(data) {
  // put the scraped data into the form fields
  setValue('company',      data.company);
  setValue('position',     data.position);
  setValue('location',     data.location);
  setValue('link',         data.link);
  setValue('compensation', data.compensation);

  const sourceSelect = document.getElementById('source');
  // check if source matches one of the dropdown options
  const match = [...sourceSelect.options].find(o => o.value === data.source);
  if (match) sourceSelect.value = data.source;
}

// Set value from the data
function setValue(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.value = value;
}

// Duplicate check
async function checkDuplicate(url) {
  // check if the url exist in local storage
  const { trackedUrls = [] } = await chrome.storage.local.get('trackedUrls');
  if (trackedUrls.includes(url)) {
    // reveal the duplicate warning banner
    document.getElementById('duplicate-warning').classList.remove('hidden');
  }
}

// Save button
document.getElementById('saveBtn').addEventListener('click', async () => {
  const company  = document.getElementById('company').value.trim(); // trim removes leading and trailing whitespace
  const position = document.getElementById('position').value.trim();
  const location = document.getElementById('location').value.trim();

  // required fields to be populated first
  if (!company || !position || !location) {
    showStatus('Company, Position, and Location are required.', 'error');
    if (!company)       document.getElementById('company').focus();
    else if (!position) document.getElementById('position').focus();
    else                document.getElementById('location').focus();
    return;
  }

  const row = buildRow();
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; // prevent double submits while saving
  btn.textContent = 'Saving...';

  try {
    const token   = await getAuthToken();  // get Google OAuth token to prove permission
    const sheetId = await getOrCreateSheet(token);  // get existing sheet or create a new one
    await appendToSheet(token, sheetId, row);  // add row to the sheet
    await saveUrlLocally(document.getElementById('link').value);  // save url local storage 
    showStatus('✓ Saved to sheet!', 'success');
    btn.textContent = 'Saved!';
  } catch (err) { // if anything fails, re-enable the button and try again
    console.error(err);
    showStatus('Error saving. Check console.', 'error');
    btn.disabled = false;
    btn.textContent = 'Save to Sheet';
  }
});

// Build row
function buildRow() {
  const today = new Date().toLocaleDateString('en-US');
  // returns the data from the keyfields into the rows
  return [
    today,
    document.getElementById('company').value.trim(),
    document.getElementById('position').value.trim(),
    document.getElementById('location').value.trim(),
    document.getElementById('compensation').value.trim() || 'Not Listed', // default
    document.getElementById('source').value,
    document.getElementById('status').value,
    document.getElementById('link').value.trim(),
  ];
}

// Authentication
function getAuthToken() {
  return new Promise((resolve, reject) => { // show Google sign-in popup if needed
    chrome.identity.getAuthToken({ interactive: true }, (token) => { 
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Auth failed')); // auth failed, reject with error
      } else {
        resolve(token); // auth succeeded, pass the token back
      }
    });
  });
}

// Save url locally 
async function saveUrlLocally(url) {
  const { trackedUrls = [] } = await chrome.storage.local.get('trackedUrls');
  if (!trackedUrls.includes(url)) {
    trackedUrls.push(url);
    await chrome.storage.local.set({ trackedUrls });
  }
}

// Display status message in the popup
function showStatus(message, type) {
  const el = document.getElementById('status-msg');
  el.textContent = message;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
}
