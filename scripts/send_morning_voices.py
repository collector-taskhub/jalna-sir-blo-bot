# scripts/send_morning_voices.py
import os, json, requests
from google.oauth2 import service_account
from googleapiclient.discovery import build

GITHUB_USERNAME = "collector-taskhub"
REPO_NAME = "jalna-sir-blo-bot"

# Single shared audio file — no more per-BLO name splicing.
BOT_ID = "6a4ce87c03bc483036044d21"
MORNING_AUDIO_URL = f'https://raw.githubusercontent.com/{GITHUB_USERNAME}/{REPO_NAME}/main/audio/morning_message.ogg'

# For the first safe test, only send to these BLO_IDs.
# Leave the list EMPTY (i.e. TEST_ONLY_IDS = []) to send to all 1,755 BLOs for real.
TEST_ONLY_IDS = ["BLO0017"]

SHEET_ID = os.environ['GOOGLE_SHEET_ID']
creds_info = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
creds = service_account.Credentials.from_service_account_info(
    creds_info, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
sheets = build('sheets', 'v4', credentials=creds).spreadsheets()

def get_sendpulse_token():
    r = requests.post('https://api.sendpulse.com/oauth/access_token', json={
        'grant_type': 'client_credentials',
        'client_id': os.environ['SENDPULSE_CLIENT_ID'],
        'client_secret': os.environ['SENDPULSE_CLIENT_SECRET'],
    })
    return r.json()['access_token']

def main():
    token = get_sendpulse_token()
    rows = sheets.values().get(
        spreadsheetId=SHEET_ID, range='BLO_Master!A2:P2000').execute().get('values', [])
    sent, skipped, failed = 0, 0, 0
    for row in rows:
        if len(row) < 8:
            continue
        blo_id, phone = row[0], str(row[7]).strip()

        if TEST_ONLY_IDS and blo_id not in TEST_ONLY_IDS:
            continue

        clean_phone = ''.join(ch for ch in phone if ch.isdigit())[-10:]
        if not clean_phone:
            skipped += 1
            continue
        full_phone = '91' + clean_phone
        resp = requests.post(
            'https://api.sendpulse.com/whatsapp/contacts/sendByPhone',
            headers={'Authorization': f'Bearer {token}'},
            json={
                'bot_id': BOT_ID,
                'phone': full_phone,
                'message': {'type': 'audio', 'audio': {'link': MORNING_AUDIO_URL}},
            },
        )
        if resp.status_code == 200:
            sent += 1
        else:
            failed += 1
            print(f'FAILED for {blo_id} ({full_phone}): {resp.text}')
    print(f'Done. Sent: {sent}, Failed (likely closed 24h window): {failed}, Skipped (no phone): {skipped}')

if __name__ == '__main__':
    main()
