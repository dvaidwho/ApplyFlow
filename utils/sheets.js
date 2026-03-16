// Create or retrieve the ApplyFlow sheet
export async function getOrCreateSheet(token) {
  const { applyFlowSheetId } = await chrome.storage.local.get('applyFlowSheetId');
  if (applyFlowSheetId) return applyFlowSheetId;

  const headers = ['Date', 'Company', 'Position', 'Location', 'Compensation', 'Source', 'Status', 'Link'];

  const headerBg = { red: 0.20, green: 0.65, blue: 0.33 }; // #33a654
  const white    = { red: 1,    green: 1,    blue: 1    };
  const darkGray = { red: 0.26, green: 0.26, blue: 0.26 };

  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: 'ApplyFlow' },
      sheets: [{
        properties: { sheetId: 0, title: 'Sheet1' },
        data: [{
          startRow: 0, startColumn: 0,
          rowData: [{
            values: headers.map(h => ({
              userEnteredValue: { stringValue: h },
              userEnteredFormat: {
                backgroundColor: headerBg,
                textFormat: { bold: true, foregroundColor: white, fontSize: 10 },
                horizontalAlignment: 'LEFT',
                verticalAlignment: 'MIDDLE',
              },
            })),
          }],
        }],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to create spreadsheet');
  }

  const { spreadsheetId, sheets } = await res.json();
  const sheetId = sheets[0].properties.sheetId;

  // source col=5, status col=6 (0-indexed)
  const sourceOptions = ['LinkedIn', 'Handshake', 'Company Website', 'Other'];
  const sourcePalette = [
    { bg: { red: 0.74, green: 0.88, blue: 0.97 }, fg: { red: 0.08, green: 0.40, blue: 0.75 } }, // LinkedIn        — light blue / blue text
    { bg: { red: 0.89, green: 0.94, blue: 0.45 }, fg: { red: 0.18, green: 0.35, blue: 0.01 } }, // Handshake       — yellow-green / dark text
    { bg: { red: 0.88, green: 0.88, blue: 0.88 }, fg: darkGray },                                // Company Website — light gray / dark text
    { bg: { red: 0.88, green: 0.88, blue: 0.88 }, fg: darkGray },                                // Other           — light gray / dark text
  ];

  const statusOptions = ['Sent', 'Application Received', 'In Review', 'Online Assessment', 'Phone Call', 'Interview', 'Offer', 'Rejected'];
  const statusPalette = [
    { bg: { red: 0.11, green: 0.37, blue: 0.20 }, fg: white },                                   // Sent                 — forest green / white
    { bg: { red: 0.08, green: 0.40, blue: 0.75 }, fg: white },                                   // Application Received — blue / white
    { bg: { red: 0.78, green: 0.90, blue: 0.79 }, fg: { red: 0.18, green: 0.35, blue: 0.01 } }, // In Review            — light green / dark green
    { bg: { red: 0.88, green: 0.75, blue: 0.91 }, fg: { red: 0.42, green: 0.11, blue: 0.60 } }, // Online Assessment    — lavender / purple
    { bg: { red: 0.73, green: 0.87, blue: 0.98 }, fg: { red: 0.08, green: 0.40, blue: 0.75 } }, // Phone Call           — light blue / blue
    { bg: { red: 0.10, green: 0.30, blue: 0.35 }, fg: white },                                   // Interview            — dark teal / white
    { bg: { red: 0.18, green: 0.49, blue: 0.27 }, fg: white },                                   // Offer                — medium green / white
    { bg: { red: 0.78, green: 0.16, blue: 0.16 }, fg: white },                                   // Rejected             — red / white
  ];

  const colWidths = [100, 180, 260, 140, 150, 150, 170, 220];

  const batchRequests = [
    // Freeze header row
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Filter arrows on header
    {
      setBasicFilter: {
        filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 8 } },
      },
    },
    // Left-align all data rows (Sheets right-aligns dates/numbers by default)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    // Header row height
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 32 },
        fields: 'pixelSize',
      },
    },
    // Column widths
    ...colWidths.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    })),
    // Data validation: Source dropdown (col 5)
    {
      setDataValidation: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: sourceOptions.map(v => ({ userEnteredValue: v })) },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Data validation: Status dropdown (col 6)
    {
      setDataValidation: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: statusOptions.map(v => ({ userEnteredValue: v })) },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // Conditional formatting: Source colors
    ...sourceOptions.map((val, i) => ({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: val }] },
            format: { backgroundColor: sourcePalette[i].bg, textFormat: { foregroundColor: sourcePalette[i].fg } },
          },
        },
        index: i,
      },
    })),
    // Conditional formatting: Status colors
    ...statusOptions.map((val, i) => ({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: val }] },
            format: { backgroundColor: statusPalette[i].bg, textFormat: { foregroundColor: statusPalette[i].fg } },
          },
        },
        index: sourceOptions.length + i,
      },
    })),
  ];

  // apply formatting, dropdowns, and conditional colors — non-fatal if it fails
  try {
    const batchRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: batchRequests }),
    });
    if (!batchRes.ok) {
      const err = await batchRes.json();
      console.warn('Sheet formatting failed (sheet was still created):', err.error?.message);
    }
  } catch (err) {
    console.warn('Sheet formatting failed (sheet was still created):', err.message);
  }

  await chrome.storage.local.set({ applyFlowSheetId: spreadsheetId });
  return spreadsheetId;
}

// Append a row to the sheet
export async function appendToSheet(token, sheetId, row) {
  const range = 'Sheet1!A:H';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Sheets API error');
  }

  return res.json();
}
