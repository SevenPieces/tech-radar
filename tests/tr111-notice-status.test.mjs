// tests/tr111-notice-status.test.mjs
// TR-111 notice half: a notice is redacted against the run's whole union, and a short configured
// value could collide with the shaper's own text. With '?code=500' on one row and a failing row
// beside it, the union carried '500', the whole-notice redaction took it out of the status, and
// the coverage note read 'HTTP [redacted] for ...' -- the one fact the notice exists to report was
// gone. The shaper's status and cause are authored by the module, not read from a request, so
// they are not removal targets; these cases pin that, and pin beside it that the value itself is
// still removed everywhere it is really a value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf, isDiscoveryOnly, redactSecrets, shapeHttpError, shapeTransportError,
} from '../scripts/lib/net.mjs';
import { assembleNotice, collectAll } from '../scripts/collect.mjs';

const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const SETTINGS = {
  user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
  error_snippet_max_chars: 200, notice_max_chars: 402, request_timeout_ms: 20000,
};
const NET = (fetchText) => ({ fetchText, hostOf, isDiscoveryOnly });
const FEED = '<rss><channel><item><title>Rust 1.90 is a new release</title>'
  + '<link>https://feeds.example/r1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
  + '<description>a new API</description></item></channel></rss>';

test('TR-111 the shaped status is not a value-removal target while the value is removed elsewhere', () => {
  assert.equal(redactSecrets('HTTP 500 for https://feeds.example/dead.xml', ['500']),
    'HTTP 500 for https://feeds.example/dead.xml',
    'the configured value took the status out of the shaped text');
  assert.equal(redactSecrets('rss https://feeds.example/500/feed.xml: HTTP 500 for it', ['500']),
    'rss https://feeds.example/[redacted]/feed.xml: HTTP 500 for it',
    'the value was not removed from the source it really stood in');
  assert.equal(redactSecrets('the answer carries 500 entries', ['500']), 'the answer carries [redacted] entries',
    'the value survives in ordinary text');
  // Only the shaper's three-digit status token is protected: a longer run is a value again.
  assert.equal(redactSecrets('HTTP 5000 for x', ['5000']), 'HTTP [redacted] for x',
    'a four-digit value was protected as if it were a status');
});

test('TR-111 a notice keeps its status when another row put the status digits in the union', async () => {
  const pool = await collectAll(
    {
      settings: SETTINGS,
      watchlist: [
        { kind: 'rss', target: 'https://feeds.example/releases.xml?code=500', domain: 'languages-runtimes', note: '' },
        { kind: 'rss', target: 'https://feeds.example/dead.xml', domain: 'languages-runtimes', note: '' },
      ],
      domains: [],
    },
    {
      ...WINDOW,
      net: NET(async (url) => {
        if (String(url).includes('dead')) {
          throw shapeHttpError(500, Buffer.from('the server broke'), url, 200);
        }
        return FEED;
      }),
    },
  );
  assert.equal(pool.notices.length, 1, 'the run published ' + pool.notices.length + ' notices');
  assert.match(pool.notices[0], /HTTP 500 for /,
    'the notice lost the status to the configured value: ' + JSON.stringify(pool.notices[0]));
  assert.ok(!pool.notices[0].includes('[redacted]'),
    'the configured value rewrote the notice: ' + JSON.stringify(pool.notices[0]));
});

test('TR-111 a transport notice keeps its cause when a configured value spells a cause word', () => {
  const notice = assembleNotice(
    'rss https://feeds.example/dead.xml',
    shapeTransportError({ status: 28 }, 'https://feeds.example/dead.xml', 200),
    ['timed'],
    200,
  );
  assert.match(notice, /timed out \(curl exit 28\)/,
    'the notice lost the transport cause to the configured value: ' + JSON.stringify(notice));
  // The same word outside the shaper's own cause text is still removed, so the protection is the
  // module's diagnosis and not a blanket exemption for the word.
  assert.equal(redactSecrets('the request timed out twice', ['timed']), 'the request [redacted] out twice',
    'a cause word in ordinary text is no longer removed');
  assert.equal(redactSecrets('a note about TLS handshake failed errors', ['handshake']),
    'a note about TLS [redacted] failed errors',
    'a credential spelling a cause word survived in ordinary candidate prose');
});
