#!/usr/bin/env python3
"""
One-shot iOS/TestFlight setup through the App Store Connect API + GitHub API.

  python tools/ios-setup.py --key-id ABC123XYZ9 --issuer 69a6de7x-... --p8 C:/Users/.../AuthKey_ABC123XYZ9.p8 [--run]

What it does (idempotent, safe to re-run):
  1. registers the bundle ID cc.mcbar.minigames (and reads the Team ID from it)
  2. checks whether the App Store Connect app record exists (tries to create it if Apple allows)
  3. stores APPLE_TEAM_ID / ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 as encrypted GitHub Actions secrets
  4. with --run, starts the "iOS TestFlight" workflow
The private key is never printed. GitHub credentials come from Git Credential Manager.
Needs: pip install pyjwt cryptography pynacl
"""

import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

import jwt
from nacl import encoding, public

PROXY = 'http://127.0.0.1:2080'
BUNDLE_ID = 'cc.mcbar.minigames'
APP_NAME = 'Iven Mini Games'
REPO = 'frankniubi/Iven-Mini-Games'
ASC = 'https://api.appstoreconnect.apple.com'

opener = urllib.request.build_opener(urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY}))


def request(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={**headers, 'Content-Type': 'application/json'})
    try:
        with opener.open(req, timeout=60) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw)
        except ValueError:
            return err.code, {'raw': raw.decode('utf-8', 'replace')[:300]}


class Asc:
    def __init__(self, key_id, issuer, p8):
        self.key_id, self.issuer, self.p8 = key_id, issuer, p8

    def headers(self):
        now = int(time.time())
        token = jwt.encode({'iss': self.issuer, 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                           self.p8, algorithm='ES256', headers={'kid': self.key_id, 'typ': 'JWT'})
        return {'Authorization': f'Bearer {token}'}

    def call(self, method, path, body=None):
        return request(method, ASC + path, self.headers(), body)


def gh_token():
    out = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\nusername=frankniubi\n\n',
                         capture_output=True, text=True, check=True).stdout
    return next(line.split('=', 1)[1] for line in out.splitlines() if line.startswith('password='))


def gh(method, path, body=None):
    return request(method, 'https://api.github.com' + path,
                   {'Authorization': f'Bearer {gh_token()}', 'Accept': 'application/vnd.github+json'}, body)


def set_secrets(values):
    status, key = gh('GET', f'/repos/{REPO}/actions/secrets/public-key')
    if status != 200:
        raise SystemExit(f'GitHub public key: {status} {key}')
    box = public.SealedBox(public.PublicKey(key['key'].encode(), encoding.Base64Encoder()))
    for name, value in values.items():
        enc = base64.b64encode(box.encrypt(value.encode())).decode()
        status, resp = gh('PUT', f'/repos/{REPO}/actions/secrets/{name}', {'encrypted_value': enc, 'key_id': key['key_id']})
        print(f'  secret {name}: {"ok" if status in (201, 204) else f"{status} {resp}"}')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--key-id', required=True)
    ap.add_argument('--issuer', required=True)
    ap.add_argument('--p8', required=True)
    ap.add_argument('--run', action='store_true')
    args = ap.parse_args()
    p8 = open(args.p8, encoding='utf-8').read()
    asc = Asc(args.key_id, args.issuer, p8)

    # 0. key works + what it can see
    status, apps = asc.call('GET', '/v1/apps?limit=50&fields[apps]=name,bundleId')
    if status != 200:
        raise SystemExit(f'App Store Connect rejected the key: {status} {json.dumps(apps)[:300]}')
    print('key ok; apps visible:', ', '.join(f"{a['attributes']['name']} ({a['attributes']['bundleId']})" for a in apps['data']) or 'none')

    # 1. bundle ID
    status, found = asc.call('GET', f'/v1/bundleIds?filter[identifier]={BUNDLE_ID}&filter[platform]=IOS')
    bundle = next((b for b in found.get('data', []) if b['attributes']['identifier'] == BUNDLE_ID), None)
    if not bundle:
        status, created = asc.call('POST', '/v1/bundleIds', {'data': {'type': 'bundleIds', 'attributes': {
            'identifier': BUNDLE_ID, 'name': APP_NAME, 'platform': 'IOS'}}})
        if status != 201:
            raise SystemExit(f'register bundle ID failed: {status} {json.dumps(created)[:400]}')
        bundle = created['data']
        print('bundle ID registered:', BUNDLE_ID)
    else:
        print('bundle ID exists:', BUNDLE_ID)
    team_id = bundle['attributes'].get('seedId')
    print('team ID:', team_id)

    # 2. app record
    app = next((a for a in apps['data'] if a['attributes']['bundleId'] == BUNDLE_ID), None)
    if not app:
        status, created = asc.call('POST', '/v1/apps', {'data': {'type': 'apps', 'attributes': {
            'name': APP_NAME, 'bundleId': BUNDLE_ID, 'sku': 'iven-mini-games', 'primaryLocale': 'zh-Hans'},
            'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': bundle['id']}}}}})
        if status == 201:
            app = created['data']
            print('app record created:', APP_NAME)
        else:
            print(f'app record: Apple does not allow creating it via the API ({status}); create it once in App Store Connect:')
            print(f'  My Apps → + → New App → iOS, name "{APP_NAME}", language 简体中文, bundle ID {BUNDLE_ID}, SKU iven-mini-games')
    else:
        print('app record exists:', app['attributes']['name'])

    # 3. GitHub secrets
    set_secrets({'APPLE_TEAM_ID': team_id, 'ASC_KEY_ID': args.key_id, 'ASC_ISSUER_ID': args.issuer, 'ASC_KEY_P8': p8})

    # 4. run the workflow
    if args.run:
        if not app:
            print('not starting the workflow yet: the app record is missing')
            return
        status, resp = gh('POST', f'/repos/{REPO}/actions/workflows/ios-testflight.yml/dispatches', {'ref': 'main'})
        print('workflow dispatch:', 'started' if status == 204 else f'{status} {resp}')


if __name__ == '__main__':
    main()
