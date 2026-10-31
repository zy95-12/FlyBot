"""FlyBot operator helper: read a single account status without an admin credential.

Run under the platform DB owner using an exact operator command. Source is FlyBot,
not a control-plane modification. The database is opened read-only with WAL freshness.
"""
import argparse
import json
import os
import sqlite3
import sys
from urllib.parse import quote


def check(db_path, request):
    subject = request.get('subject')
    nonce = request.get('nonce')
    if request.get('version') != 'platform-principal/v1' or not isinstance(subject, str) or not 0 < len(subject) <= 200 or not isinstance(nonce, str) or not 0 < len(nonce) <= 100:
        raise ValueError('Invalid principal request')
    if not os.path.isabs(db_path):
        raise ValueError('Absolute platform database path required')
    connection = sqlite3.connect('file:' + quote(db_path, safe='/') + '?mode=ro', uri=True, timeout=2)
    try:
        connection.execute('PRAGMA query_only=ON')
        row = connection.execute('SELECT status FROM users WHERE id = ?', (subject,)).fetchone()
        return {'version': 'platform-principal/v1', 'subject': subject, 'nonce': nonce, 'status': 'active' if row and row[0] == 'active' else 'unavailable'}
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    args = parser.parse_args()
    raw = sys.stdin.buffer.read(2049)
    if len(raw) > 2048:
        raise ValueError('Principal request too large')
    result = check(args.db, json.loads(raw))
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Platform principal unavailable', file=sys.stderr)
        sys.exit(1)
