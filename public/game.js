/**
 * Italy Card Game — Client v4
 */
const socket = io();

// ── State ──────────────────────────────────────────
let myPos=-1, myHand=[], validIds=[], isMyTurn=false;
let currentBid=0, currentBidder=-1;
let trumpSuit=null, trumpRevealed=false, leadSuit=null;
let scores={A:0,B:0}, roundNum=1, matchTarget=30;
let players=[], bidLog=[], handCounts={0:0,1:0,2:0,3:0};
let dealerPos=0, dragId=null, canRevTrump=false, amHost=false;

// Fix: initialize myPos properly
myPos = -1;

// ── Audio ───────────────────────────────────────────
let actx=null;
const aC=()=>{if(!actx)actx=new(window.AudioContext||window.webkitAudioContext)();return actx;};
function tone(f,d=.12,t='sine',v=.14){
  try{const c=aC(),o=c.createOscillator(),g=c.createGain();
    o.connect(g);g.connect(c.destination);o.type=t;o.frequency.value=f;
    g.gain.setValueAtTime(v,c.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d);
    o.start(c.currentTime);o.stop(c.currentTime+d);}catch(e){}
}
const sfxCard  = ()=>tone(440,.08,'square',.1);
const sfxDeal  = ()=>tone(660,.06,'sine',.09);
const sfxBid   = ()=>tone(392,.10,'triangle',.13);
const sfxErr   = ()=>tone(200,.15,'sawtooth',.1);
const sfxWin   = ()=>{tone(523,.14,'sine',.13);setTimeout(()=>tone(659,.14,'sine',.11),110);};
const sfxTrump = ()=>{tone(784,.2,'sine',.16);setTimeout(()=>tone(1047,.25,'sine',.13),190);};
const sfxGame  = ()=>[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,.2,'sine',.13),i*140));

// ── Constants ───────────────────────────────────────
const SYM={spades:'♠',hearts:'♥',diamonds:'♦',clubs:'♣'};
const COL={spades:'k',hearts:'r',diamonds:'r',clubs:'k'};
function teamOf(p){return p%2===0?'A':'B';}
function vslot(sp){return['bottom','right','top','left'][((sp-myPos)+4)%4];}

const $=id=>document.getElementById(id);
const showScreen=n=>{document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(n).classList.add('active');};
const showOv=id=>$(id).classList.add('open');
const hideOv=id=>$(id).classList.remove('open');
const hideAllOv=()=>document.querySelectorAll('.ov').forEach(o=>o.classList.remove('open'));

function toast(msg,dur=2800){
  const el=document.createElement('div');el.className='toast';el.textContent=msg;
  $('toasts').appendChild(el);setTimeout(()=>el.remove(),dur+300);
}

// ── Fullscreen ──────────────────────────────────────
function toggleFullscreen(){
  if(!document.fullscreenElement&&!document.webkitFullscreenElement){
    const el=document.documentElement;
    (el.requestFullscreen||el.webkitRequestFullscreen||el.mozRequestFullScreen||function(){})
      .call(el).catch(()=>{});
    // Also try landscape on mobile
    screen.orientation?.lock?.('landscape').catch(()=>{});
  } else {
    (document.exitFullscreen||document.webkitExitFullscreen||function(){})
      .call(document).catch(()=>{});
  }
}

// ── Card building ───────────────────────────────────
function mkCard(card,cls=''){
  const d=document.createElement('div');
  d.className=`card ${COL[card.suit]} ${cls}`;
  d.dataset.id=card.id;
  d.innerHTML=`<span class="cr">${card.rank}</span>
    <span class="cs-t">${SYM[card.suit]}</span>
    <span class="cs-c">${SYM[card.suit]}</span>
    <span class="crb">${card.rank}</span>
    <span class="cs-b">${SYM[card.suit]}</span>`;
  return d;
}
function mkBack(cls=''){const d=document.createElement('div');d.className=`card back ${cls}`;return d;}

// ── Render hand ─────────────────────────────────────
function renderHand(animate=false){
  const wrap=$('my-hand');if(!wrap)return;
  wrap.innerHTML='';
  myHand.forEach((card,i)=>{
    const el=mkCard(card,'mc');
    const ok=isMyTurn&&validIds.includes(card.id);
    if(isMyTurn)el.classList.add(ok?'vh':'inv');
    if(animate){el.classList.add('dealing');el.style.animationDelay=`${i*50}ms`;}
    el.addEventListener('click',()=>{
      if(!isMyTurn)return;
      if(!validIds.includes(card.id)){sfxErr();toast('Cannot play that card now!');return;}
      socket.emit('playCard',{cardId:card.id});
    });
    el.draggable=true;
    el.addEventListener('dragstart',e=>{
      if(!isMyTurn||!validIds.includes(card.id)){e.preventDefault();return;}
      dragId=card.id;el.classList.add('dragging');
      e.dataTransfer.setData('text/plain',card.id);
    });
    el.addEventListener('dragend',()=>{el.classList.remove('dragging');dragId=null;});
    wrap.appendChild(el);
  });
}

// ── Trick display ───────────────────────────────────
function setTrick(sp,card){
  const sl=vslot(sp);
  const el=$(`ts-${sl[0]}`); // ts-t, ts-b, ts-l, ts-r
  if(!el)return;
  el.innerHTML='';if(card)el.appendChild(mkCard(card,'tc in'));
}
function clearTricks(){
  ['t','b','l','r'].forEach(s=>{const e=$(`ts-${s}`);if(e)e.innerHTML='';});
}

// ── Trump panel ─────────────────────────────────────
function updateTrumpPanel(){
  const slot=$('tp-slot'),suit=$('tp-suit');
  if(!trumpRevealed){
    if(slot){slot.innerHTML='';slot.appendChild(mkBack('sm'));}
    if(suit)suit.textContent='Hidden';
  }else{
    if(suit)suit.innerHTML=`${SYM[trumpSuit]}<br><span style="font-size:.6rem">${trumpSuit}</span>`;
  }
}
function revealTrumpPanel(card){
  const slot=$('tp-slot');if(!slot)return;
  slot.innerHTML='';
  const c=mkCard(card,'tcard');
  c.style.animation='dropIn .4s ease-out';
  slot.appendChild(c);
  $('tp-suit').innerHTML=`${SYM[card.suit]}<br><span style="font-size:.6rem">${card.suit}</span>`;
}

function setRevealBtn(show){
  const b=$('btn-trump');if(b)b.classList.toggle('show',show);
  canRevTrump=show;
}
function onRevealTrump(){socket.emit('revealTrump');setRevealBtn(false);}

// ── Avatars ─────────────────────────────────────────
const avLetter=name=>name?name[0].toUpperCase():'?';

function setActiveAv(sp){
  ['top','left','right'].forEach(s=>{const e=$(`av-${s}`);if(e)e.classList.remove('active');});
  const me=$('av-me');if(me)me.classList.remove('active');
  if(sp<0)return;
  const s=vslot(sp);
  if(s==='bottom'){if(me)me.classList.add('active');}
  else{const e=$(`av-${s}`);if(e)e.classList.add('active');}
}

function renderPlayers(ps){
  ps.forEach(p=>{
    const tm=teamOf(p.position);
    if(p.position===myPos){
      $('nm-bottom').textContent=p.name+' (You)';
      const nt=$('nt-bottom');nt.textContent=`Team ${tm}`;nt.className=`nc-team ${tm}`;
      $('av-me-l').textContent=avLetter(p.name);
      $('av-me').className=`av ${tm} sm`;
    }else{
      const s=vslot(p.position);
      $(`nm-${s}`).textContent=p.name;
      const nt=$(`nt-${s}`);nt.textContent=`Team ${tm}`;nt.className=`nc-team ${tm}`;
      $(`av-${s}-l`).textContent=avLetter(p.name);
      $(`av-${s}`).className=`av ${tm}`;
    }
  });
}

function markDealer(dp){
  ['top','left','right','bottom'].forEach(s=>{
    const id=s==='bottom'?'dd-bottom':`dd-${s}`;
    const e=$(id);if(e)e.classList.remove('on');
  });
  if(dp<0)return;
  const s=dp===myPos?'bottom':vslot(dp);
  const id=s==='bottom'?'dd-bottom':`dd-${s}`;
  const e=$(id);if(e)e.classList.add('on');
}

function updateFan(vsl,count){
  const el=$(`fan-${vsl}`);if(!el)return;
  el.innerHTML='';
  for(let i=0;i<Math.min(count,13);i++){
    const d=document.createElement('div');d.className='cb';el.appendChild(d);
  }
}

function updateTricks(tw){
  $('ta').textContent=tw.A;$('tb').textContent=tw.B;
  players.forEach(p=>{
    const s=p.position===myPos?'bottom':vslot(p.position);
    const e=$(`ntr-${s}`);if(e)e.textContent=`${tw[teamOf(p.position)]} tricks`;
  });
}

function updateHUD(){
  $('sc-a').textContent=scores.A;$('sc-b').textContent=scores.B;
  $('h-round').textContent=`Round ${roundNum}`;
  $('h-target').textContent=`Target: ${matchTarget}`;
}

// ── Dealing animation ───────────────────────────────
function showDealAnim(dealerName,firstActiveName){
  const ov=$('deal-ov');if(!ov)return;
  $('do-title').textContent=`${dealerName} is dealing…`;
  $('do-sub').textContent=`${firstActiveName} starts the bidding`;
  const row=$('do-row');row.innerHTML='';
  for(let i=0;i<8;i++){const d=document.createElement('div');d.className='do-c';d.style.animationDelay=`${i*70}ms`;row.appendChild(d);}
  ov.classList.add('show');setTimeout(()=>ov.classList.remove('show'),2200);
}

// ── Seats grid ──────────────────────────────────────
function renderSeats(ps){
  const grid=$('seats-grid');if(!grid)return;
  grid.innerHTML='';
  for(let i=0;i<4;i++){
    const p=ps.find(pl=>pl.position===i);
    const isMe=p&&p.position===myPos;
    const div=document.createElement('div');
    div.className=`seat-tile${p?' full':''}${isMe?' me':''}`;
    if(p){
      const tm=teamOf(i);
      div.innerHTML=`<div class="s-av ${tm}">${avLetter(p.name)}</div>
        <div class="s-info">
          <div class="s-num">Seat ${i+1}${isMe?' ★':''}</div>
          <div class="s-name">${p.name}</div>
        </div>
        <span class="s-badge ${tm}">Team ${tm}</span>`;
    }else{
      div.innerHTML=`<div class="s-av empty">＋</div>
        <div class="s-info">
          <div class="s-num">Seat ${i+1}</div>
          <div class="s-name" style="opacity:.3">Empty</div>
        </div>`;
    }
    if(!isMe)div.addEventListener('click',()=>socket.emit('swapSeat',{targetPos:i}));
    grid.appendChild(div);
  }
  const cnt=ps.length;
  $('wait-note').textContent=cnt<4?`Waiting… (${cnt}/4)`:'All 4 players ready!';
  const sb=$('start-btn');
  if(sb)sb.disabled=cnt<4||!amHost;
  const sbox=$('sbox');
  if(sbox)sbox.style.display=amHost?'block':'none';
}

// ── Bid panel ───────────────────────────────────────
function openBidPanel(current,canPass,hand){
  $('bid-info').textContent=current>0
    ?`Current bid: ${current} — bid higher or pass`
    :'No bid yet — open the bidding!';
  [7,8,9].forEach(n=>{$(`b${n}`).disabled=(n<=current);});
  const nb=$('bnil');nb.disabled=!canPass;nb.textContent=canPass?'Pass (Nil)':'You MUST bid!';
  const logEl=$('blog');logEl.innerHTML='';
  bidLog.forEach(e=>{
    const d=document.createElement('div');d.className='be';
    d.innerHTML=`${e.name}: ${e.bid==='nil'?'<span style="opacity:.5">Pass</span>':`<span class="bv">${e.bid}</span>`}`;
    logEl.appendChild(d);
  });
  const hp=$('hp-cards');hp.innerHTML='';
  if(hand)hand.forEach(c=>hp.appendChild(mkCard(c)));
  showOv('ov-bid');sfxBid();
}
function placeBid(bid){socket.emit('makeBid',{bid});hideOv('ov-bid');}

// ── Power card panel ─────────────────────────────────
function openPowerPanel(hand){
  const c=$('pwr-hand');c.innerHTML='';
  hand.forEach(card=>{
    const el=mkCard(card,'mc');el.style.marginLeft='0';
    el.addEventListener('click',()=>{
      socket.emit('choosePowerCard',{cardId:card.id});
      hideOv('ov-power');toast('Power card placed face-down 🂠');sfxDeal();
    });
    c.appendChild(el);
  });
  showOv('ov-power');
}

// ── Round end ────────────────────────────────────────
function openRoundEnd(data){
  const{roundScore,totalScores,message,powerCard}=data;
  $('re-title').textContent=`Round ${roundNum} Over`;
  $('re-msg').textContent=message;
  if(powerCard){
    $('re-pc').innerHTML='';$('re-pc').appendChild(mkCard(powerCard));
    $('re-pv').style.display='flex';
  }else{$('re-pv').style.display='none';}
  ['a','b'].forEach(t=>{
    const T=t.toUpperCase(),v=roundScore[T];
    const el=$(`re-r${t}`);el.textContent=v>=0?`+${v}`:`${v}`;
    el.className=`sv ${v>0?'plus':v<0?'minus':''}`;
    $(`re-t${t}`).textContent=`Total: ${totalScores[T]}`;
  });
  $('re-ri').textContent='';showOv('ov-round');
}
function onReadyNext(){socket.emit('readyForNextRound');$('re-ri').textContent='Waiting for others…';}

// ── Lobby ────────────────────────────────────────────
function onCreateRoom(){
  const n=$('inp-name').value.trim();
  if(!n){$('lerr').textContent='Please enter your name';sfxErr();return;}
  $('lerr').textContent='';socket.emit('createRoom',{name:n});
}
function onJoinRoom(){
  const n=$('inp-namej').value.trim(),c=$('inp-code').value.trim().toUpperCase();
  if(!n){$('lerr').textContent='Please enter your name';sfxErr();return;}
  if(c.length<4){$('lerr').textContent='Enter a valid room code';sfxErr();return;}
  $('lerr').textContent='';socket.emit('joinRoom',{name:n,code:c});
}
function onStartGame(){socket.emit('startGame');}
function onRestartGame(){socket.emit('restartGame');}
function copyCode(){navigator.clipboard?.writeText($('disp-code').textContent).then(()=>toast('Code copied! 📋'));}
function selectTarget(v){
  socket.emit('setTarget',{target:v});
  $('t30').classList.toggle('sel',v===30);
  $('t50').classList.toggle('sel',v===50);
}

// ── Drag-and-drop on table ────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  const tbl=$('table');
  if(tbl){
    tbl.addEventListener('dragover',e=>{if(isMyTurn&&dragId)e.preventDefault();});
    tbl.addEventListener('drop',e=>{
      e.preventDefault();
      const cid=e.dataTransfer.getData('text/plain')||dragId;
      if(cid&&isMyTurn&&validIds.includes(cid))socket.emit('playCard',{cardId:cid});
    });
  }
  const ci=$('inp-code');
  if(ci)ci.addEventListener('input',e=>e.target.value=e.target.value.toUpperCase());
});

document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  const a=document.querySelector('.screen.active');if(!a)return;
  if(a.id==='screen-lobby'){
    if(['inp-code','inp-namej'].includes(document.activeElement?.id))onJoinRoom();
    else onCreateRoom();
  }
});

// ══════════════════════════════════════════════════
//  SOCKET EVENTS
// ══════════════════════════════════════════════════
socket.on('roomCreated',({code,position,players:ps,isHost})=>{
  myPos=position;players=ps;amHost=isHost;
  $('disp-code').textContent=code;
  renderSeats(ps);showScreen('screen-waiting');
  toast(`Room created! Code: ${code}`);
});
socket.on('roomJoined',({code,position,players:ps,isHost})=>{
  myPos=position;players=ps;amHost=isHost;
  $('disp-code').textContent=code;
  renderSeats(ps);showScreen('screen-waiting');
  toast(`Joined room ${code}!`);
});
socket.on('playerJoined',({players:ps})=>{
  players=ps;renderSeats(ps);sfxDeal();
  toast(`${ps[ps.length-1].name} joined!`);
});
socket.on('allReady',({players:ps})=>{
  players=ps;renderSeats(ps);
  toast(amHost?'All 4 ready! You can start.':'All 4 players ready!');
});
socket.on('targetSet',({target})=>{
  matchTarget=target;
  $('t30')?.classList.toggle('sel',target===30);
  $('t50')?.classList.toggle('sel',target===50);
  toast(`Target: ${target} pts`);
});
socket.on('yourPosition',({position})=>{
  myPos=position;renderSeats(players);
});
socket.on('seatsUpdated',({players:ps})=>{
  players=ps;renderSeats(ps);toast('Seats updated!');sfxDeal();
});
socket.on('gameReset',({players:ps})=>{
  players=ps;myHand=[];validIds=[];isMyTurn=false;
  trumpSuit=null;trumpRevealed=false;scores={A:0,B:0};bidLog=[];
  hideAllOv();showScreen('screen-waiting');renderSeats(ps);
  toast('Game reset');
});

// Round start
socket.on('roundBegin',({roundNumber:rn,scores:sc,players:ps,matchTarget:mt,
  dealerPos:dp,dealerName,firstActiveName})=>{
  roundNum=rn;scores=sc;matchTarget=mt;players=ps;dealerPos=dp;
  myHand=[];validIds=[];isMyTurn=false;
  trumpSuit=null;trumpRevealed=false;leadSuit=null;
  bidLog=[];handCounts={0:0,1:0,2:0,3:0};
  hideAllOv();showScreen('screen-game');
  clearTricks();updateHUD();renderPlayers(ps);markDealer(dp);
  updateTricks({A:0,B:0});updateTrumpPanel();setRevealBtn(false);
  $('tn').textContent='Trick 1/13';
  $('status').textContent='Dealing cards…';
  setActiveAv(-1);
  players.forEach(p=>{if(p.position!==myPos)updateFan(vslot(p.position),0);});
  showDealAnim(dealerName,firstActiveName);sfxDeal();
});
socket.on('handUpdate',({hand,dealPhase})=>{
  myHand=hand;handCounts[myPos]=hand.length;
  renderHand(dealPhase==='initial');
});

// Calling
socket.on('callingStarted',({callerPos,callerName})=>{
  setActiveAv(callerPos);$('status').textContent=`${callerName} is deciding bid…`;
});
socket.on('callingTurn',({callerPos,callerName,currentBid:cb})=>{
  currentBid=cb;setActiveAv(callerPos);$('status').textContent=`${callerName} is deciding bid…`;
});
socket.on('yourCallingTurn',({currentBid:cb,canPass,hand})=>{
  currentBid=cb;openBidPanel(cb,canPass,hand);
});
socket.on('bidEvent',({type,pos,name,bid})=>{
  if(type==='pass'){bidLog.push({name,bid:'nil'});toast(`${name} passed`);$('status').textContent=`${name} passed`;}
  else if(type==='bid'){bidLog.push({name,bid});currentBid=bid;currentBidder=pos;toast(`${name} bid ${bid}!`);sfxBid();$('status').textContent=`${name} bid ${bid}`;}
  else if(type==='cardReturned')toast(`${name}'s power card returned`);
});
socket.on('powerCardReturned',()=>toast('Your power card was returned'));
socket.on('selectPowerCard',({hand})=>{myHand=hand;renderHand();openPowerPanel(hand);});
socket.on('powerCardPlaced',({bidderPos,bidderName,bid})=>{
  currentBidder=bidderPos;
  $('status').textContent=`${bidderName} placed power card (bid:${bid})`;
  toast(`${bidderName} placed power card`);
});
socket.on('callingDone',({bidder,bidderName,bid})=>{
  currentBidder=bidder;
  $('status').textContent=`${bidderName} wins bid at ${bid}`;
  toast(`${bidderName} wins bid at ${bid}!`);
});

// Dealing
socket.on('fullHandDealt',({hand,bidder,bid,powerCardSuit})=>{
  myHand=hand;
  for(let i=0;i<4;i++)handCounts[i]=13;
  handCounts[bidder]=12;
  players.forEach(p=>{if(p.position!==myPos)updateFan(vslot(p.position),handCounts[p.position]);});
  renderHand(true);sfxDeal();
  if(myPos===bidder&&powerCardSuit)
    toast(`Your power card: ${SYM[powerCardSuit]} ${powerCardSuit} — secret!`,3500);
});
socket.on('dealingComplete',({bidderName,bid})=>{
  $('status').textContent=`${bidderName} bid ${bid}. Game starting!`;
});

// Playing
socket.on('playingStarted',({currentPlayer:cp,currentPlayerName,trickNumber})=>{
  setActiveAv(cp);$('status').textContent=`${currentPlayerName} leads Trick 1`;
  $('tn').textContent=`Trick ${trickNumber}/13`;
});
socket.on('turnChanged',({currentPlayer:cp,currentPlayerName})=>{
  setActiveAv(cp);
  if(cp!==myPos){
    isMyTurn=false;validIds=[];setRevealBtn(false);renderHand();
    $('status').textContent=`${currentPlayerName}'s turn`;
  }
});
socket.on('yourTurn',({validCardIds:vids,leadSuit:ls,trumpSuit:ts,trumpRevealed:tr,canRevealTrump:cr})=>{
  isMyTurn=true;validIds=vids;leadSuit=ls;
  if(tr){trumpSuit=ts;trumpRevealed=tr;updateTrumpPanel();}
  setRevealBtn(!!cr);renderHand();
  $('status').textContent=cr
    ?'No running suit! Play any card or Reveal Trump'
    :ls?`Follow ${SYM[ls]} ${ls}`:'Lead any card';
});
socket.on('cardPlayed',({position,name,card})=>{
  setTrick(position,card);
  if(position!==myPos){
    handCounts[position]=Math.max(0,(handCounts[position]||0)-1);
    updateFan(vslot(position),handCounts[position]);
  }
  sfxCard();
});
socket.on('trumpRevealed',({trumpSuit:ts,powerCard,revealedByName})=>{
  trumpSuit=ts;trumpRevealed=true;
  revealTrumpPanel(powerCard);sfxTrump();
  toast(`🔮 ${revealedByName} revealed Trump: ${SYM[ts]} ${ts}!`,3000);
  $('status').textContent=`Trump: ${SYM[ts]} ${ts} revealed!`;
});
socket.on('trickComplete',({winnerPos,winnerName,winnerTeam,tricksWon,trickNumber})=>{
  sfxWin();updateTricks(tricksWon);
  $('status').textContent=`${winnerName} (Team ${winnerTeam}) wins trick ${trickNumber}!`;
  toast(`${winnerName} wins trick ${trickNumber}! 🎉`,2000);
});
socket.on('newTrickStarting',({trickNumber,leader,leaderName})=>{
  clearTricks();leadSuit=null;
  $('tn').textContent=`Trick ${trickNumber}/13`;
  $('status').textContent=`${leaderName} leads Trick ${trickNumber}`;
  setRevealBtn(false);
});
socket.on('roundEnd',data=>{
  scores=data.totalScores;updateHUD();
  updateTricks(data.tricksWon);
  isMyTurn=false;validIds=[];setRevealBtn(false);renderHand();
  openRoundEnd(data);
});
socket.on('readyCount',({ready,total})=>{
  const e=$('re-ri');if(e)e.textContent=`${ready}/${total} ready…`;
});
socket.on('gameOver',({winner,scores:sc})=>{
  hideAllOv();scores=sc;updateHUD();
  $('go-a').textContent=sc.A;$('go-b').textContent=sc.B;
  const b=$('win-ban');b.textContent=`Team ${winner} Wins!`;b.className=`win-ban ${winner}`;
  sfxGame();showScreen('screen-gameover');
});
socket.on('playerLeft',({name})=>toast(`⚠ ${name} left`,3500));
socket.on('err',msg=>{
  sfxErr();toast(`⚠ ${msg}`,3000);
  const le=$('lerr');if(le)le.textContent=msg;
  const we=$('werr');if(we)we.textContent=msg;
});
