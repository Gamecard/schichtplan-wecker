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
  /* Wecker, die an diesem Tag laut Plan fällig wären (Wecker-Art eingeschaltet, Schicht passt) */
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
        bridgeSet(a.ds,{key:a.alarmKey,time:a.time,msg:(a.shiftName||'Wecker')+' ('+fmtDe(a.ds)+')'});
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
     Eine Komponente für alle Weckzeiten (Schichten, unbelegte Tage, Einzelwecker im Tages-Sheet):
     Pfeile ▲▼ für Stunde/Minute; Antippen der Ziffern öffnet die System-Zeitauswahl über ein
     verstecktes <input type="time">. opts: label (Vorsilbe für aria-label), hId/mId (IDs der Ziffern).
     onChange(hhmm) nur bei Änderungen durch den Nutzer. Das Element hat getTime()/setTime(hhmm). */
  function parseHhmm(s){
    var m=/^(\d{1,2}):(\d{2})/.exec(String(s||''));
    if(!m||Number(m[1])>23||Number(m[2])>59) return null;
    return pad(Number(m[1]))+':'+m[2];
  }
  function buildTimePicker(hhmm,onChange,opts){
    opts=opts||{};
    var pre=opts.label?opts.label+': ':'';
    var cur=parseHhmm(hhmm)||'07:00';
    var box=document.createElement('div'); box.className='tpick';
    var nat=document.createElement('input');
    nat.type='time'; nat.className='tnative'; nat.tabIndex=-1; nat.setAttribute('aria-hidden','true');
    function btn(cls,txt,aria){
      var b=document.createElement('button'); b.type='button'; b.className=cls; b.textContent=txt;
      if(aria) b.setAttribute('aria-label',aria);
      return b;
    }
    function set(v,fire){
      cur=v; hVal.textContent=v.slice(0,2); mVal.textContent=v.slice(3); nat.value=v;
      var a=pre+'Uhrzeit '+v+' Uhr, antippen zum Auswählen';
      hVal.setAttribute('aria-label',a); mVal.setAttribute('aria-label',a);
      if(fire&&onChange) onChange(v);
    }
    function step(i,d){
      var p=cur.split(':').map(Number), max=i?60:24;
      p[i]=(p[i]+d+max)%max;   // ohne Übertrag: 59 → 00 lässt die Stunde stehen
      set(pad(p[0])+':'+pad(p[1]),true);
    }
    function openNative(){
      nat.value=cur;
      try{ if(typeof nat.showPicker==='function'){ nat.showPicker(); return; } }catch(e){}
      try{ nat.focus(); nat.click(); }catch(e){}
    }
    function unit(i,id,what){
      var u=document.createElement('div'); u.className='tunit';
      var up=btn('tbtn','▲',pre+what+' später'), val=btn('tval','',''), dn=btn('tbtn','▼',pre+what+' früher');
      if(id) val.id=id;
      up.onclick=function(){ step(i,1); };
      dn.onclick=function(){ step(i,-1); };
      val.onclick=openNative;
      u.appendChild(up); u.appendChild(val); u.appendChild(dn);
      box.appendChild(u);
      return val;
    }
    var hVal=unit(0,opts.hId,'Stunde');
    var col=document.createElement('span'); col.className='tcolon'; col.textContent=':'; box.appendChild(col);
    var mVal=unit(1,opts.mId,'Minute');
    var uhr=document.createElement('span'); uhr.className='tuhr'; uhr.textContent='Uhr'; box.appendChild(uhr);
    box.appendChild(nat);
    nat.addEventListener('change',function(){ var v=parseHhmm(nat.value); if(v&&v!==cur) set(v,true); });
    set(cur,false);
    box.getTime=function(){ return cur; };
    box.setTime=function(v){ v=parseHhmm(v); if(v&&v!==cur) set(v,false); };
    return box;
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
  var DAYS_LONG=['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
  function isAutoOn(kind){
    return kind==='free'?!!(S.freeAlarm.enabled&&S.autoSchedule.free):!!(S.alarmEnabled[kind]&&S.autoSchedule[kind]);
  }
  function kindLabel(kind){ return kind==='free'?'Unbelegte Tage':SNAMES[kind]; }
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
  function noDaysText(kind){
    return kind==='free'?'keine unbelegten Tage an den gewählten Wochentagen':'keine '+SNAMES[kind]+'-Tage im Rhythmus';
  }
  function autoStatusText(kind){
    if(!isAutoOn(kind)) return 'Aus – kein automatischer Wecker';
    var n=autoCount(kind);
    if(n) return 'An – '+n+' Wecker gestellt';
    if(kind==='free'&&!S.freeAlarm.days.length) return 'An – keine Wochentage gewählt';
    return 'An – '+(hasKindDays(kind)?'zurzeit kein Wecker fällig':noDaysText(kind));
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
    if(!on){ toast(name+': automatische Wecker entfernt (von Hand gestellte bleiben)'); return; }
    if(!hasBridge('setAlarmForDateSilent')){ toast('Android-Bridge nicht verfügbar.',true); return; }
    var err=_lastAutoResync&&_lastAutoResync.errors||0;
    if(n) toast(name+': '+n+' Wecker gestellt'+(err?' ('+err+' fehlgeschlagen)':''),err>0);
    else if(kind==='free'&&!S.freeAlarm.days.length) toast(name+': keine Wochentage gewählt – unten antippen');
    else if(!hasKindDays(kind)) toast(kind==='free'
      ?'Im Rhythmus gibt es keine unbelegten Tage an den gewählten Wochentagen'
      :'Im Rhythmus gibt es keine '+name+'-Tage – erst unter Schichtplan eintragen');
    else toast(name+': automatisch an – zurzeit kein Wecker fällig'+(err?' ('+err+' fehlgeschlagen)':''),err>0);
  }
  function renderAlarmSettings(){
    var c=$('alarmBox'); c.innerHTML=''; shiftPickers={};
    SMETA.forEach(function(sm){
      var r=document.createElement('div'); r.className='wkrow '+sm.c;
      var lbl=document.createElement('span'); lbl.className='slbl'; lbl.textContent=sm.n;
      var pick=buildTimePicker(S.alarmTimes[sm.t],function(v){ setShiftTime(sm.t,v); },{label:sm.n,hId:'tph'+sm.t,mId:'tpm'+sm.t});
      shiftPickers[sm.t]=pick;
      var st=document.createElement('div'); st.className='wkstate small muted'; st.id='aeState'+sm.t;
      r.appendChild(lbl); r.appendChild(pick);
      r.appendChild(buildSwitch('ae'+sm.t,sm.n+': automatisch wecken',isAutoOn(sm.t)));
      r.appendChild(st);
      c.appendChild(r);
    });
    renderWeckerStatus();
  }
  function renderFreeAlarmSettings(){
    var c=$('freeAlarmBox'); if(!c) return;
    c.innerHTML='';
    var r=document.createElement('div'); r.className='wkrow';
    var lbl=document.createElement('span'); lbl.className='slbl'; lbl.textContent='Weckzeit';
    freePicker=buildTimePicker(S.freeAlarm.time,setFreeTime,{label:'Unbelegte Tage',hId:'fatph',mId:'fatpm'});
    var st=document.createElement('div'); st.className='wkstate small muted'; st.id='freeAutoState';
    r.appendChild(lbl); r.appendChild(freePicker);
    r.appendChild(buildSwitch('freeAlarmEnabled','Unbelegte Tage: automatisch wecken',isAutoOn('free')));
    r.appendChild(st);
    c.appendChild(r);
    var cap=document.createElement('div'); cap.className='small muted wkcap'; cap.textContent='An diesen Wochentagen:';
    c.appendChild(cap);
    var days=document.createElement('div'); days.className='chiprow';
    DAYS.forEach(function(dn,i){
      var b=document.createElement('button'); b.type='button'; b.className='sftbtn'; b.textContent=dn;
      b.dataset.di=i; b.setAttribute('aria-label',DAYS_LONG[i]);
      days.appendChild(b);
    });
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
          ind.title='Wecker: '+aa.map(function(a){return a.time;}).join(', ')+' Uhr';cell.appendChild(ind);
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
  var MONTHS_DE=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  function alarmDayLabel(ds){
    var d=parseYmd(ds);
    return ['So','Mo','Di','Mi','Do','Fr','Sa'][d.getDay()]+' '+fmtDe(ds).slice(0,6);
  }
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
        +'<span class="an">'+esc(a.shiftName||'Wecker')+'</span>';
      list.appendChild(el);
    });
    var last=parseYmd(entries[entries.length-1].ds);
    $('aSummary').textContent=entries.length+' Wecker'+(entries.length>1?' bis '+MONTHS_DE[last.getMonth()].slice(0,3)+'. '+last.getFullYear():'');
    if(isAlarmsOpen()) renderAllAlarms();
  }
  /* Alle Wecker: nach Monaten gruppiert, aufklappbar */
  var openMonths=null;   // null = erster Monat offen
  function isAlarmsOpen(){ return $('alarmsOverlay').classList.contains('open'); }
  function renderAllAlarms(){
    var box=$('allAlarmList'), entries=upcomingAlarms(); box.innerHTML='';
    $('allSummary').textContent=entries.length?entries.length+' gestellte Wecker':'Keine Wecker gestellt.';
    var groups={}, order=[];
    entries.forEach(function(a){ var m=a.ds.slice(0,7); if(!groups[m]){groups[m]=[];order.push(m);} groups[m].push(a); });
    if(openMonths===null) openMonths=order.length?[order[0]]:[];
    order.forEach(function(m){
      var det=document.createElement('details'); det.className='amonth'; det.dataset.m=m;
      if(openMonths.indexOf(m)!==-1) det.open=true;
      var p=m.split('-').map(Number);
      det.innerHTML='<summary><span>'+MONTHS_DE[p[1]-1]+' '+p[0]+' <span class="muted">· '+groups[m].length+'</span></span></summary>'
        +groups[m].map(function(a){
          return '<div class="arow"><span class="ad">'+esc(alarmDayLabel(a.ds))+'</span><span class="at">'+esc(a.time)+'</span>'
            +'<span class="an">'+esc(a.shiftName||'Wecker')+'</span>'
            +'<button class="adel" title="Wecker löschen" aria-label="Wecker löschen" data-date="'+esc(a.ds)+'" data-key="'+esc(a.alarmKey)+'">🗑</button></div>';
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
    var ex=S.exceptions.find(function(e){return ds>=e.start&&ds<=e.end;});
    if(ex){
      // Tag gehört zu einer Ausnahme: anzeigen und entfernen anbieten
      var span=ex.start===ex.end?fmtDe(ex.start):fmtDe(ex.start)+' – '+fmtDe(ex.end);
      el.innerHTML='<span class="lbl">📌 '+esc(ex.type)+' ('+esc(span)+')</span>'
        +'<button type="button" class="sftbtn" id="exDelBtn">Ausnahme entfernen</button>';
      $('exDelBtn').onclick=function(){
        delEx(ex.id); resyncAlarms({quiet:true}); openSheet(ds,getShift(ds)); toast(ex.type+' ('+span+') entfernt');
      };
      return;
    }
    var cur=Object.prototype.hasOwnProperty.call(S.overrides,ds)?S.overrides[ds]:null;
    var opts=[{t:null,n:'Wie Plan'},{t:1,n:'Frei'},{t:2,n:'Früh'},{t:3,n:'Spät'},{t:4,n:'Nacht'}];
    el.innerHTML='<span class="lbl">Schicht an diesem Tag:</span>'+opts.map(function(o){
      return '<button type="button" class="sftbtn'+(cur===o.t?' sftbtn-active':'')+'" data-swap="'+(o.t===null?'':o.t)+'">'+o.n+'</button>';
    }).join('')
      +'<span class="lbl" style="flex-basis:100%;margin-top:4px;">Ausnahme an diesem Tag:</span>'
      +['Urlaub','Krank','Schulung'].map(function(t){
        return '<button type="button" class="sftbtn" data-ex="'+t+'">'+t+'</button>';
      }).join('');
    el.querySelectorAll('[data-swap]').forEach(function(b){
      b.onclick=function(){ setOverride(ds,b.dataset.swap===''?null:Number(b.dataset.swap)); };
    });
    el.querySelectorAll('[data-ex]').forEach(function(b){
      b.onclick=function(){
        S.exceptions.push({id:uid(),start:ds,end:ds,type:b.dataset.ex});
        renderEx(); renderCal(); save(); resyncAlarms({quiet:true});
        openSheet(ds,getShift(ds)); toast(b.dataset.ex+' am '+fmtDe(ds)+' eingetragen');
      };
    });
  }
  function setOverride(ds,type){
    if(type===null) delete S.overrides[ds]; else S.overrides[ds]=type;
    save(); renderCal(); resyncAlarms();
    openSheet(ds,getShift(ds));
    toast(type===null?'Schicht wie im Plan':'Schicht am '+fmtDe(ds)+': '+(SNAMES[type]||'Frei'));
  }

  /* ── BOTTOM SHEET ───────────────────────── */
  /* Einzelwecker: gewählte Art (0 = Einzelwecker, 1–4 = Schicht) und Zeitauswahl des offenen Sheets */
  var sheetSelType=0, sheetPicker=null;
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
        var shiftOpts=[{t:0,n:'Einzelwecker'},{t:1,n:'Frei'},{t:2,n:'Fr\u00FCh'},{t:3,n:'Sp\u00E4t'},{t:4,n:'Nacht'}];
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
        sheetPicker=buildTimePicker(sheetDefaultTime(sheetSelType),null,{label:'Wecker',hId:'sqh',mId:'sqm'});
        pickerEl.appendChild(chips); pickerEl.appendChild(sheetPicker);
      }
      btns.innerHTML='<button class="primary" id="ssetBtn" style="flex:2;">\uD83D\uDD14 Wecker stellen</button><button id="sclBtn">Abbrechen</button>';
      document.getElementById('ssetBtn').onclick=function(){ setCustomAlarm(ds,sheetSelType); };
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
    sheetPicker=null; sheetSelType=0;
  }

  /* ── ALARM BRIDGE ───────────────────────── */
  function setCustomAlarm(ds,selType){
    try{
      var time=sheetPicker&&parseHhmm(sheetPicker.getTime());
      if(!time){toast('Ung\u00FCltige Zeit!',true);return;}
      var h=Number(time.slice(0,2)), m=Number(time.slice(3));
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
    if(THEMES.indexOf(s.theme)!==-1) S.theme=s.theme;
    if(typeof s.wizardDone==='boolean') S.wizardDone=s.wizardDone;
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
              'freeAlarm','autoSchedule','skipHolidaysShift','suppressed','overrides','preAlarmMin','startMode'];
    var data={};
    keys.forEach(function(k){ data[k]=S[k]; });
    data.manualAlarms=(S.activeAlarms||[]).filter(function(a){return !a.auto&&isFuture(a.ds,a.time);})
      .map(function(a){return {ds:a.ds,alarmKey:a.alarmKey,time:a.time,shiftName:a.shiftName};});
    var theme=S.theme||'system'; try{ theme=localStorage.getItem(THK)||theme; }catch(e){}
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
  function closeWiz(){$('wizBg').style.display='none';S.wizardDone=true;save();try{localStorage.setItem(WIZ_KEY,'1');}catch(e){}}
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
  $('startWizBtn').onclick=function(){openWiz();};
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
      showTab('plan');
      toast('Alles zur\u00fcckgesetzt. Alle Wecker sind jetzt deaktiviert.');
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
  load(); if(!S.startDate) S.startDate=todayYmd();
  if(S.theme) applyTheme(S.theme); initPat(); purgeExpiredAlarms();
  initDateSelects();
  renderStartPicker();
  $('weeksVal').textContent=S.weeksCount;
  $('bundesland').value=S.bundesland;
  $('skipHolShift').checked=S.skipHolidaysShift;
  syncWithNative(); resyncAlarms({quiet:true}); showAppVersion(); updateAlarmOptionsUi(); renderPermWarn();
  renderAlarmSettings(); renderFreeAlarmSettings(); renderPat(); renderPatHint(); renderEx(); renderCal();
  /* Wizard beim allerersten Start anzeigen */
  var wizSeen=S.wizardDone; try{ wizSeen=wizSeen||!!localStorage.getItem(WIZ_KEY); }catch(e){}
  if(!wizSeen) openWiz();
  else if(!S.wizardDone){ S.wizardDone=true; save(); }   // Altbestand: Merker auch nativ sichern
})();
