#!/usr/bin/env python3
"""
Creates App Store distribution signing for cc.mcbar.minigames through the App Store Connect API
and stores it as encrypted GitHub secrets (automatic signing can't archive in CI when the team has
no registered devices).

  python tools/ios-signing.py --key-id X --issuer Y --p8 AuthKey_X.p8

Creates (once; re-running reuses the stored certificate if its .p12 is still in --out):
  - an Apple Distribution certificate (private key generated locally, never leaves this machine
    except inside the encrypted GitHub secret)
  - an IOS_APP_STORE provisioning profile "Iven Mini Games App Store"
Secrets set: IOS_DIST_P12_BASE64, IOS_DIST_P12_PASSWORD, IOS_PROFILE_BASE64.
Local copies go to --out (default native/ios/signing/, git-ignored).
"""

import argparse
import base64
import importlib.util
import pathlib
import secrets
import sys
import urllib.parse

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ios_setup', HERE / 'ios-setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

BUNDLE_ID = setup.BUNDLE_ID
PROFILE_NAME = 'Iven Mini Games App Store'


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--key-id', required=True)
    ap.add_argument('--issuer', required=True)
    ap.add_argument('--p8', required=True)
    ap.add_argument('--out', default=str(HERE.parent / 'native' / 'ios' / 'signing'))
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    asc = setup.Asc(args.key_id, args.issuer, open(args.p8, encoding='utf-8').read())

    p12_path, pw_path, cert_id_path = out / 'distribution.p12', out / 'distribution.password', out / 'certificate.id'
    if p12_path.exists() and pw_path.exists() and cert_id_path.exists():
        cert_id = cert_id_path.read_text().strip()
        password = pw_path.read_text().strip()
        print('reusing local distribution certificate', cert_id)
    else:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        csr = (x509.CertificateSigningRequestBuilder()
               .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Iven Mini Games CI Distribution')]))
               .sign(key, hashes.SHA256()))
        csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode()
        status, created = asc.call('POST', '/v1/certificates', {'data': {'type': 'certificates', 'attributes': {
            'certificateType': 'DISTRIBUTION', 'csrContent': csr_pem}}})
        if status != 201:
            raise SystemExit(f'create certificate failed: {status} {str(created)[:400]}')
        cert_id = created['data']['id']
        cert = x509.load_der_x509_certificate(base64.b64decode(created['data']['attributes']['certificateContent']))
        password = secrets.token_hex(16)
        # Legacy 3DES/SHA1 PKCS#12 so `security import` on any macOS accepts it.
        enc = (serialization.PrivateFormat.PKCS12.encryption_builder()
               .kdf_rounds(50000)
               .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC)
               .hmac_hash(hashes.SHA1())
               .build(password.encode()))
        p12_path.write_bytes(pkcs12.serialize_key_and_certificates(b'Iven Mini Games Distribution', key, cert, None, enc))
        pw_path.write_text(password)
        cert_id_path.write_text(cert_id)
        print('distribution certificate created:', cert.subject.rfc4514_string(), 'expires', cert.not_valid_after_utc.date())

    status, found = asc.call('GET', f'/v1/bundleIds?filter[identifier]={BUNDLE_ID}&filter[platform]=IOS')
    bundle = next(b for b in found['data'] if b['attributes']['identifier'] == BUNDLE_ID)

    # Replace any older profile with the same name so it always binds to this certificate.
    status, profiles = asc.call('GET', '/v1/profiles?filter[name]=' + urllib.parse.quote(PROFILE_NAME))
    for p in profiles.get('data', []):
        asc.call('DELETE', f"/v1/profiles/{p['id']}")
    status, prof = asc.call('POST', '/v1/profiles', {'data': {'type': 'profiles',
        'attributes': {'name': PROFILE_NAME, 'profileType': 'IOS_APP_STORE'},
        'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': bundle['id']}},
                          'certificates': {'data': [{'type': 'certificates', 'id': cert_id}]}}}})
    if status != 201:
        raise SystemExit(f'create profile failed: {status} {str(prof)[:400]}')
    profile_bytes = base64.b64decode(prof['data']['attributes']['profileContent'])
    (out / 'appstore.mobileprovision').write_bytes(profile_bytes)
    print('profile created:', PROFILE_NAME, prof['data']['attributes'].get('expirationDate', '')[:10])

    setup.set_secrets({
        'IOS_DIST_P12_BASE64': base64.b64encode(p12_path.read_bytes()).decode(),
        'IOS_DIST_P12_PASSWORD': password,
        'IOS_PROFILE_BASE64': base64.b64encode(profile_bytes).decode(),
    })


if __name__ == '__main__':
    main()
