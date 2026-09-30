"""Extract factual connector metadata from a saved public Claude directory page.

Usage: python3 extract-directory.py /tmp/claude-connectors-directory.html /tmp/claude-sitemap.xml
Does not contact servers, authenticate, or install connector packages.
"""
import collections
import datetime
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

html_path, sitemap_path = map(Path, sys.argv[1:3])
html_bytes = html_path.read_bytes()
html = html_bytes.decode()
flight = []
for payload in re.findall(r'self\.__next_f\.push\((\[.*?\])\)</script>', html):
    part = json.loads(payload)
    if len(part) > 1 and isinstance(part[1], str):
        flight.append(part[1])
flight = ''.join(flight)
start = flight.index('"data":{"items":') + len('"data":')
data, _ = json.JSONDecoder().raw_decode(flight[start:])
items = data['items']
facts = []
for item in items:
    facts.append({
        'id': item['_id'], 'slug': item['slug'], 'name': item['title'],
        'publisher': item['author'], 'publisher_url': item['authorUrl'],
        'directory_type': item['type'], 'directory_categories': item['categories'] or [],
        'server_url': item['serverUrl'], 'interactive_app': item['hasMcpApp'],
        'verified_tier': item['verifiedTier'], 'works_with': item['worksWith'],
        'added_at': item['addedAt'],
        'listing_url': f"https://claude.com/marketplace/connectors/{item['slug']}",
    })
sitemap = ET.fromstring(sitemap_path.read_bytes())
urls = [element.text for element in sitemap.iter() if element.tag.endswith('}loc')]
slugs = {url.rsplit('/', 1)[-1] for url in urls if '/marketplace/connectors/' in url}
extracted_slugs = {item['slug'] for item in facts}
assert len(extracted_slugs) == len(facts), 'Duplicate slugs need investigation'
assert slugs == extracted_slugs, 'Sitemap and directory differ; reconcile before publishing'
manifest = {
    'captured_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'directory_url': 'https://claude.com/marketplace/connectors-plugins',
    'sitemap_url': 'https://claude.com/sitemap.xml',
    'source_html_sha256': hashlib.sha256(html_bytes).hexdigest(),
    'source_sitemap_sha256': hashlib.sha256(sitemap_path.read_bytes()).hexdigest(),
    'connector_count': len(facts), 'sitemap_connector_count': len(slugs),
    'types': dict(collections.Counter(row['directory_type'] for row in facts)),
    'published_endpoints': sum(bool(row['server_url']) for row in facts),
    'separate_plugin_count_excluded': data['pluginsTotal'],
    'evidence_scope': 'Full public connector directory metadata, reconciled to sitemap. No live account authorization or tool execution.',
}
out = Path(__file__).parent
(out / 'directory-facts.json').write_text(json.dumps(facts, indent=2, ensure_ascii=False) + '\n')
(out / 'capture-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
