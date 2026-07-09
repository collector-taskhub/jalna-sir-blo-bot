const { google } = require('googleapis');

async function getSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sheets = await getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  const masterResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: 'BLO_Master!A2:P2000',
  });
  const logResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: 'Daily_Progress_Log!A2:P100000',
  });
  const master = masterResp.data.values || [];
  const log = logResp.data.values || [];

  // Latest cumulative digitised per BLO, from the most recent log row for that BLO.
  const latestByBlo = {};
  const todaySubmitted = new Set();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const r of log) {
    const bloId = r[1];
    latestByBlo[bloId] = { cumulative: Number(r[10]), overallPct: Number(r[12]), aboveNinety: r[14] === 'YES' };
    if (String(r[0]).slice(0, 10) === todayStr) todaySubmitted.add(bloId);
  }

  const blos = master.map(row => {
    const bloId = row[0], acNo = Number(row[1]), acName = row[2], boothNo = row[3],
      boothName = row[5], bloName = row[6], totalElectors = Number(row[10]),
      digitisedBaseline = Number(row[12]);
    const latest = latestByBlo[bloId];
    const cumulative = latest ? latest.cumulative : digitisedBaseline;
    const overallPct = totalElectors > 0 ? Math.min(cumulative / totalElectors, 1) : 0;
    return {
      bloId, acNo, acName, boothNo, boothName, bloName,
      totalElectors, cumulative,
      overallPct: Math.round(overallPct * 1000) / 10,
      above90: overallPct >= 0.9,
      submittedToday: todaySubmitted.has(bloId),
    };
  });

  const acMap = {};
  for (const b of blos) {
    if (!acMap[b.acNo]) {
      acMap[b.acNo] = { acNo: b.acNo, acName: b.acName, totalBlos: 0, totalElectors: 0, totalCumulative: 0, above90Count: 0, submittedTodayCount: 0 };
    }
    const a = acMap[b.acNo];
    a.totalBlos += 1;
    a.totalElectors += b.totalElectors;
    a.totalCumulative += b.cumulative;
    if (b.above90) a.above90Count += 1;
    if (b.submittedToday) a.submittedTodayCount += 1;
  }
  const acSummary = Object.values(acMap).map(a => ({
    ...a,
    overallPct: a.totalElectors > 0 ? Math.round((a.totalCumulative / a.totalElectors) * 1000) / 10 : 0,
  })).sort((x, y) => x.acNo - y.acNo);

  const district = {
    totalBlos: blos.length,
    totalElectors: acSummary.reduce((s, a) => s + a.totalElectors, 0),
    totalCumulative: acSummary.reduce((s, a) => s + a.totalCumulative, 0),
    above90Count: acSummary.reduce((s, a) => s + a.above90Count, 0),
    submittedTodayCount: acSummary.reduce((s, a) => s + a.submittedTodayCount, 0),
  };
  district.overallPct = district.totalElectors > 0 ? Math.round((district.totalCumulative / district.totalElectors) * 1000) / 10 : 0;

  return res.status(200).json({ district, acSummary, blos });
};
