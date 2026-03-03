import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<150']
  }
};

export default function () {
  const res = http.get('http://localhost:4002/v1/projects/demo-project/db/collections/todos/docs?limit=20');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
