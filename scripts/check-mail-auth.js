import { resolveCname, resolveTxt } from 'node:dns/promises';

const checks = [
  {
    type: 'CNAME',
    name: 'mt00.noreply.restro360.tech',
    expected: 'smtp.mailtrap.live',
  },
  {
    type: 'CNAME',
    name: 'rwmt1._domainkey.noreply.restro360.tech',
    expected: 'rwmt1.dkim.smtp.mailtrap.live',
  },
  {
    type: 'CNAME',
    name: 'rwmt2._domainkey.noreply.restro360.tech',
    expected: 'rwmt2.dkim.smtp.mailtrap.live',
  },
  {
    type: 'TXT',
    name: '_dmarc.noreply.restro360.tech',
    startsWith: 'v=DMARC1',
  },
  {
    type: 'CNAME',
    name: 'mt-link.noreply.restro360.tech',
    expected: 't.mailtrap.live',
  },
];

function normalized(value) {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

let failed = false;
for (const check of checks) {
  try {
    if (check.type === 'CNAME') {
      const values = await resolveCname(check.name);
      const passed = values.some((value) => normalized(value) === check.expected);
      console.log(`${passed ? 'PASS' : 'FAIL'} CNAME ${check.name} -> ${check.expected}${passed ? '' : ` (found ${values.join(', ') || 'none'})`}`);
      failed ||= !passed;
    } else {
      const values = (await resolveTxt(check.name)).flat();
      const passed = values.some((value) => value.trim().toUpperCase().startsWith(check.startsWith));
      console.log(`${passed ? 'PASS' : 'FAIL'} TXT ${check.name} starts with ${check.startsWith}${passed ? '' : ` (found ${values.join(' | ') || 'none'})`}`);
      failed ||= !passed;
    }
  } catch (error) {
    console.log(`FAIL ${check.type} ${check.name} (${error.code || error.message})`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
