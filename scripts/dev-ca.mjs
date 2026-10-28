// Makes the private certificate authority phones trust for the dev stack's
// HTTPS port, limited by name constraints to LAN_HTTPS_HOST and localhost
// (issue #70). Caddy's own root can sign for any domain, so anyone holding its
// key could intercept all of a trusting phone's traffic; this one cannot sign
// for anything else. Run `pnpm dev:ca`, then `pnpm dev:backend`, then install
// the new profile on the phone (README, "Testing on a phone").
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
const host = process.env.LAN_HTTPS_HOST || 'localhost';
const dir = '.local/caddy/local-ca';
// Caddy's generated authority and the certificates it issued, which the new
// authority replaces.
const stale = ['.local/caddy/caddy/pki/authorities/local', '.local/caddy/caddy/certificates/local'];

const permitted = [
  'permitted;DNS:localhost',
  'permitted;IP:127.0.0.1/255.255.255.255',
  isIP(host) === 4
    ? `permitted;IP:${host}/255.255.255.255`
    : isIP(host) === 6
      ? `permitted;IP:${host}/ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff`
      : `permitted;DNS:${host}`,
];

mkdirSync(dir, { recursive: true });
const file = (name) => join(dir, name);
writeFileSync(
  file('openssl.cnf'),
  `[req]
distinguished_name = dn
prompt = no
[dn]
CN = Dishkept dev CA (${host} only)
[root]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, ${[...new Set(permitted)].join(', ')}
[intermediate]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, digitalSignature, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
`,
);
const openssl = (...args) =>
  execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
const days = '3650';
openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', file('root.key'));
openssl(
  'req',
  '-x509',
  '-new',
  '-key',
  file('root.key'),
  '-days',
  days,
  '-sha256',
  '-config',
  file('openssl.cnf'),
  '-extensions',
  'root',
  '-out',
  file('root.crt'),
);
openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', file('intermediate.key'));
openssl(
  'req',
  '-new',
  '-key',
  file('intermediate.key'),
  '-config',
  file('openssl.cnf'),
  '-subj',
  `/CN=Dishkept dev intermediate (${host} only)`,
  '-out',
  file('intermediate.csr'),
);
openssl(
  'x509',
  '-req',
  '-in',
  file('intermediate.csr'),
  '-CA',
  file('root.crt'),
  '-CAkey',
  file('root.key'),
  '-CAcreateserial',
  '-days',
  days,
  '-sha256',
  '-extfile',
  file('openssl.cnf'),
  '-extensions',
  'intermediate',
  '-out',
  file('intermediate.crt'),
);
// Caddy signs with the intermediate; the root's key is not needed again.
rmSync(file('root.key'));
for (const name of ['intermediate.csr', 'root.srl', 'openssl.cnf'])
  rmSync(file(name), { force: true });

// Imported by deploy/Caddyfile's global options; /data is .local/caddy.
writeFileSync(
  file('ca.caddy'),
  `pki {
	ca local {
		name "Dishkept dev (${host} only)"
		root {
			cert /data/local-ca/root.crt
		}
		intermediate {
			cert /data/local-ca/intermediate.crt
			key /data/local-ca/intermediate.key
		}
	}
}
`,
);
for (const path of stale) rmSync(path, { recursive: true, force: true });

console.log(`A certificate authority for ${host} and localhost only is in ${dir}.
Next:
  1. pnpm dev:backend
  2. On the phone, delete the old profile (Settings > General > VPN & Device Management),
     then install https://${host}:${process.env.LAN_HTTPS_PORT || '8443'}/local-ca.crt as in the README.`);
