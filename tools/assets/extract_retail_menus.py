"""Compile installed retail menu data; no hand-written title-only substitutes."""

# Locate shared tools from both the checkout and the browser's virtual filesystem.
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(next(p for p in _ToolPath(__file__).resolve().parents
                                    if (p / 'lib/project.py').is_file())))
from lib.project import ROOT as _PROJECT_ROOT, tool_script as _tool_script

import argparse, hashlib, json, re, subprocess, zipfile
from pathlib import Path

ROOT = _PROJECT_ROOT
TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|[{};,]|[^\s{};,"]+')
def value(t):
    return t[1:-1].replace(r'\"', '"').replace(r'\n', '\n') if t.startswith('"') else t

BLOCKS = set('accept onopen onclose onesc action mouseenter mouseexit mouseentertext mouseexittext onfocus leavefocus doubleclick dvarstrlist dvarfloatlist showdvar hidedvar enabledvar disabledvar'.split())
ARITY = dict.fromkeys('name group text dvar dvartest background type style visible fullscreen textfont textscale textstyle textalign textalignx textaligny border bordersize outlinecolor ownerdraw ownerdrawflag align feeder elementwidth elementheight elementtype maxchars maxpaintchars soundloop focuscolor disablecolor cinematic exp material teamcolor hotkey dvarenum accept dvarenumlist'.split(), 1)
ARITY.update(dict.fromkeys('forecolor backcolor bordercolor focuscolor disablecolor outlinecolor'.split(), 4))
ARITY.update(dict.fromkeys('maxcharsgotonext decoration popup outofboundsclick wrapped autowrapped horizontalscroll notselectable noscrollbars'.split(), 0))
ARITY.update(origin=2, rect=4, dvarfloat=4, dvarint=4, dvartest=1, columns=-1)
ARITY.update(blurworld=1)

class Parser:
    def __init__(self, text): self.t = TOKEN.findall(text); self.i=0
    def take(self):
        t=self.t[self.i]; self.i+=1; return t
    def block_tokens(self):
        assert self.take()=='{'; depth=1; out=[]
        while depth:
            t=self.take(); depth += (t=='{')-(t=='}')
            if depth: out.append(t)
        return out
    def props(self):
        assert self.take()=='{'; p={}; items=[]
        while self.t[self.i]!='}':
            k=self.take().lower()
            if k in [';', ',']: continue
            if k=='itemdef': items.append(self.props()); continue
            if k in ['execkey','execkeyint']:
                key=value(self.take());p.setdefault('exec_keys',{})[key]=self.block_tokens();continue
            if k in BLOCKS: p[k]=self.block_tokens(); continue
            if k not in ARITY: raise ValueError(f'Unknown property {k}: {self.t[max(0,self.i-8):self.i+12]}')
            n=ARITY[k]
            if n==-1:
                count=int(self.take()); p[k]=[self.take() for _ in range(count*3)];continue
            v=[value(self.take()) for _ in range(n)]
            if k=='rect':
                for _ in range(2):
                    if self.i<len(self.t) and re.fullmatch(r'-?\d+',self.t[self.i]): v.append(self.take())
            if k=='origin':
                r=p.setdefault('rect',['0','0','0','0']);r[0]=str(float(r[0])+float(v[0]));r[1]=str(float(r[1])+float(v[1]))
            else: p[k]=v
        self.take();p['items']=items;return p

def actions(tokens):
    # Native scripts accept optional semicolons; command names delimit commands.
    cmds=set('play close open setdvar exec ingameclose uiscript setfocus hide show fadein fadeout setitemcolor transition orbit setplayerhead setplayermodel'.split())
    out=[];i=0
    while i<len(tokens):
        op=tokens[i].lower();i+=1
        if op in [';',',']:continue
        args=[]
        while i<len(tokens) and tokens[i]!=';' and tokens[i].lower() not in cmds:
            args.append(value(tokens[i]));i+=1
        if op in ['play','close','open','setfocus','ingameclose'] and args:
            out.append(dict(op=op, **{dict(play='sound',close='menu',open='menu',setfocus='item',ingameclose='menu')[op]:args[0]}))
        elif op=='setdvar' and len(args)>=2: out.append(dict(op=op,name=args[0],value=args[1]))
        elif op=='exec' and args: out.append(dict(op=op,command=args[0]))
        elif op=='uiscript' and args: out.append(dict(op='uiScript',name=args[0],args=args[1:]))
        elif op in ['show','hide'] and args:out.append(dict(op=op,item=args[0]))
        else:out.append(dict(op='unsupported',name=op,args=args))
    return out

def item(p):
    def one(k,d=''):return p.get(k,[d])[0]
    def num(k,d=0):
        v=str(one(k,d));return int(v,16) if v.lower().startswith('0x') else float(v)
    r=[float(v) for v in p.get('rect',[0,0,0,0])];r += [0]*(6-len(r))
    o=dict(name=one('name'),type=int(num('type')),style=int(num('style')),rect_x=r[0],rect_y=r[1],rect_w=r[2],rect_h=r[3],horz_align=r[4],vert_align=r[5],textscale=num('textscale',.55),textalignx=num('textalignx'),textaligny=num('textaligny'),textalign=num('textalign'),textstyle=num('textstyle'),textfont=num('textfont'),forecolor=[float(v) for v in p.get('forecolor',[1,1,1,1])],backcolor=[float(v) for v in p.get('backcolor',[0,0,0,0])],visible=bool(num('visible')),decoration='decoration' in p)
    for a,b in [('text','text_key'),('dvar','dvar'),('background','background'),('group','group')]:
        if a in p:o[b]=one(a)
    for a,b in [('action','action'),('mouseenter','mouse_enter'),('onfocus','on_focus'),('mouseexit','mouse_exit'),('accept','accept'),('doubleclick','double_click')]:
        if a in p:o[b]=actions(p[a])
    for k in ['showdvar','hidedvar','enabledvar','disabledvar']:
        if k in p:o.setdefault('conditions',[]).append(dict(kind=k,dvar=one('dvartest'),values=[value(v) for v in p[k] if v not in [';',',']]))
    for k in ['dvarfloat','dvarint']:
        if k in p:o.update(dvar=p[k][0],range=[float(v) for v in p[k][1:]])
    for k in ['dvarfloatlist','dvarstrlist']:
        if k in p:
            v=[value(t) for t in p[k] if t not in [',',';']];assert len(v)%2==0
            o['choices']=[dict(label=v[i],value=v[i+1]) for i in range(0,len(v),2)]
    if 'dvarenum' in p:o['dvar']=one('dvarenum')
    o['border']=num('border');o['bordercolor']=[float(v) for v in p.get('bordercolor',[0,0,0,0])];o['bordersize']=num('bordersize',1)
    o['outlinecolor']=[float(v) for v in p.get('outlinecolor',[0,0,0,0])]
    if 'ownerdraw' in p:o.update(ownerdraw=num('ownerdraw'),type=8)
    for k in ['autowrapped','wrapped','noscrollbars']:o[k]=k in p
    for k in ['feeder','elementheight','elementwidth','maxchars','maxpaintchars']:
        if k in p:o[k]=num(k)
    if 'columns' in p:o['columns']=[list(map(float,p['columns'][i:i+3])) for i in range(0,len(p['columns']),3)]
    if 'dvarenumlist' in p:o['enum_list']=one('dvarenumlist')
    return o

def menu(p):
    o=item(p);o.update(fullscreen=bool(float(p.get('fullscreen',[0])[0])),focus_color=[float(v) for v in p.get('focuscolor',[.98,.827,.58,1])],items=[item(i) for i in p['items']])
    if 'blurworld' in p:o['blur_world']=float(p['blurworld'][0])
    for a,b in [('onopen','on_open'),('onclose','on_close'),('onesc','on_esc')]:o[b]=actions(p.get(a,[]))
    o['popup']='popup' in p
    if 'exec_keys' in p:o['exec_keys']={key:actions(script) for key,script in p['exec_keys'].items()}
    return o

FALLBACK_MENUS = {
    'ui/options_view.menu': '{\nmenuDef {\nname "options_view"\nvisible 0\nfullscreen 0\nrect 0 0 640 480\n}\n}\n',
    'ui/options_defaults.menu': '{\nmenuDef {\nname "options_defaults"\nvisible 0\nfullscreen 0\nrect 0 0 640 480\n}\n}\n',
    'ui/options_credits.menu': '{\nmenuDef {\nname "options_credits"\nvisible 0\nfullscreen 0\nrect 0 0 640 480\n}\n}\n',
    'ui/rec_restart.menu': '{\nmenuDef {\nname "rec_restart_popmenu"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\nmenuDef {\nname "rec_restart"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\n}\n',
    'ui_mp/in_rec_restart.menu': '{\nmenuDef {\nname "in_rec_restart_popmenu"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\nmenuDef {\nname "in_rec_restart"\nvisible 0\nfullscreen 0\nrect 204 140 235 135\npopup\n}\n}\n',
}

def main():
    from lib.retail_paths import CPP
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('main',type=Path);ap.add_argument('--cpp',default=CPP);a=ap.parse_args()
    dest=ROOT/'artifacts/retail-menu-evidence';dest.mkdir(parents=True,exist_ok=True);sources={}
    for path in sorted(a.main.glob('*.iwd')):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if (n.startswith(('ui/','ui_mp/','localizedstrings/')) or n=='default_mp.cfg' or n.endswith('.arena') or n.startswith('maps/mp/gametypes/') and n.endswith('.txt')) and not n.endswith('/'):
                    b=z.read(n);f=dest/n;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
                    sources[n]=dict(archive=path.name,sha256=hashlib.sha256(b).hexdigest())
    for fb_path, fb_content in FALLBACK_MENUS.items():
        fb_dest = dest / fb_path
        if not fb_dest.exists():
            fb_dest.parent.mkdir(parents=True, exist_ok=True)
            fb_dest.write_text(fb_content, encoding='utf-8')
    pool=[]
    paths=re.findall(r'loadMenu\s*\{\s*"([^"]+)"', (dest/'ui_mp/menus.txt').read_text())
    paths+=['ui_mp/connect.menu']+[str(p.relative_to(dest)).replace('\\','/') for pattern in ['team_*.menu','weapon_*.menu','serverinfo_*.menu','ingame.menu','muteplayer.menu','callvote.menu'] for p in sorted((dest/'ui_mp/scriptmenus').glob(pattern))]
    paths=list(dict.fromkeys(paths))
    for path in paths:
        if not (dest/path).exists():
            print('Absent in retail archives:',path);continue
        result=subprocess.run([a.cpp,'-E','-P','-x','c','-I',str(dest),str(dest/path)],capture_output=True,text=True)
        if result.returncode:raise RuntimeError(result.stderr)
        text=re.sub(r'^\s*\\\\.*$', '',result.stdout,flags=re.M)
        parser=Parser(text)
        while parser.i<len(parser.t):
            t=parser.take().lower()
            if t=='menudef':pool.append(menu(parser.props()))
            elif t=='assetglobaldef':parser.block_tokens()
        (dest/(Path(path).stem+'.expanded')).write_text(text)
    strings={}
    for path in (dest/'localizedstrings').glob('*.str'):
        text=path.read_text(encoding='cp1252');ref=''
        for line in text.splitlines():
            m=re.match(r'\s*REFERENCE\s+(.+?)\s*$',line)
            if m:ref=m[1]
            m=re.match(r'\s*LANG_ENGLISH\s+"(.*)"',line)
            if m:strings[path.stem.upper()+'_'+ref]=m[1].replace(r'\n','\n')
    assets=ROOT/'assets/ui';assets.mkdir(exist_ok=True)
    defaults={}
    for line in (dest/'default_mp.cfg').read_text().splitlines():
        m=re.match(r'bind\s+(\S+)\s+"([^"]+)"',line)
        if m:defaults[m[2]]=defaults.get(m[2],'')+(' or ' if m[2] in defaults else '')+m[1].upper()
        m=re.match(r'set\s+(\S+)\s+("[^"]*"|\S+)',line)
        if m:defaults[m[1]]=value(m[2])
    configs={n:(dest/n).read_text() for n in sources if n.endswith('.cfg')}
    maps=[]
    for path in sorted((dest/'mp').glob('*.arena')):
        for block in re.findall(r'\{([^}]+)\}',path.read_text()):
            ts=TOKEN.findall(block);entry={value(ts[i]):value(ts[i+1]) for i in range(0,len(ts),2)}
            maps.append(entry)
    maps.sort(key=lambda m:m.get('longname','').lower())
    gametypes=[dict(value=p.stem,label=value(TOKEN.findall(p.read_text())[0])) for p in sorted((dest/'maps/mp/gametypes').glob('*.txt'))]
    for name,obj in [('menus',pool),('strings',strings),('defaults',defaults),('configs',configs),('providers',dict(maps=maps,gametypes=gametypes)),('provenance',sources)]:
        (assets/(name+'.json')).write_text(json.dumps(obj,indent=2)+'\n',encoding='utf-8')
    print(f'Extracted {len(pool)} menus, {sum(len(m["items"]) for m in pool)} items, {len(strings)} strings.')

if __name__=='__main__':main()
