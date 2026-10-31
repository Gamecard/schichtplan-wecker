window.onerror=function(msg,src,line,col,err){
  var t=document.getElementById('toast');
  if(t){t.textContent='JS-FEHLER: '+msg+' (Zeile '+line+')';t.className='show err';}
  return false;
};
(function(){
  /* ── SPRACHE (i18n) ───────────────────────
     Alle sichtbaren Texte kommen aus lang/<code>.json (flaches Objekt, Schlüssel mit Punkt-
     Namensräumen, Platzhalter {name}, Mehrzahl über _zero/_one/_two/_few/_many/_other nach
     Intl.PluralRules). Auflösung: gewählte Sprache → en → de → Schlüssel selbst.
     Einstellung „auto“ = Systemsprache, falls eingebaut, sonst en. Interne Datenwerte
     (Ausnahme-Typen, gespeicherte Namen, AlarmKeys) bleiben deutsch – übersetzt wird nur die Anzeige.
     Mit Android-Bridge kommen Liste/Dateien/Einstellung nativ, sonst (Browser/Test) per XHR. */
  var LANG_KEY='schichtplan-lang-v1';
  var BUILTIN_LANGS=[{code:'de',name:'Deutsch'},{code:'en',name:'English'}];
  var I18N={setting:'auto',code:'de',locale:'de',chain:[],files:{}};
  function readLangFile(code){
    if(Object.prototype.hasOwnProperty.call(I18N.files,code)) return I18N.files[code];
    var txt='', obj=null;
    if(hasBridge('getLanguageFile')){ try{ txt=String(window.Android.getLanguageFile(code)||''); }catch(e){} }
    else if(code!=='custom'&&/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(code)){
      try{
        var x=new XMLHttpRequest(); x.open('GET','lang/'+code+'.json',false); x.send(null);
        if(x.status===200||(x.status===0&&x.responseText)) txt=x.responseText;
      }catch(e){}
    }
    if(txt){ try{ obj=JSON.parse(txt); }catch(e){} }
    if(!obj||typeof obj!=='object'||Array.isArray(obj)) obj=null;
    I18N.files[code]=obj;
    return obj;
  }
  function listLangs(){
    var l=null;
    if(hasBridge('listLanguages')){ try{ l=JSON.parse(window.Android.listLanguages()); }catch(e){} }
    if(!Array.isArray(l)||!l.length) l=BUILTIN_LANGS.slice();
    return l.filter(function(x){ return x&&typeof x.code==='string'&&x.code; });
  }
  function systemLang(){
    var s='';
    if(hasBridge('getSystemLanguage')){ try{ s=String(window.Android.getSystemLanguage()||''); }catch(e){} }
    if(!s) s=(typeof navigator!=='undefined'&&navigator.language)||'';
    return s.toLowerCase().split(/[-_]/)[0];
  }
  function readLangSetting(){
    var s='';
    if(hasBridge('getLanguageSetting')){ try{ s=String(window.Android.getLanguageSetting()||''); }catch(e){} }
    else { try{ s=localStorage.getItem(LANG_KEY)||''; }catch(e){} }
    return s||'auto';
  }
  function resolveLang(setting,list){
    var codes=list.map(function(x){ return x.code; });
    if(setting&&setting!=='auto'&&codes.indexOf(setting)!==-1&&readLangFile(setting)) return setting;
    var sys=systemLang();
    if(sys&&sys!=='custom'&&codes.indexOf(sys)!==-1&&readLangFile(sys)) return sys;
    return 'en';
  }
  function pluralRule(code){
    var pr=null;
    try{ if(typeof Intl!=='undefined'&&Intl.PluralRules) pr=new Intl.PluralRules(code); }catch(e){}
    return function(n){
      if(pr){ try{ return pr.select(n); }catch(e){} }
      return n===1?'one':'other';
    };
  }
  /* Sprachdateien der Kette laden (gewählte → en → de) */
  function loadLanguage(setting){
    var code=resolveLang(setting,listLangs()), chain=[], seen={};
    [code,'en','de'].forEach(function(c){
      if(seen[c]) return; seen[c]=1;
      var d=readLangFile(c); if(!d) return;
      var meta=d._meta&&typeof d._meta==='object'?d._meta:{};
      var lc=c==='custom'?String(meta.code||''):c;
      if(!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lc)) lc='en';
      chain.push({code:c,locale:lc,dict:d,plural:pluralRule(lc)});
    });
    I18N.setting=setting||'auto'; I18N.code=code; I18N.chain=chain;
    I18N.locale=chain.length?chain[0].locale:'de';
  }
  /* Rohtext eines Schlüssels; n = Anzahl für die Mehrzahl (je Datei nach deren Regeln) */
  function tTpl(key,n){
    for(var i=0;i<I18N.chain.length;i++){
      var c=I18N.chain[i], d=c.dict, v;
      if(typeof n==='number'){
        var cands=n===0?[key+'_zero']:[];
        cands.push(key+'_'+c.plural(n),key+'_other');
        for(var j=0;j<cands.length;j++){ v=d[cands[j]]; if(typeof v==='string'&&v!=='') return v; }
      }
      v=d[key]; if(typeof v==='string'&&v!=='') return v;
    }
    return null;
  }
  function fillTpl(tpl,params){
    return tpl.replace(/\{(\w+)\}/g,function(m,k){ return params&&params[k]!=null?String(params[k]):m; });
  }
  /* Übersetzung als Text; params.n wählt die Mehrzahl */
  function t(key,params){
    var tpl=tTpl(key,params&&typeof params.n==='number'?params.n:undefined);
    return tpl===null?key:fillTpl(tpl,params);
  }
  /* Übersetzung als HTML: Text wird escapt, nur <b>…</b> bleibt erlaubt (eigene Übersetzungs-
     dateien dürfen kein HTML/Script einschleusen). params werden roh eingesetzt → vorher escapen! */
  function tHtml(key,params){
    var tpl=tTpl(key,params&&typeof params.n==='number'?params.n:undefined);
    if(tpl===null) return esc(key);
    return fillTpl(esc(tpl).replace(/&lt;(\/?)b&gt;/g,'<$1b>'),params);
  }
  /* statische Texte in index.html: data-i18n (Text), data-i18n-html (mit <b>),
     data-i18n-attr="aria-label:schlüssel;title:schlüssel2" */
  function applyI18n(root){
    root=root||document;
    root.querySelectorAll('[data-i18n]').forEach(function(el){ el.textContent=t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach(function(el){ el.innerHTML=tHtml(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-attr]').forEach(function(el){
      el.getAttribute('data-i18n-attr').split(';').forEach(function(p){
        var i=p.indexOf(':'); if(i>0) el.setAttribute(p.slice(0,i).trim(),t(p.slice(i+1).trim()));
      });
    });
    document.documentElement.setAttribute('lang',I18N.locale);
  }
  loadLanguage(readLangSetting());
  window.onerror=function(msg,src,line){
    var el=document.getElementById('toast');
    if(el){ el.textContent=t('error.js',{msg:msg,line:line}); el.className='show err'; }
    return false;
  };

  /* Namen aus der Sprachdatei (Wochentag: Montag = 0) */
  function shiftLabel(tp){ return tp>=1&&tp<=4?t('shift.'+tp):''; }
  function dayShort(i){ return t('weekday.short.'+i); }
  function dayLong(i){ return t('weekday.long.'+i); }
  function monthLong(i){ return t('month.long.'+i); }
  /* Monatsname im Datum (z. B. pl/ru Genitiv: „2 listopada“) – month.gen.*, sonst month.long.* */
  function monthGen(i){ var k='month.gen.'+i, v=t(k); return v===k?monthLong(i):v; }
  function monthShort(i){ return t('month.short.'+i); }
  /* Ausnahme-Typen bleiben intern deutsch ('Urlaub'/'Krank'/'Schulung'), Anzeige übersetzt */
  var EX_TYPES={Urlaub:'urlaub',Krank:'krank',Schulung:'schulung'};
  function exLabel(type){ return EX_TYPES[type]?t('exception.'+EX_TYPES[type]):String(type||''); }
  /* Datumsformate aus der Sprachdatei: {d} {dd} {m} {mm} {yyyy} {mon} {month} {wd} {weekday} */
  function fmtParts(ds){
    var p=String(ds||'').split('-').map(Number), dt=new Date(p[0],p[1]-1,p[2],12,0,0), wi=(dt.getDay()+6)%7;
    return {d:p[2],dd:pad(p[2]),m:p[1],mm:pad(p[1]),yyyy:p[0],mon:monthShort(p[1]-1),month:monthLong(p[1]-1),month_gen:monthGen(p[1]-1),
            wd:dayShort(wi),weekday:dayLong(wi)};
  }
  function fmtDate(ds){ return ds?t('format.date',fmtParts(ds)):''; }
  function fmtTime(hhmm){ return t('format.time',{time:hhmm}); }

  /* ── Header-Kalender-Icon: aktuellen Tag/Monat setzen ── */
  function renderHdrIcon(){
    var now=new Date(), dayEl=document.getElementById('hdrCalDay'), monEl=document.getElementById('hdrCalMon');
    if(dayEl) dayEl.textContent=now.getDate();
    if(monEl) monEl.textContent=monthShort(now.getMonth()).toUpperCase();
  }

  /* ── KONSTANTEN ─────────────────────────── */
  /* interne (deutsche) Schichtnamen – Datenwerte, NICHT für die Anzeige (→ shiftLabel) */
  var SNAMES = {0:'',1:'Frei',2:'Fr\u00FCh',3:'Sp\u00E4t',4:'Nacht'};
  var SCLS   = {0:'',1:'free',2:'frueh',3:'spaet',4:'nacht'};
  var SMETA  = [
    {t:1,n:'Frei', c:'free' },
    {t:2,n:'Fr\u00FCh',c:'frueh'},
    {t:3,n:'Sp\u00E4t',c:'spaet'},
    {t:4,n:'Nacht',c:'nacht'}
  ];
  var LS  = 'schichtplan-native-v1';
  var THK = 'schichtplan-theme-v1';

  /* ── STATE ──────────────────────────────── */
  function createDefaultState(){
    return {
      startDate:'', weeksCount:6, bundesland:'NW',
      pattern:[], exceptions:[],
      alarmTimes:{1:'07:00',2:'05:30',3:'13:00',4:'21:00'},
      alarmEnabled:{1:false,2:false,3:false,4:false},
      activeAlarms:[],
      freeAlarm:{enabled:false,time:'07:00',days:[0,1,2,3,4]},
      /* Schalter „automatisch wecken“: immer gleich alarmEnabled[t] bzw. freeAlarm.enabled
         (an → alle passenden Tage bekommen automatisch einen Wecker, s. normalizeAutoFlags) */
      autoSchedule:{1:false,2:false,3:false,4:false,free:false},
      skipHolidaysShift:false,
      /* Schichttausch: abweichende Schicht für einzelne Tage {"YYYY-MM-DD": 0..4} */
      overrides:{},
      /* Vorwecker: Minuten vor jedem Auto-Schicht-Wecker (0 = aus) */
      preAlarmMin:0,
      /* Startwoche als Kalenderwoche ('kw', Standard) oder als Datum ('date') wählen */
      startMode:'kw',
      /* Design und „Anleitung gesehen“ – zusätzlich zum localStorage nativ gesichert */
      theme:'',
      wizardDone:false,
      /* Erscheinungsbild: 'classic' oder 'anime' (verstecktes Extra: Versionsnummer antippen) */
      design:'classic',
      /* vom Nutzer gelöschte Auto-Wecker – werden nicht wieder angelegt */
      suppressed:[]
    };
  }
  var S = createDefaultState();
  var viewDate = new Date();
  viewDate.setDate(1); viewDate.setHours(12,0,0,0);

  /* ── HELPERS ────────────────────────────── */
  function pad(n){ return String(n).padStart(2,'0'); }
  function toYmd(d){ var dd=new Date(d); return dd.getFullYear()+'-'+pad(dd.getMonth()+1)+'-'+pad(dd.getDate()); }
  function todayYmd(){ return toYmd(new Date()); }
  function getISOWeek(d){
    var dt=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    var day=dt.getUTCDay()||7;
    dt.setUTCDate(dt.getUTCDate()+4-day);
    var y=new Date(Date.UTC(dt.getUTCFullYear(),0,1));
    return Math.ceil((((dt-y)/86400000)+1)/7);
  }
  /* ISO-Kalenderwochen-Jahr (31.12. kann KW 1 des Folgejahres sein, 1.1. KW 52/53 des Vorjahres) */
  function isoWeekYear(d){
    var dt=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    dt.setUTCDate(dt.getUTCDate()+4-(dt.getUTCDay()||7));
    return dt.getUTCFullYear();
  }
  function isoWeeksInYear(y){ return getISOWeek(new Date(y,11,28,12)); }
  /* Montag der ISO-KW w im Jahr y (der 4. Januar liegt immer in KW 1) */
  function mondayOfIsoWeek(y,w){
    var m=mondayOf(new Date(y,0,4,12));
    m.setDate(m.getDate()+(w-1)*7);
    return m;
  }
  function fillKwWeeks(y,sel){
    var kn=$('kwNum'), n=isoWeeksInYear(y); kn.innerHTML='';
    for(var w=1;w<=n;w++){var o=document.createElement('option');o.value=w;o.textContent=t('start.kw',{n:w});kn.appendChild(o);}
    kn.value=Math.min(sel||1,n);
  }
  /* Startwoche/Startdatum aus S.startDate in die Auswahl übernehmen, Hinweis aktualisieren */
  function renderStartPicker(){
    var kwMode=S.startMode!=='date';
    $('kwPick').style.display=kwMode?'flex':'none';
    $('datePick').style.display=kwMode?'none':'flex';
    $('startModeBtn').textContent=t(kwMode?'start.mode_date':'start.mode_kw');
    var d=parseYmd(S.startDate);
    if(isNaN(d)){ $('startLabel').textContent=t('start.label_default'); $('startInfo').textContent=''; return; }
    var mo=mondayOf(d), su=new Date(mo.getTime()); su.setDate(su.getDate()+6);
    var kw=getISOWeek(mo), ky=isoWeekYear(mo);
    $('kwYear').value=ky; fillKwWeeks(ky,kw);
    setDateSelects(S.startDate);
    var range={mon:dayShort(0),sun:dayShort(6),from:fmtDate(toYmd(mo)),to:fmtDate(toYmd(su))};
    if(kwMode){
      $('startLabel').textContent=t('start.label_kw');
      $('startInfo').textContent=t('start.range',range);
    } else {
      $('startLabel').innerHTML=tHtml('start.label_date',{kw:esc(t('start.kw',{n:kw})),year:ky!==d.getFullYear()?' '+ky:''});
      $('startInfo').textContent=t('start.range_date',range);
    }
  }
  function initDateSelects(){
    var sy=$('sdYear'),sm=$('sdMon'),sd=$('sdDay'); if(!sy||!sm||!sd)return;
    sy.innerHTML=''; sm.innerHTML=''; sd.innerHTML='';
    var curY=new Date().getFullYear();
    for(var y=curY-5;y<=curY+10;y++){var o=document.createElement('option');o.value=y;o.textContent=y;sy.appendChild(o);}
    for(var mi=0;mi<12;mi++){var om=document.createElement('option');om.value=mi+1;om.textContent=monthShort(mi);sm.appendChild(om);}
    for(var d=1;d<=31;d++){var o=document.createElement('option');o.value=d;o.textContent=t('start.day_option',{d:d});sd.appendChild(o);}
    var ky=$('kwYear'); ky.innerHTML='';
    for(var y2=curY-5;y2<=curY+10;y2++){var o2=document.createElement('option');o2.value=y2;o2.textContent=y2;ky.appendChild(o2);}
  }
  function setDateSelects(ymd){
    if(!ymd||!/^\d{4}-\d{2}-\d{2}$/.test(ymd))return;
    var p=ymd.split('-').map(Number);
    $('sdYear').value=p[0]; $('sdMon').value=p[1]; $('sdDay').value=p[2];
  }
  function getDateFromSelects(){
    var y=Number($('sdYear').value),m=Number($('sdMon').value),d=Number($('sdDay').value);
    if(!y||!m||!d)return '';
    var dt=new Date(y,m-1,d);
    if(dt.getDate()!==d||dt.getMonth()!==m-1||dt.getFullYear()!==y) return '';
    return y+'-'+pad(m)+'-'+pad(d);
  }
  function parseYmd(s){
    if(!s||!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(NaN);
    var p=s.split('-').map(Number); return new Date(p[0],p[1]-1,p[2],12,0,0);
  }
  /* Datum in der Anzeigesprache (früher fest TT.MM.JJJJ) */
  function fmtDe(s){ return fmtDate(s); }
  /* „Mo 02.11.“ bzw. „Mon 2 Nov“ – kurzer Tag für Listen */
  function dayLabel(ds){ return t('format.day_label',fmtParts(ds)); }
  function esc(s){
    return String(s||'').replace(/[&<>'"]/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];
    });
  }
  function uid(){
    return typeof crypto!=='undefined'&&crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36)+Math.random().toString(36).slice(2);
  }
  function toast(msg,err){
    var t=document.getElementById('toast');
    t.textContent=msg; t.className='show'+(err?' err':'');
    clearTimeout(t._tid); t._tid=setTimeout(function(){t.className='';},3100);
  }
  function customConfirm(msg, onOk){
    var bg=$('cdlgBg');
    $('cdlgMsg').textContent=msg;
    bg.style.display='flex';
    $('cdlgOk').onclick=function(){ bg.style.display='none'; onOk(); };
    $('cdlgCancel').onclick=function(){ bg.style.display='none'; };
  }

  function $(id){ return document.getElementById(id); }

  function addActiveAlarm(ds,alarmKey,time,shiftName,auto){
    if(!S.activeAlarms) S.activeAlarms=[];
    var existing=S.activeAlarms.find(function(a){return a.ds===ds&&a.alarmKey===alarmKey;});
    if(existing){existing.time=time;existing.shiftName=shiftName;existing.auto=!!auto;return;}
    S.activeAlarms.push({ds:ds,alarmKey:alarmKey,time:time,shiftName:shiftName,auto:!!auto});
  }
  function removeActiveAlarm(ds,alarmKey){
    if(!S.activeAlarms)return;
    S.activeAlarms=S.activeAlarms.filter(function(a){return !(a.ds===ds&&a.alarmKey===alarmKey);});
  }
  function getActiveAlarmsForDate(ds){
    if(!S.activeAlarms)return[];
    return S.activeAlarms.filter(function(a){return a.ds===ds;});
  }
  function getAllActiveAlarmsSorted(){
    if(!S.activeAlarms)return[];
    var today=todayYmd();
    return S.activeAlarms.filter(function(a){return a.ds>=today;})
      .sort(function(a,b){return (a.ds+a.time).localeCompare(b.ds+b.time)||a.alarmKey.localeCompare(b.alarmKey);});
  }
  function purgeExpiredAlarms(){
    if(!S.activeAlarms)return;
    var today=todayYmd();
    var before=S.activeAlarms.length;
    S.activeAlarms=S.activeAlarms.filter(function(a){return a.ds>=today;});
    var supBefore=S.suppressed.length;
    S.suppressed=S.suppressed.filter(function(k){var m=k.match(/\d{4}-\d{2}-\d{2}/);return !m||m[0]>=today;});
    var ovBefore=Object.keys(S.overrides).length;
    Object.keys(S.overrides).forEach(function(d){ if(d<today) delete S.overrides[d]; });
    if(S.activeAlarms.length!==before||S.suppressed.length!==supBefore||Object.keys(S.overrides).length!==ovBefore) save();
  }

  /* ── THEME ──────────────────────────────── */
  var THEMES=['system','light','dark'];
  var DESIGNS=['classic','anime'];
  var TICOS={system:'\uD83D\uDDA5\uFE0F',light:'\u2600\uFE0F',dark:'\uD83C\uDF19'};
  function applyTheme(t){
    var th=THEMES.includes(t)?t:'system';
    document.documentElement.setAttribute('data-theme',th);
    $('themeBtn').textContent=TICOS[th];
    S.theme=th;   // auch nativ sichern (localStorage kann bei Absturz verloren gehen)
    try{localStorage.setItem(THK,th);}catch(e){}
  }
  function cycleTheme(){
    var cur=document.documentElement.getAttribute('data-theme')||'system';
    applyTheme(THEMES[(THEMES.indexOf(cur)+1)%3]);
    save();
  }
  (function(){var t='system';try{t=localStorage.getItem(THK)||t;}catch(e){}applyTheme(t);})();

  /* ── FEIERTAGE ──────────────────────────── */
  function holidays(year,bl){
    var h={};
    function a(m,d,n){h[year+'-'+pad(m)+'-'+pad(d)]=n;}
    /* Werte = Kennung, Anzeige über t('holiday.<kennung>') */
    a(1,1,'neujahr');a(5,1,'tag_der_arbeit');a(10,3,'einheit');
    a(12,25,'weihnacht1');a(12,26,'weihnacht2');
    var ay=year%19,b=year%4,c=year%7,k=Math.floor(year/100);
    var M=(15-Math.floor((13+8*k)/25)+k-Math.floor(k/4))%30;
    var N=(4+k-Math.floor(k/4))%7;
    var dd=(19*ay+M)%30,e=(2*b+4*c+6*dd+N)%7,ot=22+dd+e,om=3;
    if(ot>31){ot-=31;om=4;}
    if(dd===29&&e===6){ot=19;om=4;}
    if(dd===28&&e===6&&ay>10){ot=18;om=4;}
    var os=new Date(year,om-1,ot,12,0,0);
    function rel(off,n){var x=new Date(os.getTime()+off*864e5);a(x.getMonth()+1,x.getDate(),n);}
    rel(-2,'karfreitag');rel(1,'ostermontag');rel(39,'himmelfahrt');rel(50,'pfingstmontag');
    if(['BW','BY','ST'].includes(bl)) a(1,6,'heilige_drei_koenige');
    if(['BE','MV'].includes(bl)) a(3,8,'frauentag');
    if(['BW','BY','HE','NW','RP','SL'].includes(bl)) rel(60,'fronleichnam');
    if(['BW','BY','NW','RP','SL'].includes(bl)) a(11,1,'allerheiligen');
    if(bl==='TH') a(9,20,'weltkindertag');
    if(bl==='SL') a(8,15,'mariae_himmelfahrt');
    if(['BB','HB','HH','MV','NI','SN','SH','ST','TH'].includes(bl)) a(10,31,'reformationstag');
    if(bl==='SN'){
      /* Buß- und Bettag: Mittwoch vor Totensonntag (letzter So vor 1. Advent) → 16.–22.11.
         Startpunkt 22.11. = spätestes mögliches Datum, rückwärts zum Mittwoch. */
      var x=new Date(year,10,22,12,0,0);
      while(x.getDay()!==3) x.setDate(x.getDate()-1);
      a(x.getMonth()+1,x.getDate(),'buss_und_bettag');
    }
    return h;
  }

  /* ── SCHICHT ────────────────────────────── */
  function mondayOf(d){
    var dt=new Date(d),day=dt.getDay();
    dt.setDate(dt.getDate()+(day===0?-6:1-day));
    dt.setHours(12,0,0,0); return dt;
  }
  function getShift(ds){
    var ex=S.exceptions.find(function(e){return ds>=e.start&&ds<=e.end;});
    // name = Anzeige (aktuelle Sprache), dname = interner Datenname (deutsch, z. B. fürs Widget)
    if(ex) return {type:-1,name:exLabel(ex.type),dname:ex.type,cls:'excep'};
    if(S.overrides&&Object.prototype.hasOwnProperty.call(S.overrides,ds)){
      var o=S.overrides[ds];
      return {type:o,name:shiftLabel(o),dname:SNAMES[o]||'',cls:SCLS[o]||'',swapped:true};
    }
    if(!S.startDate) return {type:0,name:'',cls:''};
    var sm=mondayOf(parseYmd(S.startDate));
    var tgt=parseYmd(ds);
    var diffDays=Math.round((tgt.getTime()-sm.getTime())/864e5);
    if(diffDays<0) return {type:0,name:'',cls:''};
    var idx=diffDays%(S.weeksCount*7);
    var tp=S.pattern[idx]!=null?S.pattern[idx]:0;
    return {type:tp,name:shiftLabel(tp),dname:SNAMES[tp]||'',cls:SCLS[tp]||''};
  }
  /* ── WECKER-ABGLEICH ─────────────────────
     Soll-Liste aus Plan + Einstellungen berechnen und mit den gesetzten Weckern
     vergleichen. Nur automatisch gesetzte Wecker (auto:true) werden angepasst;
     von Hand gestellte Wecker bleiben unberührt. */
  var HORIZON_DAYS=370;
  var _holCache={};
  function holidayName(ds){
    var bl=S.bundesland||'NW', y=Number(ds.slice(0,4)), ck=y+bl;
    if(!_holCache[ck]) _holCache[ck]=holidays(y,bl);
    return _holCache[ck][ds];
  }
  function isFuture(ds,time){
    var p=ds.split('-').map(Number), t=String(time||'').split(':').map(Number);
    return new Date(p[0],p[1]-1,p[2],t[0]||0,t[1]||0,0,0).getTime()>Date.now();
  }
  function hasBridge(fn){ return !!(window.Android&&typeof window.Android[fn]==='function'); }
  /* Wecker, die an diesem Tag laut Plan fällig wären (Wecker-Art eingeschaltet, Schicht passt) */
  function expectedAlarmsFor(ds){
    var out=[], sh=getShift(ds), hol=holidayName(ds);
    if(sh.type>=1&&sh.type<=4&&S.alarmEnabled[sh.type]&&S.alarmTimes[sh.type]&&!(hol&&S.skipHolidaysShift)){
      var mk='shift-'+ds+'-t'+sh.type;
      var main={key:mk,kind:sh.type,time:S.alarmTimes[sh.type],name:SNAMES[sh.type],msg:alarmMsg(mk,ds)};
      out.push(main);
      if(S.preAlarmMin>0){
        // Vorwecker: kann über Mitternacht auf den Vortag fallen → eigenes Datum
        var p=ds.split('-').map(Number), tm=main.time.split(':').map(Number);
        var pre=new Date(p[0],p[1]-1,p[2],tm[0],tm[1]-S.preAlarmMin,0,0);
        out.push({key:'pre-'+mk,kind:sh.type,ds:toYmd(pre),time:pad(pre.getHours())+':'+pad(pre.getMinutes()),
          name:'Vorwecker '+SNAMES[sh.type],msg:alarmMsg('pre-'+mk,toYmd(pre),main.time)});
      }
    }
    var dow=(parseYmd(ds).getDay()+6)%7;
    if(sh.type===0&&!hol&&S.freeAlarm.enabled&&S.freeAlarm.time&&S.freeAlarm.days.indexOf(dow)!==-1){
      out.push({key:'free-day-'+ds,kind:'free',time:S.freeAlarm.time,name:'Freier Tag',msg:alarmMsg('free-day-'+ds,ds)});
    }
    return out.filter(function(e){return isFuture(e.ds||ds,e.time);});
  }
  function expectedAlarms(){
    var res={}, start=parseYmd(todayYmd());
    for(var i=0;i<HORIZON_DAYS;i++){
      var ds=toYmd(new Date(start.getTime()+i*864e5));
      expectedAlarmsFor(ds).forEach(function(e){res[e.key]={ds:e.ds||ds,e:e};});
    }
    return res;
  }
  /* Anzeigename eines Weckers – aus dem Schlüssel abgeleitet, damit er der Sprache folgt
     (shiftName im Zustand ist ein alter, deutscher Datenwert) */
  function alarmName(a){
    var k=a&&a.alarmKey||'', m;
    if((m=/^pre-shift-\d{4}-\d{2}-\d{2}-t([1-4])$/.exec(k))) return t('alarm.pre_name',{shift:shiftLabel(Number(m[1]))});
    if((m=/^shift-\d{4}-\d{2}-\d{2}-t([1-4])$/.exec(k))) return shiftLabel(Number(m[1]));
    if(/^free-day-/.test(k)) return t('alarm.free_day');
    if(/^custom-/.test(k)) return t('alarm.single');
    return a&&a.shiftName||t('alarm.generic');
  }
  /* Text, den Android beim Klingeln zeigt (nativ gespeichert → nach Sprachwechsel neu schreiben).
     ds = Tag des Weckers; beim Vorwecker zählt der Schichttag aus dem Schlüssel, mainTime = Weckzeit
     des Hauptweckers (fehlt sie, aus der Liste bzw. den Einstellungen). */
  function alarmMsg(key,ds,mainTime){
    var m=/^pre-(shift-(\d{4}-\d{2}-\d{2})-t([1-4]))$/.exec(key);
    if(m){
      if(!mainTime){
        var ma=(S.activeAlarms||[]).filter(function(x){ return x.alarmKey===m[1]; })[0];
        mainTime=ma?ma.time:S.alarmTimes[m[3]];
      }
      return t('alarm.msg_pre',{shift:shiftLabel(Number(m[3])),time:mainTime,date:fmtDate(m[2])});
    }
    return t('alarm.msg',{name:alarmName({alarmKey:key}),date:fmtDate(ds)});
  }
  function bridgeSet(ds,e){
    var p=ds.split('-').map(Number), t=e.time.split(':').map(Number);
    try{ return window.Android.setAlarmForDateSilent(p[0],p[1],p[2],t[0],t[1],e.key,e.msg)!==false; }
    catch(x){ return false; }
  }
  function bridgeCancel(key){ try{ if(hasBridge('cancelAlarm')) window.Android.cancelAlarm(key); }catch(x){} }
  function resyncAlarms(opts){
    opts=opts||{};
    var r={added:0,removed:0,updated:0,errors:0};
    if(!hasBridge('setAlarmForDateSilent')) return r;
    var expected=expectedAlarms();
    // 1) automatisch gesetzte Wecker prüfen (abgelaufene/heute schon klingelnde nicht anfassen – evtl. Schlummern aktiv)
    (S.activeAlarms||[]).slice().forEach(function(a){
      if(!a.auto||!isFuture(a.ds,a.time)) return;
      var x=expected[a.alarmKey];
      if(!x){ bridgeCancel(a.alarmKey); removeActiveAlarm(a.ds,a.alarmKey); r.removed++; return; }
      if(x.e.time!==a.time||x.ds!==a.ds){ if(bridgeSet(x.ds,x.e)){ a.time=x.e.time; a.ds=x.ds; r.updated++; } else r.errors++; }
    });
    // 2) fehlende ergänzen, wenn für diese Art „automatisch wecken“ an ist
    Object.keys(expected).forEach(function(k){
      var x=expected[k];
      if(!S.autoSchedule[x.e.kind]||S.suppressed.indexOf(k)!==-1) return;
      if(S.activeAlarms.some(function(a){return a.alarmKey===k;})) return;
      if(bridgeSet(x.ds,x.e)){ addActiveAlarm(x.ds,k,x.e.time,x.e.name,true); r.added++; } else r.errors++;
    });
    if(r.added||r.removed||r.updated){
      // Android hält nur die nächsten Wecker scharf (Limit 500) – Fenster nach Sammeländerung prüfen
      if(hasBridge('syncAlarmWindow')){ try{ window.Android.syncAlarmWindow(); }catch(e){} }
      save(); renderCal();
    }
    if(!opts.quiet&&(r.added||r.removed||r.updated||r.errors)){
      var parts=[];
      if(r.added) parts.push(t('resync.added',{n:r.added}));
      if(r.updated) parts.push(t('resync.updated',{n:r.updated}));
      if(r.removed) parts.push(t('resync.removed',{n:r.removed}));
      if(r.errors) parts.push(t('resync.failed',{n:r.errors}));
      toast('⏰ '+t('resync.toast',{parts:parts.join(', ')}),r.errors>0);
    }
    return r;
  }
  var _resyncTid=null;
  /* Nach Planänderungen gebündelt abgleichen (z. B. mehrere Taps im Schichtmuster) */
  function scheduleResync(){
    clearTimeout(_resyncTid);
    _resyncTid=setTimeout(function(){ _resyncTid=null; resyncAlarms(); },800);
  }
  /* Wecker ohne auto-Merker (Altversion/verwaist): gilt als automatisch, wenn er zur Standardzeit klingelt */
  function guessAuto(key,time){
    var m=key.match(/^shift-\d{4}-\d{2}-\d{2}-t(\d)$/);
    return !!((m&&time===S.alarmTimes[m[1]])||(/^free-day-/.test(key)&&time===S.freeAlarm.time));
  }
  /* Beim Start: Wecker älterer Versionen in den nativen Speicher übernehmen und die
     Liste mit den tatsächlich geplanten Android-Weckern abgleichen. */
  function syncWithNative(){
    if(!hasBridge('getScheduledKeys')) return;
    if(!window.Android.isStoreMigrated()){
      S.activeAlarms.forEach(function(a){
        if(!isFuture(a.ds,a.time)) return;
        bridgeSet(a.ds,{key:a.alarmKey,time:a.time,msg:alarmMsg(a.alarmKey,a.ds)});
        if(a.auto===undefined) a.auto=guessAuto(a.alarmKey,a.time);
      });
      window.Android.setStoreMigrated();
    }
    var keys; try{ keys=JSON.parse(window.Android.getScheduledKeys()); }catch(e){ return; }
    var known={}; keys.forEach(function(k){known[k]=1;});
    // Nicht mehr geplant = ausgelöst oder verloren → aus der Liste nehmen
    S.activeAlarms=S.activeAlarms.filter(function(a){return known[a.alarmKey];});
    // Umgekehrt: nativ geplant, aber hier unbekannt (z. B. App beendet, bevor der
    // localStorage geschrieben war) → übernehmen, damit der Wecker sichtbar und löschbar ist
    if(hasBridge('getScheduledAlarms')){
      var listed={}; S.activeAlarms.forEach(function(a){listed[a.alarmKey]=1;});
      var nat=[]; try{ nat=JSON.parse(window.Android.getScheduledAlarms()); }catch(e){}
      nat.forEach(function(n){
        if(!n||listed[n.key]||!/^(pre-)?(shift|custom|free-day)-\d{4}-\d{2}-\d{2}/.test(n.key)) return;
        var ds=n.y+'-'+pad(n.mo)+'-'+pad(n.d), time=pad(n.h)+':'+pad(n.mi);
        var m=n.key.match(/-t(\d)$/), name=m?(SNAMES[m[1]]||'Wecker'):(/^free-day-/.test(n.key)?'Freier Tag':'Einzelwecker');
        var auto=guessAuto(n.key,time);
        if(/^pre-/.test(n.key)){ auto=true; name='Vorwecker '+name; }
        S.activeAlarms.push({ds:ds,alarmKey:n.key,time:time,shiftName:name,auto:auto});
      });
    }
    save();
  }

  /* ── ZEITAUSWAHL ─────────────────────────
     Eine Komponente für alle Weckzeiten (Schichten, unbelegte Tage, Einzelwecker, Einrichtung):
     ein Uhrzeit-Chip; Antippen öffnet das Zeit-Fenster (große Uhrzeit → Android-Uhr, −15/−5/+5/+15,
     Abbrechen/Übernehmen). Erst „Übernehmen“ ruft onChange(hhmm) – Vertippen ändert keine Wecker.
     opts: label (Name für Titel/aria), id (ID des Chips). Das Element hat getTime()/setTime(hhmm).
     Das versteckte <input type="time"> im Element übernimmt Werte direkt (Barrierefreiheit, Tests). */
  function parseHhmm(s){
    var m=/^(\d{1,2}):(\d{2})/.exec(String(s||''));
    if(!m||Number(m[1])>23||Number(m[2])>59) return null;
    return pad(Number(m[1]))+':'+m[2];
  }
  function buildTimePicker(hhmm,onChange,opts){
    opts=opts||{};
    var cur=parseHhmm(hhmm)||'07:00';
    var box=document.createElement('span'); box.className='tpick';
    var chip=document.createElement('button'); chip.type='button'; chip.className='tchip';
    if(opts.id) chip.id=opts.id;
    var nat=document.createElement('input');
    nat.type='time'; nat.className='tnative'; nat.tabIndex=-1; nat.setAttribute('aria-hidden','true');
    function set(v,fire){
      cur=v; chip.textContent=v; nat.value=v;
      chip.setAttribute('aria-label',(opts.label?opts.label+': ':'')+t('time.chip_aria',{time:v}));
      if(fire&&onChange) onChange(v);
    }
    chip.onclick=function(){
      openTimeSheet((opts.label?opts.label+' – ':'')+t('time.title'),cur,function(v){ if(v!==cur) set(v,true); });
    };
    nat.addEventListener('change',function(){ var v=parseHhmm(nat.value); if(v&&v!==cur) set(v,true); });
    box.appendChild(chip); box.appendChild(nat);
    set(cur,false);
    box.getTime=function(){ return cur; };
    box.setTime=function(v){ v=parseHhmm(v); if(v&&v!==cur) set(v,false); };
    return box;
  }
  /* Zeit-Fenster: Entwurf bearbeiten, erst „Übernehmen“ ruft onApply */
  var TS={value:'07:00',onApply:null};
  function tsShow(){ $('tsDigits').textContent=TS.value; $('tsNative').value=TS.value; }
  function openTimeSheet(title,hhmm,onApply){
    TS.value=parseHhmm(hhmm)||'07:00'; TS.onApply=onApply;
    $('tsTitle').textContent=title; tsShow();
    var ov=$('timeSheet'); ov.classList.add('open'); document.body.style.overflow='hidden';
    // Fenster an den unteren Rand: Abstandshalter = freie Höhe über dem Fenster
    var sp=ov.querySelector('.tsheet-space'), sh=ov.querySelector('.tsheet');
    sp.style.height=Math.max(0,window.innerHeight-sh.offsetHeight)+'px'; ov.scrollTop=0;
  }
  function isTimeSheetOpen(){ return $('timeSheet').classList.contains('open'); }
  function closeTimeSheet(apply){
    $('timeSheet').classList.remove('open');
    // Body-Scroll nur freigeben, wenn darunter kein anderes Sheet offen ist
    if(!$('overlay').classList.contains('open')&&!$('wizBg').classList.contains('open')) document.body.style.overflow='';
    var cb=TS.onApply; TS.onApply=null;
    if(apply&&cb) cb(TS.value);
  }
  /* ±Minuten mit Übertrag in die Stunde, rundum über Mitternacht */
  function tsShift(d){
    var p=TS.value.split(':').map(Number), m=((p[0]*60+p[1]+d)%1440+1440)%1440;
    TS.value=pad(Math.floor(m/60))+':'+pad(m%60); tsShow();
  }

  function buildSwitch(id,aria,checked){
    var sw=document.createElement('label'); sw.className='sw'; sw.title=aria;
    var cb=document.createElement('input'); cb.type='checkbox'; cb.id=id; cb.checked=!!checked;
    cb.setAttribute('aria-label',aria);
    var sl=document.createElement('span'); sl.className='sl';
    sw.appendChild(cb); sw.appendChild(sl);
    return sw;
  }

  /* ── WECKER-BEREICH ──────────────────────
     Pro Schicht (und für unbelegte Tage) EIN Schalter „automatisch wecken“: an = Wecker für alle
     passenden Tage der nächsten 12 Monate stellen und aktuell halten (resyncAlarms), aus = diese
     automatischen Wecker entfernen. Von Hand gestellte Wecker bleiben immer. */
  var shiftPickers={}, freePicker=null, _lastAutoResync=null;
  function isAutoOn(kind){
    return kind==='free'?!!(S.freeAlarm.enabled&&S.autoSchedule.free):!!(S.alarmEnabled[kind]&&S.autoSchedule[kind]);
  }
  function kindLabel(kind){ return kind==='free'?t('free.kind'):shiftLabel(kind); }
  /* kommende automatische Hauptwecker dieser Art (ohne Vorwecker) */
  function autoCount(kind){
    var re=kind==='free'?/^free-day-/:new RegExp('^shift-.*-t'+kind+'$');
    return (S.activeAlarms||[]).filter(function(a){return a.auto&&re.test(a.alarmKey)&&isFuture(a.ds,a.time);}).length;
  }
  /* Gibt es in den nächsten 12 Monaten überhaupt Tage dieser Art (unabhängig von Uhrzeit/Löschungen)? */
  function hasKindDays(kind){
    var start=parseYmd(todayYmd());
    for(var i=0;i<HORIZON_DAYS;i++){
      var ds=toYmd(new Date(start.getTime()+i*864e5)), sh=getShift(ds);
      if(kind==='free'){
        if(sh.type===0&&!holidayName(ds)&&S.freeAlarm.days.indexOf((parseYmd(ds).getDay()+6)%7)!==-1) return true;
      } else if(sh.type===kind) return true;
    }
    return false;
  }
  function autoStatusText(kind){
    if(!isAutoOn(kind)) return t('wecker.state_off');
    var n=autoCount(kind);
    if(n) return t('wecker.state_count',{n:n});
    if(kind==='free'&&!S.freeAlarm.days.length) return t('wecker.state_no_weekdays');
    if(hasKindDays(kind)) return t('wecker.state_none_due');
    return kind==='free'?t('wecker.state_no_free_days'):t('wecker.state_no_shift_days',{shift:shiftLabel(kind)});
  }
  function renderWeckerStatus(){
    [1,2,3,4,'free'].forEach(function(k){
      var el=$(k==='free'?'freeAutoState':'aeState'+k); if(el) el.textContent=autoStatusText(k);
    });
  }
  /* Bedienelemente an S angleichen, ohne sie neu aufzubauen (Fokus bleibt erhalten) –
     auch wenn die Einrichtung die Setter aufruft */
  function syncWeckerUi(){
    [1,2,3,4].forEach(function(t){
      var cb=$('ae'+t); if(cb) cb.checked=isAutoOn(t);
      if(shiftPickers[t]) shiftPickers[t].setTime(S.alarmTimes[t]);
    });
    var fc=$('freeAlarmEnabled'); if(fc) fc.checked=isAutoOn('free');
    if(freePicker) freePicker.setTime(S.freeAlarm.time);
    document.querySelectorAll('#freeAlarmBox [data-di]').forEach(function(b){
      var on=S.freeAlarm.days.indexOf(Number(b.dataset.di))!==-1;
      b.classList.toggle('sftbtn-active',on); b.setAttribute('aria-pressed',on?'true':'false');
    });
    renderWeckerStatus();
  }
  /* Schalter umgelegt: umsetzen und ehrlich melden, was passiert ist */
  function onAutoSwitch(kind,on){
    var n=kind==='free'?setFreeAuto(on):setShiftAuto(kind,on), name=kindLabel(kind);
    if(!on){ toast(t('wecker.toast_off',{name:name})); return; }
    if(!hasBridge('setAlarmForDateSilent')){ toast(t('common.no_bridge'),true); return; }
    var err=_lastAutoResync&&_lastAutoResync.errors||0, errTxt=err?' ('+t('resync.failed',{n:err})+')':'';
    if(n) toast(t('wecker.toast_count',{name:name,n:n})+errTxt,err>0);
    else if(kind==='free'&&!S.freeAlarm.days.length) toast(t('wecker.toast_no_weekdays',{name:name}));
    else if(!hasKindDays(kind)) toast(kind==='free'?t('wecker.toast_no_free_days'):t('wecker.toast_no_shift_days',{name:name}));
    else toast(t('wecker.toast_none_due',{name:name})+errTxt,err>0);
  }
  var KIND_COLORS={1:'var(--accent)',2:'var(--frueh)',3:'var(--spaet)',4:'var(--nacht)'};
  /* eine kompakte Zeile: Name + Stand | Uhrzeit-Chip | Schalter */
  function buildWeckerRow(name,color,picker,switchEl,stateId,kind){
    var r=document.createElement('div'); r.className='wkrow';
    var nm=document.createElement('div'); nm.className='wkname';
    var lbl=document.createElement('span'); lbl.className='slbl';
    // data-shift: im Anime-Design ersetzt das Schicht-Symbol (anime/shift-*.svg) den Farbpunkt
    lbl.innerHTML=(color?'<span class="ld"'+(kind?' data-shift="'+kind+'"':'')+' style="background:'+color+'"></span>':'')+esc(name);
    var st=document.createElement('span'); st.className='wkstate small muted'; st.id=stateId;
    nm.appendChild(lbl); nm.appendChild(st);
    r.appendChild(nm); r.appendChild(picker); r.appendChild(switchEl);
    return r;
  }
  function renderAlarmSettings(){
    var c=$('alarmBox'); c.innerHTML=''; shiftPickers={};
    SMETA.forEach(function(sm){
      var name=shiftLabel(sm.t);
      var pick=buildTimePicker(S.alarmTimes[sm.t],function(v){ setShiftTime(sm.t,v); },{label:name,id:'tp'+sm.t});
      shiftPickers[sm.t]=pick;
      c.appendChild(buildWeckerRow(name,KIND_COLORS[sm.t],pick,
        buildSwitch('ae'+sm.t,t('wecker.auto_aria',{name:name}),isAutoOn(sm.t)),'aeState'+sm.t,sm.t));
    });
    renderWeckerStatus();
  }
  function renderFreeAlarmSettings(){
    var c=$('freeAlarmBox'); if(!c) return;
    c.innerHTML='';
    freePicker=buildTimePicker(S.freeAlarm.time,setFreeTime,{label:t('free.kind'),id:'fatp'});
    c.appendChild(buildWeckerRow(t('time.title'),'',freePicker,
      buildSwitch('freeAlarmEnabled',t('wecker.auto_aria',{name:t('free.kind')}),isAutoOn('free')),'freeAutoState'));
    var cap=document.createElement('div'); cap.className='small muted wkcap'; cap.textContent=t('free.weekdays');
    c.appendChild(cap);
    var days=document.createElement('div'); days.className='chiprow';
    for(var i=0;i<7;i++){
      var b=document.createElement('button'); b.type='button'; b.className='sftbtn'; b.textContent=dayShort(i);
      b.dataset.di=i; b.setAttribute('aria-label',dayLong(i));
      days.appendChild(b);
    }
    c.appendChild(days);
    syncWeckerUi();
  }
  function toggleFreeDay(i){
    var idx=S.freeAlarm.days.indexOf(i);
    if(idx===-1) S.freeAlarm.days.push(i); else S.freeAlarm.days.splice(idx,1);
    S.freeAlarm.days.sort();
    save(); syncWeckerUi(); renderCal(); scheduleResync();
  }

  /* ── MUSTER ─────────────────────────────── */
  function initPat(){
    var req=S.weeksCount*7;
    if(S.pattern.length!==req){
      var p=new Array(req).fill(0);
      for(var i=0;i<Math.min(S.pattern.length,req);i++) p[i]=S.pattern[i];
      S.pattern=p;
    }
  }
  /* Schnellauswahl: gewählte Schicht aus der Legende (null = Tippen wechselt reihum) */
  var patBrush=null;
  function renderPatHint(){
    document.querySelectorAll('#patLegend .pick').forEach(function(b){
      b.classList.toggle('active',Number(b.dataset.pick)===patBrush);
    });
    $('patHint').textContent=patBrush
      ?'✏️ '+t('pattern.brush_hint',{shift:shiftLabel(patBrush)})
      :t('pattern.tip',{shifts:[1,2,3,4].map(shiftLabel).join('/')});
  }
  function renderPat(){
    var c=$('patGrid'); c.innerHTML='';
    // Kopfzeile mit Wochentagen – belegte Tage zeigen die Schicht statt des Wochentags
    var head=document.createElement('div'); head.className='wrow whead';
    var hl=document.createElement('span'); hl.className='wlbl'; head.appendChild(hl);
    var hd=document.createElement('div'); hd.className='pdays';
    for(var di=0;di<7;di++){ var e=document.createElement('div'); e.className='pdh'; e.textContent=dayShort(di); hd.appendChild(e); }
    head.appendChild(hd); c.appendChild(head);
    for(var w=0;w<S.weeksCount;w++){
      var row=document.createElement('div'); row.className='wrow';
      var lbl=document.createElement('span'); lbl.className='wlbl'; lbl.textContent=t('pattern.week',{n:w+1}); row.appendChild(lbl);
      var days=document.createElement('div'); days.className='pdays';
      for(var d=0;d<7;d++){
        var idx=w*7+d, tp=S.pattern[idx];
        var btn=document.createElement('div');
        btn.className='pday '+(SCLS[tp]||'');
        btn.textContent=tp===0?dayShort(d):shiftLabel(tp);
        btn.dataset.idx=idx;
        days.appendChild(btn);
      }
      row.appendChild(days); c.appendChild(row);
    }
  }
  function cycleShift(idx){
    if(patBrush) S.pattern[idx]=S.pattern[idx]===patBrush?0:patBrush;
    else S.pattern[idx]=(S.pattern[idx]+1)%5;
    renderPat(); renderCal(); save(); scheduleResync();
  }

  /* ── AUSNAHMEN ──────────────────────────── */
  function renderEx(){
    var c=$('exList'); c.innerHTML='';
    if(!S.exceptions.length){
      c.innerHTML='<p class="small muted" style="margin:0;">'+esc(t('exceptions.none'))+'</p>'; return;
    }
    S.exceptions.slice().sort(function(a,b){return a.start.localeCompare(b.start);}).forEach(function(ex){
      var txt=ex.start===ex.end?fmtDe(ex.start):fmtDe(ex.start)+' \u2013 '+fmtDe(ex.end);
      var el=document.createElement('div'); el.className='exitem';
      el.innerHTML='<span>'+esc(txt)+': <b>'+esc(exLabel(ex.type))+'</b></span>'
        +'<button class="danger sm xdel" data-id="'+esc(ex.id)+'" aria-label="'+esc(t('exceptions.delete'))+'">✕</button>';
      c.appendChild(el);
    });
  }
  function delEx(id){
    S.exceptions=S.exceptions.filter(function(e){return e.id!==id;});
    renderEx(); renderCal(); save(); scheduleResync();
  }

  /* ── KALENDER ───────────────────────────── */
  function renderCal(){
    var year=viewDate.getFullYear(), month=viewDate.getMonth();
    var hols=holidays(year,S.bundesland||'NW');
    if(month===0) Object.assign(hols,holidays(year-1,S.bundesland||'NW'));
    if(month===11) Object.assign(hols,holidays(year+1,S.bundesland||'NW'));
    $('mTitle').textContent=t('format.month_year',{month:monthLong(month),year:year});
    var grid=document.createElement('div'); grid.className='cgrid';
    // Header: KW-Ecke + Mo-So
    var kwh=document.createElement('div'); kwh.className='dow'; kwh.textContent=t('cal.kw'); grid.appendChild(kwh);
    for(var di=0;di<7;di++){var dw=document.createElement('div');dw.className='dow';dw.textContent=dayShort(di);grid.appendChild(dw);}
    var firstDow=(new Date(year,month,1).getDay()+6)%7;
    var dim=new Date(year,month+1,0).getDate();
    var today=todayYmd();
    var now=new Date(); now.setHours(0,0,0,0);
    // Slots: null=leer, Zahl=Tag
    var slots=[];
    for(var i=0;i<firstDow;i++) slots.push(null);
    for(var d=1;d<=dim;d++) slots.push(d);
    while(slots.length%7!==0) slots.push(null);
    for(var r=0;r<slots.length;r+=7){
      // KW-Zelle: ersten echten Tag der Zeile suchen
      var kwDate=null;
      for(var c=r;c<r+7;c++){ if(slots[c]!==null){kwDate=new Date(year,month,slots[c],12,0,0);break;} }
      var kwNum=kwDate?getISOWeek(kwDate):'';
      var kwCell=document.createElement('div');
      kwCell.className='kw'; kwCell.textContent=kwNum?kwNum:'';
      grid.appendChild(kwCell);
      for(var c=r;c<r+7;c++){
        var d=slots[c];
        if(d===null){var el=document.createElement('div');el.className='cday dim';grid.appendChild(el);continue;}
        var ds=toYmd(new Date(year,month,d,12,0,0));
        var sh=getShift(ds);
        var hol=hols[ds];
        var isTod=ds===today;
        var aa=getActiveAlarmsForDate(ds);
        var cell=document.createElement('div');
        cell.className='cday'+(sh.cls?' '+sh.cls:'')+(hol&&sh.type!==-1?' holid':'')+(isTod?' today':'')+(sh.swapped?' swapped':'');
        var cd=parseYmd(ds); cd.setHours(0,0,0,0);
        if(cd>=new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate(),0,0,0,0)){
          cell.classList.add('click');
          (function(s,sf){cell.onclick=function(ev){ev.stopPropagation();openSheet(s,sf);};})(ds,sh);
        }
        if(isTod){var b=document.createElement('div');b.className='dtbadge';b.textContent=t('cal.today_badge');cell.appendChild(b);}
        var num=document.createElement('div');
        num.className='dnum'+(isTod?' tc':''); num.textContent=t('cal.day_num',{d:d}); cell.appendChild(num);
        if(hol){var p=document.createElement('div');p.className='dpill hp';p.textContent=t('holiday.'+hol);cell.appendChild(p);}
        if(sh.name){
          var p=document.createElement('div');
          p.className='dpill'+(sh.type===-1?' ep':''); p.textContent=sh.name; cell.appendChild(p);
        }
        if(aa.length){
          var ind=document.createElement('div');ind.className='aind';
          ind.title=t('cal.alarm_title',{times:fmtTime(aa.map(function(a){return a.time;}).join(', '))});cell.appendChild(ind);
        }
        grid.appendChild(cell);
      }
    }
    var con=$('calGrid'); con.innerHTML=''; con.appendChild(grid);
    renderAList(); renderWeckerStatus();
  }

  /* ── WECKER-LISTE ───────────────────────── */
  /* Startseite: nur die nächsten Wecker kompakt, die ganze Liste auf Abruf */
  var A_PREVIEW=3;
  function alarmDayLabel(ds){ return dayLabel(ds); }
  function upcomingAlarms(){
    return getAllActiveAlarmsSorted().filter(function(a){return isFuture(a.ds,a.time);});
  }
  function renderAList(){
    var card=$('aCard'), list=$('aList'); list.innerHTML='';
    renderNextAlarm();
    var entries=upcomingAlarms();
    if(!entries.length){ card.style.display='none'; if(isAlarmsOpen()) renderAllAlarms(); return; }
    card.style.display='';
    entries.slice(0,A_PREVIEW).forEach(function(a){
      var el=document.createElement('div'); el.className='arow'; el.dataset.date=a.ds;
      el.innerHTML='<span class="ad">'+esc(alarmDayLabel(a.ds))+'</span><span class="at">'+esc(a.time)+'</span>'
        +'<span class="an">'+esc(alarmName(a))+'</span>';
      list.appendChild(el);
    });
    var last=parseYmd(entries[entries.length-1].ds), cnt=entries.length;
    $('aSummary').textContent=cnt>1
      ?t('alarm.summary_until',{n:cnt,mon:monthShort(last.getMonth()),year:last.getFullYear()})
      :t('alarm.count',{n:cnt});
    if(isAlarmsOpen()) renderAllAlarms();
  }
  /* Alle Wecker: nach Monaten gruppiert, aufklappbar */
  var openMonths=null;   // null = erster Monat offen
  function isAlarmsOpen(){ return $('alarmsOverlay').classList.contains('open'); }
  function renderAllAlarms(){
    var box=$('allAlarmList'), entries=upcomingAlarms(); box.innerHTML='';
    $('allSummary').textContent=entries.length?t('alarm.set_count',{n:entries.length}):t('alarm.none_set');
    if(!entries.length&&isAnime()) box.innerHTML='<div class="an-say an-empty">'+mascotHtml('sleepy')+'<span class="an-bubble">'+esc(t('anime.empty_alarms'))+'</span></div>';
    var groups={}, order=[];
    entries.forEach(function(a){ var m=a.ds.slice(0,7); if(!groups[m]){groups[m]=[];order.push(m);} groups[m].push(a); });
    if(openMonths===null) openMonths=order.length?[order[0]]:[];
    order.forEach(function(m){
      var det=document.createElement('details'); det.className='amonth'; det.dataset.m=m;
      if(openMonths.indexOf(m)!==-1) det.open=true;
      var p=m.split('-').map(Number);
      var delTxt=esc(t('alarm.delete'));
      det.innerHTML='<summary><span>'+esc(t('format.month_year',{month:monthLong(p[1]-1),year:p[0]}))+' <span class="muted">· '+groups[m].length+'</span></span></summary>'
        +groups[m].map(function(a){
          return '<div class="arow"><span class="ad">'+esc(alarmDayLabel(a.ds))+'</span><span class="at">'+esc(a.time)+'</span>'
            +'<span class="an">'+esc(alarmName(a))+'</span>'
            +'<button class="adel" title="'+delTxt+'" aria-label="'+delTxt+'" data-date="'+esc(a.ds)+'" data-key="'+esc(a.alarmKey)+'">🗑</button></div>';
        }).join('');
      box.appendChild(det);
    });
  }
  function openAllAlarms(){ openMonths=null; renderAllAlarms(); $('alarmsOverlay').classList.add('open'); $('alarmsOverlay').scrollTop=0; }
  function closeAllAlarms(){ $('alarmsOverlay').classList.remove('open'); }

  /* Warnung bei fehlender Wecker-Berechtigung (z. B. Dialog mit „Später“ weggeklickt) */
  function renderPermWarn(){
    var el=$('permWarn'); if(!el) return;
    var issue=''; try{ if(hasBridge('getAlarmPermissionIssue')) issue=window.Android.getAlarmPermissionIssue(); }catch(e){}
    if(!issue){ el.style.display='none'; return; }
    var txt=t(issue==='exact'?'perm.exact':'perm.fullscreen');
    el.innerHTML='<span>⚠️ '+esc(txt)+'</span><button class="sm primary" id="permFixBtn">'+esc(t('perm.allow'))+'</button>';
    $('permFixBtn').onclick=function(){ window.Android.openAlarmPermissionSettings(issue); };
    el.style.display='';
  }

  /* „Nächster Wecker“ über dem Kalender */
  function renderNextAlarm(){
    var el=$('nextAlarm'); if(!el) return;
    var next=(S.activeAlarms||[]).filter(function(a){return isFuture(a.ds,a.time);})
      .sort(function(a,b){return (a.ds+a.time).localeCompare(b.ds+b.time);})[0];
    if(isAnime()){ renderNextAnime(el,next); return; }
    if(!next){ el.className='nextalarm none'; el.textContent='⏰ '+t('next.none'); return; }
    var rel=nextRelLabel(next);
    el.className='nextalarm';
    // ein einziges Kind-Element, sonst verteilt Flexbox die Textteile auf Spalten
    el.innerHTML='<span>⏰ '+tHtml('next.label',{when:esc(rel),time:esc(fmtTime(next.time)),name:esc(alarmName(next))})+'</span>';
  }

  function nextRelLabel(next){
    return next.ds===todayYmd()?t('next.today'):(next.ds===toYmd(new Date(Date.now()+864e5))?t('next.tomorrow'):dayLabel(next.ds));
  }
  /* Anime-Design: „Nächster Wecker“ als Sprechblase des Maskottchens. Gesicht passend:
     schläfrig ohne Wecker oder vor der Nachtschicht, aufgeregt wenn es bald (< 12 h) klingelt */
  function renderNextAnime(el,next){
    var face='sleepy', txt, soon='';
    if(!next) txt=esc(t('anime.next_none'));
    else{
      var p=next.ds.split('-').map(Number), tm=String(next.time).split(':').map(Number);
      var mins=Math.max(1,Math.round((new Date(p[0],p[1]-1,p[2],tm[0]||0,tm[1]||0,0,0).getTime()-Date.now())/60000));
      var night=/-t4$/.test(String(next.alarmKey).replace(/#snooze$/,''));
      face=night?'sleepy':(mins<12*60?'excited':'happy');
      if(mins<12*60) soon=mins<60?t('anime.soon_minutes',{n:mins}):t('anime.soon_hours',{n:Math.round(mins/60)});
      txt=tHtml('anime.next',{when:esc(nextRelLabel(next)),time:esc(fmtTime(next.time)),name:esc(alarmName(next))});
    }
    el.className='nextalarm an-next'+(next?'':' none');
    el.innerHTML=mascotHtml(face)+'<span class="an-bubble"><span class="an-greet">'+esc(animeGreeting())+'</span>'
      +txt+(soon?'<span class="an-soon">'+esc(soon)+'</span>':'')+'</span>';
  }

  /* Schichttausch im Tages-Sheet: Schicht nur für diesen Tag ändern */
  function renderSwap(ds){
    var el=$('sSwap'); if(!el) return;
    var ex=S.exceptions.find(function(e){return ds>=e.start&&ds<=e.end;});
    if(ex){
      // Tag gehört zu einer Ausnahme: anzeigen und entfernen anbieten
      var span=ex.start===ex.end?fmtDe(ex.start):fmtDe(ex.start)+' – '+fmtDe(ex.end);
      el.innerHTML='<span class="lbl">📌 '+esc(exLabel(ex.type))+' ('+esc(span)+')</span>'
        +'<button type="button" class="sftbtn" id="exDelBtn">'+esc(t('swap.remove_exception'))+'</button>';
      $('exDelBtn').onclick=function(){
        delEx(ex.id); resyncAlarms({quiet:true}); openSheet(ds,getShift(ds)); toast(t('swap.exception_removed',{type:exLabel(ex.type),span:span}));
      };
      return;
    }
    var cur=Object.prototype.hasOwnProperty.call(S.overrides,ds)?S.overrides[ds]:null;
    var opts=[{t:null,n:t('swap.as_plan')},{t:1,n:shiftLabel(1)},{t:2,n:shiftLabel(2)},{t:3,n:shiftLabel(3)},{t:4,n:shiftLabel(4)}];
    el.innerHTML='<span class="lbl">'+esc(t('swap.shift_label'))+'</span>'+opts.map(function(o){
      return '<button type="button" class="sftbtn'+(cur===o.t?' sftbtn-active':'')+'" data-swap="'+(o.t===null?'':o.t)+'">'+esc(o.n)+'</button>';
    }).join('')
      +'<span class="lbl" style="flex-basis:100%;margin-top:4px;">'+esc(t('swap.exception_label'))+'</span>'
      +['Urlaub','Krank','Schulung'].map(function(et){
        // data-ex = interner (deutscher) Typ, Beschriftung übersetzt
        return '<button type="button" class="sftbtn" data-ex="'+et+'">'+esc(exLabel(et))+'</button>';
      }).join('');
    el.querySelectorAll('[data-swap]').forEach(function(b){
      b.onclick=function(){ setOverride(ds,b.dataset.swap===''?null:Number(b.dataset.swap)); };
    });
    el.querySelectorAll('[data-ex]').forEach(function(b){
      b.onclick=function(){
        S.exceptions.push({id:uid(),start:ds,end:ds,type:b.dataset.ex});
        renderEx(); renderCal(); save(); resyncAlarms({quiet:true});
        openSheet(ds,getShift(ds)); toast(t('swap.exception_added',{type:exLabel(b.dataset.ex),date:fmtDate(ds)}));
      };
    });
  }
  function setOverride(ds,type){
    if(type===null) delete S.overrides[ds]; else S.overrides[ds]=type;
    save(); renderCal(); resyncAlarms();
    openSheet(ds,getShift(ds));
    toast(type===null?t('swap.toast_plan'):t('swap.toast_set',{date:fmtDate(ds),shift:shiftLabel(type)||shiftLabel(1)}));
  }

  /* ── BOTTOM SHEET ───────────────────────── */
  /* Einzelwecker: gewählte Art (0 = Einzelwecker, 1–4 = Schicht) und Zeitauswahl des offenen Sheets */
  var sheetSelType=0, sheetPicker=null, sheetDs=null;
  function sheetDefaultTime(t){
    return (t>=1&&t<=4?S.alarmTimes[t]:S.freeAlarm.time)||'07:00';
  }
  function markSheetType(chips){
    chips.querySelectorAll('.sftbtn').forEach(function(b){
      var on=Number(b.dataset.st)===sheetSelType;
      b.classList.toggle('sftbtn-active',on); b.setAttribute('aria-pressed',on?'true':'false');
    });
  }
  function openSheet(ds,sh){
    try{
    sheetDs=ds;
    document.getElementById('sDate').textContent=t('format.date_long',fmtParts(ds));
    var aa=getActiveAlarmsForDate(ds);
    var txt=document.getElementById('sTxt'), btns=document.getElementById('sBtns');
    var pickerEl=document.getElementById('sPicker');
    if(pickerEl)pickerEl.innerHTML='';
    var bar=document.getElementById('sBar');
    renderSwap(ds);
    if(aa.length){
      var first=aa[0];
      bar.textContent=alarmName(first); bar.className='sbar '+(SCLS[first.alarmKey.match(/t(\d)/)?Number(RegExp.$1):0]||'');
      txt.innerHTML='<strong>🔔 '+esc(t('sheet.alarm_set'))+'</strong><br><span class="muted small">'
        +esc(t('sheet.alarm_at',{date:fmtDate(ds),times:fmtTime(aa.map(function(a){return a.time;}).join(', '))}))+'</span>';
      if(pickerEl)pickerEl.style.display='none';
      btns.innerHTML='<button class="danger" id="scnBtn">🔕 '+esc(t('sheet.delete'))+'</button><button id="sclBtn">'+esc(t('common.close'))+'</button>';
      document.getElementById('scnBtn').onclick=function(){aa.forEach(function(a){cancelAlarm(ds,a.alarmKey);});};
    } else {
      bar.textContent='⏰ '+t('sheet.set_title'); bar.className='sbar';
      txt.innerHTML='<span class="muted small">'+esc(t('sheet.choose',{date:fmtDate(ds)}))+'</span>';
      if(pickerEl){
        pickerEl.style.display='';
        var shiftOpts=[{t:0,n:t('alarm.single')},{t:1,n:shiftLabel(1)},{t:2,n:shiftLabel(2)},{t:3,n:shiftLabel(3)},{t:4,n:shiftLabel(4)}];
        sheetSelType=sh.type>=1&&sh.type<=4?sh.type:0;
        var chips=document.createElement('div'); chips.className='chiprow';
        shiftOpts.forEach(function(o){
          var b=document.createElement('button'); b.type='button'; b.className='sftbtn'; b.textContent=o.n;
          b.dataset.st=o.t; b.setAttribute('aria-pressed','false');
          b.onclick=function(){
            sheetSelType=o.t; markSheetType(chips);
            sheetPicker.setTime(sheetDefaultTime(o.t));
          };
          chips.appendChild(b);
        });
        markSheetType(chips);
        sheetPicker=buildTimePicker(sheetDefaultTime(sheetSelType),null,{label:t('alarm.generic'),id:'sqt'});
        pickerEl.appendChild(chips); pickerEl.appendChild(sheetPicker);
      }
      btns.innerHTML='<button class="primary" id="ssetBtn" style="flex:2;">🔔 '+esc(t('sheet.set_btn'))+'</button><button id="sclBtn">'+esc(t('common.cancel'))+'</button>';
      document.getElementById('ssetBtn').onclick=function(){ setCustomAlarm(ds,sheetSelType); };
    }
    document.getElementById('sclBtn').onclick=closeSheet;
    document.body.style.overflow='hidden';
    var ov=document.getElementById('overlay');
    ov.classList.add('open');
    setTimeout(function(){ov.scrollTop=ov.scrollHeight;},50);
    }catch(ex){toast(t('error.generic',{msg:ex.message}),true);}
  }
  function closeSheet(){
    document.getElementById('overlay').classList.remove('open');
    document.body.style.overflow='';
    sheetPicker=null; sheetSelType=0; sheetDs=null;
  }

  /* ── ALARM BRIDGE ───────────────────────── */
  function setCustomAlarm(ds,selType){
    try{
      var time=sheetPicker&&parseHhmm(sheetPicker.getTime());
      if(!time){toast(t('sheet.invalid_time'),true);return;}
      var h=Number(time.slice(0,2)), m=Number(time.slice(3));
      var p=ds.split('-').map(Number);
      var alarmMs=new Date(p[0],p[1]-1,p[2],h,m,0,0).getTime();
      if(alarmMs<=Date.now()){
        toast('⚠️ '+t('sheet.past',{time:fmtTime(pad(h)+':'+pad(m)),date:fmtDate(ds)}),true);
        return;
      }
      var key=selType>=1&&selType<=4?('shift-'+ds+'-t'+selType):('custom-'+ds);
      var shiftName=SNAMES[selType]||'Einzelwecker';   // Datenwert (deutsch), Anzeige über alarmName
      var label=alarmMsg(key,ds);
      if(!window.Android||typeof window.Android.setAlarmForDate!=='function'){
        toast(t('common.no_bridge'),true);return;
      }
      var result=window.Android.setAlarmForDate(p[0],p[1],p[2],h,m,key,label);
      if(result===false){toast(t('sheet.set_failed'),true);return;}
      addActiveAlarm(ds,key,time,shiftName,false);
      S.suppressed=S.suppressed.filter(function(k){return k!==key;});
      save(); renderCal(); closeSheet();
      toast('✅ '+t('sheet.set_ok',{time:fmtTime(pad(h)+':'+pad(m)),date:fmtDate(ds)}));
    }catch(ex){
      toast(t('error.alarm',{msg:ex.message}),true);
    }
  }
  function cancelAlarm(ds,key){
    bridgeCancel(key);
    var a=S.activeAlarms.find(function(x){return x.ds===ds&&x.alarmKey===key;});
    // gelöschten Auto-Wecker nicht beim nächsten Abgleich wieder anlegen
    if(a&&a.auto&&S.suppressed.indexOf(key)===-1) S.suppressed.push(key);
    removeActiveAlarm(ds,key);
    // Zum Schicht-Wecker gehörenden Vorwecker mitlöschen
    if(/^shift-/.test(key)){
      var pk='pre-'+key, pa=S.activeAlarms.find(function(x){return x.alarmKey===pk;});
      bridgeCancel(pk);
      if(pa){ removeActiveAlarm(pa.ds,pk); if(S.suppressed.indexOf(pk)===-1) S.suppressed.push(pk); }
    }
    save(); renderCal(); closeSheet(); toast(t('sheet.deleted'));
  }

  /* Widget: Schichtnamen der nächsten 60 Tage (das Widget wählt per Datum selbst).
     Bewusst die internen deutschen Namen – ShiftWidget übersetzt bekannte Namen selbst in die
     App-Sprache (stimmt so auch nach einem Sprachwechsel, bevor die Oberfläche neue Daten schickt). */
  function pushWidgetData(){
    if(!hasBridge('updateWidget')) return;
    var out={}, start=parseYmd(todayYmd());
    for(var i=0;i<60;i++){
      var ds=toYmd(new Date(start.getTime()+i*864e5)), sh=getShift(ds);
      out[ds]=sh.dname||'kein Eintrag';
    }
    try{ window.Android.updateWidget(JSON.stringify(out)); }catch(e){}
  }

  /* Zurück-Geste (aus MainActivity): oberste offene Ebene schließen. true = erledigt */
  window.handleBack=function(){
    var vis=function(id){ var e=$(id); return e&&getComputedStyle(e).display!=='none'; };
    if(vis('cdlgBg')){ $('cdlgCancel').click(); return true; }
    if(isTimeSheetOpen()){ closeTimeSheet(false); return true; }
    if(isWizOpen()){ wizBack(); return true; }
    if($('overlay').classList.contains('open')){ closeSheet(); return true; }
    if(isAlarmsOpen()){ closeAllAlarms(); return true; }
    if(currentTab!=='plan'){ showTab('plan'); return true; }
    return false;
  };

  /* ── BEREICHE (untere Navigation) ─────────
     plan = Kalender (Startseite), wecker = alles rund ums Wecken,
     schicht = Einrichtung des Schichtplans + Daten/App */
  var TABS={plan:'tabPlan',wecker:'tabWecker',schicht:'tabSchicht'};
  var currentTab='plan';
  function showTab(name){
    if(!TABS[name]) name='plan';
    currentTab=name;
    Object.keys(TABS).forEach(function(k){ $(TABS[k]).hidden=(k!==name); });
    document.querySelectorAll('#bottomNav .navbtn').forEach(function(b){
      b.classList.toggle('active',b.dataset.tab===name);
    });
    window.scrollTo(0,0);
  }

  /* ── SCHNITTSTELLE für Bereiche und Einrichtung ──
     Kleine Setter, die Zustand ändern, speichern und den Wecker-Abgleich anstoßen.
     Die Oberfläche (Wecker-Bereich, Einrichtung) soll nur diese verwenden. */
  function setShiftTime(t,hhmm){
    if(!(t>=1&&t<=4)||!/^\d{2}:\d{2}$/.test(hhmm)) return;
    S.alarmTimes[t]=hhmm; save(); syncWeckerUi(); renderCal(); scheduleResync();
  }
  /* EIN Schalter pro Wecker-Art: an = Wecker für alle passenden Tage automatisch stellen
     und aktuell halten, aus = automatische Wecker dieser Art entfernen (manuelle bleiben).
     Liefert die Anzahl automatischer Wecker dieser Art danach. */
  function setShiftAuto(t,on){
    if(!(t>=1&&t<=4)) return 0;
    S.alarmEnabled[t]=!!on; S.autoSchedule[t]=!!on;
    // eigene Löschungen dieser Art nicht mehr unterdrücken – wer einschaltet, will alle Tage
    if(on) S.suppressed=S.suppressed.filter(function(k){return !new RegExp('^(pre-)?shift-.*-t'+t+'$').test(k);});
    save(); _lastAutoResync=resyncAlarms({quiet:true}); renderCal(); syncWeckerUi();
    return autoCount(t);
  }
  function setFreeAuto(on){
    S.freeAlarm.enabled=!!on; S.autoSchedule.free=!!on;
    if(on) S.suppressed=S.suppressed.filter(function(k){return !/^free-day-/.test(k);});
    save(); _lastAutoResync=resyncAlarms({quiet:true}); renderCal(); syncWeckerUi();
    return autoCount('free');
  }
  function setFreeTime(hhmm){
    if(!/^\d{2}:\d{2}$/.test(hhmm)) return;
    S.freeAlarm.time=hhmm; save(); syncWeckerUi(); renderCal(); scheduleResync();
  }
  function setPatternDay(idx,t){
    if(idx<0||idx>=S.pattern.length||!(t>=0&&t<=4)) return;
    S.pattern[idx]=t; renderPat(); renderCal(); save(); scheduleResync();
  }
  function setWeeksCount(n){
    S.weeksCount=Math.max(1,Math.min(6,n)); $('weeksVal').textContent=S.weeksCount;
    initPat(); renderPat(); renderCal(); save(); scheduleResync();
  }

  /* ── PERSISTENZ ─────────────────────────── */
  function save(){
    var json=JSON.stringify(S);
    // Zuerst nativ und synchron sichern – localStorage schreibt verzögert und geht verloren,
    // wenn die App direkt nach einer Änderung beendet wird
    if(hasBridge('saveState')){ try{ if(window.Android.saveState(json)===false) throw 0; }catch(e){ toast(t('error.save'),true); } }
    pushWidgetData();
    try{localStorage.setItem(LS,json);}
    catch(e){toast(t('error.save_local'),true);}
  }
  function load(){
    try{
      var raw='';
      if(hasBridge('loadState')){ try{ raw=window.Android.loadState(); }catch(e){} }
      if(!raw) raw=localStorage.getItem(LS);
      if(!raw){ S=createDefaultState(); S.startDate=todayYmd(); return; }
      var s=JSON.parse(raw); if(!s||typeof s!=='object')return;
      applyState(s);
    }catch(e){}
  }
  /* Übernimmt geprüfte Werte aus s nach S (gespeicherter Stand oder Profil-Datei) */
  function applyState(s){
    if(typeof s.startDate==='string'&&(s.startDate===''||/^\d{4}-\d{2}-\d{2}$/.test(s.startDate))) S.startDate=s.startDate;
    if(typeof s.weeksCount==='number')  S.weeksCount=Math.max(1,Math.min(6,s.weeksCount));
    if(typeof s.bundesland==='string'&&/^(BW|BY|BE|BB|HB|HH|HE|MV|NI|NW|RP|SL|SN|ST|SH|TH)$/.test(s.bundesland)) S.bundesland=s.bundesland;
    if(Array.isArray(s.pattern))        S.pattern=s.pattern.map(function(t){return (typeof t==='number'&&t>=0&&t<=4&&t%1===0)?t:0;});
    if(Array.isArray(s.exceptions))     S.exceptions=s.exceptions.filter(function(e){
      return e&&/^\d{4}-\d{2}-\d{2}$/.test(e.start)&&/^\d{4}-\d{2}-\d{2}$/.test(e.end)&&typeof e.type==='string';
    }).map(function(e){return {id:typeof e.id==='string'?e.id:uid(),start:e.start,end:e.end,type:e.type.slice(0,40)};});
    if(s.alarmTimes&&typeof s.alarmTimes==='object')
      [1,2,3,4].forEach(function(t){
        if(typeof s.alarmTimes[t]==='string'){
          // Validiere Format HH:MM
          var m=s.alarmTimes[t].match(/^(\d{1,2}):(\d{2})$/);
          if(m&&Number(m[1])<=23&&Number(m[2])<=59){
            S.alarmTimes[t]=String(Number(m[1])).padStart(2,'0')+':'+m[2];
          } else {
            S.alarmTimes[t]=''; // Ung\u00FCltige Zeit l\u00F6schen
          }
        }
      });
    if(s.activeAlarms&&typeof s.activeAlarms==='object'){
      if(Array.isArray(s.activeAlarms)){
        S.activeAlarms=s.activeAlarms;
      } else {
        // Migration from old {date: {alarmKey, time, shiftName}} format
        var migrated=[];
        Object.keys(s.activeAlarms).forEach(function(ds){
          var info=s.activeAlarms[ds];
          if(info&&typeof info==='object'&&info.alarmKey){
            migrated.push({ds:ds,alarmKey:info.alarmKey,time:info.time||'',shiftName:info.shiftName||''});
          }
        });
        S.activeAlarms=migrated;
      }
    }
    if(s.alarmEnabled&&typeof s.alarmEnabled==='object')
      [1,2,3,4].forEach(function(t){if(typeof s.alarmEnabled[t]==='boolean')S.alarmEnabled[t]=s.alarmEnabled[t];});
    if(s.freeAlarm&&typeof s.freeAlarm==='object'){
      if(typeof s.freeAlarm.enabled==='boolean') S.freeAlarm.enabled=s.freeAlarm.enabled;
      if(typeof s.freeAlarm.time==='string'){
        var fm=s.freeAlarm.time.match(/^(\d{1,2}):(\d{2})$/);
        if(fm&&Number(fm[1])<=23&&Number(fm[2])<=59) S.freeAlarm.time=String(Number(fm[1])).padStart(2,'0')+':'+fm[2];
      }
      if(Array.isArray(s.freeAlarm.days)) S.freeAlarm.days=s.freeAlarm.days.filter(function(d){return d>=0&&d<=6;});
    }
    if(s.autoSchedule&&typeof s.autoSchedule==='object')
      [1,2,3,4,'free'].forEach(function(k){if(typeof s.autoSchedule[k]==='boolean')S.autoSchedule[k]=s.autoSchedule[k];});
    if(typeof s.skipHolidaysShift==='boolean') S.skipHolidaysShift=s.skipHolidaysShift;
    if(s.startMode==='kw'||s.startMode==='date') S.startMode=s.startMode;
    if(THEMES.indexOf(s.theme)!==-1) S.theme=s.theme;
    if(typeof s.wizardDone==='boolean') S.wizardDone=s.wizardDone;
    if(DESIGNS.indexOf(s.design)!==-1) S.design=s.design;
    if(typeof s.preAlarmMin==='number'&&[0,5,10,15,30,45,60].indexOf(s.preAlarmMin)!==-1) S.preAlarmMin=s.preAlarmMin;
    if(Array.isArray(s.suppressed)) S.suppressed=s.suppressed.filter(function(k){return typeof k==='string';});
    if(s.overrides&&typeof s.overrides==='object'&&!Array.isArray(s.overrides)){
      S.overrides={};
      Object.keys(s.overrides).forEach(function(d){
        var t=s.overrides[d];
        if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&typeof t==='number'&&t>=0&&t<=4&&t%1===0) S.overrides[d]=t;
      });
    }
    // fehlende/ungültige Weckzeit → Standardzeit (sonst zeigte die Auswahl 00:00)
    var defTimes=createDefaultState().alarmTimes;
    [1,2,3,4].forEach(function(t){ if(!S.alarmTimes[t]) S.alarmTimes[t]=defTimes[t]; });
    normalizeAutoFlags();
  }
  /* MIGRATION: Früher gab es je Wecker-Art zwei Schalter – alarmEnabled („Wecker aktiv“) und
     autoSchedule („Alle stellen“ gedrückt). Neu ist es EIN Schalter „automatisch wecken“, beide
     Flags sind immer gleich. Bei abweichenden Altwerten gilt: an nur, wenn beides an war – nur dann
     hat die App die Wecker bisher selbst ergänzt; „aktiv“ allein stellte keine neuen Wecker.
     Ausnahme: Versionen vor autoSchedule kannten nur „Alle stellen“ ohne Merker. Wer dort Wecker
     gestellt hat, hat noch automatische Wecker dieser Art – die sollen nicht stillschweigend
     verschwinden, also bleibt die Art an. Von Hand gestellte Wecker (auto:false) zählen nie mit
     und werden nicht verändert. Läuft beim Laden und beim Profil-Import (beide über applyState). */
  function normalizeAutoFlags(){
    [1,2,3,4,'free'].forEach(function(k){
      var en=k==='free'?S.freeAlarm.enabled:S.alarmEnabled[k];
      var re=k==='free'?/^free-day-/:new RegExp('^shift-\\d{4}-\\d{2}-\\d{2}-t'+k+'$');
      var legacy=!S.autoSchedule[k]&&(S.activeAlarms||[]).some(function(a){
        return a&&typeof a.alarmKey==='string'&&typeof a.ds==='string'&&re.test(a.alarmKey)&&isFuture(a.ds,a.time)
          &&(a.auto===true||(a.auto===undefined&&guessAuto(a.alarmKey,a.time)));
      });
      var on=!!(en&&(S.autoSchedule[k]||legacy));
      if(k==='free') S.freeAlarm.enabled=on; else S.alarmEnabled[k]=on;
      S.autoSchedule[k]=on;
    });
  }

  /* ── PROFIL (Sicherung als Datei) ────────
     Enthält Plan + Einstellungen + von Hand gestellte Wecker. Automatische Wecker
     werden nicht gespeichert, sondern beim Laden per resyncAlarms() neu berechnet. */
  var PROFILE_FORMAT=1;
  function buildProfile(){
    var keys=['startDate','weeksCount','bundesland','pattern','exceptions','alarmTimes','alarmEnabled',
              'freeAlarm','autoSchedule','skipHolidaysShift','suppressed','overrides','preAlarmMin','startMode','design'];
    var data={};
    keys.forEach(function(k){ data[k]=S[k]; });
    data.manualAlarms=(S.activeAlarms||[]).filter(function(a){return !a.auto&&isFuture(a.ds,a.time);})
      .map(function(a){return {ds:a.ds,alarmKey:a.alarmKey,time:a.time,shiftName:a.shiftName};});
    var theme=S.theme||'system'; try{ theme=localStorage.getItem(THK)||theme; }catch(e){}
    return {app:'schichtwecker',format:PROFILE_FORMAT,exportedAt:new Date().toISOString(),theme:theme,
            alarmOptions:readAlarmOptions(),data:data};
  }
  function exportProfileFile(){
    if(!hasBridge('exportProfile')){ toast(t('common.no_bridge'),true); return; }
    save();
    window.Android.exportProfile(JSON.stringify(buildProfile(),null,2),'Schichtwecker-Profil-'+todayYmd()+'.json');
  }
  /* Schichten der nächsten 12 Monate als iCalendar-Datei (ganztägige Termine).
     Aufeinanderfolgende Tage gleicher Art werden zu einem Termin zusammengefasst. */
  function buildIcs(){
    var start=parseYmd(todayYmd()), events=[], cur=null;
    function ymd8(d){ return toYmd(d).replace(/-/g,''); }
    function label(sh){ return sh.type===-1?sh.name:(sh.type>=2&&sh.type<=4?t('ics.shift.'+sh.type):null); }
    for(var i=0;i<=366;i++){
      var d=new Date(start.getTime()+i*864e5), ds=toYmd(d), sh=getShift(ds), lab=i<366?label(sh):null;
      if(cur&&cur.lab===lab){ cur.end=d; continue; }
      if(cur) events.push(cur);
      cur=lab?{lab:lab,start:d,end:d}:null;
    }
    if(cur) events.push(cur);
    var stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    function esc(t){ return String(t).replace(/[\\;,]/g,function(c){return '\\'+c;}); }
    var lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Schichtwecker//DE','CALSCALE:GREGORIAN','X-WR-CALNAME:'+esc(t('ics.calname'))];
    events.forEach(function(e){
      var endExcl=new Date(e.end.getTime()+864e5);
      lines.push('BEGIN:VEVENT','UID:'+ymd8(e.start)+'-'+e.lab.replace(/\W/g,'')+'@schichtwecker','DTSTAMP:'+stamp,
        'DTSTART;VALUE=DATE:'+ymd8(e.start),'DTEND;VALUE=DATE:'+ymd8(endExcl),'SUMMARY:'+esc(e.lab),
        'TRANSP:TRANSPARENT','END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return {text:lines.join('\r\n')+'\r\n',count:events.length};
  }
  function exportIcsFile(){
    if(!hasBridge('exportFile')){ toast(t('common.no_bridge'),true); return; }
    var r=buildIcs();
    if(!r.count){ toast(t('backup.ics_empty'),true); return; }
    window.Android.exportFile(r.text,'Schichtplan-'+todayYmd()+'.ics','text/calendar');
  }
  function importProfileFile(){
    if(!hasBridge('importProfile')){ toast(t('common.no_bridge'),true); return; }
    window.Android.importProfile();
  }
  /* Rückruf aus MainActivity mit dem Dateiinhalt */
  window.onProfileImported=function(text){
    var p;
    try{ p=JSON.parse(text); }catch(e){ toast(t('profile.invalid'),true); return; }
    if(!p||p.app!=='schichtwecker'||!p.data||typeof p.data!=='object'){ toast(t('profile.foreign'),true); return; }
    if(typeof p.format!=='number'||p.format>PROFILE_FORMAT){ toast(t('profile.too_new'),true); return; }
    var when=p.exportedAt&&/^\d{4}-\d{2}-\d{2}/.test(String(p.exportedAt))?String(p.exportedAt).slice(0,10):'';
    customConfirm(when?t('profile.confirm_dated',{date:fmtDate(when)}):t('profile.confirm'),function(){
      applyProfile(p);
    });
  };
  function applyProfile(p){
    // alle bisherigen Wecker löschen
    (S.activeAlarms||[]).forEach(function(a){ bridgeCancel(a.alarmKey); });
    if(hasBridge('cancelAllAlarms')){ try{ window.Android.cancelAllAlarms(); }catch(e){} }
    S=createDefaultState();
    var d=p.data;
    applyState(d);
    S.activeAlarms=[];
    if(!S.startDate) S.startDate=todayYmd();
    initPat();
    // von Hand gestellte Wecker wieder setzen
    var manual=0;
    (Array.isArray(d.manualAlarms)?d.manualAlarms:[]).forEach(function(a){
      if(!a||typeof a.alarmKey!=='string'||!/^(shift|custom|free-day)-/.test(a.alarmKey)) return;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(a.ds)||!/^\d{2}:\d{2}$/.test(a.time)||!isFuture(a.ds,a.time)) return;
      var name=String(a.shiftName||'Wecker');
      if(bridgeSet(a.ds,{key:a.alarmKey,time:a.time,msg:alarmMsg(a.alarmKey,a.ds)})){
        addActiveAlarm(a.ds,a.alarmKey,a.time,name,false); manual++;
      }
    });
    save();
    var r=resyncAlarms({quiet:true});
    if(hasBridge('syncAlarmWindow')){ try{ window.Android.syncAlarmWindow(); }catch(e){} }
    if(typeof p.theme==='string') applyTheme(p.theme);
    if(p.alarmOptions&&typeof p.alarmOptions==='object'&&hasBridge('setAlarmOptions')){
      try{ window.Android.setAlarmOptions(JSON.stringify(p.alarmOptions)); }catch(e){}
    }
    refreshAllUi();
    var n=S.activeAlarms.length;
    toast('✅ '+t('profile.loaded',{n:n})+(r.errors?' ('+t('resync.failed',{n:r.errors})+')':''),r.errors>0);
  }
  /* Weck-Verhalten: Schlummerzeit/Lautstärke/Vibration liegen nativ (Direct Boot),
     der Vorwecker im Plan-Zustand S (er erzeugt Wecker im Abgleich) */
  function readAlarmOptions(){
    var o={snoozeMinutes:5,risingVolume:false,vibrateOnly:false};
    if(hasBridge('getAlarmOptions')){ try{ Object.assign(o,JSON.parse(window.Android.getAlarmOptions())); }catch(e){} }
    return o;
  }
  function updateAlarmOptionsUi(){
    var o=readAlarmOptions();
    $('snoozeSel').value=String(o.snoozeMinutes);
    $('risingVol').checked=!!o.risingVolume;
    $('vibOnly').checked=!!o.vibrateOnly;
    $('preSel').value=String(S.preAlarmMin||0);
  }
  function writeAlarmOptions(){
    if(!hasBridge('setAlarmOptions')) return;
    var ok=window.Android.setAlarmOptions(JSON.stringify({
      snoozeMinutes:Number($('snoozeSel').value),risingVolume:$('risingVol').checked,vibrateOnly:$('vibOnly').checked}));
    if(ok===false) toast(t('error.option_save'),true);
  }

  /* Alle Einstellungs-Elemente neu aus S befüllen (nach Reset oder Profil-Import) */
  function refreshAllUi(){
    updateAlarmOptionsUi();
    renderStartPicker();
    $('weeksVal').textContent=S.weeksCount;
    $('bundesland').value=S.bundesland;
    $('skipHolShift').checked=S.skipHolidaysShift;
    renderAlarmSettings(); renderFreeAlarmSettings(); renderPat(); renderEx(); renderCal(); updateRingtoneUI();
    applyDesign();
  }

  /* ── EINRICHTUNG (geführt) ────────────────
     Vier Schritte (Startwoche, Rhythmus, Weckzeiten, Feiertage) + Abschluss.
     Alle Eingaben landen zuerst im Entwurf W und werden erst mit „Einrichten“
     (Schritt 4) übernommen – „Überspringen“ und Zurück-Geste ändern also nichts.
     Übernommen wird nur, was sich gegenüber dem aktuellen Stand geändert hat. */
  var WIZ_KEY='schichtplan-wizard-done';
  var WIZ_STEPS=4;
  var WIZ_COLORS={1:'var(--accent)',2:'var(--frueh)',3:'var(--spaet)',4:'var(--nacht)'};
  /* Vorlagen: je Woche die Schicht für Mo–Fr, Sa/So = Frei; null = alles leeren */
  var WIZ_TPLS=[
    /* Name/Beschreibung: wiz.tpl.<id>.name / .desc */
    {id:'fs',  weeks:[2,3]},
    {id:'fsn', weeks:[2,3,4]},
    {id:'leer',weeks:null}
  ];
  var W=null;   // Entwurf, solange die Einrichtung offen ist
  function isWizOpen(){ return $('wizBg').classList.contains('open'); }
  /* Ist die automatische Wecker-Art t aktuell an? */
  function wizAutoNow(t){ return !!(S.autoSchedule[t]&&S.alarmEnabled[t]); }
  /* Schichtarten im Entwurfs-Muster (Früh, Spät, Nacht, dann Frei) */
  function wizTypes(){ return [2,3,4,1].filter(function(t){ return W.pattern.indexOf(t)!==-1; }); }
  function wizMonday(){ return mondayOfIsoWeek(W.kwYear,W.kwNum); }
  function openWiz(){
    var d=parseYmd(S.startDate); if(isNaN(d)) d=parseYmd(todayYmd());
    var mo=mondayOf(d), times={}, auto={};
    [1,2,3,4].forEach(function(t){
      times[t]=S.alarmTimes[t]||'';
      // schon im Muster → aktuellen Stand zeigen; neue Arten: Schichten an, Frei aus
      auto[t]=S.pattern.indexOf(t)!==-1?wizAutoNow(t):t!==1;
    });
    W={step:0, kwYear:isoWeekYear(mo), kwNum:getISOWeek(mo), weeks:S.weeksCount,
       pattern:S.pattern.slice(0,S.weeksCount*7), tpl:null, times:times, auto:auto, bl:S.bundesland};
    while(W.pattern.length<W.weeks*7) W.pattern.push(0);
    renderWiz();
    $('wizBg').classList.add('open'); $('wizBg').setAttribute('aria-hidden','false'); $('wizBg').scrollTop=0;
    document.body.style.overflow='hidden';
  }
  function closeWiz(){
    $('wizBg').classList.remove('open'); $('wizBg').setAttribute('aria-hidden','true');
    document.body.style.overflow='';
    W=null;
    S.wizardDone=true; save();
    try{localStorage.setItem(WIZ_KEY,'1');}catch(e){}
  }
  /* Abschluss: zum Plan, Kalender auf den Monat der Startwoche */
  function finishWiz(){
    closeWiz(); showTab('plan');
    var d=parseYmd(S.startDate);
    // Kalender auf den Monat der Startwoche – liegt sie in der Vergangenheit, auf den aktuellen Monat
    if(!isNaN(d)){
      var now=new Date(), show=d<new Date(now.getFullYear(),now.getMonth(),1,12)?now:d;
      viewDate=new Date(show.getFullYear(),show.getMonth(),1,12,0,0); renderCal();
    }
  }
  /* Zurück (Knopf und Geste): einen Schritt zurück, auf Schritt 1 schließen */
  function wizBack(){
    if(W.step>=WIZ_STEPS) finishWiz();
    else if(W.step>0){ W.step--; renderWiz(); }
    else closeWiz();
  }
  function wizNext(){
    if(W.step>=WIZ_STEPS){ finishWiz(); return; }
    if(W.step===WIZ_STEPS-1) wizApply();
    W.step++; renderWiz();
  }
  function wizResize(n){
    n=Math.max(1,Math.min(6,n)); W.weeks=n;
    var p=new Array(n*7).fill(0);
    for(var i=0;i<Math.min(W.pattern.length,p.length);i++) p[i]=W.pattern[i];
    W.pattern=p;
  }
  function wizApplyTpl(id){
    var tpl=WIZ_TPLS.filter(function(x){return x.id===id;})[0]; if(!tpl) return;
    W.tpl=id;
    if(!tpl.weeks){ W.pattern=new Array(W.weeks*7).fill(0); return; }
    W.weeks=tpl.weeks.length; W.pattern=[];
    tpl.weeks.forEach(function(t){ W.pattern.push(t,t,t,t,t,1,1); });
  }
  /* Entwurf übernehmen – ausschließlich über die Schnittstellen-Setter */
  function wizApply(){
    var mo=toYmd(wizMonday()), cur=parseYmd(S.startDate);
    if(isNaN(cur)||toYmd(mondayOf(cur))!==mo){ S.startMode='kw'; applyStartDate(mo); }
    if(W.weeks!==S.weeksCount) setWeeksCount(W.weeks);
    for(var i=0;i<W.pattern.length;i++) if(S.pattern[i]!==W.pattern[i]) setPatternDay(i,W.pattern[i]);
    if(W.bl!==S.bundesland){ S.bundesland=W.bl; save(); }
    var types=wizTypes();
    types.forEach(function(t){ if(/^\d{2}:\d{2}$/.test(W.times[t])&&W.times[t]!==S.alarmTimes[t]) setShiftTime(t,W.times[t]); });
    // nur umschalten, was sich ändert – setShiftAuto(t,true) holt sonst gelöschte Wecker zurück
    types.forEach(function(t){ if(W.auto[t]!==wizAutoNow(t)) setShiftAuto(t,W.auto[t]); });
    // Setter haben einen gebündelten Abgleich angestoßen → jetzt sofort und still erledigen
    clearTimeout(_resyncTid); _resyncTid=null;
    resyncAlarms({quiet:true});
    S.wizardDone=true; save();
    try{localStorage.setItem(WIZ_KEY,'1');}catch(e){}
    refreshAllUi();
  }
  function wizRange(mo){
    var su=new Date(mo.getTime()); su.setDate(su.getDate()+6);
    return t('wiz.range',{mon:dayShort(0),sun:dayShort(6),from:t('format.date_short',fmtParts(toYmd(mo))),to:t('format.date_short',fmtParts(toYmd(su)))});
  }
  function wizFillKw(){
    var kn=$('wizKwNum'), n=isoWeeksInYear(W.kwYear); kn.innerHTML='';
    if(W.kwNum>n) W.kwNum=n;
    for(var w=1;w<=n;w++){ var o=document.createElement('option'); o.value=w; o.textContent=t('start.kw',{n:w}); kn.appendChild(o); }
    kn.value=W.kwNum;
    $('wizKwInfo').textContent=wizRange(wizMonday())+' '+W.kwYear;
  }
  function renderWizPat(){
    var h='<div class="wrow whead"><span class="wlbl"></span><div class="pdays">'
      +[0,1,2,3,4,5,6].map(function(di){return '<div class="pdh">'+esc(dayShort(di))+'</div>';}).join('')+'</div></div>';
    for(var w=0;w<W.weeks;w++){
      h+='<div class="wrow"><span class="wlbl">'+esc(t('pattern.week',{n:w+1}))+'</span><div class="pdays">';
      for(var d=0;d<7;d++){
        var i=w*7+d, tp=W.pattern[i];
        h+='<div class="pday '+(SCLS[tp]||'')+'" data-wi="'+i+'">'+esc(tp===0?dayShort(d):shiftLabel(tp))+'</div>';
      }
      h+='</div></div>';
    }
    $('wizPat').innerHTML=h;
    $('wizWeeksVal').textContent=W.weeks;
  }
  function wizSummary(){
    var up=upcomingAlarms(), mo=parseYmd(S.startDate);
    var head=up.length
      ?t('wiz.sum_head',{n:up.length,day:alarmDayLabel(up[0].ds),time:up[0].time})
      :t('alarm.none_set_short');
    var times=wizTypes().filter(function(tp){return tp!==1||W.auto[tp];}).map(function(tp){
      return esc(shiftLabel(tp))+' '+esc(S.alarmTimes[tp])+(wizAutoNow(tp)?'':' '+esc(t('wiz.sum_off')));
    }).join(' · ')||esc(t('wiz.sum_none'));
    var bl=$('bundesland').querySelector('option[value="'+S.bundesland+'"]');
    var row=function(k,v){ return '<div class="wiz-sumrow"><span class="muted">'+esc(t(k))+'</span><span>'+v+'</span></div>'; };
    return '<div class="wiz-stat" id="wizSummary">'+esc(head)+'</div>'
      +'<div class="wiz-sum">'
      +row('wiz.sum_start',esc(t('start.kw',{n:getISOWeek(mo)}))+' · '+esc(wizRange(mondayOf(mo))))
      +row('wiz.sum_pattern',esc(t('wiz.sum_weeks',{n:S.weeksCount})))
      +row('wiz.sum_alarms',times)
      +row('wiz.sum_holidays',esc(bl?bl.textContent:S.bundesland))
      +'</div>'
      +'<div class="wiz-tip">'+tHtml('wiz.tip')+'</div>'
      +'<div class="small muted" style="margin-top:12px;">'+esc(t('wiz.later'))+'</div>';
  }
  function renderWiz(){
    var st=W.step, done=st>=WIZ_STEPS, b=$('wizBody'), h='';
    $('wizStepTxt').textContent=done?t('wiz.done_step'):t('wiz.step',{n:st+1,total:WIZ_STEPS});
    $('wizBar').innerHTML=[0,1,2,3].map(function(i){return '<span'+(done||i<=st?' class="on"':'')+'></span>';}).join('');
    $('wizSkip').style.visibility=done?'hidden':'visible';
    $('wizPrev').style.display=done?'none':'';
    $('wizPrev').style.visibility=st===0?'hidden':'visible';   // Schritt 1: Schließen geht über „Überspringen“
    $('wizNext').textContent=t(done?'wiz.to_plan':(st===WIZ_STEPS-1?'wiz.apply':'wiz.next'));
    // Maskottchen-Begrüßung (nur im Anime-Design sichtbar, .an-only)
    $('wizMascotTxt').textContent=t(done?'anime.wiz.done':['anime.wiz.s1','anime.wiz.s2','anime.wiz.s3','anime.wiz.s4'][st]);
    $('wizMascot').setAttribute('data-face',done?'excited':(st===0?'wink':'happy'));
    if(st===0){
      $('wizTitle').textContent=t('wiz.s1_title');
      $('wizSub').textContent=t('wiz.s1_sub');
      var curY=new Date().getFullYear(), yrs='';
      for(var y=Math.min(curY-1,W.kwYear);y<=Math.max(curY+2,W.kwYear);y++) yrs+='<option value="'+y+'">'+y+'</option>';
      h='<div class="wiz-row"><div class="f1"><label for="wizKwNum">'+esc(t('wiz.kw_label'))+'</label><select id="wizKwNum"></select></div>'
        +'<div style="width:6.5rem;"><label for="wizKwYear">'+esc(t('wiz.year'))+'</label><select id="wizKwYear">'+yrs+'</select></div></div>'
        +'<div class="wiz-info" id="wizKwInfo"></div>'
        +'<div class="small muted">'+esc(t('wiz.current_week',{kw:t('start.kw',{n:getISOWeek(new Date())}),year:isoWeekYear(new Date())}))+'</div>';
      b.innerHTML=h; $('wizKwYear').value=W.kwYear; wizFillKw();
    } else if(st===1){
      $('wizTitle').textContent=t('wiz.s2_title');
      $('wizSub').textContent=t('wiz.s2_sub');
      h='<div class="wiz-sec">'+esc(t('wiz.quickstart'))+'</div><div class="wiz-tpls">'
        +WIZ_TPLS.map(function(x){
          return '<button type="button" class="wiz-tpl'+(W.tpl===x.id?' active':'')+'" data-tpl="'+x.id+'"><b>'
            +esc(t('wiz.tpl.'+x.id+'.name'))+'</b><span>'+esc(t('wiz.tpl.'+x.id+'.desc'))+'</span></button>';
        }).join('')+'</div>'
        +'<div class="wiz-sec">'+esc(t('wiz.customize'))+'</div>'
        +'<div class="wiz-weeks"><label style="margin:0;">'+esc(t('pattern.weeks'))+'</label>'
        +'<button type="button" class="icon" data-wweeks="-1" aria-label="'+esc(t('pattern.fewer_weeks'))+'">&#x2212;</button>'
        +'<span id="wizWeeksVal"></span>'
        +'<button type="button" class="icon" data-wweeks="1" aria-label="'+esc(t('pattern.more_weeks'))+'">+</button></div>'
        +'<div id="wizPat"></div>'
        +'<div class="small muted" style="margin-top:4px;">'
        +esc(t('wiz.cycle_hint',{cycle:[t('wiz.cycle_empty'),shiftLabel(1),shiftLabel(2),shiftLabel(3),shiftLabel(4)].join(' → ')}))+'</div>';
      b.innerHTML=h; renderWizPat();
    } else if(st===2){
      $('wizTitle').textContent=t('wiz.s3_title');
      $('wizSub').textContent=t('wiz.s3_sub');
      var types=wizTypes(), autoTxt=esc(t('wiz.auto'));
      h=types.length?types.map(function(tp){
        return '<div class="wiz-shift"><div class="wiz-sname"><span class="ld" data-shift="'+tp+'" style="background:'+WIZ_COLORS[tp]+'"></span>'+esc(shiftLabel(tp))+'</div>'
          +'<div class="wiz-time" data-wtbox="'+tp+'"></div>'
          +'<div class="wiz-chk"><label class="sw" title="'+autoTxt+'"><input type="checkbox" id="wizAuto'+tp+'" data-wa="'+tp+'"'+(W.auto[tp]?' checked':'')
          +' aria-label="'+esc(t('wiz.auto_aria',{name:shiftLabel(tp)}))+'"><span class="sl"></span></label><span>'+autoTxt+'</span></div></div>';
      }).join('')+'<div class="small muted">'+esc(t('wiz.auto_hint'))+'</div>'
        :'<div class="wiz-info">'+esc(t('wiz.empty_pattern'))+'</div>';
      b.innerHTML=h;
      // dieselbe Uhrzeit-Auswahl wie im Bereich Wecker (Pfeile + System-Zeitauswahl)
      types.forEach(function(tp){
        var pk=buildTimePicker(W.times[tp],function(v){ W.times[tp]=v; },{label:shiftLabel(tp)});
        var nat=pk.querySelector('input.tnative'); nat.id='wizTime'+tp; nat.setAttribute('data-wt',tp);
        b.querySelector('[data-wtbox="'+tp+'"]').appendChild(pk);
      });
    } else if(st===3){
      $('wizTitle').textContent=t('wiz.s4_title');
      $('wizSub').textContent=t('wiz.s4_sub');
      b.innerHTML='<label for="wizBl">'+esc(t('wiz.state_label'))+'</label><select id="wizBl">'+$('bundesland').innerHTML+'</select>'
        +'<div class="small muted" style="margin-top:8px;">'+esc(t('wiz.apply_hint'))+'</div>';
      $('wizBl').value=W.bl;
    } else {
      $('wizTitle').textContent=t('wiz.done_title');
      $('wizSub').textContent=t('wiz.done_sub');
      b.innerHTML=wizSummary();
    }
    $('wizBg').scrollTop=0;
  }
  $('wizNext').onclick=wizNext;
  $('wizPrev').onclick=wizBack;
  $('wizSkip').onclick=closeWiz;
  $('wizBody').addEventListener('click',function(e){
    var tb=e.target.closest('[data-tpl]');
    if(tb){ wizApplyTpl(tb.dataset.tpl); renderWiz(); return; }
    var wk=e.target.closest('[data-wweeks]');
    if(wk){ wizResize(W.weeks+Number(wk.dataset.wweeks)); W.tpl=null; renderWizPat(); return; }
    var p=e.target.closest('.pday[data-wi]');
    if(p){ var i=Number(p.dataset.wi); W.pattern[i]=(W.pattern[i]+1)%5; W.tpl=null; renderWizPat();
      var a=document.querySelector('.wiz-tpl.active'); if(a) a.classList.remove('active'); }
  });
  $('wizBody').addEventListener('change',function(e){
    var el=e.target, id=el.id||'';
    if(id==='wizKwYear'){ W.kwYear=Number(el.value); wizFillKw(); }
    else if(id==='wizKwNum'){ W.kwNum=Number(el.value); $('wizKwInfo').textContent=wizRange(wizMonday())+' '+W.kwYear; }
    else if(id==='wizBl'){ W.bl=el.value; }
    else if(el.dataset.wt){ if(/^\d{2}:\d{2}$/.test(el.value)) W.times[el.dataset.wt]=el.value; }
    else if(el.dataset.wa){ W.auto[el.dataset.wa]=el.checked; }
  });

  /* ── EVENTS ─────────────────────────────── */
  $('themeBtn').onclick=cycleTheme;
  $('startWizBtn').onclick=function(){openWiz();};
  $('privacyLink').onclick=function(e){e.preventDefault();if(window.Android&&Android.openPrivacyPolicy)Android.openPrivacyPolicy();};
  $('tsDigits').onclick=function(){
    var n=$('tsNative'); n.value=TS.value;
    try{ if(typeof n.showPicker==='function'){ n.showPicker(); return; } }catch(e){}
    try{ n.focus(); n.click(); }catch(e){}
  };
  $('tsNative').addEventListener('change',function(){ var v=parseHhmm($('tsNative').value); if(v){ TS.value=v; tsShow(); } });
  $('tsQuick').addEventListener('click',function(e){ var b=e.target.closest('[data-d]'); if(b) tsShift(Number(b.dataset.d)); });
  $('tsApply').onclick=function(){ closeTimeSheet(true); };
  $('tsCancel').onclick=function(){ closeTimeSheet(false); };
  $('timeSheet').addEventListener('click',function(e){ if(e.target===this||e.target.classList.contains('tsheet-space')) closeTimeSheet(false); });
  $('bottomNav').addEventListener('click',function(e){
    var b=e.target.closest('.navbtn'); if(b) showTab(b.dataset.tab);
  });
  function applyStartDate(nd){
    S.startDate=nd;
    var d=parseYmd(S.startDate);
    if(!isNaN(d)) viewDate=new Date(d.getFullYear(),d.getMonth(),1,12,0,0);
    renderStartPicker(); renderCal(); save(); scheduleResync();
  }
  ['sdDay','sdMon','sdYear'].forEach(function(id){
    $(id).addEventListener('change',function(){
      var nd=getDateFromSelects();
      if(!nd){toast(t('start.invalid_date'),true);return;}
      applyStartDate(nd);
    });
  });
  $('kwYear').addEventListener('change',function(){
    var y=Number($('kwYear').value); fillKwWeeks(y,Number($('kwNum').value));
    applyStartDate(toYmd(mondayOfIsoWeek(y,Number($('kwNum').value))));
  });
  $('kwNum').addEventListener('change',function(){
    applyStartDate(toYmd(mondayOfIsoWeek(Number($('kwYear').value),Number($('kwNum').value))));
  });
  $('startModeBtn').onclick=function(){
    S.startMode=S.startMode==='date'?'kw':'date';
    // Wechsel auf KW: Woche 1 beginnt ohnehin am Montag → Startdatum auf den Montag setzen
    if(S.startMode==='kw'&&S.startDate) S.startDate=toYmd(mondayOf(parseYmd(S.startDate)));
    renderStartPicker(); save();
  };
  $('bundesland').addEventListener('change',function(e){S.bundesland=e.target.value;renderCal();save();scheduleResync();});
  $('decWeeks').onclick=function(){
    if(S.weeksCount<=1)return; S.weeksCount--;
    $('weeksVal').textContent=S.weeksCount; initPat();renderPat();renderCal();save();scheduleResync();
  };
  $('incWeeks').onclick=function(){
    if(S.weeksCount>=6)return; S.weeksCount++;
    $('weeksVal').textContent=S.weeksCount; initPat();renderPat();renderCal();save();scheduleResync();
  };
  $('resetAll').onclick=function(){
    customConfirm(t('app.reset_confirm'),function(){
      // Cancel all Android alarms first
      if(S.activeAlarms) S.activeAlarms.forEach(function(a){ bridgeCancel(a.alarmKey); });
      if(hasBridge('cancelAllAlarms')){ try{ window.Android.cancelAllAlarms(); }catch(e){} }
      if(hasBridge('setAlarmOptions')){ try{ window.Android.setAlarmOptions(JSON.stringify({snoozeMinutes:5,risingVolume:false,vibrateOnly:false})); }catch(e){} }
      S=createDefaultState();
      S.startDate=todayYmd();
      initPat();
      save();
      refreshAllUi();
      showTab('plan');
      toast(t('app.reset_done'));
    });
  };
  // Schalter „automatisch wecken“: ae1..ae4 bzw. freeAlarmEnabled
  $('alarmBox').addEventListener('change',function(e){
    var mt=(e.target.id||'').match(/^ae([1-4])$/);
    if(mt) onAutoSwitch(Number(mt[1]),e.target.checked);
  });
  $('freeAlarmBox').addEventListener('change',function(e){
    if(e.target.id==='freeAlarmEnabled') onAutoSwitch('free',e.target.checked);
  });
  $('freeAlarmBox').addEventListener('click',function(e){
    var b=e.target.closest('[data-di]'); if(b) toggleFreeDay(Number(b.dataset.di));
  });
  $('exportProfileBtn').onclick=exportProfileFile;
  $('exportIcsBtn').onclick=exportIcsFile;
  ['snoozeSel','risingVol','vibOnly'].forEach(function(id){ $(id).addEventListener('change',writeAlarmOptions); });
  $('preSel').addEventListener('change',function(e){
    S.preAlarmMin=Number(e.target.value)||0; save(); scheduleResync();
  });
  $('importProfileBtn').onclick=importProfileFile;
  /* App geht in den Hintergrund: ausstehenden Abgleich sofort ausführen */
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden) renderPermWarn();   // zurück aus den Systemeinstellungen
    if(document.hidden&&_resyncTid){ clearTimeout(_resyncTid); _resyncTid=null; resyncAlarms(); }
  });
  $('skipHolShift').addEventListener('change',function(e){
    S.skipHolidaysShift=e.target.checked; save(); scheduleResync();
  });
  $('patLegend').addEventListener('click',function(e){
    var b=e.target.closest('.pick'); if(!b) return;
    var t=Number(b.dataset.pick);
    patBrush=patBrush===t?null:t;
    renderPatHint();
  });
  $('patGrid').addEventListener('click',function(e){
    var b=e.target.closest('.pday'); if(b) cycleShift(Number(b.dataset.idx));
  });
  $('clearPat').onclick=function(){S.pattern=new Array(S.weeksCount*7).fill(0);renderPat();renderCal();save();scheduleResync();};
  $('addEx').onclick=function(){
    var s=$('exS').value, e=$('exE').value||s, et=$('exT').value;   // et = interner Typ (deutsch)
    if(!s){toast(t('exceptions.no_start'),true);return;}
    if(e<s){toast(t('exceptions.end_before'),true);return;}
    S.exceptions.push({id:uid(),start:s,end:e,type:et});
    renderEx();renderCal();save();scheduleResync();
    $('exS').value='';$('exE').value='';toast(t('exceptions.added',{type:exLabel(et)}));
  };
  $('exList').addEventListener('click',function(e){var b=e.target.closest('.xdel');if(b)delEx(b.dataset.id);});
  $('prevM').onclick=function(){viewDate.setMonth(viewDate.getMonth()-1);renderCal();};
  $('nextM').onclick=function(){viewDate.setMonth(viewDate.getMonth()+1);renderCal();};
  $('todayM').onclick=function(){viewDate=new Date();viewDate.setDate(1);viewDate.setHours(12,0,0,0);renderCal();};
  $('aList').addEventListener('click',function(e){
    var r=e.target.closest('.arow'); if(r) openSheet(r.dataset.date,getShift(r.dataset.date));
  });
  $('allAlarmsBtn').onclick=openAllAlarms;
  $('allAlarmsBtn2').onclick=openAllAlarms;
  $('closeAlarms').onclick=closeAllAlarms;
  $('allAlarmList').addEventListener('click',function(e){
    var b=e.target.closest('.adel'); if(b) cancelAlarm(b.dataset.date,b.dataset.key);
  });
  // Auf-/Zugeklappte Monate merken (toggle-Ereignis steigt nicht auf → capture)
  $('allAlarmList').addEventListener('toggle',function(e){
    var m=e.target&&e.target.dataset&&e.target.dataset.m; if(!m||!openMonths) return;
    var i=openMonths.indexOf(m);
    if(e.target.open&&i===-1) openMonths.push(m); else if(!e.target.open&&i!==-1) openMonths.splice(i,1);
  },true);
  $('overlay').onclick=function(e){if(e.target===this)closeSheet();};
  $('testAlarmBtn').onclick=function(){
    if(window.Android&&typeof window.Android.testAlarm==='function'){
      window.Android.testAlarm();
    } else {
      toast(t('common.no_bridge'),true);
    }
  };

  /* ── KLINGELTON ──────────────────────────── */
  function updateRingtoneUI(){
    var nameEl=$('ringtoneName');
    var resetBtn=$('resetRingtoneBtn');
    if(window.Android&&typeof window.Android.usesCustomRingtone==='function'&&window.Android.usesCustomRingtone()){
      var name=window.Android.getCustomRingtoneName&&window.Android.getCustomRingtoneName()||t('ringtone.custom');
      nameEl.innerHTML='&#x1F3B5; <b>'+esc(name)+'</b>';
      resetBtn.style.display='';
    } else {
      nameEl.textContent=t('ringtone.default');
      resetBtn.style.display='none';
    }
  }
  window.onRingtoneChanged=function(name){
    updateRingtoneUI();
  };
  $('pickRingtoneBtn').onclick=function(){
    if(window.Android&&typeof window.Android.pickRingtone==='function'){
      window.Android.pickRingtone();
    } else {
      toast(t('common.no_bridge'),true);
    }
  };
  $('resetRingtoneBtn').onclick=function(){
    if(window.Android&&typeof window.Android.resetRingtone==='function'){
      window.Android.resetRingtone();
      updateRingtoneUI();
    }
  };

  function showAppVersion(){
    var el=$('appVersion'); if(!el) return;
    var v=''; try{ if(hasBridge('getAppVersion')) v=window.Android.getAppVersion(); }catch(e){}
    el.textContent='Schichtwecker'+(v?' '+v:'');
  }

  /* ── DESIGN (verstecktes Extra) ───────────
     Versionsnummer antippen: klassisch ↔ Anime-Design. Kennzeichen data-design="anime" auf <html>
     (Gestaltung in anime.css; fehlt die Datei, bleibt alles klassisch). Zustand in S.design. */
  function applyDesign(){
    if(S.design==='anime') document.documentElement.setAttribute('data-design','anime');
    else document.documentElement.removeAttribute('data-design');
    // Kopf-Maskottchen: nachts schläfrig
    var h=new Date().getHours();
    $('hdrMascot').setAttribute('data-face',h>=22||h<5?'sleepy':'happy');
    if(hasBridge('setDesign')){ try{ window.Android.setDesign(S.design); }catch(e){} }   // Wecker-Bildschirm (nativ)
  }
  $('appVersion').onclick=function(){
    S.design=S.design==='anime'?'classic':'anime';
    applyDesign(); save();
    renderNextAlarm(); if(isAlarmsOpen()) renderAllAlarms();
    toast(t(S.design==='anime'?'design.anime_on':'design.classic_on'));
    if(isAnime()){ mascotHop($('hdrMascot')); mascotHop(document.querySelector('#nextAlarm .an-masc')); }
  };

  /* ── ANIME-MASKOTTCHEN ────────────────────
     Eigene Figur („Weckerchen“, anime/mascot-<gesicht>.svg), nur im Anime-Design. Dynamische
     Teile werden nur dann erzeugt; feste Elemente in index.html tragen .an-only (app.css blendet
     sie aus, anime.css ein). Strom: keine Dauer-Animation, nur ein kurzer Hüpfer beim Antippen
     bzw. Einschalten des Designs (bei prefers-reduced-motion gar keiner). */
  function isAnime(){ return S.design==='anime'; }
  var MASCOT_FACES=['happy','sleepy','excited','wink','oops'];
  function mascotHtml(face){
    return '<span class="an-masc" data-face="'+(MASCOT_FACES.indexOf(face)!==-1?face:'happy')+'" aria-hidden="true"></span>';
  }
  function animeGreeting(){
    var h=new Date().getHours();
    return t(h>=5&&h<11?'anime.greet.morning':(h>=11&&h<18?'anime.greet.day':(h>=18&&h<22?'anime.greet.evening':'anime.greet.night')));
  }
  function mascotHop(el){
    if(!el) return;
    el.classList.remove('an-hop'); void el.offsetWidth; el.classList.add('an-hop');
  }
  document.addEventListener('animationend',function(e){
    if(e.target&&e.target.classList&&e.target.classList.contains('an-hop')) e.target.classList.remove('an-hop');
  });
  /* Antippen: einmal hüpfen und kurz zwinkern */
  document.addEventListener('click',function(e){
    var m=e.target&&e.target.closest&&e.target.closest('.an-masc');
    if(!m||!isAnime()) return;
    mascotHop(m);
    if(m._face) return;   // zwinkert schon
    m._face=m.getAttribute('data-face'); m.setAttribute('data-face','wink');
    setTimeout(function(){ m.setAttribute('data-face',m._face); m._face=null; },1400);
  });

  /* ── SPRACHE: Auswahl, Wechsel, eigene Übersetzung ── */
  function renderOptionLabels(){
    [].forEach.call($('snoozeSel').options,function(o){ o.textContent=t('behavior.minutes',{n:Number(o.value)}); });
    [].forEach.call($('preSel').options,function(o){
      var n=Number(o.value); o.textContent=n?t('behavior.pre_before',{n:n}):t('behavior.pre_off');
    });
  }
  function renderLangSelect(){
    var sel=$('langSel'); if(!sel) return;
    sel.innerHTML='';
    var o=document.createElement('option'); o.value='auto'; o.textContent=t('app.lang_auto'); sel.appendChild(o);
    var found=false;
    listLangs().forEach(function(l){
      var name=l.name;
      if(!name){ var d=readLangFile(l.code); name=d&&d._meta&&d._meta.name; }
      name=String(name||l.code);
      var op=document.createElement('option'); op.value=l.code;
      // Sprachnamen in ihrer eigenen Sprache; eigene Übersetzung erkennbar markieren
      op.textContent=l.code==='custom'?t('app.lang_custom_name',{name:name}):name;
      sel.appendChild(op);
      if(l.code===I18N.setting) found=true;
    });
    sel.value=found?I18N.setting:'auto';
  }
  /* Nach Sprachwechsel: Texte der gesetzten Wecker in der neuen Sprache nativ neu schreiben.
     Gleicher Schlüssel + gleiche Zeit → Android ersetzt nur den Eintrag (Anzahl/Zeiten bleiben). */
  function rewriteAlarmTexts(){
    if(!hasBridge('setAlarmForDateSilent')) return 0;
    var n=0;
    (S.activeAlarms||[]).forEach(function(a){
      if(!a||typeof a.alarmKey!=='string'||!isFuture(a.ds,a.time)) return;
      if(bridgeSet(a.ds,{key:a.alarmKey,time:a.time,msg:alarmMsg(a.alarmKey,a.ds)})) n++;
    });
    if(n&&hasBridge('syncAlarmWindow')){ try{ window.Android.syncAlarmWindow(); }catch(e){} }
    return n;
  }
  /* komplette Oberfläche in der aktuellen Sprache neu aufbauen (ohne Neustart) */
  function rerenderAll(){
    applyI18n(); renderHdrIcon(); renderOptionLabels(); renderLangSelect();
    initDateSelects(); refreshAllUi(); renderPatHint(); showAppVersion(); renderPermWarn();
    if(sheetDs&&$('overlay').classList.contains('open')) openSheet(sheetDs,getShift(sheetDs));
    if(isWizOpen()) renderWiz();
  }
  function setLanguage(code){
    code=code||'auto';
    if(hasBridge('setLanguageSetting')){ try{ window.Android.setLanguageSetting(code); }catch(e){} }
    try{ localStorage.setItem(LANG_KEY,code); }catch(e){}
    loadLanguage(code);
    rerenderAll();
    rewriteAlarmTexts();
    save();   // Widget bekommt die Schichtnamen in der neuen Sprache
  }
  $('langSel').addEventListener('change',function(e){ setLanguage(e.target.value); });
  /* Übersetzungsvorlage: aktuelle Sprachdatei, fehlende Schlüssel aus en ergänzt */
  function exportLangTemplate(){
    if(!hasBridge('exportFile')){ toast(t('common.no_bridge'),true); return; }
    var base=readLangFile('en')||{}, cur=readLangFile(I18N.code)||{}, out={}, k;
    out._meta=Object.assign({},base._meta||{},cur._meta||{});
    for(k in base) if(k!=='_meta'&&Object.prototype.hasOwnProperty.call(base,k)) out[k]=base[k];
    for(k in cur) if(k!=='_meta'&&Object.prototype.hasOwnProperty.call(cur,k)) out[k]=cur[k];
    var code=String(out._meta.code||I18N.code||'en').replace(/[^A-Za-z0-9-]/g,'')||'custom';
    window.Android.exportFile(JSON.stringify(out,null,2),'schichtwecker-sprache-'+code+'.json','application/json');
  }
  $('exportLangBtn').onclick=exportLangTemplate;
  $('importLangBtn').onclick=function(){
    if(!hasBridge('importLanguageFile')){ toast(t('common.no_bridge'),true); return; }
    window.Android.importLanguageFile();
  };
  /* Rückruf aus MainActivity nach der Dateiauswahl: ok = Datei gültig, Sprache „custom“ verfügbar */
  window.onLanguageImported=function(ok,name){
    if(!(ok===true||ok==='true')){ toast(t('lang.import_failed'),true); return; }
    delete I18N.files.custom;
    setLanguage('custom');
    if(I18N.code!=='custom'){ toast(t('lang.import_failed'),true); return; }
    toast(t('lang.imported',{name:String(name||t('lang.custom_default'))}));
  };

  /* ── INIT ───────────────────────────────── */
  applyI18n(); renderHdrIcon(); renderOptionLabels(); renderLangSelect();
  S.startDate=todayYmd();
  load(); if(!S.startDate) S.startDate=todayYmd();
  if(S.theme) applyTheme(S.theme); applyDesign(); initPat(); purgeExpiredAlarms();
  initDateSelects();
  renderStartPicker();
  $('weeksVal').textContent=S.weeksCount;
  $('bundesland').value=S.bundesland;
  $('skipHolShift').checked=S.skipHolidaysShift;
  syncWithNative(); resyncAlarms({quiet:true}); showAppVersion(); updateAlarmOptionsUi(); renderPermWarn();
  renderAlarmSettings(); renderFreeAlarmSettings(); renderPat(); renderPatHint(); renderEx(); renderCal(); updateRingtoneUI();
  /* Wizard beim allerersten Start anzeigen */
  var wizSeen=S.wizardDone; try{ wizSeen=wizSeen||!!localStorage.getItem(WIZ_KEY); }catch(e){}
  if(!wizSeen) openWiz();
  else if(!S.wizardDone){ S.wizardDone=true; save(); }   // Altbestand: Merker auch nativ sichern
})();
