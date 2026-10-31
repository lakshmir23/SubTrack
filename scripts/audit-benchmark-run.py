"""Independent analysis of preserved raw performance observations and read-only DB."""
import collections
import hashlib
import json
import math
import pathlib
import sqlite3
import statistics
import sys

result_path = pathlib.Path(sys.argv[1]).resolve()
raw = result_path.read_bytes()
r = json.loads(raw)
errors = []
warnings = []
def check(value, message):
    if not value:
        errors.append(message)
check(r['completion']['state'] == 'complete', 'Benchmark is incomplete')
dirty_paths = [line[3:] for line in r['metadata'].get('worktree', '').splitlines() if line]
runtime_dirty = [path for path in dirty_paths if not (path.startswith('docs/') or path in ('README.md', 'DESIGN.md', 'PRODUCT.md', 'UX-CONTRACT.md'))]
check(not runtime_dirty, 'Measured runtime/harness source had uncommitted changes')
if dirty_paths and not runtime_dirty:
    warnings.append('Uncommitted documentation paths were recorded; runtime/harness source was clean.')
observations = r['observations']
check(bool(observations), 'No observations were recorded')
check(not [x for x in observations if x.get('error')], 'Observed timing/readiness errors')
check(r['completion'].get('errors') == sum(bool(x.get('error')) for x in observations), 'Completion error count differs from raw observations')
check(all(isinstance(x.get('milliseconds'), (int, float)) and math.isfinite(x['milliseconds']) and x['milliseconds'] >= 0 for x in observations), 'A timing is invalid or negative')
groups = collections.defaultdict(list)
for o in observations:
    groups[(o['kind'], o['id'])].append(o)
pages = r['metadata']['inventory']
actions = r['metadata']['actionInventory']
expected_samples = r['metadata']['samples']
selection = r['metadata'].get('selection', {})
only = selection.get('only')
concurrent_only = selection.get('concurrentOnly', False)
skip_api = selection.get('skipApi', False) or concurrent_only
skip_concurrent = selection.get('skipConcurrent', False)
skip_batch = selection.get('skipBatch', False) or concurrent_only
cold_samples = selection.get('coldSamples', 1)
check(isinstance(expected_samples, int) and expected_samples > 0, 'Invalid declared warm sample count')
check(isinstance(cold_samples, int) and cold_samples > 0, 'Invalid declared cold sample count')
check(len({p['id'] for p in pages}) == len(pages), 'Duplicate page descriptor IDs')
check(len({p['id'] for p in actions}) == len(actions), 'Duplicate action descriptor IDs')
if not only:
    check(len(pages) == 93 and len(actions) == 14, 'Unfiltered inventory is not the declared complete 93 pages and 14 actions')
else:
    check(bool(pages or actions), 'Selected subset matched no destinations or actions')
if not concurrent_only:
    for p in pages:
        check(len(groups[('page-cold-browser', p['id'])]) == cold_samples, 'Wrong cold page count ' + p['id'])
        check(sorted(x['sample'] for x in groups[('page-cold-browser', p['id'])]) == list(range(cold_samples)), 'Missing/duplicate cold page samples ' + p['id'])
        check(len(groups[('page-warm', p['id'])]) == expected_samples, 'Wrong warm page count ' + p['id'])
        check(sorted(x['sample'] for x in groups[('page-warm', p['id'])]) == list(range(1, expected_samples + 1)), 'Missing/duplicate warm page samples ' + p['id'])
    for p in actions:
        check(len(groups[('action-warm', p['id'])]) == expected_samples, 'Wrong warm action count ' + p['id'])
        check(sorted(x['sample'] for x in groups[('action-warm', p['id'])]) == list(range(1, expected_samples + 1)), 'Missing/duplicate warm action samples ' + p['id'])
else:
    check(not [x for x in observations if x['kind'] in ('page-cold-browser', 'page-warm', 'action-warm')], 'Concurrent-only run unexpectedly reports single-user page/action measurements')
api_ids = {role['role'] + ':' + endpoint for role in pages + actions for endpoint in role['apiPaths']}
if not skip_api:
    check(bool(api_ids), 'No API endpoints declared for an API measurement run')
    for identifier in api_ids:
        check(len(groups[('api-cold-server', identifier)]) == 1, 'Missing cold API ' + identifier)
        check(len(groups[('api-warm', identifier)]) == expected_samples, 'Wrong warm API count ' + identifier)
        check(sorted(x['sample'] for x in groups[('api-warm', identifier)]) == list(range(1, expected_samples + 1)), 'Missing/duplicate warm API samples ' + identifier)
else:
    check(not [x for x in observations if x['kind'] in ('api-cold-server', 'api-warm')], 'Skipped API scope unexpectedly reports API observations')
expected_concurrency = not skip_concurrent and (not only or concurrent_only)
concurrent_rows = [x for x in observations if x['kind'] == 'page-concurrent']
if expected_concurrency:
    workloads = ['subscriptions', 'finance', 'invoices']
    if 'mixed operational workload' in r['metadata'].get('protocol', {}).get('concurrency', '').lower():
        workloads.append('mixed-operations')
    for workload in workloads:
        for index, role in enumerate(['admin', 'staff', 'customer', 'staff', 'customer']):
            identifier = f'five-users:{workload}:{role}:{index}'
            rows = groups[('page-concurrent', identifier)]
            check(len(rows) == 10 and sorted(x['sample'] for x in rows) == list(range(1, 11)), 'Missing/duplicate concurrent samples ' + identifier)
    check(len(concurrent_rows) == len(workloads) * 5 * 10, 'Concurrent observation count differs from declared workloads')
else:
    workloads = []
    check(not concurrent_rows, 'Skipped concurrency scope unexpectedly reports concurrent observations')

stats = []
for (kind, identifier), rows in groups.items():
    times = sorted(row['milliseconds'] for row in rows)
    if not times:
        continue
    stats.append(dict(kind=kind, id=identifier, count=len(rows), median=statistics.median(times), p95=times[max(0, math.ceil(len(times) * .95) - 1)], max=max(times)))
breaches = [dict(id=x['id'], kind=x['kind'], sample=x['sample'], milliseconds=x['milliseconds']) for x in observations if x['milliseconds'] >= 2000]
check(r['completion'].get('breaches') == len(breaches) == len(r.get('breaches', [])), 'Recorded breach count differs from raw observations')

runtime_path = result_path.parent / 'runtime.sqlite'
db = sqlite3.connect(runtime_path.as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
tables = ['users', 'subscriptions', 'invoices', 'invoice_lines', 'payments', 'logical_charges', 'lifecycle_events']
counts = {table: db.execute('select count(*) from ' + table).fetchone()[0] for table in tables}
check(counts == r['metadata']['startSnapshot']['counts'], 'Runtime baseline counts changed during read-only timings')
check(counts == r['metadata']['endSnapshot']['counts'], 'Recorded final counts differ from independent runtime counts')
schema = db.execute('select max(version) from schema_migrations').fetchone()[0]
check(schema == 11, 'Runtime schema is not expected measured-index version11')
fk = [dict(x) for x in db.execute('pragma foreign_key_check')]
integrity = db.execute('pragma integrity_check').fetchone()[0]
check(not fk and integrity == 'ok', 'Final runtime relational integrity failed')
triggers = [dict(x) for x in db.execute("select name,sql from sqlite_master where type='trigger' order by name")]
guard_names = ['invoice_financial_snapshot_immutable', 'invoice_line_no_update', 'invoice_no_delete', 'payment_allocation_guard', 'payment_apply_allocation', 'payment_no_update', 'payment_no_delete', 'invoice_payment_facts_guard', 'discount_capacity_insert', 'subscription_accepted_immutable']
trigger_names = {x['name'] for x in triggers}
for guard in guard_names:
    check(guard in trigger_names, 'Missing financial guard ' + guard)
indexes = [dict(x) for x in db.execute("select name,sql from sqlite_master where type='index' and sql is not null order by name")]
plans = {table: [dict(x) for x in db.execute('EXPLAIN QUERY PLAN select * from ' + table + ' order by created_at desc,id limit 20 offset 0')] for table in ['subscriptions', 'invoices']}
for table, plan in plans.items():
    text = ' '.join(x['detail'] for x in plan)
    check(table + '_created_page' in text and 'TEMP B-TREE' not in text, 'Measured ordering index not used by ' + table)
stages = [dict(x) for x in db.execute('select stage,count(*) as n from subscriptions group by stage')]
check(stages == r['metadata']['startSnapshot']['stages'] == r['metadata']['endSnapshot']['stages'], 'Stage distribution changed during read-only benchmark')
db.close()

batch = r['metadata'].get('batch')
batch_result = None
expected_batch = not skip_batch and not only and not concurrent_only
check(bool(batch) == expected_batch, 'Persisted batch evidence is missing or outside declared scope')
if batch:
    p = pathlib.Path(batch['isolatedDatabase']).resolve()
    batch_db = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True)
    batch_db.row_factory = sqlite3.Row
    run_id = batch['run']['id']
    outcomes = dict(batch_db.execute('select outcome,count(*) from billing_run_items where run_id=? group by outcome', (run_id,)).fetchall())
    duplicates = batch_db.execute('select subscription_id,period_start,count(*) from logical_charges group by subscription_id,period_start having count(*)>1').fetchall()
    run = dict(batch_db.execute('select * from billing_runs where id=?', (run_id,)).fetchone())
    check(run['processed'] == sum(outcomes.values()) and run['processed'] == 250, 'Batch persisted item/counter reconciliation failed')
    for outcome, counter in [('created', 'created_count'), ('alreadyExisting', 'existing_count'), ('nonbillable', 'nonbillable_count'), ('failed', 'failed_count')]:
        check(run[counter] == outcomes.get(outcome, 0), 'Batch outcome counter differs from persisted rows: ' + outcome)
    check(not duplicates and batch['replaySameRun'], 'Batch duplicate/replay failure')
    check(run['status'] == 'completed', 'Batch did not complete')
    check(batch['acknowledgmentMs'] < 2000, 'Batch acknowledgment breached response target')
    probe_breaches = [p for p in batch['probes'] if p['milliseconds'] >= 2000 or p['status'] != 200]
    check(not probe_breaches, 'Finance probes during batch failed or breached target')
    batch_result = dict(processed=run['processed'], outcomes=outcomes, acknowledgmentMs=batch['acknowledgmentMs'], completionMs=batch['completionMs'], duplicatePeriods=len(duplicates), probeCount=len(batch['probes']), probeBreaches=probe_breaches)
    batch_db.close()

protocol_errors = list(errors)
check(not breaches, 'Observed responses at or above 2,000 ms; affected follow-up evidence is required')
scope = 'concurrent-only supplement' if concurrent_only else 'selected page/action subset' if only else 'all page/action destinations'
out = dict(passed=not errors, protocolPassed=not protocol_errors, responseTargetMet=not breaches, errors=errors, warnings=warnings, scope=dict(kind=scope, selection=selection, pagesMeasured=not concurrent_only, apiMeasured=not skip_api, concurrentWorkloads=workloads, batchMeasured=bool(batch)), rawResultsPath=str(result_path), rawResultsSha256=hashlib.sha256(raw).hexdigest(), commit=r['metadata']['commit'], countsByKind=dict(collections.Counter(x['kind'] for x in observations)), pageDescriptors=len(pages), actionDescriptors=len(actions), declaredRoleApiEndpoints=len(api_ids), measuredRoleApiEndpoints=len({x['id'] for x in observations if x['kind'] == 'api-warm'}), breaches=breaches,
    worst=sorted(stats, key=lambda x:x['max'], reverse=True)[:15], runtime=dict(schemaVersion=schema, sqliteIntegrity=integrity, foreignKeyViolations=len(fk), counts=counts, stages=stages, triggers=triggers, indexes=indexes, globalListPlans=plans), batch=batch_result,
    limitations=['Statistics derived independently from preserved raw observations; conventional even-count median used.', 'Browser cold means empty browser cache, not flushed OS filesystem caches.', 'Main mixed-role concurrency includes two customer finance-denial destinations; supplemental operational workload is separate.', 'This audit is evidence of the measured local configuration, not a security certification or deployment claim.'])
print(json.dumps(out, indent=2))
sys.exit(0 if not errors else 1)
