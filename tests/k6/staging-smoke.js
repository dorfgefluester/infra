import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 2,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const targetUrl = __ENV.TARGET_URL || 'http://dev-env-01/dorfgefluester/';
  const res = http.get(targetUrl, { redirects: 5 });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'returns html': (r) => String(r.headers['Content-Type'] || '').includes('text/html'),
  });

  sleep(1);
}
