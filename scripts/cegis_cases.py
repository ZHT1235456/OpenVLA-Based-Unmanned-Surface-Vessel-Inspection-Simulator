"""Independent harbor command specification. Expected results never call application code."""
from collections import Counter

PIER, WALL, RED, GREEN = '栈桥黄标', '防波堤黄标', '浮标门红标', '浮标门绿标'
EAST, WEST = '东泊位 · 返航靠泊', '西泊位 · 返航靠泊'
GATE = '浮标门 · 穿过浮标门'


def photo(mark):
    return mark + ' · 全景拍照'


def observe(mark):
    return mark + ' · 抵近观察'


def side(mark):
    return mark + ' · 换侧补拍'

def side_view(mark):
    return mark + ' · 换侧观察'


def conditional(mark, skipped=False):
    return '倾斜时 · ' + side(mark) + ('（跳过）' if skipped else '')


def corpus():
    cases = []
    phase = 'discovery'

    def row(group, text, a=(), b=(), *, dual=False, op='order', reason='', setup=(), condition='normal',
            layout=None, start_dual=False, selected='A', traffic=True):
        cases.append(dict(id=f'C{len(cases)+1:03}', phase=phase, group=group, text=text,
                          expected={'A':list(a), 'B':list(b)}, dual=dual, op=op, reason=reason,
                          setup=list(setup), condition=condition, layout=len(cases)%3 if layout is None else layout,
                          startDual=start_dual, selected=selected, traffic=traffic))

    # Scene specification: two yellow inspection buoys and two different channel marks.
    marks = [
        (PIER, '木栈桥旁的黄标', '木桥边的黄色浮标', '木平台附近的黄色航标'),
        (WALL, '防波堤内侧的黄标', '石堤旁的黄色浮标', '消波堤旁的黄色航标'),
        (RED, '浮标门的红标', '航道西侧的红色浮标', '浮标门西侧的红色航标'),
        (GREEN, '浮标门的绿标', '航道东侧的绿色浮标', '浮标门东侧的绿色航标'),
    ]
    for mark, short, longer, _ in marks:
        for text, action in [
            (f'去{short}拍照', photo), (f'给{longer}拍一张全景', photo),
            (f'抵近观察{short}', observe), (f'靠近{longer}，不用拍照', observe),
            (f'给{short}拍张侧面照', side), (f'只观察{longer}，不要按快门', observe),
            (f'绕到另一侧给{short}补一张', side),
        ]:
            row('目标与动作', text, [action(mark)])

    for text, tasks in [
        ('回东泊位', [EAST]), ('请返回西泊位', [WEST]), ('从港池返回东侧泊位', [EAST]),
        ('回到西侧泊位停靠', [WEST]), ('返航', [EAST]), ('穿过红绿浮标门', [GATE]),
        ('通过航标门，回东泊位', [GATE,EAST]), ('经过红绿浮标门，最后回西泊位', [GATE,WEST]),
        ('去栈桥黄标，只观察', [observe(PIER)]),
        ('先观察防波堤黄标，再拍一张', [observe(WALL),photo(WALL)]),
        ('先拍浮标门红标，然后拍浮标门绿标', [photo(RED),photo(GREEN)]),
        ('穿过红绿浮标门，再给绿标拍照，随后回到西泊位', [GATE,photo(GREEN),WEST]),
        ('靠近木栈桥黄标，先不要拍照', [observe(PIER)]),
        ('不要去木栈桥，去防波堤黄标拍照', [photo(WALL)]),
        ('别拍绿标，只看浮标门的红标', [observe(RED)]),
        ('先只观察绿标，之后再去木桥黄标拍照', [observe(GREEN),photo(PIER)]),
        ('先拍木栈桥黄标，最后回西泊位', [photo(PIER),WEST]),
        ('检查石堤边那座，再回东泊位', [observe(WALL),EAST]),
        ('先观察红标，栈桥黄标留到回程，最后返回东泊位', [observe(RED),observe(PIER),EAST]),
        ('先看一眼防波堤边的黄标，再去绿标拍照', [observe(WALL),photo(GREEN)]),
    ]:
        row('航线与顺序', text, tasks)

    for mark, short, _, _ in marks:
        row('同一目标的连续动作', f'先观察{short}，再拍一张，最后回西泊位',
            [observe(mark),photo(mark),WEST])
        row('经过与返航', f'穿过浮标门，只观察{short}，最后返回东泊位',
            [GATE,observe(mark),EAST])

    for text, tasks, cond in [
        ('先拍栈桥黄标，如果它一直歪着，换一侧补拍', [photo(PIER),conditional(PIER)], 'tilt'),
        ('先拍木桥边的黄标，若它持续倾斜，就换另一面补拍', [photo(PIER),conditional(PIER,True)], 'normal'),
        ('检查防波堤的黄标，如果它持续倾斜，换一侧补拍', [observe(WALL),conditional(WALL,True)], 'tilt'),
        ('先查栈桥黄标，再查防波堤黄标，如果哪座一直歪着就换侧补拍',
         [observe(PIER),conditional(PIER),observe(WALL),conditional(WALL,True)], 'tilt'),
        ('先查浮标门红标，若它持续倾斜就换侧补拍', [observe(RED),conditional(RED,True)], 'tilt'),
        ('如果栈桥黄标一直歪着，就换到另一面补拍', [conditional(PIER)], 'tilt'),
    ]:
        row('条件与侧拍', text, tasks, condition=cond)

    at_pier=[['去木栈桥旁的黄标拍照','active']]
    at_green=[['给浮标门的绿标拍照','active']]
    at_wall=[['给防波堤黄标拍照','active']]
    pier_done=[['给木桥旁的黄标拍照','done']]
    for text, prep, tasks in [
        ('追加防波堤黄标拍照',at_pier,[photo(PIER),photo(WALL)]),
        ('加一项，去观察浮标门的红标',at_green,[photo(GREEN),observe(RED)]),
        ('改去防波堤黄标拍照',at_pier,[photo(WALL)]),
        ('这座先别拍，先去查另一座，回来再补',at_pier,[observe(WALL),photo(PIER)]),
        ('改去浮标门红标，把绿标留到回程',at_green,[observe(RED),observe(GREEN)]),
        ('先前那座换个角度补拍',pier_done,[photo(PIER),side(PIER)]),
        ('给刚才那座补一张，把木栈桥也拍进去',pier_done,[photo(PIER),PIER+' · 带地标补拍']),
        ('查另一座',at_wall,[observe(PIER)]),
    ]:
        row('上下文与改派',text,tasks,setup=prep)
    for text, op, prep, tasks in [
        ('停船','hold',at_pier,[photo(PIER)]), ('原地等一下','hold',at_green,[photo(GREEN)]),
        ('请暂停航行','hold',at_wall,[photo(WALL)]),
        ('继续刚才的任务','resume',at_pier+[['停船','active']],[photo(PIER)]),
        ('恢复航行','resume',at_green+[['暂停任务','active']],[photo(GREEN)]),
        ('取消当前任务','cancel',at_pier,[]), ('清空所有巡检任务','cancel',at_green,[]),
        ('等保洁船通过后再走','traffic',at_pier,[photo(PIER)]),
    ]:
        row('航行控制',text,tasks,op=op,setup=prep,traffic=op!='traffic')

    for text, a, b in [
        ('A艇只观察木栈桥黄标，B艇给防波堤黄标拍照',[observe(PIER)],[photo(WALL)]),
        ('Ｂ艇观察航道西侧的红色浮标',[],[observe(RED)]),
        ('一号无人艇拍浮标门绿标，二号无人艇看一眼红标',[photo(GREEN)],[observe(RED)]),
        ('乙艇返回自己的泊位',[],[WEST]), ('B艇返航',[],[WEST]),
        ('A艇回东泊位，B艇回西泊位',[EAST],[WEST]),
        ('双艇分别巡检木栈桥和防波堤的黄标',[observe(WALL)],[observe(PIER)]),
        ('两艘无人艇分头观察红标和绿标，不必拍照',[observe(GREEN)],[observe(RED)]),
        ('双艇分别给绿标与红标拍照，最后返回各自泊位',[photo(GREEN),EAST],[photo(RED),WEST]),
        ('双艇分别巡检两座黄标',[observe(WALL)],[observe(PIER)]),
        ('全队返回各自泊位',[EAST],[WEST]),
        ('接力复核，A艇先查木栈桥黄标，B艇接力补拍',[observe(PIER),EAST],[side(PIER)]),
        ('接力，B艇先查防波堤黄标，A艇接力补拍',[side(WALL)],[observe(WALL),WEST]),
        ('接力复核，A艇给绿标拍照，B艇等首拍后补拍',[photo(GREEN),EAST],[side(GREEN)]),
        ('双艇接力，A艇拍栈桥黄标，B艇如果发现倾斜才补拍',[photo(PIER),EAST],[]),
    ]:
        row('双艇与通信',text,a,b,dual=True,layout=0)
    team_setup=[['A艇检查木栈桥黄标，B艇检查防波堤黄标','active']]
    row('双艇控制','全队暂停任务',[observe(PIER)],[observe(WALL)],dual=True,op='hold',setup=team_setup)
    row('双艇控制','双艇继续航行',[observe(PIER)],[observe(WALL)],dual=True,op='resume',setup=team_setup+[['两艇停船','active']])
    row('双艇控制','编队取消任务',dual=True,op='cancel',setup=team_setup)
    row('选中艇上下文','返回本艇泊位',[],[WEST],dual=True,start_dual=True,selected='B')

    # Negative pairs use independent physical constraints. Rejection must be atomic.
    for text, reason in [
        ('去木栈桥旁边的绿标拍照','绿标'), ('给防波堤旁的红色浮标拍照','红标'),
        ('去木桥边的蓝色航标补拍','蓝标'), ('给浮标门的黄标拍照','黄标'),
        ('去浮标门西侧的绿标拍照','西侧|东侧'), ('去浮标门东侧的红标拍照','西侧|东侧'),
        ('给黄标拍一张','两座|指定'), ('去浮标门拍照','红标|绿标|颜色'),
        ('给红或绿标拍照','多种|分别|颜色'), ('去东泊位的绿标拍照','绿标'),
        ('先观察防波堤黄标，最后拍木栈桥旁的绿标','绿标'),
        ('给绿标拍照，它在防波堤旁','绿标'), ('去木栈桥旁边，给绿色浮标拍照','绿标'),
        ('A艇回东泊位，B艇拍防波堤旁的绿标','绿标'),
        ('接力复核，A艇拍栈桥黄标，B艇补拍浮标门绿标','同一|不同'),
        ('双艇分别巡检栈桥绿标和防波堤黄标','绿标'),
        ('给紫色浮标拍照','紫标'), ('去木栈桥采水','设备|支持'),
        ('给它拍一张','目标|指定'), ('查另一座浮标','目标|指定'),
    ]:
        # Unbound deixis needs a fresh scene. Other rejections alternate idle and in-flight.
        prep=at_green if len(cases)%2 and '它拍' not in text and '另一座' not in text else []
        row('矛盾、歧义与能力边界',text,[photo(GREEN)] if prep else [],op='reject',reason=reason,setup=prep)

    # Held back until the repaired candidate passes the discovery corpus. Distinct wording and compositions.
    phase='holdout'
    for mark, _, _, phrase in marks:
        for text, tasks in [
            (f'请给{phrase}留一张全景照片',[photo(mark)]),
            (f'靠近{phrase}就好，不需要拍照',[observe(mark)]),
            (f'先观察{phrase}，然后给它拍照',[observe(mark),photo(mark)]),
            (f'请在{phrase}另一面补张照片',[side(mark)]),
            (f'先经过浮标门，再到{phrase}旁只观察，最后回西泊位',[GATE,observe(mark),WEST]),
        ]:
            row('留出 · 目标与组合',text,tasks)
    for text,a,b,dual in [
        ('甲艇观察防波堤黄标，乙艇给木桥黄标拍一张',[observe(WALL)],[photo(PIER)],True),
        ('B艇穿过浮标门，接着再回西泊位',[],[GATE,WEST],True),
        ('两艇分别观察木栈桥和防波堤旁的黄标，查完各自返航',[observe(WALL),EAST],[observe(PIER),WEST],True),
        ('双艇接力，B艇给航道红标拍照，A艇收到首拍后补拍',[side(RED)],[photo(RED),WEST],True),
        ('去浮标门红标补一张，然后回东泊位',[side(RED),EAST],[],False),
        ('先别去防波堤，给木平台旁的黄标留影',[photo(PIER)],[],False),
        ('从东泊位出发，穿过浮标门，再观察绿标',[GATE,observe(GREEN)],[],False),
        ('先给栈桥黄标拍一张，再观察石堤旁的黄标，最后回西泊位',[photo(PIER),observe(WALL),WEST],[],False),
    ]:
        row('留出 · 航线与协作',text,a,b,dual=dual,layout=0)
    for text,reason in [
        ('抵近观察木平台附近的红色航标','红标'), ('请去消波堤旁的绿色航标补一张','绿标'),
        ('给航道东侧的红色浮标补拍','西侧|东侧'), ('只观察航道西侧的绿色标体','西侧|东侧'),
        ('先回西泊位，随后拍木桥边的绿标','绿标'), ('乙艇检查港池内的白色航标','白标'),
    ]:
        row('留出 · 反例变体',text,[photo(PIER)],op='reject',reason=reason,setup=at_pier)
    # Preserve the IDs and wording of the original 151 scenarios. Check the shutter separately for
    # each leg, each vessel and each conditional outcome in these additional counterexamples.
    phase='discovery'
    for text, tasks in [
        ('去木栈桥旁的黄标', [observe(PIER)]),
        ('抵达防波堤内侧的黄标，随后返航靠泊', [observe(WALL),EAST]),
        ('巡检浮标门绿标，然后返回西泊位', [observe(GREEN),WEST]),
        ('去红标附近的拍照点观察', [observe(RED)]),
        ('查看上次拍摄的栈桥黄标', [observe(PIER)]),
        ('去绿标，禁止拍摄', [observe(GREEN)]),
        ('检查木栈桥黄标，不要再补拍', [observe(PIER)]),
        ('绕到防波堤黄标另一侧观察', [side_view(WALL)]),
        ('先巡检红标再去绿标拍照', [observe(RED),photo(GREEN)]),
        ('给浮标门绿标拍照，红标留到回程', [photo(GREEN),observe(RED)]),
        ('先检查栈桥黄标，再检查防波堤黄标，每座拍一张全景', [photo(PIER),photo(WALL)]),
        ('先查木栈桥黄标，再查防波堤黄标，每座只观察', [observe(PIER),observe(WALL)]),
        ('到栈桥黄标按下快门', [photo(PIER)]),
    ]:
        row('拍摄意图',text,tasks,layout=0)
    row('拍摄意图','改去浮标门红标', [observe(RED)],setup=at_green)
    row('拍摄意图','这座先别拍，去查另一座', [observe(WALL)],setup=at_pier)
    for text, tasks, condition in [
        ('巡检木栈桥黄标，如果持续倾斜就换一侧观察',
         [observe(PIER),'倾斜时 · '+side_view(PIER)],'tilt'),
        ('检查防波堤黄标，只有持续倾斜才拍一张全景',
         [observe(WALL),'倾斜时 · '+photo(WALL)+'（跳过）'],'normal'),
        ('检查栈桥黄标，如果一直歪着，再拍一张全景',
         [observe(PIER),'倾斜时 · '+photo(PIER)],'tilt'),
    ]:
        row('按条件启用快门',text,tasks,condition=condition)
    for text,a,b in [
        ('两艇分头检查红标与绿标',[observe(GREEN)],[observe(RED)]),
        ('双艇分工，给栈桥黄标拍照，检查防波堤黄标',[observe(WALL)],[photo(PIER)]),
        ('双艇分别巡检两座黄标，只给防波堤黄标拍照',[photo(WALL)],[observe(PIER)]),
        ('A艇巡检防波堤黄标，B艇拍木栈桥黄标',[observe(WALL)],[photo(PIER)]),
        ('接力复核，A艇检查栈桥黄标，B艇换侧观察',[observe(PIER),EAST],[side_view(PIER)]),
        ('接力，A艇只观察栈桥黄标，B艇收到回报再补拍',[observe(PIER),EAST],[side(PIER)]),
        ('双艇接力，A艇拍防波堤黄标，B艇换侧复核',[photo(WALL),EAST],[side_view(WALL)]),
        ('双艇接力，B艇检查红标，A艇若发现倾斜才补拍',[],[observe(RED),WEST]),
    ]:
        row('逐艇拍摄意图',text,a,b,dual=True,layout=0)
    assert len({c['text'] for c in cases})==len(cases)
    assert sum(c['op']!='reject' for c in cases)>=100
    return cases


if __name__=='__main__':
    rows=corpus()
    print(len(rows), Counter(c['phase'] for c in rows), Counter(c['op'] for c in rows))
