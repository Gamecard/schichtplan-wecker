window.onerror=function(msg,src,line,col,err){
  var t=document.getElementById('toast');
  if(t){t.textContent='JS-FEHLER: '+msg+' (Zeile '+line+')';t.className='show err';}
  return false;
};
(function(){
  /* ── Header-Kalender-Icon: aktuellen Tag/Monat setzen ── */
  var _now = new Date();
  var _monNames = ['JAN','FEB','MÄR','APR','MAI','JUN','JUL','AUG','SEP','OKT','NOV','DEZ'];
  var _dayEl = document.getElementById('hdrCalDay');
  var _monEl = document.getElementById('hdrCalMon');
  if (_dayEl) _dayEl.textContent = _now.getDate();
  if (_monEl) _monEl.textContent = _monNames[_now.getMonth()];

  /* ── KONSTANTEN ─────────────────────────── */
  var DAYS   = ['Mo','Di','Mi','Do','Fr','Sa','So'];
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
      /* „Alle stellen“ aktiv → neue passende Tage bekommen automatisch einen Wecker */
      autoSchedule:{1:false,2:false,3:false,4:false,free:false},
      skipHolidaysShift:false,
      /* Schichttausch: abweichende Schicht für einzelne Tage {"YYYY-MM-DD": 0..4} */
      overrides:{},
      /* Vorwecker: Minuten vor jedem Auto-Schicht-Wecker (0 = aus) */
      preAlarmMin:0,
      /* Startwoche als Kalenderwoche ('kw', Standard) oder als Datum ('date') wählen */
      startMode:'kw',
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
    for(var w=1;w<=n;w++){var o=document.createElement('option');o.value=w;o.textContent='KW '+w;kn.appendChild(o);}
    kn.value=Math.min(sel||1,n);
  }
  /* Startwoche/Startdatum aus S.startDate in die Auswahl übernehmen, Hinweis aktualisieren */
  function renderStartPicker(){
    var kwMode=S.startMode!=='date';
    $('kwPick').style.display=kwMode?'flex':'none';
    $('datePick').style.display=kwMode?'none':'flex';
    $('startModeBtn').textContent=kwMode?'Stattdessen Datum w\u00E4hlen':'Stattdessen Kalenderwoche w\u00E4hlen';
    var d=parseYmd(S.startDate);
    if(isNaN(d)){ $('startInfo').textContent=''; return; }
    var mo=mondayOf(d), su=new Date(mo.getTime()); su.setDate(su.getDate()+6);
    var kw=getISOWeek(mo), ky=isoWeekYear(mo);
    $('kwYear').value=ky; fillKwWeeks(ky,kw);
    setDateSelects(S.startDate);
    if(kwMode){
      $('startLabel').innerHTML='Startwoche (Woche&nbsp;1)';
      $('startInfo').textContent='Mo '+fmtDe(toYmd(mo))+' \u2013 So '+fmtDe(toYmd(su));
    } else {
      $('startLabel').innerHTML='Startdatum (Woche&nbsp;1 = <b>KW '+kw+'</b>'+(ky!==d.getFullYear()?' '+ky:'')+')';
      $('startInfo').textContent='Woche 1 l\u00E4uft von Mo '+fmtDe(toYmd(mo))+' bis So '+fmtDe(toYmd(su));
    }
  }
  function initDateSelects(){
    var sy=$('sdYear'),sm=$('sdMon'),sd=$('sdDay'); if(!sy||!sm||!sd)return;
    sy.innerHTML=''; sm.innerHTML=''; sd.innerHTML='';
    var curY=new Date().getFullYear();
    for(var y=curY-5;y<=curY+10;y++){var o=document.createElement('option');o.value=y;o.textContent=y;sy.appendChild(o);}
    ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'].forEach(function(mn,i){var o=document.createElement('option');o.value=i+1;o.textContent=mn;sm.appendChild(o);});
    for(var d=1;d<=31;d++){var o=document.createElement('option');o.value=d;o.textContent=d+'.';sd.appendChild(o);}
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
  function fmtDe(s){ if(!s)return''; var p=s.split('-'); return p[2]+'.'+p[1]+'.'+p[0]; }
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
      .sort(function(a,b){return a.ds.localeCompare(b.ds)||a.alarmKey.localeCompare(b.alarmKey);});
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
  var TICOS={system:'\uD83D\uDDA5\uFE0F',light:'\u2600\uFE0F',dark:'\uD83C\uDF19'};
  function applyTheme(t){
    var th=THEMES.includes(t)?t:'system';
    document.documentElement.setAttribute('data-theme',th);
    $('themeBtn').textContent=TICOS[th];
    try{localStorage.setItem(THK,th);}catch(e){}
  }
  function cycleTheme(){
    var cur=document.documentElement.getAttribute('data-theme')||'system';
    applyTheme(THEMES[(THEMES.indexOf(cur)+1)%3]);
  }
  (function(){var t='system';try{t=localStorage.getItem(THK)||t;}catch(e){}applyTheme(t);})();

  /* ── FEIERTAGE ──────────────────────────── */
  function holidays(year,bl){
    var h={};
    function a(m,d,n){h[year+'-'+pad(m)+'-'+pad(d)]=n;}
    a(1,1,'Neujahr');a(5,1,'Tag d.Arbeit');a(10,3,'Tag d.Einheit');
    a(12,25,'1.Weihnacht');a(12,26,'2.Weihnacht');
    var ay=year%19,b=year%4,c=year%7,k=Math.floor(year/100);
    var M=(15-Math.floor((13+8*k)/25)+k-Math.floor(k/4))%30;
    var N=(4+k-Math.floor(k/4))%7;
    var dd=(19*ay+M)%30,e=(2*b+4*c+6*dd+N)%7,ot=22+dd+e,om=3;
    if(ot>31){ot-=31;om=4;}
    if(dd===29&&e===6){ot=19;om=4;}
    if(dd===28&&e===6&&ay>10){ot=18;om=4;}
    var os=new Date(year,om-1,ot,12,0,0);
    function rel(off,n){var x=new Date(os.getTime()+off*864e5);a(x.getMonth()+1,x.getDate(),n);}
    rel(-2,'Karfreitag');rel(1,'Ostermontag');rel(39,'Himmelfahrt');rel(50,'Pfingstmontag');
    if(['BW','BY','ST'].includes(bl)) a(1,6,'Hl.Drei K\u00F6nige');
    if(['BE','MV'].includes(bl)) a(3,8,'Frauentag');
    if(['BW','BY','HE','NW','RP','SL'].includes(bl)) rel(60,'Fronleichnam');
    if(['BW','BY','NW','RP','SL'].includes(bl)) a(11,1,'Allerheiligen');
    if(bl==='TH') a(9,20,'Weltkindertag');
    if(bl==='SL') a(8,15,'Mari\u00E4 Himmelf.');
    if(['BB','HB','HH','MV','NI','SN','SH','ST','TH'].includes(bl)) a(10,31,'Reformationstag');
    if(bl==='SN'){
      /* Buß- und Bettag: Mittwoch vor Totensonntag (letzter So vor 1. Advent) → 16.–22.11.
         Startpunkt 22.11. = spätestes mögliches Datum, rückwärts zum Mittwoch. */
      var x=new Date(year,10,22,12,0,0);
      while(x.getDay()!==3) x.setDate(x.getDate()-1);
      a(x.getMonth()+1,x.getDate(),'Bu\u00DF-u.Bettag');
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
    if(ex) return {type:-1,name:ex.type,cls:'excep'};
    if(S.overrides&&Object.prototype.hasOwnProperty.call(S.overrides,ds)){
      var o=S.overrides[ds];
      return {type:o,name:SNAMES[o]||'',cls:SCLS[o]||'',swapped:true};
    }
    if(!S.startDate) return {type:0,name:'',cls:''};
    var sm=mondayOf(parseYmd(S.startDate));
    var tgt=parseYmd(ds);
    var diffDays=Math.round((tgt.getTime()-sm.getTime())/864e5);
    if(diffDays<0) return {type:0,name:'',cls:''};
    var idx=diffDays%(S.weeksCount*7);
    var t=S.pattern[idx]!=null?S.pattern[idx]:0;
    return {type:t,name:SNAMES[t]||'',cls:SCLS[t]||''};
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
  /* Wecker, die an diesem Tag laut Plan fällig wären (unabhängig von „Alle stellen“) */
  function expectedAlarmsFor(ds){
    var out=[], sh=getShift(ds), hol=holidayName(ds);
    if(sh.type>=1&&sh.type<=4&&S.alarmEnabled[sh.type]&&S.alarmTimes[sh.type]&&!(hol&&S.skipHolidaysShift)){
      var main={key:'shift-'+ds+'-t'+sh.type,kind:sh.type,time:S.alarmTimes[sh.type],name:sh.name,msg:sh.name+' ('+fmtDe(ds)+')'};
      out.push(main);
      if(S.preAlarmMin>0){
        // Vorwecker: kann über Mitternacht auf den Vortag fallen → eigenes Datum
        var p=ds.split('-').map(Number), t=main.time.split(':').map(Number);
        var pre=new Date(p[0],p[1]-1,p[2],t[0],t[1]-S.preAlarmMin,0,0);
        out.push({key:'pre-'+main.key,kind:sh.type,ds:toYmd(pre),time:pad(pre.getHours())+':'+pad(pre.getMinutes()),
          name:'Vorwecker '+sh.name,msg:'Vorwecker: '+sh.name+' um '+main.time+' ('+fmtDe(ds)+')'});
      }
    }
    var dow=(parseYmd(ds).getDay()+6)%7;
    if(sh.type===0&&!hol&&S.freeAlarm.enabled&&S.freeAlarm.time&&S.freeAlarm.days.indexOf(dow)!==-1){
      out.push({key:'free-day-'+ds,kind:'free',time:S.freeAlarm.time,name:'Freier Tag',msg:'Freier Tag ('+fmtDe(ds)+')'});
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
    // 2) fehlende ergänzen, wenn für diese Art „Alle stellen“ aktiv ist
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
      if(r.added) parts.push(r.added+' neu');
      if(r.updated) parts.push(r.updated+' geändert');
      if(r.removed) parts.push(r.removed+' entfernt');
      if(r.errors) parts.push(r.errors+' fehlgeschlagen');
      toast('⏰ Wecker angepasst: '+parts.join(', '),r.errors>0);
    }
    return r;
  }
  var _resyncTid=null;
  /* Nach Planänderungen gebündelt abgleichen (z. B. mehrere Taps im Schichtmuster) */
  function scheduleResync(){
    clearTimeout(_resyncTid);
    _resyncTid=setTimeout(function(){ _resyncTid=null; resyncAlarms(); },800);
  }
  /* Beim Start: Wecker älterer Versionen in den nativen Speicher übernehmen und die
     Liste mit den tatsächlich geplanten Android-Weckern abgleichen. */
  function syncWithNative(){
    if(!hasBridge('getScheduledKeys')) return;
    if(!window.Android.isStoreMigrated()){
      S.activeAlarms.forEach(function(a){
        if(!isFuture(a.ds,a.time)) return;
        bridgeSet(a.ds,{key:a.alarmKey,time:a.time,msg:(a.shiftName||'Wecker')+' ('+fmtDe(a.ds)+')'});
        if(a.auto===undefined){
          var m=a.alarmKey.match(/^shift-\d{4}-\d{2}-\d{2}-t(\d)$/);
          a.auto=!!((m&&a.time===S.alarmTimes[m[1]])||(/^free-day-/.test(a.alarmKey)&&a.time===S.freeAlarm.time));
        }
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
        var auto=!!((m&&time===S.alarmTimes[m[1]])||(/^free-day-/.test(n.key)&&time===S.freeAlarm.time));
        if(/^pre-/.test(n.key)){ auto=true; name='Vorwecker '+name; }
        S.activeAlarms.push({ds:ds,alarmKey:n.key,time:time,shiftName:name,auto:auto});
      });
    }
    save();
  }

  function scheduleAllShiftAlarms(shiftType){
    if(!S.startDate){
      toast('Bitte zuerst die Startwoche festlegen.',true);
      return;
    }
    if(!S.alarmEnabled[shiftType]){
      toast(SNAMES[shiftType]+'-Wecker ist deaktiviert.',true);
      return;
    }
    if(!S.alarmTimes[shiftType]){
      toast('Keine Weckerzeit für '+SNAMES[shiftType]+' gesetzt.',true);
      return;
    }
    if(!hasBridge('setAlarmForDateSilent')){
      toast('Android-Bridge nicht verfügbar.',true);
      return;
    }
    scheduleAllOfKind(shiftType,SNAMES[shiftType]+'-Wecker');
  }
  /* „Alle stellen“: schaltet den Dauer-Modus für diese Wecker-Art ein. Danach ergänzt und
     korrigiert resyncAlarms() die Wecker bei jeder Planänderung und bei jedem App-Start. */
  function scheduleAllOfKind(kind,label){
    var exp=expectedAlarms();
    var all=Object.keys(exp).map(function(k){return exp[k];})
      .filter(function(x){return x.e.kind===kind;})
      .sort(function(a,b){return a.ds.localeCompare(b.ds);});
    if(!all.length){ toast('Keine kommenden Tage für '+label+' gefunden.',true); return; }
    var msg=all.length+' '+label+' setzen?\n\nErster: '+fmtDe(all[0].ds)+'\nLetzter: '+fmtDe(all[all.length-1].ds)
      +'\n\nWenn du den Plan änderst (Muster, Ausnahmen, Urlaub, Weckzeit), werden diese Wecker automatisch angepasst.';
    customConfirm(msg,function(){
      S.autoSchedule[kind]=true;
      // eigene Löschungen dieser Art nicht mehr unterdrücken – der Nutzer will jetzt alle
      S.suppressed=S.suppressed.filter(function(k){return !exp[k]||exp[k].e.kind!==kind;});
      // bereits gesetzte Wecker mit Standardzeit übernehmen den Dauer-Modus
      all.forEach(function(x){
        var a=S.activeAlarms.find(function(a){return a.alarmKey===x.e.key;});
        if(a&&a.time===x.e.time) a.auto=true;
      });
      var r=resyncAlarms({quiet:true});
      var count=S.activeAlarms.filter(function(a){
        return a.auto&&exp[a.alarmKey]&&exp[a.alarmKey].e.kind===kind;}).length;
      save(); renderCal();
      var t='✅ '+count+' '+label+' aktiv';
      if(r.errors) t+=' ('+r.errors+' fehlgeschlagen)';
      toast(t,r.errors>0);
    });
  }

  /* ── ALARM SETTINGS UI ──────────────────── */
  function stepTime(spanId, step, max){
    var el=document.getElementById(spanId);
    if(!el) return;
    var v=(Number(el.textContent)+step+max)%max;
    el.textContent=pad(v);
    // Schichttyp aus ID ermitteln und speichern
    var m=spanId.match(/(\d)$/);
    if(m){
      var t=Number(m[1]);
      var hEl=document.getElementById('tph'+t);
      var mEl=document.getElementById('tpm'+t);
      if(hEl&&mEl){
        S.alarmTimes[t]=pad(Number(hEl.textContent))+':'+pad(Number(mEl.textContent));
        save(); renderCal(); scheduleResync();
      }
    }
  }
  function renderAlarmSettings(){
    var c=document.getElementById('alarmBox'); c.innerHTML='';
    SMETA.forEach(function(sm){
      var r=document.createElement('div');
      r.className='arow '+sm.c;
      var time=S.alarmTimes[sm.t]||'';
      var hh=0, mm=0;
      if(time){ var pts=time.split(':'); hh=Number(pts[0])||0; mm=Number(pts[1])||0; }
      // Label
      var lbl=document.createElement('span');
      lbl.className='slbl'; lbl.textContent=sm.n;
      r.appendChild(lbl);
      // Time picker container
      var pick=document.createElement('div');
      pick.className='tpick';
      // Hour unit
      var hu=document.createElement('div'); hu.className='tunit';
      var hUp=document.createElement('button'); hUp.type='button'; hUp.className='tbtn'; hUp.textContent='\u25B2';
      var hVal=document.createElement('span'); hVal.className='tval'; hVal.id='tph'+sm.t; hVal.textContent=pad(hh);
      var hDn=document.createElement('button'); hDn.type='button'; hDn.className='tbtn'; hDn.textContent='\u25BC';
      (function(id){hUp.onclick=function(){stepTime(id,1,24);};hDn.onclick=function(){stepTime(id,-1,24);}})('tph'+sm.t);
      hu.appendChild(hUp); hu.appendChild(hVal); hu.appendChild(hDn);
      // Colon
      var col=document.createElement('span'); col.className='tcolon'; col.textContent=':';
      // Minute unit
      var mu=document.createElement('div'); mu.className='tunit';
      var mUp=document.createElement('button'); mUp.type='button'; mUp.className='tbtn'; mUp.textContent='\u25B2';
      var mVal=document.createElement('span'); mVal.className='tval'; mVal.id='tpm'+sm.t; mVal.textContent=pad(mm);
      var mDn=document.createElement('button'); mDn.type='button'; mDn.className='tbtn'; mDn.textContent='\u25BC';
      (function(id){mUp.onclick=function(){stepTime(id,1,60);};mDn.onclick=function(){stepTime(id,-1,60);}})('tpm'+sm.t);
      mu.appendChild(mUp); mu.appendChild(mVal); mu.appendChild(mDn);
      // Uhr label
      var uhr=document.createElement('span'); uhr.className='tuhr'; uhr.textContent='Uhr';
      pick.appendChild(hu); pick.appendChild(col); pick.appendChild(mu); pick.appendChild(uhr);
      r.appendChild(pick);
      // Toggle switch
      var sw=document.createElement('label'); sw.className='sw';
      sw.title=sm.n+' Wecker aktivieren';
      var cb=document.createElement('input'); cb.type='checkbox'; cb.id='ae'+sm.t;
      if(S.alarmEnabled[sm.t]) cb.checked=true;
      var sl=document.createElement('span'); sl.className='sl';
      sw.appendChild(cb); sw.appendChild(sl);
      r.appendChild(sw);
      var nextBtn=document.createElement('button');
      nextBtn.type='button';
      nextBtn.className='sm';
      nextBtn.textContent='Alle stellen';
      nextBtn.title='Setzt Wecker für alle kommenden '+sm.n+'-Tage (12 Monate)';
      (function(shiftType){nextBtn.onclick=function(){scheduleAllShiftAlarms(shiftType);};})(sm.t);
      r.appendChild(nextBtn);
      c.appendChild(r);
      if(!time){ S.alarmTimes[sm.t]=pad(hh)+':'+pad(mm); }
    });
  }

  /* ── FREIE TAGE WECKER ─────────────────── */
  function renderFreeAlarmSettings(){
    var c=$('freeAlarmBox'); if(!c)return;
    c.innerHTML='';
    // Toggle + Zeit
    var row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin-bottom:.6rem;';
    var lbl=document.createElement('label'); lbl.className='sw'; lbl.title='Wecker für unbelegte Tage aktivieren';
    var cb=document.createElement('input'); cb.type='checkbox'; cb.id='freeAlarmEnabled';
    if(S.freeAlarm.enabled) cb.checked=true;
    var sl=document.createElement('span'); sl.className='sl';
    lbl.appendChild(cb); lbl.appendChild(sl);
    var txt=document.createElement('span'); txt.style.fontWeight='600'; txt.textContent='Aktivieren';
    row.appendChild(lbl); row.appendChild(txt);
    // Zeit
    var pts=(S.freeAlarm.time||'07:00').split(':').map(Number);
    var hh=pts[0]||0, mm=pts[1]||0;
    var pick=document.createElement('div'); pick.className='tpick';
    var hu=document.createElement('div'); hu.className='tunit';
    var hUp=document.createElement('button'); hUp.type='button'; hUp.className='tbtn'; hUp.textContent='\u25B2';
    var hVal=document.createElement('span'); hVal.className='tval'; hVal.id='fatph'; hVal.textContent=pad(hh);
    var hDn=document.createElement('button'); hDn.type='button'; hDn.className='tbtn'; hDn.textContent='\u25BC';
    hUp.onclick=function(){var e=$('fatph');e.textContent=pad((Number(e.textContent)+1)%24);saveFreeAlarmTime();};
    hDn.onclick=function(){var e=$('fatph');e.textContent=pad((Number(e.textContent)+23)%24);saveFreeAlarmTime();};
    hu.appendChild(hUp);hu.appendChild(hVal);hu.appendChild(hDn);
    var col=document.createElement('span'); col.className='tcolon'; col.textContent=':';
    var mu=document.createElement('div'); mu.className='tunit';
    var mUp=document.createElement('button'); mUp.type='button'; mUp.className='tbtn'; mUp.textContent='\u25B2';
    var mVal=document.createElement('span'); mVal.className='tval'; mVal.id='fatpm'; mVal.textContent=pad(mm);
    var mDn=document.createElement('button'); mDn.type='button'; mDn.className='tbtn'; mDn.textContent='\u25BC';
    mUp.onclick=function(){var e=$('fatpm');e.textContent=pad((Number(e.textContent)+1)%60);saveFreeAlarmTime();};
    mDn.onclick=function(){var e=$('fatpm');e.textContent=pad((Number(e.textContent)+59)%60);saveFreeAlarmTime();};
    mu.appendChild(mUp);mu.appendChild(mVal);mu.appendChild(mDn);
    var uhr=document.createElement('span'); uhr.className='tuhr'; uhr.textContent='Uhr';
    pick.appendChild(hu);pick.appendChild(col);pick.appendChild(mu);pick.appendChild(uhr);
    row.appendChild(pick);
    c.appendChild(row);
    // Wochentag-Chips
    var dayRow=document.createElement('div');
    dayRow.style.cssText='display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.6rem;';
    var dayNames=['Mo','Di','Mi','Do','Fr','Sa','So'];
    dayNames.forEach(function(dn,i){
      var btn=document.createElement('button');
      btn.type='button'; btn.className='sm';
      btn.textContent=dn;
      btn.dataset.di=i;
      var active=S.freeAlarm.days.indexOf(i)!==-1;
      btn.style.cssText=active?'background:var(--primary);color:#fff;border-color:transparent;':''; 
      btn.onclick=function(){
        var idx=S.freeAlarm.days.indexOf(i);
        if(idx===-1) S.freeAlarm.days.push(i);
        else S.freeAlarm.days.splice(idx,1);
        S.freeAlarm.days.sort();
        save(); renderFreeAlarmSettings(); renderCal(); scheduleResync();
      };
      dayRow.appendChild(btn);
    });
    c.appendChild(dayRow);
    // Alle stellen
    var allBtn=document.createElement('button');
    allBtn.type='button'; allBtn.className='sm primary'; allBtn.textContent='\uD83D\uDD14 Alle stellen';
    allBtn.onclick=scheduleAllFreeAlarms;
    c.appendChild(allBtn);
    // Toggle-Event
    cb.onchange=function(){ S.freeAlarm.enabled=cb.checked; save(); renderCal(); toast('Freie-Tage-Wecker '+(cb.checked?'aktiviert':'deaktiviert')+'.'); scheduleResync(); };
  }
  function saveFreeAlarmTime(){
    var h=$('fatph'),m=$('fatpm');
    if(h&&m){ S.freeAlarm.time=pad(Number(h.textContent))+':'+pad(Number(m.textContent)); save(); renderCal(); scheduleResync(); }
  }
  function scheduleAllFreeAlarms(){
    if(!S.startDate){ toast('Bitte zuerst die Startwoche festlegen.',true); return; }
    if(!S.freeAlarm.enabled){ toast('Freie-Tage-Wecker ist deaktiviert.',true); return; }
    if(!S.freeAlarm.time){ toast('Keine Weckzeit gesetzt.',true); return; }
    if(!S.freeAlarm.days.length){ toast('Keine Wochentage ausgew\u00E4hlt.',true); return; }
    if(!hasBridge('setAlarmForDateSilent')){ toast('Android-Bridge nicht verf\u00FCgbar.',true); return; }
    scheduleAllOfKind('free','Wecker f\u00FCr unbelegte Tage');
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
      ?'\u270F\uFE0F '+SNAMES[patBrush]+' gew\u00E4hlt: Tag antippen setzt '+SNAMES[patBrush]+', nochmal antippen leert den Tag. Legende erneut antippen beendet die Auswahl.'
      :'Tipp: Frei/Fr\u00FCh/Sp\u00E4t/Nacht in der Legende antippen und dann Tage mit einem Klick belegen.';
  }
  function renderPat(){
    var c=$('patGrid'); c.innerHTML='';
    // Kopfzeile mit Wochentagen – belegte Tage zeigen die Schicht statt des Wochentags
    var head=document.createElement('div'); head.className='wrow whead';
    var hl=document.createElement('span'); hl.className='wlbl'; head.appendChild(hl);
    var hd=document.createElement('div'); hd.className='pdays';
    DAYS.forEach(function(dn){ var e=document.createElement('div'); e.className='pdh'; e.textContent=dn; hd.appendChild(e); });
    head.appendChild(hd); c.appendChild(head);
    for(var w=0;w<S.weeksCount;w++){
      var row=document.createElement('div'); row.className='wrow';
      var lbl=document.createElement('span'); lbl.className='wlbl'; lbl.textContent='Woche '+(w+1); row.appendChild(lbl);
      var days=document.createElement('div'); days.className='pdays';
      for(var d=0;d<7;d++){
        var idx=w*7+d, t=S.pattern[idx];
        var btn=document.createElement('div');
        btn.className='pday '+(SCLS[t]||'');
        btn.textContent=t===0?DAYS[d]:SNAMES[t];
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
      c.innerHTML='<p class="small muted" style="margin:0;">Keine Ausnahmen.</p>'; return;
    }
    S.exceptions.slice().sort(function(a,b){return a.start.localeCompare(b.start);}).forEach(function(ex){
      var txt=ex.start===ex.end?fmtDe(ex.start):fmtDe(ex.start)+' \u2013 '+fmtDe(ex.end);
      var el=document.createElement('div'); el.className='exitem';
      el.innerHTML='<span>'+esc(txt)+': <b>'+esc(ex.type)+'</b></span>'
        +'<button class="danger sm xdel" data-id="'+esc(ex.id)+'">\u2715</button>';
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
    $('mTitle').textContent=new Date(year,month,1).toLocaleString('de-DE',{month:'long',year:'numeric'});
    var grid=document.createElement('div'); grid.className='cgrid';
    // Header: KW-Ecke + Mo-So
    var kwh=document.createElement('div'); kwh.className='dow'; kwh.textContent='KW'; grid.appendChild(kwh);
    DAYS.forEach(function(d){var el=document.createElement('div');el.className='dow';el.textContent=d;grid.appendChild(el);});
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
        if(isTod){var b=document.createElement('div');b.className='dtbadge';b.textContent='HEUTE';cell.appendChild(b);}
        var num=document.createElement('div');
        num.className='dnum'+(isTod?' tc':''); num.textContent=d+'.'; cell.appendChild(num);
        if(hol){var p=document.createElement('div');p.className='dpill hp';p.textContent=hol;cell.appendChild(p);}
        if(sh.name){
          var p=document.createElement('div');
          p.className='dpill'+(sh.type===-1?' ep':''); p.textContent=sh.name; cell.appendChild(p);
        }
        if(aa.length){
          var ind=document.createElement('div');ind.className='aind';
          ind.textContent='\uD83D\uDD14';ind.title='Wecker: '+aa.map(function(a){return a.time;}).join(', ')+' Uhr';cell.appendChild(ind);
        }
        grid.appendChild(cell);
      }
    }
    var con=$('calGrid'); con.innerHTML=''; con.appendChild(grid);
    aListLimit=5; renderAList();
  }

  /* ── WECKER-LISTE ───────────────────────── */
  var aListLimit=5;
  function renderAList(){
    var card=$('aCard'), list=$('aList'); list.innerHTML='';
    renderNextAlarm();
    var entries=getAllActiveAlarmsSorted();
    if(!entries.length){card.style.display='none';return;}
    card.style.display='';
    var show=entries.slice(0,aListLimit);
    show.forEach(function(info){
      var el=document.createElement('div'); el.className='exitem';
      el.innerHTML='\uD83D\uDD14 <b>'+esc(fmtDe(info.ds))+'</b> \u2013 '+esc(info.shiftName)+' um '+esc(info.time)+' Uhr'
        +'<button class="danger sm adel" data-date="'+esc(info.ds)+'" data-key="'+esc(info.alarmKey)+'">L\u00F6schen</button>';
      list.appendChild(el);
    });
    if(entries.length>aListLimit){
      var more=document.createElement('button');
      more.className='sm';more.id='aMore';
      more.textContent='\u25BC Mehr anzeigen ('+(entries.length-aListLimit)+' weitere)';
      list.appendChild(more);
    }
    if(aListLimit>5){
      var less=document.createElement('button');
      less.className='sm';less.id='aLess';
      less.textContent='\u25B2 Weniger anzeigen';
      list.appendChild(less);
    }
  }

  /* Warnung bei fehlender Wecker-Berechtigung (z. B. Dialog mit „Später“ weggeklickt) */
  function renderPermWarn(){
    var el=$('permWarn'); if(!el) return;
    var issue=''; try{ if(hasBridge('getAlarmPermissionIssue')) issue=window.Android.getAlarmPermissionIssue(); }catch(e){}
    if(!issue){ el.style.display='none'; return; }
    var txt=issue==='exact'
      ?'\u26A0\uFE0F Wecker sind nicht erlaubt \u2013 ohne die Berechtigung \u201EWecker und Erinnerungen\u201C klingelt nichts.'
      :'\u26A0\uFE0F Vollbild-Wecker nicht erlaubt \u2013 der Wecker klingelt, erscheint aber nicht \u00FCber dem Sperrbildschirm.';
    el.innerHTML='<span>'+txt+'</span><button class="sm primary" id="permFixBtn">Erlauben</button>';
    $('permFixBtn').onclick=function(){ window.Android.openAlarmPermissionSettings(issue); };
    el.style.display='';
  }

  /* „Nächster Wecker“ über dem Kalender */
  function renderNextAlarm(){
    var el=$('nextAlarm'); if(!el) return;
    var next=(S.activeAlarms||[]).filter(function(a){return isFuture(a.ds,a.time);})
      .sort(function(a,b){return (a.ds+a.time).localeCompare(b.ds+b.time);})[0];
    if(!next){ el.className='nextalarm none'; el.textContent='\u23F0 Kein Wecker gestellt'; return; }
    var d=parseYmd(next.ds), wd=['So','Mo','Di','Mi','Do','Fr','Sa'][d.getDay()];
    var rel=next.ds===todayYmd()?'heute':(next.ds===toYmd(new Date(Date.now()+864e5))?'morgen':wd+' '+fmtDe(next.ds).slice(0,6));
    el.className='nextalarm';
    // ein einziges Kind-Element, sonst verteilt Flexbox die Textteile auf Spalten
    el.innerHTML='<span>\u23F0 N\u00E4chster Wecker: <b>'+esc(rel)+' \u00B7 '+esc(next.time)+' Uhr</b> \u2013 '+esc(next.shiftName||'Wecker')+'</span>';
  }

  /* Schichttausch im Tages-Sheet: Schicht nur für diesen Tag ändern */
  function renderSwap(ds){
    var el=$('sSwap'); if(!el) return;
    var ex=S.exceptions.some(function(e){return ds>=e.start&&ds<=e.end;});
    if(ex){ el.innerHTML='<span class="lbl">Ausnahme eingetragen \u2013 Schicht nicht \u00E4nderbar</span>'; return; }
    var cur=Object.prototype.hasOwnProperty.call(S.overrides,ds)?S.overrides[ds]:null;
    var opts=[{t:null,n:'Wie Plan'},{t:1,n:'Frei'},{t:2,n:'Fr\u00FCh'},{t:3,n:'Sp\u00E4t'},{t:4,n:'Nacht'}];
    el.innerHTML='<span class="lbl">Schicht an diesem Tag:</span>'+opts.map(function(o){
      return '<button type="button" class="sftbtn'+(cur===o.t?' sftbtn-active':'')+'" data-swap="'+(o.t===null?'':o.t)+'">'+o.n+'</button>';
    }).join('');
    el.querySelectorAll('[data-swap]').forEach(function(b){
      b.onclick=function(){ setOverride(ds,b.dataset.swap===''?null:Number(b.dataset.swap)); };
    });
  }
  function setOverride(ds,type){
    if(type===null) delete S.overrides[ds]; else S.overrides[ds]=type;
    save(); renderCal(); resyncAlarms();
    openSheet(ds,getShift(ds));
    toast(type===null?'Schicht wie im Plan':'Schicht am '+fmtDe(ds)+': '+(SNAMES[type]||'Frei'));
  }

  /* ── BOTTOM SHEET ───────────────────────── */
  function openSheet(ds,sh){
    try{
    var p=ds.split('-').map(Number);
    document.getElementById('sDate').textContent=new Date(p[0],p[1]-1,p[2],12,0,0)
      .toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    var aa=getActiveAlarmsForDate(ds);
    var txt=document.getElementById('sTxt'), btns=document.getElementById('sBtns');
    var pickerEl=document.getElementById('sPicker');
    if(pickerEl)pickerEl.innerHTML='';
    var bar=document.getElementById('sBar');
    renderSwap(ds);
    if(aa.length){
      var first=aa[0];
      bar.textContent=first.shiftName||'Wecker'; bar.className='sbar '+(SCLS[first.alarmKey.match(/t(\d)/)?Number(RegExp.$1):0]||'');
      txt.innerHTML='<strong>\uD83D\uDD14 Wecker gesetzt</strong><br><span class="muted small">Am '+esc(fmtDe(ds))+' um '+esc(aa.map(function(a){return a.time;}).join(', '))+' Uhr</span>';
      if(pickerEl)pickerEl.style.display='none';
      btns.innerHTML='<button class="danger" id="scnBtn">\uD83D\uDD15 Wecker l\u00F6schen</button><button id="sclBtn">Schlie\u00DFen</button>';
      document.getElementById('scnBtn').onclick=function(){aa.forEach(function(a){cancelAlarm(ds,a.alarmKey);});};
    } else {
      bar.textContent='\u23F0 Wecker stellen'; bar.className='sbar';
      txt.innerHTML='<span class="muted small">'+esc(fmtDe(ds))+' \u2013 Schicht w\u00E4hlen:</span>';
      if(pickerEl){
        pickerEl.style.display='';
        var shiftOpts=[
          {t:0,n:'Einzelwecker',c:'',defH:7,defM:0},
          {t:1,n:'Frei',c:'free',defH:7,defM:0},
          {t:2,n:'Fr\u00FCh',c:'frueh',defH:5,defM:30},
          {t:3,n:'Sp\u00E4t',c:'spaet',defH:13,defM:0},
          {t:4,n:'Nacht',c:'nacht',defH:21,defM:0}
        ];
        var preSel=sh.type>=1&&sh.type<=4?sh.type:0;
        var selType=preSel;
        var html='<div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.7rem;">';
        for(var i=0;i<shiftOpts.length;i++){
          var o=shiftOpts[i];
          html+='<button type="button" class="sftbtn'+(selType===o.t?' sftbtn-active':'')+'" data-st="'+o.t+'" data-dh="'+o.defH+'" data-dm="'+o.defM+'">'+o.n+'</button>';
        }
        html+='</div>';
        var initH,initM;
        if(preSel>=1&&S.alarmTimes[preSel]){var pp=S.alarmTimes[preSel].split(':').map(Number);initH=pp[0];initM=pp[1];}
        else{initH=7;initM=0;}
        html+='<div class="tpick">'
          +'<div class="tunit">'
          +'<button type="button" class="tbtn" id="sqhU">\u25B2</button>'
          +'<span class="tval" id="sqh">'+pad(initH)+'</span>'
          +'<button type="button" class="tbtn" id="sqhD">\u25BC</button>'
          +'</div>'
          +'<span class="tcolon">:</span>'
          +'<div class="tunit">'
          +'<button type="button" class="tbtn" id="sqmU">\u25B2</button>'
          +'<span class="tval" id="sqm">'+pad(initM)+'</span>'
          +'<button type="button" class="tbtn" id="sqmD">\u25BC</button>'
          +'</div>'
          +'<span class="tuhr">Uhr</span>'
          +'</div>';
        pickerEl.innerHTML=html;
        pickerEl.querySelectorAll('.sftbtn').forEach(function(btn){
          btn.onclick=function(){
            pickerEl.querySelectorAll('.sftbtn').forEach(function(b){b.classList.remove('sftbtn-active');});
            btn.classList.add('sftbtn-active');
            selType=Number(btn.dataset.st);
            window._currentSelType=selType;
            document.getElementById('sqh').textContent=pad(Number(btn.dataset.dh));
            document.getElementById('sqm').textContent=pad(Number(btn.dataset.dm));
            var st=selType;
            if(st>=1&&S.alarmTimes[st]){var pt=S.alarmTimes[st].split(':').map(Number);document.getElementById('sqh').textContent=pad(pt[0]);document.getElementById('sqm').textContent=pad(pt[1]);}
            if(st===0&&S.freeAlarm&&S.freeAlarm.time){var ft=S.freeAlarm.time.split(':').map(Number);document.getElementById('sqh').textContent=pad(ft[0]);document.getElementById('sqm').textContent=pad(ft[1]);}
          };
        });
        document.getElementById('sqhU').onclick=function(){var e=document.getElementById('sqh');e.textContent=pad((Number(e.textContent)+1)%24);};
        document.getElementById('sqhD').onclick=function(){var e=document.getElementById('sqh');e.textContent=pad((Number(e.textContent)+23)%24);};
        document.getElementById('sqmU').onclick=function(){var e=document.getElementById('sqm');e.textContent=pad((Number(e.textContent)+1)%60);};
        document.getElementById('sqmD').onclick=function(){var e=document.getElementById('sqm');e.textContent=pad((Number(e.textContent)+59)%60);};
        window._currentSelType=selType;
      }
      btns.innerHTML='<button class="primary" id="ssetBtn" style="flex:2;">\uD83D\uDD14 Wecker stellen</button><button id="sclBtn">Abbrechen</button>';
      document.getElementById('ssetBtn').onclick=function(){
        var sel=window._currentSelType!==undefined?window._currentSelType:0;
        setCustomAlarm(ds,sel);
      };
    }
    document.getElementById('sclBtn').onclick=closeSheet;
    document.body.style.overflow='hidden';
    var ov=document.getElementById('overlay');
    ov.classList.add('open');
    setTimeout(function(){ov.scrollTop=ov.scrollHeight;},50);
    }catch(ex){toast('Fehler: '+ex.message,true);}
  }
  function closeSheet(){
    document.getElementById('overlay').classList.remove('open');
    document.body.style.overflow='';
    delete window._currentSelType;
  }

  /* ── ALARM BRIDGE ───────────────────────── */
  function setCustomAlarm(ds,selType){
    try{
      var h=Number(document.getElementById('sqh').textContent);
      var m=Number(document.getElementById('sqm').textContent);
      var time=pad(h)+':'+pad(m);
      if(isNaN(h)||isNaN(m)){toast('Ung\u00FCltige Zeit!',true);return;}
      var p=ds.split('-').map(Number);
      var alarmMs=new Date(p[0],p[1]-1,p[2],h,m,0,0).getTime();
      if(alarmMs<=Date.now()){
        toast('\u26A0\uFE0F '+pad(h)+':'+pad(m)+' Uhr am '+fmtDe(ds)+' liegt in der Vergangenheit!',true);
        return;
      }
      var key=selType>=1&&selType<=4?('shift-'+ds+'-t'+selType):('custom-'+ds);
      var shiftName=SNAMES[selType]||'Einzelwecker';
      var label=shiftName+' ('+fmtDe(ds)+')';
      if(!window.Android||typeof window.Android.setAlarmForDate!=='function'){
        toast('Android-Bridge nicht verf\u00FCgbar.',true);return;
      }
      var result=window.Android.setAlarmForDate(p[0],p[1],p[2],h,m,key,label);
      if(result===false){toast('Wecker konnte nicht gesetzt werden (Berechtigung?).',true);return;}
      addActiveAlarm(ds,key,time,shiftName,false);
      S.suppressed=S.suppressed.filter(function(k){return k!==key;});
      save(); renderCal(); closeSheet();
      toast('\u2705 Wecker gesetzt f\u00FCr '+pad(h)+':'+pad(m)+' Uhr am '+fmtDe(ds));
    }catch(ex){
      toast('Alarm-Fehler: '+ex.message,true);
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
    save(); renderCal(); closeSheet(); toast('Wecker gel\u00F6scht.');
  }

  /* Widget: Schichtnamen der nächsten 60 Tage (das Widget wählt per Datum selbst) */
  function pushWidgetData(){
    if(!hasBridge('updateWidget')) return;
    var out={}, start=parseYmd(todayYmd());
    for(var i=0;i<60;i++){
      var ds=toYmd(new Date(start.getTime()+i*864e5)), sh=getShift(ds);
      out[ds]=sh.name||'kein Eintrag';
    }
    try{ window.Android.updateWidget(JSON.stringify(out)); }catch(e){}
  }

  /* Zurück-Geste (aus MainActivity): oberste offene Ebene schließen. true = erledigt */
  window.handleBack=function(){
    var vis=function(id){ var e=$(id); return e&&getComputedStyle(e).display!=='none'; };
    if(vis('cdlgBg')){ $('cdlgCancel').click(); return true; }
    if(vis('wizBg')){ closeWiz(); return true; }
    if($('overlay').classList.contains('open')){ closeSheet(); return true; }
    if($('settingsOverlay').classList.contains('open')){ $('settingsOverlay').classList.remove('open'); save(); return true; }
    return false;
  };

  /* ── PERSISTENZ ─────────────────────────── */
  function save(){
    var json=JSON.stringify(S);
    // Zuerst nativ und synchron sichern – localStorage schreibt verzögert und geht verloren,
    // wenn die App direkt nach einer Änderung beendet wird
    if(hasBridge('saveState')){ try{ if(window.Android.saveState(json)===false) throw 0; }catch(e){ toast('Speichern fehlgeschlagen!',true); } }
    pushWidgetData();
    try{localStorage.setItem(LS,json);}
    catch(e){toast('Speichern fehlgeschlagen! \u00C4nderungen gehen m\u00F6glicherweise beim n\u00E4chsten Start verloren.',true);}
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
    if(typeof s.preAlarmMin==='number'&&[0,5,10,15,30,45,60].indexOf(s.preAlarmMin)!==-1) S.preAlarmMin=s.preAlarmMin;
    if(Array.isArray(s.suppressed)) S.suppressed=s.suppressed.filter(function(k){return typeof k==='string';});
    if(s.overrides&&typeof s.overrides==='object'&&!Array.isArray(s.overrides)){
      S.overrides={};
      Object.keys(s.overrides).forEach(function(d){
        var t=s.overrides[d];
        if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&typeof t==='number'&&t>=0&&t<=4&&t%1===0) S.overrides[d]=t;
      });
    }
  }

  /* ── PROFIL (Sicherung als Datei) ────────
     Enthält Plan + Einstellungen + von Hand gestellte Wecker. Automatische Wecker
     werden nicht gespeichert, sondern beim Laden per resyncAlarms() neu berechnet. */
  var PROFILE_FORMAT=1;
  function buildProfile(){
    var keys=['startDate','weeksCount','bundesland','pattern','exceptions','alarmTimes','alarmEnabled',
              'freeAlarm','autoSchedule','skipHolidaysShift','suppressed','overrides','preAlarmMin','startMode'];
    var data={};
    keys.forEach(function(k){ data[k]=S[k]; });
    data.manualAlarms=(S.activeAlarms||[]).filter(function(a){return !a.auto&&isFuture(a.ds,a.time);})
      .map(function(a){return {ds:a.ds,alarmKey:a.alarmKey,time:a.time,shiftName:a.shiftName};});
    var theme='system'; try{ theme=localStorage.getItem(THK)||'system'; }catch(e){}
    return {app:'schichtwecker',format:PROFILE_FORMAT,exportedAt:new Date().toISOString(),theme:theme,
            alarmOptions:readAlarmOptions(),data:data};
  }
  function exportProfileFile(){
    if(!hasBridge('exportProfile')){ toast('Android-Bridge nicht verf\u00FCgbar.',true); return; }
    save();
    window.Android.exportProfile(JSON.stringify(buildProfile(),null,2),'Schichtwecker-Profil-'+todayYmd()+'.json');
  }
  /* Schichten der nächsten 12 Monate als iCalendar-Datei (ganztägige Termine).
     Aufeinanderfolgende Tage gleicher Art werden zu einem Termin zusammengefasst. */
  function buildIcs(){
    var start=parseYmd(todayYmd()), events=[], cur=null;
    function ymd8(d){ return toYmd(d).replace(/-/g,''); }
    function label(sh){ return sh.type===-1?sh.name:(sh.type>=2&&sh.type<=4?sh.name+'schicht':null); }
    for(var i=0;i<=366;i++){
      var d=new Date(start.getTime()+i*864e5), ds=toYmd(d), sh=getShift(ds), lab=i<366?label(sh):null;
      if(cur&&cur.lab===lab){ cur.end=d; continue; }
      if(cur) events.push(cur);
      cur=lab?{lab:lab,start:d,end:d}:null;
    }
    if(cur) events.push(cur);
    var stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    function esc(t){ return String(t).replace(/[\\;,]/g,function(c){return '\\'+c;}); }
    var lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Schichtwecker//DE','CALSCALE:GREGORIAN','X-WR-CALNAME:Schichtplan'];
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
    if(!hasBridge('exportFile')){ toast('Android-Bridge nicht verf\u00FCgbar.',true); return; }
    var r=buildIcs();
    if(!r.count){ toast('Keine Schichten zum Exportieren (Muster leer?).',true); return; }
    window.Android.exportFile(r.text,'Schichtplan-'+todayYmd()+'.ics','text/calendar');
  }
  function importProfileFile(){
    if(!hasBridge('importProfile')){ toast('Android-Bridge nicht verf\u00FCgbar.',true); return; }
    window.Android.importProfile();
  }
  /* Rückruf aus MainActivity mit dem Dateiinhalt */
  window.onProfileImported=function(text){
    var p;
    try{ p=JSON.parse(text); }catch(e){ toast('Keine g\u00FCltige Profil-Datei.',true); return; }
    if(!p||p.app!=='schichtwecker'||!p.data||typeof p.data!=='object'){ toast('Keine Schichtwecker-Profil-Datei.',true); return; }
    if(typeof p.format!=='number'||p.format>PROFILE_FORMAT){ toast('Profil stammt aus einer neueren App-Version.',true); return; }
    var when=p.exportedAt?' vom '+fmtDe(String(p.exportedAt).slice(0,10)):'';
    customConfirm('Profil'+when+' laden?\n\nDein aktueller Plan und alle gesetzten Wecker werden ersetzt.',function(){
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
      if(bridgeSet(a.ds,{key:a.alarmKey,time:a.time,msg:name+' ('+fmtDe(a.ds)+')'})){
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
    toast('\u2705 Profil geladen \u2013 '+n+' Wecker gesetzt'+(r.errors?' ('+r.errors+' fehlgeschlagen)':''),r.errors>0);
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
    if(ok===false) toast('Einstellung konnte nicht gespeichert werden.',true);
  }

  /* Alle Einstellungs-Elemente neu aus S befüllen (nach Reset oder Profil-Import) */
  function refreshAllUi(){
    updateAlarmOptionsUi();
    renderStartPicker();
    $('weeksVal').textContent=S.weeksCount;
    $('bundesland').value=S.bundesland;
    $('skipHolShift').checked=S.skipHolidaysShift;
    renderAlarmSettings(); renderFreeAlarmSettings(); renderPat(); renderEx(); renderCal(); updateRingtoneUI();
  }

  /* ── EINRICHTUNGSASSISTENT ────────────── */
  var WIZ_KEY='schichtplan-wizard-done';
  var wizSteps=[
    { icon:'\uD83D\uDC4B', title:'Willkommen!',
      body:'<b>Mein Schichtplan</b> hilft dir, deinen Schichtrhythmus im Blick zu behalten und automatisch Wecker zu stellen.'
        +'<br><br>Diese kurze Anleitung zeigt dir die wichtigsten Funktionen.' },
    { icon:'\uD83D\uDCC5', title:'Startwoche & Rhythmus',
      body:'<ul>'
        +'<li><b>Startwoche</b> \u2013 W\u00E4hle die Kalenderwoche, in der Woche 1 deines Rhythmus liegt (oder stattdessen ein Datum).</li>'
        +'<li><b>Wochen im Rhythmus</b> \u2013 Wie viele Wochen umfasst ein kompletter Durchlauf? (1\u20136)</li>'
        +'<li><b>Bundesland</b> \u2013 Damit Feiertage automatisch angezeigt werden.</li>'
        +'</ul>'
        +'Alles findest du unter <b>\u2699\uFE0F Einstellungen</b>.' },
    { icon:'\uD83D\uDD04', title:'Schichtmuster anlegen',
      body:'Im Bereich <b>Wochenrhythmus</b> legst du das Muster fest:'
        +'<ul>'
        +'<li>Tippe auf einen Tag, um zwischen <b>Frei</b>, <b>Fr\u00FCh</b>, <b>Sp\u00E4t</b> und <b>Nacht</b> zu wechseln.</li>'
        +'<li>Das Muster wiederholt sich automatisch ab dem Startdatum.</li>'
        +'</ul>' },
    { icon:'\u23F0', title:'Wecker einstellen',
      body:'<ul>'
        +'<li>Unter <b>Weckerzeit pro Schicht</b> stellst du die Standard-Weckzeiten ein und aktivierst sie per Schalter.</li>'
        +'<li>Tippe im Kalender auf einen Tag \u2192 <b>Wecker stellen</b> f\u00FCr genau dieses Datum.</li>'
        +'<li><b>\u201EAlle stellen\u201C</b> setzt Wecker f\u00FCr die n\u00E4chsten 12 Monate auf einmal.</li>'
        +'</ul>' },
    { icon:'\uD83D\uDCCC', title:'Ausnahmen & Extras',
      body:'<ul>'
        +'<li><b>Ausnahmen</b> \u2013 Urlaub, Krank oder Schulung f\u00FCr einzelne Tage oder Zeitr\u00E4ume eintragen.</li>'
        +'<li><b>Unbelegte-Tage-Wecker</b> \u2013 Wecker f\u00FCr freie Tage, nur an gew\u00E4hlten Wochentagen.</li>'
        +'<li><b>Schicht tauschen</b> \u2013 Tag im Kalender antippen und die Schicht nur f\u00FCr diesen Tag \u00E4ndern.</li>'
        +'<li><b>Weck-Verhalten</b> \u2013 Schlummerzeit, Vorwecker, ansteigende Lautst\u00E4rke, nur Vibration.</li>'
        +'<li><b>Profil sichern</b> \u2013 ganz unten in den Einstellungen; dort auch der Kalender-Export.</li>'
        +'<li><b>Gesetzte Wecker</b> \u2013 Unter dem Kalender siehst du alle aktiven Wecker.</li>'
        +'</ul>' },
    { icon:'\uD83D\uDE80', title:'Los geht\u2019s!',
      body:'Du kannst diese Anleitung jederzeit \u00FCber <b>\u2699\uFE0F Einstellungen \u2192 \u2753 Anleitung</b> erneut starten.'
        +'<br><br>Viel Spa\u00DF mit deinem Schichtplan! \uD83C\uDF89' }
  ];
  var wizStep=0;
  function renderWiz(){
    var s=wizSteps[wizStep];
    $('wizIcon').textContent=s.icon;
    $('wizTitle').textContent=s.title;
    $('wizBody').innerHTML=s.body;
    var dots=$('wizDots'); dots.innerHTML='';
    for(var i=0;i<wizSteps.length;i++){
      var d=document.createElement('div');d.className='wiz-dot'+(i===wizStep?' active':'');
      dots.appendChild(d);
    }
    $('wizPrev').style.visibility=wizStep===0?'hidden':'visible';
    $('wizNext').textContent=wizStep===wizSteps.length-1?'Fertig':'Weiter';
  }
  function openWiz(){wizStep=0;renderWiz();$('wizBg').style.display='flex';}
  function closeWiz(){$('wizBg').style.display='none';try{localStorage.setItem(WIZ_KEY,'1');}catch(e){}}
  $('wizNext').onclick=function(){
    if(wizStep<wizSteps.length-1){wizStep++;renderWiz();}
    else closeWiz();
  };
  $('wizPrev').onclick=function(){
    if(wizStep>0){wizStep--;renderWiz();}
  };
  $('wizBg').addEventListener('click',function(e){if(e.target===this)closeWiz();});

  /* ── EVENTS ─────────────────────────────── */
  $('themeBtn').onclick=cycleTheme;
  $('settingsBtn').onclick=function(){
    var ov=$('settingsOverlay');
    ov.classList.toggle('open');
  };
  $('closeSettings').onclick=function(){
    $('settingsOverlay').classList.remove('open');
  };
  $('settingsOverlay').onclick=function(e){
    if(e.target===this) this.classList.remove('open');
  };
  $('startWizBtn').onclick=function(){openWiz();};
  $('doneSettings').onclick=function(){
    $('settingsOverlay').classList.remove('open');
    save();
  };
  function applyStartDate(nd){
    S.startDate=nd;
    var d=parseYmd(S.startDate);
    if(!isNaN(d)) viewDate=new Date(d.getFullYear(),d.getMonth(),1,12,0,0);
    renderStartPicker(); renderCal(); save(); scheduleResync();
  }
  ['sdDay','sdMon','sdYear'].forEach(function(id){
    $(id).addEventListener('change',function(){
      var nd=getDateFromSelects();
      if(!nd){toast('Ung\u00FCltiges Datum gew\u00E4hlt!',true);return;}
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
    customConfirm('Wirklich alles l\u00f6schen?\nAlle Einstellungen und Wecker werden zur\u00fcckgesetzt.',function(){
      // Cancel all Android alarms first
      if(S.activeAlarms) S.activeAlarms.forEach(function(a){ bridgeCancel(a.alarmKey); });
      if(hasBridge('cancelAllAlarms')){ try{ window.Android.cancelAllAlarms(); }catch(e){} }
      if(hasBridge('setAlarmOptions')){ try{ window.Android.setAlarmOptions(JSON.stringify({snoozeMinutes:5,risingVolume:false,vibrateOnly:false})); }catch(e){} }
      S=createDefaultState();
      S.startDate=todayYmd();
      initPat();
      save();
      refreshAllUi();
      $('settingsOverlay').classList.remove('open');
      toast('Alles zur\u00fcckgesetzt. Alle Wecker sind jetzt deaktiviert.');
    });
  };
  $('alarmBox').addEventListener('change',function(e){
    var id=e.target.id||'';
    // Checkbox: ae1..ae4
    var mt=id.match(/^ae(\d)$/);
    if(mt){
      var t=Number(mt[1]); if(t<1||t>4)return;
      S.alarmEnabled[t]=e.target.checked;save();renderCal();scheduleResync();
      toast(SNAMES[t]+'-Wecker '+(e.target.checked?'aktiviert':'deaktiviert')+'.');
    }
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
    var s=$('exS').value, e=$('exE').value||s, t=$('exT').value;
    if(!s){toast('Startdatum fehlt!',true);return;}
    if(e<s){toast('Bis-Datum vor Von-Datum!',true);return;}
    S.exceptions.push({id:uid(),start:s,end:e,type:t});
    renderEx();renderCal();save();scheduleResync();
    $('exS').value='';$('exE').value='';toast(t+' eingetragen!');
  };
  $('exList').addEventListener('click',function(e){var b=e.target.closest('.xdel');if(b)delEx(b.dataset.id);});
  $('prevM').onclick=function(){viewDate.setMonth(viewDate.getMonth()-1);renderCal();};
  $('nextM').onclick=function(){viewDate.setMonth(viewDate.getMonth()+1);renderCal();};
  $('todayM').onclick=function(){viewDate=new Date();viewDate.setDate(1);viewDate.setHours(12,0,0,0);renderCal();};
  $('aList').addEventListener('click',function(e){
    var b=e.target.closest('.adel');if(b)cancelAlarm(b.dataset.date,b.dataset.key);
    if(e.target.id==='aMore'){aListLimit+=5;renderAList();}
    if(e.target.id==='aLess'){aListLimit=5;renderAList();}
  });
  $('overlay').onclick=function(e){if(e.target===this)closeSheet();};
  $('testAlarmBtn').onclick=function(){
    if(window.Android&&typeof window.Android.testAlarm==='function'){
      window.Android.testAlarm();
    } else {
      toast('Android-Bridge nicht verf\u00FCgbar.',true);
    }
  };

  /* ── KLINGELTON ──────────────────────────── */
  function updateRingtoneUI(){
    var nameEl=$('ringtoneName');
    var resetBtn=$('resetRingtoneBtn');
    if(window.Android&&typeof window.Android.usesCustomRingtone==='function'&&window.Android.usesCustomRingtone()){
      var name=window.Android.getCustomRingtoneName&&window.Android.getCustomRingtoneName()||'Eigener Klingelton';
      nameEl.innerHTML='&#x1F3B5; <b>'+esc(name)+'</b>';
      resetBtn.style.display='';
    } else {
      nameEl.textContent='Standard-Klingelton';
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
      toast('Android-Bridge nicht verf\u00FCgbar.',true);
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

  /* ── INIT ───────────────────────────────── */
  S.startDate=todayYmd();
  load(); if(!S.startDate) S.startDate=todayYmd(); initPat(); purgeExpiredAlarms();
  // Migration: Frei-Defaults setzen falls leer (alte Versionen hatten '' / false)
  if(!S.alarmTimes[1]) S.alarmTimes[1]='07:00';
  initDateSelects();
  renderStartPicker();
  $('weeksVal').textContent=S.weeksCount;
  $('bundesland').value=S.bundesland;
  $('skipHolShift').checked=S.skipHolidaysShift;
  syncWithNative(); resyncAlarms({quiet:true}); showAppVersion(); updateAlarmOptionsUi(); renderPermWarn();
  renderAlarmSettings(); renderFreeAlarmSettings(); renderPat(); renderPatHint(); renderEx(); renderCal();
  /* Wizard beim allerersten Start anzeigen */
  try{if(!localStorage.getItem(WIZ_KEY))openWiz();}catch(e){}
})();
