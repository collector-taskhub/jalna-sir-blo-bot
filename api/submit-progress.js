const { google } = require('googleapis');

async function getSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { phone, ef_distributed, ef_collected, ef_digitised } = req.body;
  const sheets = await getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  const masterResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: 'BLO_Master!A2:P2000',
  });
  const master = masterResp.data.values || [];
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  const row = master.find(r => String(r[7]).replace(/\D/g, '').slice(-10) === cleanPhone);
  if (!row) return res.status(404).json({ status: 'error', msg: 'BLO not found' });

  const bloId = row[0], totalElectors = Number(row[10]);
  const digitisedBaseline = Number(row[12]);

  const logResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: 'Daily_Progress_Log!A2:P100000',
  });
  const log = logResp.data.values || [];
  let cumulative = digitisedBaseline;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i][1] === bloId) { cumulative = Number(log[i][10]); break; }
  }
  const efDigitisedToday = Number(ef_digitised) || 0;
  const newCumulative = cumulative + efDigitisedToday;
  const overallPct = totalElectors > 0 ? newCumulative / totalElectors : 0;
  const above90 = overallPct >= 0.9;

  // Cap only the value shown to the BLO — the raw overallPct is still logged below for admin review.
  const displayPct = Math.min(overallPct, 1);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Daily_Progress_Log!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[
      new Date().toISOString(), bloId, row[1], row[2], row[3], row[6], row[7],
      ef_distributed, ef_collected, efDigitisedToday, newCumulative, totalElectors,
      overallPct, efDigitisedToday / totalElectors, above90 ? 'YES' : '', 'N',
    ]] },
  });

  return res.status(200).json({
    status: 'ok',
    overall_pct: Math.round(displayPct * 1000) / 10,
    above_90: above90,
  });
};
