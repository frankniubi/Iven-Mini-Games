#!/usr/bin/env python3
"""
TestFlight internal testing for Iven Mini Games.

  python tools/ios-testers.py --key-id X --issuer Y --p8 AuthKey_X.p8 --email a@b.com [--email ...]

Idempotent. Makes sure the internal beta group "家人" exists with automatic distribution of new
builds, adds every given email that has already accepted its App Store Connect invitation, and
reports who is still pending (internal testers must be team members, so they accept the team
invitation e-mail first; run this again afterwards).
"""

import argparse
import importlib.util
import json
import pathlib
import sys
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ios_setup', HERE / 'ios-setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

GROUP = '家人'


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--key-id', required=True)
    ap.add_argument('--issuer', required=True)
    ap.add_argument('--p8', required=True)
    ap.add_argument('--email', action='append', default=[])
    args = ap.parse_args()
    asc = setup.Asc(args.key_id, args.issuer, open(args.p8, encoding='utf-8').read())

    st, apps = asc.call('GET', f'/v1/apps?filter[bundleId]={setup.BUNDLE_ID}')
    if not apps.get('data'):
        raise SystemExit('app record not found')
    app_id = apps['data'][0]['id']

    st, groups = asc.call('GET', f'/v1/apps/{app_id}/betaGroups?limit=50')
    group = next((g for g in groups.get('data', []) if g['attributes']['name'] == GROUP), None)
    if not group:
        st, created = asc.call('POST', '/v1/betaGroups', {'data': {'type': 'betaGroups', 'attributes': {
            'name': GROUP, 'isInternalGroup': True, 'hasAccessToAllBuilds': True},
            'relationships': {'app': {'data': {'type': 'apps', 'id': app_id}}}}})
        if st != 201:
            raise SystemExit(f'create beta group failed: {st} {json.dumps(created, ensure_ascii=False)[:300]}')
        group = created['data']
        print('internal group created:', GROUP)
    else:
        print('internal group exists:', GROUP)

    st, members = asc.call('GET', f"/v1/betaGroups/{group['id']}/betaTesters?limit=200")
    have = {t['attributes'].get('email', '').lower() for t in members.get('data', [])}
    for email in args.email:
        if email.lower() in have:
            print(f'{email}: already in {GROUP}')
            continue
        st, users = asc.call('GET', '/v1/users?filter[username]=' + urllib.parse.quote(email))
        if not users.get('data'):
            st, inv = asc.call('GET', '/v1/userInvitations?filter[email]=' + urllib.parse.quote(email))
            state = 'invitation pending (accept the App Store Connect e-mail first)' if inv.get('data') else 'not invited'
            print(f'{email}: {state}')
            continue
        st, r = asc.call('POST', '/v1/betaTesters', {'data': {'type': 'betaTesters', 'attributes': {
            'email': email, 'firstName': 'Iven', 'lastName': 'Tester'},
            'relationships': {'betaGroups': {'data': [{'type': 'betaGroups', 'id': group['id']}]}}}})
        if st == 201:
            print(f'{email}: added to {GROUP}; TestFlight invitation sent')
        else:
            print(f'{email}: add failed {st} {json.dumps(r, ensure_ascii=False)[:300]}')


if __name__ == '__main__':
    main()
