"""Read-only snapshot checks. Usage: python audit_reproduce.py REPO_ROOT

Obtain upstream data separately under its own license. This package contains no
upstream question bank. Never evaluates upstream question['verify'] code.
"""
import collections
import hashlib
import json
import sys
from pathlib import Path

def git_blob(raw):
    return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()

def run(root):
    here=Path(__file__).resolve().parent
    evidence=json.loads((here/'evidence.json').read_text())
    data=root/'data' if (root/'data').is_dir() else root
    raw={n:(data/n).read_bytes() for n in evidence['source_fingerprints']}
    for name,expected in evidence['source_fingerprints'].items():
        assert git_blob(raw[name])==expected['git_blob'],f'Wrong snapshot: {name}'
    topics=json.loads(raw['topics.json']);questions=json.loads(raw['questions.json']);edges=json.loads(raw['dependencies.json'])
    alltopics={t['id']:t for t in topics}
    primary={k:v for k,v in alltopics.items() if k.startswith('cnm_p')}
    upper={k:v for k,v in primary.items() if v['grade'] in (5,6)}
    pq=[q for q in questions if q['topicId'] in primary]
    uq=[q for q in questions if q['topicId'] in upper]
    pe=[e for e in edges if e['topicId'] in primary]
    assert len(primary)==259 and len(pq)==1036
    assert len(upper)==100 and len(uq)==400
    assert all(e['prerequisiteId'] in alltopics for e in pe)
    assert len(pe)==406 and sum(e['topicId'] in upper for e in pe)==178
    bytopic=collections.defaultdict(list)
    for q in pq: bytopic[q['topicId']].append(q)
    for tid in upper:
        assert collections.Counter(q['difficulty'] for q in bytopic[tid])=={'basic':2,'standard':1,'challenge':1}
    adj={tid:[] for tid in primary}
    for e in pe:
        if e['prerequisiteId'] in primary: adj[e['topicId']].append(e['prerequisiteId'])
    done=set();active=set()
    def visit(n):
        assert n not in active,'Cycle in original graph'
        if n in done:return
        active.add(n)
        for p in adj[n]:visit(p)
        active.remove(n);done.add(n)
    for n in adj:visit(n)
    qmap={q['id']:q for q in pq}
    for record in evidence['records']:
        q=qmap[record['question_id']]
        assert q['topicId']==record['topic_id']
        assert q['difficulty']==record['stored_difficulty']
        actual={(e['prerequisiteId'],e['strength']) for e in pe if e['topicId']==q['topicId']}
        recorded={(e['id'],e['strength']) for e in record['direct_prerequisites']}
        assert actual==recorded
    extension=json.loads((here/'extension-proposal.json').read_text())
    caps={c['id']:c for c in extension['capabilities']}
    assert len(caps)==len(extension['capabilities'])
    for c in caps.values():
        for ref in c['prerequisites']['all_of']+sum(c['prerequisites']['any_of_paths'],[]):
            assert ref in alltopics or ref in caps
        assert not c['review']['teacher_reviewed']
    for q in extension['questions']:
        assert set(q['capability_ids'])<=caps.keys()
        assert not q['review']['teacher_reviewed']
        seen=set()
        for step in q['solution_steps']:
            assert step['id'] not in seen
            assert set(step['depends_on'])<=seen
            assert step['capability_id'] in caps
            seen.add(step['id'])
    print(json.dumps({'commit':evidence['commit'],'primary_topics':len(primary),'upper_topics':len(upper),'upper_questions':len(uq),'upper_difficulty':dict(collections.Counter(q['difficulty'] for q in uq)),'primary_edges':len(pe),'detailed_records':len(evidence['records']),'status':'snapshot_and_references_verified'},ensure_ascii=False,indent=2))

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit(__doc__)
    run(Path(sys.argv[1]).resolve())
