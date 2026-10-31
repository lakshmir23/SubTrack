"""Independent, read-only audit of the synthetic P8 database. No application imports."""
import calendar
import collections
import datetime as dt
import json
import pathlib
import sqlite3
import sys

path = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads(pathlib.Path(str(path) + '.manifest.json').read_text(encoding='utf-8'))
db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
errors = []
checks = []

def check(condition, message):
    if not condition:
        errors.append(message)

def boundary(anchor, cadence, index):
    d = dt.date.fromisoformat(anchor)
    if cadence in ('daily', 'weekly'):
        return (d + dt.timedelta(days=index * (7 if cadence == 'weekly' else 1))).isoformat()
    absolute = d.year * 12 + d.month - 1 + index * (12 if cadence == 'yearly' else 1)
    y, m0 = divmod(absolute, 12)
    return dt.date(y, m0 + 1, min(d.day, calendar.monthrange(y, m0 + 1)[1])).isoformat()

check(db.execute('pragma integrity_check').fetchone()[0] == 'ok', 'SQLite integrity_check failed')
check(not db.execute('pragma foreign_key_check').fetchall(), 'Foreign key violations')
checks.append('SQLite integrity and foreign keys')
subs = {r['id']: dict(r) for r in db.execute('select * from subscriptions')}
invoices = {r['id']: dict(r) for r in db.execute('select * from invoices')}
charges = {r['id']: dict(r) for r in db.execute('select * from logical_charges')}
payments = [dict(r) for r in db.execute('select * from payments')]
lines = collections.defaultdict(list)
for r in db.execute('select * from invoice_lines'):
    lines[r['invoice_id']].append(dict(r))
by_sub = collections.defaultdict(list)
for c in charges.values():
    by_sub[c['subscription_id']].append(c)
for s in subs.values():
    terms = json.loads(s['accepted_terms_json'] or s['offered_terms_json'] or s['terms_json'])
    s['_terms'] = terms
    cadence = terms['plan']['interval']
    check(s['expiry_date'] == boundary(s['start_date'], cadence, s['term_periods']), f"Expiry anchor mismatch {s['id']}")
    next_boundary = boundary(s['start_date'], cadence, s['next_period_index'])
    expected_projection = next_boundary if s['accepted_terms_json'] and next_boundary < s['expiry_date'] else None
    check(s['next_billing_date'] == expected_projection, f"Cursor projection mismatch {s['id']}")
    decided = {c['period_start']: c for c in by_sub[s['id']] if c['outcome'] != 'failed'}
    for index in range(s['next_period_index']):
        start = boundary(s['start_date'], cadence, index)
        end = boundary(s['start_date'], cadence, index + 1)
        c = decided.get(start)
        check(c is not None and c['period_end'] == end, f"Cursor skipped undecided period {s['id']}:{index}")
    for c in by_sub[s['id']]:
        # Expected indices are bounded by the recorded term; no 30-day approximation.
        start_index = next((n for n in range(s['term_periods']) if boundary(s['start_date'], cadence, n) == c['period_start']), None)
        check(start_index is not None and boundary(s['start_date'], cadence, start_index + 1) == c['period_end'], f"Charge off calendar {c['id']}")
        if c['outcome'] != 'failed':
            check(start_index is not None and start_index < s['next_period_index'], f"Decided charge beyond cursor {c['id']}")
        if c['outcome'] == 'invoiced':
            i = invoices.get(c['current_invoice_id'])
            check(i is not None and i['logical_charge_id'] == c['id'], f"Bad current invoice pointer {c['id']}")
        else:
            check(c['current_invoice_id'] is None, f"Non-invoiced charge has invoice pointer {c['id']}")
checks.append('Every subscription expiry/cursor and every logical period independently recalculated')

payment_sum = collections.Counter()
payment_count = collections.Counter()
for p in payments:
    payment_sum[p['invoice_id']] += p['amount']
    payment_count[p['invoice_id']] += 1
    i = invoices[p['invoice_id']]
    check(p['amount'] > 0 and p['currency'] == i['currency'], f"Invalid allocation {p['id']}")
    check(p['payment_date'] <= manifest['businessDate'], f"Future payment {p['id']}")
    check(charges[i['logical_charge_id']]['current_invoice_id'] == i['id'], f"Allocation to superseded invoice {p['id']}")

for i in invoices.values():
    check(i['amount_paid'] == payment_sum[i['id']] and i['payment_count'] == payment_count[i['id']], f"Payment facts/cache mismatch {i['id']}")
    check(sum(x['subtotal'] for x in lines[i['id']]) == i['subtotal'], f"Invoice subtotal differs from lines {i['id']}")
    check(sum(x['discount'] for x in lines[i['id']]) == i['discount'], f"Invoice discount differs from lines {i['id']}")
    check(sum(x['tax'] for x in lines[i['id']]) == i['tax'], f"Invoice tax differs from lines {i['id']}")
    check(sum(x['total'] for x in lines[i['id']]) == i['total'], f"Invoice total differs from lines {i['id']}")
    check(i['total'] == i['subtotal'] - i['discount'] + i['tax'], f"Invoice arithmetic mismatch {i['id']}")
    check((i['status'] == 'Paid') == (i['status'] not in ('Draft', 'Canceled') and i['amount_paid'] == i['total']), f"Paid state mismatch {i['id']}")
    check(i['total'] > 0 or i['payment_count'] == 0, f"Fake zero-total payment {i['id']}")
    s = subs[i['subscription_id']]
    check(i['customer_id'] == s['customer_id'] and i['customer_email'] == s['customer_email'], f"Invoice ownership mismatch {i['id']}")
    accepted = {x['id']: x for x in s['_terms']['lines']}
    for l in lines[i['id']]:
        a = accepted.get(l['subscription_line_id'])
        check(a is not None, f"Invoice line not accepted {l['id']}")
        if a:
            check(l['unit_price'] == a['unitPrice'] and l['base_unit_price'] == a['baseUnitPrice'] and l['variant_adjustment'] == a['variantAdjustment'] and l['quantity'] == a['quantity'], f"Accepted price/quantity mismatch {l['id']}")
        expected_tax = ((l['subtotal'] - l['discount']) * l['tax_rate_bps'] + 5000) // 10000
        check(l['tax'] == expected_tax and l['total'] == l['subtotal'] - l['discount'] + expected_tax, f"Line exact tax/total mismatch {l['id']}")
checks.append('Every invoice line, immutable accepted price, exact tax and payment-derived settlement')

for a in db.execute('select * from discount_applications'):
    i = invoices[a['invoice_id']]
    snapshot = json.loads(i['discount_snapshot_json']) if i['discount_snapshot_json'] else None
    check(snapshot is not None and snapshot['id'] == a['rule_id'] and i['discount'] == a['amount'], f"Discount application mismatch {a['id']}")
    if a['state'] == 'reserved':
        check(i['status'] == 'Draft', f"Non-Draft reservation {a['id']}")
    if a['state'] == 'released':
        check(i['status'] == 'Canceled', f"Non-canceled released application {a['id']}")
    if a['state'] == 'consumed':
        check(i['status'] != 'Draft', f"Draft consumed application {a['id']}")
checks.append('Discount application snapshot and reservation/consumption state')

billed = sum(i['total'] for i in invoices.values() if i['status'] in ('Confirmed', 'Paid'))
outstanding = sum(i['total'] - i['amount_paid'] for i in invoices.values() if i['status'] == 'Confirmed')
overdue = sum(i['total'] - i['amount_paid'] for i in invoices.values() if i['status'] == 'Confirmed' and i['due_date'] < manifest['businessDate'])
received = sum(p['amount'] for p in payments)
totals = {k: str(v) for k, v in dict(billed=billed, received=received, outstanding=outstanding, overdue=overdue).items()}
check(totals == manifest['totals'], 'Manifest finance totals differ from independent facts')
check(len(subs) == 10000 and len(invoices) == 30000, 'Required 10k/30k dataset shape missing')
check(len({s['_terms']['plan']['interval'] for s in subs.values()}) == 4, 'Missing cadence')
check(len({s['stage'] for s in subs.values()}) == 5, 'Missing subscription stage')
checks.append('Independent full-dataset finance and mandatory distribution')
result = dict(passed=not errors, databasePath=str(path), counts=dict(subscriptions=len(subs), invoices=len(invoices), payments=len(payments), invoiceLines=sum(map(len, lines.values())), logicalCharges=len(charges)), totals=totals, checks=checks, errorCount=len(errors), errors=errors[:100])
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
