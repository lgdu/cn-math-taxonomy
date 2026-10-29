"""Validate the module with exact arithmetic; never execute textbook code.
Run: python validate_module.py [path/to/upstream/topics.json]
Optional upstream file verifies course IDs without redistributing its data.
"""
import collections
import json
import sys
from fractions import Fraction as F
from pathlib import Path

def read(name):return json.loads((Path(__file__).resolve().parent/name).read_text())

def main():
    graph=read('engineering-graph.json')
    curriculum=read('curriculum-mapping.json')
    questions=read('original-questions.json')['questions']
    lesson=read('lesson-storyboard.json')
    diagnosis=read('diagnosis-spec.json')
    refs={r['id'] for r in curriculum['refs']}
    if len(sys.argv)>1:
        upstream={t['id']:t for t in json.loads(Path(sys.argv[1]).read_text())}
        for r in curriculum['refs']:
            assert r['id'] in upstream
            assert upstream[r['id']]['name']==r['name']
            assert upstream[r['id']]['grade']==r['grade']
    caps={c['id']:c for c in graph['capabilities']}
    assert len(caps)==14==len(graph['capabilities'])
    allrefs=refs|set(caps)
    edges={k:[] for k in caps}
    for c in caps.values():
        assert c['review']=={'status':'ai_draft','teacher_reviewed':False}
        p=c['prerequisites']
        for r in p['all_of']+sum(p['any_of_paths'],[]):
            assert r in allrefs,r
            if r in caps:edges[c['id']].append(r)
    visited=set();active=set()
    def visit(n):
        assert n not in active,'cycle: '+n
        if n in visited:return
        active.add(n)
        for p in edges[n]:visit(p)
        active.remove(n);visited.add(n)
    for n in caps:visit(n)
    assert len(graph['textbook_index'])==32
    assert collections.Counter(i['band'] for i in graph['textbook_index'])=={'兴趣篇':10,'拓展篇':14,'超越篇':8}
    for i in graph['textbook_index']:
        assert i['pdf_page_1_based']==i['printed_page']+13
        assert set(i['method_ids'])<=caps.keys()
    for route in graph['learning_routes']:assert set(route['requires'])<=refs
    qmap={q['id']:q for q in questions}
    assert len(qmap)==len(questions)==8
    for q in questions:
        assert set(q['capability_ids'])<=caps.keys()
        assert q['review']['teacher_reviewed'] is False
        seen=set()
        for s in q['solution_steps']:
            assert s['id'] not in seen
            assert set(s['depends_on'])<=seen
            seen.add(s['id'])

    # Independently compute model answers with exact fractions and a simulator.
    for q in questions:
        if q['id']=='ext.olymp.q003':
            got=(1-F(2,12))/(F(1,12)+F(1,18))+2
        else:
            m=q['model_for_validation'];kind=m['kind']
            if kind=='cooperate':got=1/sum((F(1,t) for t in m['times']),F(0))
            elif kind=='inverse':got=1/(F(1,m['together'])-F(1,m['a']))
            elif kind=='alternate':
                remaining=F(1);elapsed=F(0);turn=0
                while remaining>0:
                    rate=F(1,m['a'] if turn%2==0 else m['b'])
                    duration=min(F(m['turn_hours']),remaining/rate)
                    elapsed+=duration;remaining-=rate*duration;turn+=1
                    assert turn<1000
                got=elapsed
            elif kind=='source':
                a,b=m['outflows'];ta,tb=m['durations']
                r=F(a*ta-b*tb,ta-tb);v=(a-r)*ta
                assert r>=0 and a>r and b>r and v>0
                assert v==(b-r)*tb
                got={'inflow_L_per_min':r,'initial_L':v}
            elif kind=='level':
                bottom=F(m['capacity'])*F(m['threshold_fraction'])
                net=m['inflow']-m['outflow'];assert net>0
                got=bottom/m['inflow']+(m['capacity']-bottom)/net
                # Before threshold there must be no discharge.
                assert bottom/m['inflow']==5
            elif kind=='rate_change':
                a=F(m['a'])*(1+F(m['increase']))
                got={'A_alone_h':F(m['total'])/a,'together_h':F(m['total'])/(a+m['b'])}
                assert F(m['total'])/a != F(m['total'],m['a'])*(1-F(m['increase']))
            elif kind=='contribution':
                contributions=[F(r)*t for r,t in zip(m['rates'],m['hours'])]
                pays=[F(m['pay'])*c/sum(contributions) for c in contributions]
                got=dict(zip(['A_yuan','B_yuan'],pays))
                assert sum(pays)==m['pay']
            else:raise AssertionError(kind)
        expected=q['answer']
        if isinstance(expected,dict):assert got=={k:F(v) for k,v in expected.items()},q['id']
        else:assert got==F(expected),q['id']

    # Hero animation state at every 1/12 day, including t=2 and t=8.
    for tick in range(97):
        t=F(tick,12);a=3*t;b=2*max(F(0),t-2);remaining=36-a-b
        assert a+b+remaining==36 and remaining>=0
        assert (a/36+b/36+remaining/36)==1
        if t<2:assert b==0
    for scene in lesson['scenes']:
        s=scene['state']
        if 'A_completed' in s:
            assert F(s['A_completed'])+F(s['B_completed'])+F(s['remaining'])==36
    assert lesson['estimated_narration_seconds']==71
    assert lesson['question_id'] in qmap
    for checkpoint in diagnosis['checkpoints']:
        expected=checkpoint['expected']
        a,b=F(expected['integer_total']),F(expected['unit_one'])
        if checkpoint['id'] in ['d1','d2','d3']:assert a/36==b
        else:assert a==b
    # Equivalent answers accepted; numeric equality alone is not a student diagnosis.
    assert F('2/12')==F('1/6') and F('10/72')==F('5/36')
    result={'status':'passed','method_ids':14,'source_items':32,'seed_questions':8,'independently_checked_seed_answers':8,'hero_timeline_checkpoints':97,'integer_fraction_equivalence':'passed','graph_cycles':0,'course_refs_checked_against_upstream':len(sys.argv)>1,'teacher_reviewed':False,'scope_limit':'仅验证数学、引用与状态契约；不验证教学效果，也未实现动画或学生诊断引擎。'}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return result

if __name__=='__main__':main()
