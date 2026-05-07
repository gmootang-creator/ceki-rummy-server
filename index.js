import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  SafeAreaView, TextInput, ActivityIndicator, Animated,
  Vibration, Platform, AppState
} from 'react-native';

const SERVER_URL = 'wss://ceki-rummy-server-production.up.railway.app';

const C = {
  bg:'#1a0533',bg2:'#2d0f4e',gold:'#F59E0B',gold2:'#D97706',
  green:'#10B981',green2:'#064E3B',red:'#EF4444',blue:'#3B82F6',
  purple:'#8B5CF6',text:'#F3F4F6',textDim:'#9CA3AF',textFaint:'#6B7280',
  border:'#4C1D95',success:'#065F46',successBorder:'#10B981',
};

const SUITS=['♠','♥','♦','♣'];
const RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const RANK_VAL={A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13};
const SUIT_COLORS={'♠':'#1E293B','♥':'#EF4444','♦':'#EF4444','♣':'#1E293B','*':'#8B5CF6'};

function isJoker(c){return c.r==='JKR';}
function suitColor(c){return SUIT_COLORS[c.s]||'#1E293B';}
function isValidSet(cards){
  const n=cards.length;
  if(n<3||n>4)return false;
  const nonJ=cards.filter(c=>!isJoker(c));
  const j=n-nonJ.length;
  if(nonJ.length===0)return true;
  if(nonJ.every(c=>c.r===nonJ[0].r))return true;
  if(!nonJ.every(c=>c.s===nonJ[0].s))return false;
  const vals=nonJ.map(c=>RANK_VAL[c.r]).sort((a,b)=>a-b);
  const span=vals[vals.length-1]-vals[0]+1;
  return span<=n&&(span-nonJ.length)<=j;
}
function setsComplete(sets){
  const f=sets.filter(Boolean);
  if(f.length!==3)return false;
  const sz=f.map(s=>s.length).sort();
  return sz[0]===3&&sz[1]===3&&sz[2]===4;
}
function buildDeck(){
  const d=[];let i=0;
  for(const s of SUITS)for(const r of RANKS)d.push({id:`${r}${s}${i++}`,r,s});
  d.push({id:'JKR',r:'JKR',s:'*'});
  return d;
}
function shuffle(a){
  const b=[...a];
  for(let i=b.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [b[i],b[j]]=[b[j],b[i]];
  }
  return b;
}

function CardFace({card,selected,isMove,onPress,onLongPress,small}){
  const scale=useRef(new Animated.Value(1)).current;
  useEffect(()=>{
    Animated.spring(scale,{toValue:selected?1.15:isMove?1.08:1,useNativeDriver:true,friction:6}).start();
  },[selected,isMove]);
  const size=small?{width:38,height:52}:{width:56,height:78};
  const rankSize=small?11:15;
  const suitSize=small?13:20;
  return(
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress} activeOpacity={0.8}>
      <Animated.View style={[st.card,size,selected&&st.cardSel,isMove&&st.cardMove,{transform:[{scale}]}]}>
        {isJoker(card)?(
          <><Text style={{fontSize:rankSize+2,fontWeight:'800',color:'#8B5CF6'}}>★</Text><Text style={{fontSize:rankSize-2,color:'#8B5CF6'}}>WILD</Text></>
        ):(
          <><Text style={{fontSize:rankSize,fontWeight:'800',color:suitColor(card)}}>{card.r}</Text><Text style={{fontSize:suitSize,color:suitColor(card)}}>{card.s}</Text></>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

function CardBack({small}){
  const size=small?{width:32,height:44}:{width:44,height:62};
  return(
    <View style={[st.cardBack,size]}>
      <View style={st.cardBackInner}>
        <Text style={st.cardBackLogo}>R</Text>
      </View>
    </View>
  );
}

const CHAT_MESSAGES=['👋 Hey!','😂 Lol','😤 Lucky!','🎉 Nice!','😮 Wow!','🤔 Hmm...','👍 GG!','😈 Watch out!','🃏 Let\'s go!','🏆 I\'m winning!'];

export default function App(){
  const [screen,setScreen]=useState('lobby');
  const [mode,setMode]=useState(5);
  const [playerName,setPlayerName]=useState('');
  const [joinCode,setJoinCode]=useState('');
  const [roomCode,setRoomCode]=useState('');
  const [connecting,setConnecting]=useState(false);
  const [connError,setConnError]=useState('');
  const [onlineState,setOnlineState]=useState(null);
  const [localHand,setLocalHand]=useState([]);
  const [selIds,setSelIds]=useState([]);
  const [moveIdx,setMoveIdx]=useState(null);
  const [msg,setMsg]=useState('');
  const [roundOver,setRoundOver]=useState(null);
  const [game,setGame]=useState(null);
  const [chatMsgs,setChatMsgs]=useState([]);
  const [showChat,setShowChat]=useState(false);
  const [newMsg,setNewMsg]=useState(false);
  const [timeLeft,setTimeLeft]=useState(60);
  const [showRejoin,setShowRejoin]=useState(false);
  const [lastRoomCode,setLastRoomCode]=useState('');
  const [lastPlayerName,setLastPlayerName]=useState('');
  const wsRef=useRef(null);
  const heartbeatRef=useRef(null);
  const turnTimerRef=useRef(null);
  const appState=useRef(AppState.currentState);
  const titleScale=useRef(new Animated.Value(0)).current;
  const fadeAnim=useRef(new Animated.Value(0)).current;

  useEffect(()=>{
    Animated.parallel([
      Animated.spring(titleScale,{toValue:1,friction:4,useNativeDriver:true}),
      Animated.timing(fadeAnim,{toValue:1,duration:800,useNativeDriver:true}),
    ]).start();
  },[]);

  useEffect(()=>{
    const sub=AppState.addEventListener('change',next=>{
      if(appState.current.match(/inactive|background/)&&next==='active'){
        if(wsRef.current&&wsRef.current.readyState!==WebSocket.OPEN&&lastRoomCode){
          setShowRejoin(true);
        }
      }
      appState.current=next;
    });
    return()=>sub.remove();
  },[lastRoomCode]);

  useEffect(()=>{
    return()=>{clearAllTimers();closeWS();};
  },[]);

  const clearAllTimers=()=>{
    if(heartbeatRef.current)clearInterval(heartbeatRef.current);
    if(turnTimerRef.current)clearInterval(turnTimerRef.current);
  };

  const closeWS=()=>{
    if(wsRef.current){
      wsRef.current.onmessage=null;
      wsRef.current.onclose=null;
      wsRef.current.onerror=null;
      try{wsRef.current.close();}catch(e){}
      wsRef.current=null;
    }
    clearAllTimers();
  };

  const startTurnTimer=()=>{
    if(turnTimerRef.current)clearInterval(turnTimerRef.current);
    setTimeLeft(60);
    turnTimerRef.current=setInterval(()=>{
      setTimeLeft(t=>{if(t<=1){clearInterval(turnTimerRef.current);return 0;}return t-1;});
    },1000);
  };

  const stopTurnTimer=()=>{
    if(turnTimerRef.current)clearInterval(turnTimerRef.current);
    setTimeLeft(60);
  };

  const vibrate=useCallback((pattern='light')=>{
    try{
      if(Platform.OS==='web')return;
      if(pattern==='heavy')Vibration.vibrate([0,50,30,50]);
      else if(pattern==='success')Vibration.vibrate([0,30,20,30,20,30]);
      else Vibration.vibrate(40);
    }catch(e){}
  },[]);

  const connectWS=(onOpen)=>{
    closeWS();
    setConnecting(true);setConnError('');
    try{
      const ws=new WebSocket(SERVER_URL);
      wsRef.current=ws;
      ws.onopen=()=>{
        setConnecting(false);
        heartbeatRef.current=setInterval(()=>{
          if(ws.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify({type:'PING'}));}catch(e){}}
        },25000);
        onOpen(ws);
      };
      ws.onmessage=(e)=>{try{const d=JSON.parse(e.data);if(d.type==='PONG')return;handleServerMsg(d);}catch(err){}};
      ws.onerror=()=>{setConnecting(false);setConnError('Connection error.');};
      ws.onclose=()=>{
        setConnecting(false);
        clearInterval(heartbeatRef.current);
        if(screen==='online-game'||screen==='waiting'){
          setShowRejoin(true);
          setMsg('⚠️ Connection lost. Tap Rejoin Game to reconnect.');
        }
      };
    }catch(e){setConnecting(false);setConnError('Connection failed.');}
  };

  const handleServerMsg=(data)=>{
    if(!data||!data.type)return;
    if(data.type==='ROOM_CREATED'){
      setRoomCode(data.code);
      setLastRoomCode(data.code);
      setScreen('waiting');
    }
    else if(data.type==='GAME_START'){
      setRoundOver(null);setSelIds([]);setMoveIdx(null);setChatMsgs([]);
      setMsg('Game starting...');stopTurnTimer();setShowRejoin(false);
    }
    else if(data.type==='GAME_STATE'){
      setOnlineState(data);
      setLocalHand(h=>{
        const sIds=data.yourHand.map(c=>c.id);
        const kept=h.filter(c=>sIds.includes(c.id));
        const kIds=kept.map(c=>c.id);
        const newCards=data.yourHand.filter(c=>!kIds.includes(c.id));
        return[...kept,...newCards];
      });
      if(data.turn==='yours'){
        setMsg(data.phase==='draw'?'Your turn — tap DECK or DISCARD':'Select cards or discard to end turn');
        startTurnTimer();vibrate('light');
      } else {
        setMsg("Waiting for opponent's move...");stopTurnTimer();
      }
      setScreen('online-game');
    }
    else if(data.type==='ROUND_OVER'){
      stopTurnTimer();setRoundOver(data);setSelIds([]);setMoveIdx(null);
      if(data.winner==='you')vibrate('success');
      else if(data.winner==='opponent')vibrate('heavy');
    }
    else if(data.type==='CHAT'){
      setChatMsgs(m=>[...m,{text:data.text,isMe:false}]);setNewMsg(true);vibrate('light');
    }
    else if(data.type==='OPPONENT_DISCONNECTED'){
      setMsg('⚠️ '+data.name+' disconnected. They have 5 mins to rejoin.');
      vibrate('heavy');
    }
    else if(data.type==='OPPONENT_RECONNECTED'){
      setMsg('✅ '+data.name+' reconnected! Game resuming...');vibrate('success');
    }
    else if(data.type==='ERROR'){
      setMsg('❌ '+data.msg);setConnError(data.msg);setConnecting(false);
    }
  };

  const sendWS=(data)=>{
    try{
      if(wsRef.current&&wsRef.current.readyState===WebSocket.OPEN){
        wsRef.current.send(JSON.stringify(data));
      } else {
        setMsg('⚠️ Connection lost. Tap Rejoin Game.');
        setShowRejoin(true);
      }
    }catch(e){setMsg('⚠️ Send failed.');}
  };

  const createRoom=()=>{
    if(!playerName.trim()){setConnError('Enter your name first');return;}
    setLastPlayerName(playerName.trim());
    connectWS(ws=>{ws.send(JSON.stringify({type:'CREATE_ROOM',name:playerName.trim(),totalGames:mode}));});
  };

  const joinRoom=()=>{
    if(!playerName.trim()){setConnError('Enter your name first');return;}
    if(!joinCode.trim()){setConnError('Enter a room code');return;}
    setLastPlayerName(playerName.trim());
    setLastRoomCode(joinCode.trim().toUpperCase());
    connectWS(ws=>{ws.send(JSON.stringify({type:'JOIN_ROOM',code:joinCode.trim().toUpperCase(),name:playerName.trim()}));});
  };

  const rejoinGame=()=>{
    if(!lastRoomCode||!lastPlayerName){setConnError('No previous game found.');return;}
    connectWS(ws=>{ws.send(JSON.stringify({type:'REJOIN',code:lastRoomCode,name:lastPlayerName}));});
  };

  const tapCard=(id)=>{
    if(!onlineState||onlineState.turn!=='yours'||onlineState.phase!=='action')return;
    vibrate('light');
    setSelIds(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  };

  const longPressCard=(idx)=>{vibrate('light');setMoveIdx(m=>m===idx?null:idx);};

  const moveLeft=()=>{
    if(moveIdx===null||moveIdx===0)return;
    vibrate('light');
    setLocalHand(h=>{const n=[...h];[n[moveIdx],n[moveIdx-1]]=[n[moveIdx-1],n[moveIdx]];return n;});
    setMoveIdx(m=>m-1);
  };

  const moveRight=()=>{
    if(moveIdx===null||moveIdx>=localHand.length-1)return;
    vibrate('light');
    setLocalHand(h=>{const n=[...h];[n[moveIdx],n[moveIdx+1]]=[n[moveIdx+1],n[moveIdx]];return n;});
    setMoveIdx(m=>m+1);
  };

  // ── AI GAME ──
  const startAiGame=(prev)=>{
    const pool=prev?[...prev.deck,...prev.discard,...prev.playerHand,...prev.aiHand,...prev.playerSets.filter(Boolean).flat(),...prev.aiSets.filter(Boolean).flat()]:[];
    const fresh=shuffle(buildDeck());
    const deck=pool.length>0?[...fresh,...shuffle(pool)]:fresh;
    const winner=prev?prev.roundWinner:null;
    const playerHand=deck.splice(0,winner==='player'?11:10);
    const aiHand=deck.splice(0,winner==='ai'?11:10);
    const starter=winner||(Math.random()<0.5?'player':'ai');
    const g={deck,discard:[],playerHand,aiHand,playerSets:[null,null,null],aiSets:[null,null,null],scores:prev?prev.scores:{player:0,ai:0},totalGames:prev?prev.totalGames:mode,currentRound:prev?prev.currentRound+1:1,turn:starter,phase:'draw',selIds:[],moveIdx:null,roundWinner:null,msg:starter==='player'?'Your turn — tap DECK or DISCARD':'Opponent goes first...'};
    setGame(g);setScreen('ai-game');
    if(starter==='ai')setTimeout(()=>doAiTurn(g),1200);
  };

  const doAiTurn=(initial)=>{
    setGame(g=>{
      const cur=g||initial;
      if(!cur||cur.turn!=='ai')return cur;
      let deck=[...cur.deck],discard=[...cur.discard],aiHand=[...cur.aiHand],aiSets=[...cur.aiSets];
      if(discard.length>0&&Math.random()<0.4)aiHand.push(discard.pop());
      else if(deck.length>0)aiHand.push(deck.shift());
      else return{...cur,turn:'done',roundWinner:null,msg:"It's a tie!"};
      for(const size of[4,3,3]){
        const f=aiSets.filter(Boolean);
        if(size===4&&f.filter(s=>s.length===4).length>=1)continue;
        if(size===3&&f.filter(s=>s.length===3).length>=2)continue;
        const jokers=aiHand.filter(c=>isJoker(c));
        const byRank={};
        aiHand.filter(c=>!isJoker(c)).forEach(c=>{if(!byRank[c.r])byRank[c.r]=[];byRank[c.r].push(c);});
        for(const r in byRank){
          let set=null;
          if(byRank[r].length>=size)set=byRank[r].slice(0,size);
          else if(byRank[r].length===size-1&&jokers.length>0)set=[...byRank[r],jokers[0]];
          if(set){const slot=aiSets.findIndex(s=>s===null);if(slot>=0){aiSets[slot]=set;aiHand=aiHand.filter(c=>!set.some(s=>s.id===c.id));break;}}
        }
      }
      if(setsComplete(aiSets))return{...cur,aiHand,aiSets,deck,discard,scores:{...cur.scores,ai:cur.scores.ai+1},turn:'done',roundWinner:'ai',msg:'AI wins!'};
      if(aiHand.length>0)discard.push(aiHand.splice(Math.floor(Math.random()*aiHand.length),1)[0]);
      return{...cur,aiHand,aiSets,deck,discard,turn:'player',phase:'draw',selIds:[],moveIdx:null,msg:'Your turn — tap DECK or DISCARD'};
    });
  };

  const aiTapDeck=()=>{vibrate('light');setGame(g=>{if(!g||g.turn!=='player'||g.phase!=='draw'||g.deck.length===0)return g;const card=g.deck[0];return{...g,deck:g.deck.slice(1),playerHand:[...g.playerHand,card],phase:'action',selIds:[],moveIdx:null,msg:'Card drawn!'};});};
  const aiTakeDiscard=()=>{vibrate('light');setGame(g=>{if(!g||g.turn!=='player'||g.phase!=='draw'||g.discard.length===0)return g;const card=g.discard[g.discard.length-1];return{...g,discard:g.discard.slice(0,-1),playerHand:[...g.playerHand,card],phase:'action',selIds:[],moveIdx:null,msg:'Took discard!'};});};
  const aiTapCard=(id)=>{vibrate('light');setGame(g=>{if(!g||g.turn!=='player'||g.phase!=='action')return g;const already=g.selIds.includes(id);return{...g,selIds:already?g.selIds.filter(x=>x!==id):[...g.selIds,id]};});};
  const aiLongPress=(idx)=>{vibrate('light');setGame(g=>{if(!g)return g;return{...g,moveIdx:g.moveIdx===idx?null:idx};});};
  const aiDeclareSet=(size)=>{vibrate('success');setGame(g=>{if(!g)return g;const cards=g.playerHand.filter(c=>g.selIds.includes(c.id));if(cards.length!==size)return{...g,msg:`Select exactly ${size} cards`};if(!isValidSet(cards))return{...g,msg:'❌ Invalid set!'};const f=g.playerSets.filter(Boolean);if(size===4&&f.filter(s=>s.length===4).length>=1)return{...g,msg:'Already have set of 4!'};if(size===3&&f.filter(s=>s.length===3).length>=2)return{...g,msg:'Already have 2 sets of 3!'};const newSets=[...g.playerSets];let slot=-1;if(size===4){slot=newSets[0]===null?0:newSets.findIndex(s=>s===null);}else{const hasFour=newSets.some(s=>s&&s.length===4);if(!hasFour){slot=newSets.findIndex((s,i)=>s===null&&i>0);if(slot===-1)slot=newSets.findIndex(s=>s===null);}else slot=newSets.findIndex(s=>s===null);}if(slot<0)return{...g,msg:'All slots full!'};newSets[slot]=cards;const newHand=g.playerHand.filter(c=>!g.selIds.includes(c.id));const done=setsComplete(newSets);return{...g,playerSets:newSets,playerHand:newHand,selIds:[],moveIdx:null,msg:done?'🎉 All sets done! Press Declare Win!':`Set of ${size} locked in!`};});};
  const aiUndoSet=(idx)=>{setGame(g=>{if(!g||!g.playerSets[idx])return g;const set=g.playerSets[idx];const newSets=[...g.playerSets];newSets[idx]=null;return{...g,playerSets:newSets,playerHand:[...g.playerHand,...set],msg:'Set returned to hand.'};});};
  const aiDiscard=()=>{vibrate('light');setGame(g=>{if(!g||g.selIds.length!==1||g.phase!=='action')return g;const id=g.selIds[0];const card=g.playerHand.find(c=>c.id===id);if(!card)return g;return{...g,playerHand:g.playerHand.filter(c=>c.id!==id),discard:[...g.discard,card],selIds:[],moveIdx:null,turn:'ai',phase:'draw',msg:"Opponent's turn..."};});setTimeout(doAiTurn,1200);};
  const aiDeclareWin=()=>{vibrate('success');setGame(g=>{if(!g||!setsComplete(g.playerSets))return g;return{...g,scores:{...g.scores,player:g.scores.player+1},turn:'done',roundWinner:'player',msg:'You win!'};});};

  // ── SHARED HELPERS ──
  const renderHand=(hand,onTap,onLong,selIdsVal,moveIdxVal,canSelect)=>(
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={st.handRow}>
        {hand.map((c,idx)=>(
          <CardFace key={c.id} card={c}
            selected={selIdsVal.includes(c.id)}
            isMove={moveIdxVal===idx}
            onPress={()=>{if(canSelect)onTap(c.id);}}
            onLongPress={()=>onLong(idx)}
          />
        ))}
      </View>
    </ScrollView>
  );

  const renderMoveButtons=(hand,moveIdxVal,onLeft,onRight,onCancel)=>(
    <View style={[st.row,{marginTop:8,gap:6,flexWrap:'wrap'}]}>
      <Text style={st.dimT}>Long-press then move:</Text>
      <TouchableOpacity style={[st.movBtn,(moveIdxVal===null||moveIdxVal===0)&&{opacity:0.3}]} onPress={onLeft}>
        <Text style={st.movBtnT}>◀</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[st.movBtn,(moveIdxVal===null||moveIdxVal>=hand.length-1)&&{opacity:0.3}]} onPress={onRight}>
        <Text style={st.movBtnT}>▶</Text>
      </TouchableOpacity>
      {moveIdxVal!==null&&<TouchableOpacity style={st.movBtnX} onPress={onCancel}><Text style={st.movBtnT}>✕</Text></TouchableOpacity>}
    </View>
  );

  const renderSets=(sets,onUndo)=>(
    <View style={st.setsZone}>
      <Text style={st.setsTitle}>YOUR SETS <Text style={{fontWeight:'400',fontSize:10,color:C.textFaint}}>(hidden from opponent)</Text></Text>
      {[{label:'Set of 4'},{label:'Set of 3'},{label:'Set of 3'}].map((slot,i)=>(
        <View key={i} style={[st.setSlot,sets[i]&&st.setSlotOn]}>
          <View style={st.row}>
            <Text style={st.setSlotLbl}>{slot.label} {sets[i]?'✓':''}</Text>
            {sets[i]&&<TouchableOpacity style={st.undoBtn} onPress={()=>onUndo(i)}><Text style={st.undoBtnT}>↩ Undo</Text></TouchableOpacity>}
          </View>
          {sets[i]?(
            <View style={[st.row,{flexWrap:'wrap',gap:4,marginTop:6}]}>
              {sets[i].map(c=><CardFace key={c.id} card={c} small onPress={()=>{}}/>)}
            </View>
          ):(
            <Text style={[st.dimT,{marginTop:6}]}>— empty — select cards then declare —</Text>
          )}
        </View>
      ))}
    </View>
  );

  const renderRoundOver=(winner,scores,yourName,oppName,needed,onNext,onRematch,onLeave,winSets)=>(
    <View style={st.roundOverZone}>
      <Text style={st.roundOverEmoji}>{winner==='player'||winner==='you'?'🏆':winner==='tie'?'🤝':'😔'}</Text>
      <Text style={st.roundOverTitle}>
        {winner==='you'||winner==='player'?'You win the round!':winner==='tie'?'It\'s a tie!':'You lose the round!'}
      </Text>
      {winSets&&winSets.filter(Boolean).length>0&&(
        <View style={{marginBottom:12,width:'100%'}}>
          <Text style={st.revealTitle}>{winner==='you'||winner==='player'?'Your winning sets:':'Opponent\'s winning sets:'}</Text>
          {winSets.filter(Boolean).map((set,i)=>(
            <View key={i} style={{marginBottom:8}}>
              <Text style={st.dimT}>{set.length===4?'Set of 4':'Set of 3'}:</Text>
              <View style={[st.row,{flexWrap:'wrap',gap:4,marginTop:4}]}>
                {set.map(c=><CardFace key={c.id} card={c} small onPress={()=>{}}/>)}
              </View>
            </View>
          ))}
        </View>
      )}
      <View style={[st.row,{justifyContent:'center',gap:16,marginBottom:12}]}>
        <View style={st.scoreBox}><Text style={st.scoreBoxN}>{scores[0]}</Text><Text style={st.scoreBoxL}>{yourName}</Text></View>
        <Text style={{fontSize:20,color:C.textFaint}}>–</Text>
        <View style={st.scoreBox}><Text style={st.scoreBoxN}>{scores[1]}</Text><Text style={st.scoreBoxL}>{oppName}</Text></View>
      </View>
      {scores[0]>=needed||scores[1]>=needed?(
        <>
          <Text style={st.seriesWinner}>{scores[0]>scores[1]?'🏆 You win the match!':scores[1]>scores[0]?'😔 Opponent wins the match!':'🤝 Match tied!'}</Text>
          {onRematch&&<TouchableOpacity style={[st.btnDeclare,{marginBottom:8,backgroundColor:C.purple}]} onPress={onRematch}><Text style={st.btnDeclareT}>🔄 Rematch</Text></TouchableOpacity>}
        </>
      ):(
        <TouchableOpacity style={[st.btnDeclare,{marginBottom:8}]} onPress={onNext}><Text style={st.btnDeclareT}>Next Round ▶</Text></TouchableOpacity>
      )}
      <TouchableOpacity style={st.btnOutline} onPress={onLeave}><Text style={st.btnOutlineT}>Leave Game</Text></TouchableOpacity>
    </View>
  );

  const renderRejoinBanner=()=>(
    showRejoin&&lastRoomCode?(
      <View style={st.rejoinBanner}>
        <Text style={st.rejoinTitle}>⚠️ Disconnected from game</Text>
        <Text style={st.rejoinSub}>Room: <Text style={{color:C.gold,fontWeight:'700'}}>{lastRoomCode}</Text></Text>
        {connecting?(
          <ActivityIndicator color={C.gold} style={{marginTop:8}}/>
        ):(
          <TouchableOpacity style={[st.btnGold,{marginTop:8}]} onPress={rejoinGame}>
            <Text style={st.btnGoldT}>🔄 Rejoin Game</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={()=>setShowRejoin(false)}>
          <Text style={[st.dimT,{textAlign:'center',marginTop:8}]}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    ):null
  );

  // ── LOBBY ──
  if(screen==='lobby') return(
    <SafeAreaView style={st.bg}>
      <ScrollView contentContainerStyle={st.lobby}>
        <Animated.View style={{transform:[{scale:titleScale}],opacity:fadeAnim,alignItems:'center',marginBottom:28}}>
          <Text style={st.lobbyTitle}>🃏 RUMIKI</Text>
          <Text style={st.lobbySub}>The ultimate card game</Text>
        </Animated.View>

        {renderRejoinBanner()}

        <View style={st.lobbyCard}>
          <Text style={st.label}>YOUR NAME</Text>
          <TextInput style={st.input} placeholder="Enter your name" placeholderTextColor={C.textFaint} value={playerName} onChangeText={setPlayerName} maxLength={12}/>
          <Text style={st.label}>GAME MODE</Text>
          <View style={st.modeRow}>
            {[3,5,10].map(m=>(
              <TouchableOpacity key={m} style={[st.pill,mode===m&&st.pillOn]} onPress={()=>{vibrate();setMode(m);}}>
                <Text style={[st.pillT,mode===m&&st.pillTOn]}>Best of {m}</Text>
                <Text style={[st.pillS,mode===m&&st.pillSOn]}>First to {Math.ceil(m/2)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {connError?<Text style={st.errT}>{connError}</Text>:null}
        {connecting?<ActivityIndicator color={C.gold} style={{marginBottom:12}}/>:null}

        <Text style={st.sectionHead}>🌐 ONLINE MULTIPLAYER</Text>
        <TouchableOpacity style={st.btnGold} onPress={()=>{vibrate();createRoom();}}>
          <Text style={st.btnGoldT}>➕ Create Room</Text>
        </TouchableOpacity>
        <Text style={st.label}>JOIN WITH CODE</Text>
        <View style={[st.row,{marginBottom:16}]}>
          <TextInput style={[st.input,{flex:1,marginBottom:0}]} placeholder="Room code" placeholderTextColor={C.textFaint} value={joinCode} onChangeText={t=>setJoinCode(t.toUpperCase())} maxLength={4} autoCapitalize="characters"/>
          <TouchableOpacity style={[st.btnGold,{marginBottom:0,marginLeft:8,paddingHorizontal:20,paddingVertical:15}]} onPress={()=>{vibrate();joinRoom();}}>
            <Text style={st.btnGoldT}>Join</Text>
          </TouchableOpacity>
        </View>
        <View style={st.divRow}>
          <View style={st.divLine}/><Text style={st.divT}>or</Text><View style={st.divLine}/>
        </View>
        <Text style={st.sectionHead}>🤖 PLAY VS AI</Text>
        <TouchableOpacity style={st.btnOutline} onPress={()=>{vibrate();startAiGame(null);}}>
          <Text style={st.btnOutlineT}>🎮 Play vs AI</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.btnOutline} onPress={()=>setScreen('rules')}>
          <Text style={st.btnOutlineT}>ℹ️ How to Play</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  // ── WAITING ──
  if(screen==='waiting') return(
    <SafeAreaView style={st.bg}>
      <View style={st.waiting}>
        <Text style={st.lobbyTitle}>🃏 RUMIKI</Text>
        <Text style={st.waitSub}>Share this code:</Text>
        <View style={st.codeBox}><Text style={st.codeText}>{roomCode}</Text></View>
        <ActivityIndicator color={C.gold} size="large" style={{marginTop:24}}/>
        <Text style={st.waitMsg}>Waiting for opponent...</Text>
        <TouchableOpacity style={[st.btnOutline,{marginTop:32}]} onPress={()=>{closeWS();setScreen('lobby');}}>
          <Text style={st.btnOutlineT}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  // ── RULES ──
  if(screen==='rules') return(
    <SafeAreaView style={st.bg}>
      <ScrollView contentContainerStyle={st.lobby}>
        <Text style={st.lobbyTitle}>How to Play</Text>
        {[
          ['🎯 Goal','Complete 3 sets: 1 set of 4 cards AND 2 sets of 3 cards, then declare win.'],
          ['🃏 Deck','52 cards + 1 Joker (wild). Each card exists only once.'],
          ['🔄 Your Turn','1. Tap DECK or DISCARD to draw.\n2. Tap cards to select for sets.\n3. Declare sets anytime.\n4. Tap 1 card then Discard to end turn.'],
          ['✅ Valid Sets','Same rank (e.g. K♠ K♥ K♦) OR same suit consecutive (e.g. 3♥ 4♥ 5♥). Joker fills any gap.'],
          ['🏆 Winning','Fill all 3 slots (1×4 + 2×3) then tap Declare Win. Sets revealed only then!'],
          ['↩ Undo','Tap Undo on any set to return cards to hand.'],
          ['📦 Move','Long-press a card then use ◀ ▶ to reorder anytime.'],
          ['💬 Chat','Tap Chat during online games to send quick messages.'],
          ['🔄 Rejoin','If you lose connection tap Rejoin Game on the lobby screen.'],
          ['⏱ Timer','You have 60 seconds per turn in online games.'],
        ].map(([t,b])=>(
          <View key={t} style={st.ruleCard}>
            <Text style={st.ruleT}>{t}</Text>
            <Text style={st.ruleB}>{b}</Text>
          </View>
        ))}
        <TouchableOpacity style={st.btnGold} onPress={()=>setScreen('lobby')}>
          <Text style={st.btnGoldT}>Got it! Let's play 🃏</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  // ── ONLINE GAME ──
  if(screen==='online-game'&&onlineState){
    const o=onlineState;
    const isMyTurn=o.turn==='yours';
    const inDraw=isMyTurn&&o.phase==='draw';
    const inAction=isMyTurn&&o.phase==='action';
    const topD=o.topDiscard;
    const myFours=o.yourSets.filter(Boolean).filter(s=>s.length===4).length;
    const myThrees=o.yourSets.filter(Boolean).filter(s=>s.length===3).length;
    const sel=selIds.length;
    const needed=Math.ceil(o.totalGames/2);
    const timerColor=timeLeft<=10?C.red:timeLeft<=20?C.gold:C.green;

    return(
      <SafeAreaView style={st.bg}>
        <ScrollView contentContainerStyle={st.gameWrap}>
          {renderRejoinBanner()}

          <View style={st.header}>
            <View style={st.scoreItem}><Text style={st.scoreN}>{o.scores[0]}</Text><Text style={st.scoreLb}>{o.yourName}</Text></View>
            <View style={{alignItems:'center'}}>
              <Text style={st.gameTitle}>RUMIKI</Text>
              <Text style={st.roundBadge}>Best of {o.totalGames} · Need {needed}</Text>
              {isMyTurn&&<View style={[st.timerBadge,{backgroundColor:timerColor+'33',borderColor:timerColor}]}><Text style={[st.timerText,{color:timerColor}]}>⏱ {timeLeft}s</Text></View>}
            </View>
            <View style={st.scoreItem}><Text style={st.scoreN}>{o.scores[1]}</Text><Text style={st.scoreLb}>{o.oppName}</Text></View>
          </View>

          <View style={st.oppZone}>
            <View style={st.row}>
              <Text style={st.oppTitle}>{o.oppName}</Text>
              {!isMyTurn&&<View style={st.thinkingBadge}><Text style={st.thinkingText}>🟡 Their turn...</Text></View>}
              <Text style={st.dimT}>{o.oppHandCount} cards</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={st.handRow}>{Array(Math.min(o.oppHandCount,13)).fill(0).map((_,i)=><CardBack key={i} small/>)}</View>
            </ScrollView>
            <View style={[st.row,{marginTop:8,gap:6}]}>
              <View style={[st.badge,o.oppSetsFours>=1&&st.badgeDone]}><Text style={st.badgeT}>{o.oppSetsFours>=1?'✓ ':''}Set of 4</Text></View>
              <View style={[st.badge,o.oppSetsThrees>=2&&st.badgeDone,o.oppSetsThrees===1&&st.badgeHalf]}><Text style={st.badgeT}>{o.oppSetsThrees}/2 Sets of 3</Text></View>
            </View>
          </View>

          <View style={[st.row,{gap:10,marginBottom:10,alignItems:'flex-start'}]}>
            <View style={{alignItems:'center'}}>
              <Text style={st.pileLabel}>DECK</Text>
              <TouchableOpacity style={[st.deckPile,inDraw&&st.pileGlow]} onPress={()=>{vibrate();sendWS({type:'DRAW_DECK'});}}>
                <CardBack/>
                <View style={st.deckCount}><Text style={st.deckCountText}>{o.deckCount}</Text></View>
              </TouchableOpacity>
              {inDraw&&<Text style={st.tapHint}>tap to draw</Text>}
            </View>
            <View style={{alignItems:'center'}}>
              <Text style={st.pileLabel}>DISCARD</Text>
              {topD?(
                <TouchableOpacity style={[st.discardPile,inDraw&&st.pileGlow]} onPress={()=>{vibrate();sendWS({type:'TAKE_DISCARD'});}}>
                  <CardFace card={topD} onPress={()=>{}}/>
                </TouchableOpacity>
              ):(
                <View style={st.emptyPile}><Text style={st.dimT}>empty</Text></View>
              )}
              {inDraw&&topD&&<Text style={st.tapHint}>tap to take</Text>}
            </View>
            <View style={st.msgBox}><Text style={st.msgText}>{msg}</Text></View>
          </View>

          <View style={st.playerZone}>
            <View style={st.row}>
              <Text style={st.playerTitle}>Your Hand ({localHand.length})</Text>
              {isMyTurn&&<View style={st.yourTurnBadge}><Text style={st.yourTurnText}>YOUR TURN</Text></View>}
            </View>
            <Text style={st.dimT}>Tap = select · Long-press = move (anytime)</Text>
            {renderHand(localHand,tapCard,longPressCard,selIds,moveIdx,inAction)}
            {renderMoveButtons(localHand,moveIdx,moveLeft,moveRight,()=>setMoveIdx(null))}
            {sel>0&&<Text style={st.selInfo}>{sel} selected{sel===3?' — ready for Set of 3':sel===4?' — ready for Set of 4':sel===1?' — discard to end turn':''}</Text>}
            <View style={{marginTop:10,gap:8}}>
              {inAction&&sel===4&&myFours<1&&<TouchableOpacity style={st.btnDeclare} onPress={()=>{vibrate('success');sendWS({type:'DECLARE_SET',cardIds:selIds,setSize:4});setSelIds([]);}}><Text style={st.btnDeclareT}>✓ Declare Set of 4</Text></TouchableOpacity>}
              {inAction&&sel===3&&myThrees<2&&<TouchableOpacity style={st.btnDeclare} onPress={()=>{vibrate('success');sendWS({type:'DECLARE_SET',cardIds:selIds,setSize:3});setSelIds([]);}}><Text style={st.btnDeclareT}>✓ Declare Set of 3</Text></TouchableOpacity>}
              {inAction&&sel===1&&<TouchableOpacity style={st.btnDiscard} onPress={()=>{vibrate('light');sendWS({type:'DISCARD_CARD',cardId:selIds[0]});setSelIds([]);setMoveIdx(null);stopTurnTimer();}}><Text style={st.btnDiscardT}>Discard &amp; End Turn</Text></TouchableOpacity>}
              {inAction&&setsComplete(o.yourSets)&&<TouchableOpacity style={st.btnWin} onPress={()=>{vibrate('success');sendWS({type:'DECLARE_WIN'});stopTurnTimer();}}><Text style={st.btnWinT}>🏆 Declare Win!</Text></TouchableOpacity>}
            </View>
            {sel>0&&<TouchableOpacity onPress={()=>setSelIds([])}><Text style={{fontSize:11,color:C.textFaint,textAlign:'center',marginTop:6}}>✕ Clear selection</Text></TouchableOpacity>}
          </View>

          {renderSets(o.yourSets,(i)=>sendWS({type:'UNDO_SET',slotIdx:i}))}

          <View style={st.chatZone}>
            <TouchableOpacity style={st.chatToggle} onPress={()=>{setShowChat(s=>!s);setNewMsg(false);}}>
              <Text style={st.chatToggleT}>💬 Chat {newMsg&&!showChat?'🔴':''}</Text>
            </TouchableOpacity>
            {showChat&&(
              <>
                <View style={st.chatMsgs}>
                  {chatMsgs.length===0?<Text style={[st.dimT,{textAlign:'center',padding:8}]}>No messages yet</Text>:chatMsgs.map((m,i)=>(
                    <View key={i} style={[st.bubble,m.isMe?st.bubbleMe:st.bubbleThem]}>
                      <Text style={[st.bubbleText,m.isMe&&{color:'#1C1917'}]}>{m.text}</Text>
                    </View>
                  ))}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={st.quickMsgs}>
                    {CHAT_MESSAGES.map(m=>(
                      <TouchableOpacity key={m} style={st.quickMsg} onPress={()=>{vibrate('light');sendWS({type:'CHAT',text:m});setChatMsgs(msgs=>[...msgs,{text:m,isMe:true}]);}}>
                        <Text style={st.quickMsgT}>{m}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
          </View>

          {roundOver&&renderRoundOver(roundOver.winner,roundOver.scores,roundOver.yourName,roundOver.oppName,needed,()=>sendWS({type:'NEXT_ROUND'}),()=>sendWS({type:'NEXT_ROUND'}),()=>{closeWS();setScreen('lobby');},roundOver.winnerSets)}

        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── AI GAME ──
  if(screen==='ai-game'&&game){
    const g=game;
    const needed=Math.ceil(g.totalGames/2);
    const isMyTurn=g.turn==='player';
    const inAction=isMyTurn&&g.phase==='action';
    const inDraw=isMyTurn&&g.phase==='draw';
    const topD=g.discard.length>0?g.discard[g.discard.length-1]:null;
    const myFours=g.playerSets.filter(Boolean).filter(s=>s.length===4).length;
    const myThrees=g.playerSets.filter(Boolean).filter(s=>s.length===3).length;
    const sel=g.selIds.length;
    const isRoundOver=g.turn==='done';

    return(
      <SafeAreaView style={st.bg}>
        <ScrollView contentContainerStyle={st.gameWrap}>
          <View style={st.header}>
            <View style={st.scoreItem}><Text style={st.scoreN}>{g.scores.player}</Text><Text style={st.scoreLb}>You</Text></View>
            <View style={{alignItems:'center'}}><Text style={st.gameTitle}>RUMIKI</Text><Text style={st.roundBadge}>Best of {g.totalGames} · Need {needed}</Text></View>
            <View style={st.scoreItem}><Text style={st.scoreN}>{g.scores.ai}</Text><Text style={st.scoreLb}>AI</Text></View>
          </View>

          <View style={st.oppZone}>
            <View style={st.row}>
              <Text style={st.oppTitle}>AI Opponent</Text>
              {g.turn==='ai'&&<View style={st.thinkingBadge}><Text style={st.thinkingText}>🟡 Thinking...</Text></View>}
              <Text style={st.dimT}>{g.aiHand.length} cards</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={st.handRow}>{g.aiHand.map(c=><CardBack key={c.id} small/>)}</View>
            </ScrollView>
            <View style={[st.row,{marginTop:8,gap:6}]}>
              {(()=>{const af=g.aiSets.filter(Boolean);const af4=af.filter(s=>s.length===4).length;const af3=af.filter(s=>s.length===3).length;return(<><View style={[st.badge,af4>=1&&st.badgeDone]}><Text style={st.badgeT}>{af4>=1?'✓ ':''}Set of 4</Text></View><View style={[st.badge,af3>=2&&st.badgeDone,af3===1&&st.badgeHalf]}><Text style={st.badgeT}>{af3}/2 Sets of 3</Text></View></>);})()}
            </View>
          </View>

          <View style={[st.row,{gap:10,marginBottom:10,alignItems:'flex-start'}]}>
            <View style={{alignItems:'center'}}>
              <Text style={st.pileLabel}>DECK</Text>
              <TouchableOpacity style={[st.deckPile,inDraw&&st.pileGlow]} onPress={aiTapDeck}>
                <CardBack/>
                <View style={st.deckCount}><Text style={st.deckCountText}>{g.deck.length}</Text></View>
              </TouchableOpacity>
              {inDraw&&<Text style={st.tapHint}>tap to draw</Text>}
            </View>
            <View style={{alignItems:'center'}}>
              <Text style={st.pileLabel}>DISCARD</Text>
              {topD?(<TouchableOpacity style={[st.discardPile,inDraw&&st.pileGlow]} onPress={aiTakeDiscard}><CardFace card={topD} onPress={aiTakeDiscard}/></TouchableOpacity>):(<View style={st.emptyPile}><Text style={st.dimT}>empty</Text></View>)}
              {inDraw&&topD&&<Text style={st.tapHint}>tap to take</Text>}
            </View>
            <View style={st.msgBox}><Text style={st.msgText}>{g.msg}</Text></View>
          </View>

          <View style={st.playerZone}>
            <View style={st.row}>
              <Text style={st.playerTitle}>Your Hand ({g.playerHand.length})</Text>
              {isMyTurn&&<View style={st.yourTurnBadge}><Text style={st.yourTurnText}>YOUR TURN</Text></View>}
            </View>
            <Text style={st.dimT}>Tap = select · Long-press = move (anytime)</Text>
            {renderHand(g.playerHand,aiTapCard,aiLongPress,g.selIds,g.moveIdx,inAction)}
            {renderMoveButtons(g.playerHand,g.moveIdx,
              ()=>setGame(gg=>{if(!gg||gg.moveIdx===null||gg.moveIdx===0)return gg;const h=[...gg.playerHand];[h[gg.moveIdx],h[gg.moveIdx-1]]=[h[gg.moveIdx-1],h[gg.moveIdx]];return{...gg,playerHand:h,moveIdx:gg.moveIdx-1};}),
              ()=>setGame(gg=>{if(!gg||gg.moveIdx===null||gg.moveIdx>=gg.playerHand.length-1)return gg;const h=[...gg.playerHand];[h[gg.moveIdx],h[gg.moveIdx+1]]=[h[gg.moveIdx+1],h[gg.moveIdx]];return{...gg,playerHand:h,moveIdx:gg.moveIdx+1};}),
              ()=>setGame(g=>({...g,moveIdx:null}))
            )}
            {sel>0&&<Text style={st.selInfo}>{sel} selected{sel===3?' — ready for Set of 3':sel===4?' — ready for Set of 4':sel===1?' — discard to end turn':''}</Text>}
            <View style={{marginTop:10,gap:8}}>
              {inAction&&sel===4&&myFours<1&&<TouchableOpacity style={st.btnDeclare} onPress={()=>aiDeclareSet(4)}><Text style={st.btnDeclareT}>✓ Declare Set of 4</Text></TouchableOpacity>}
              {inAction&&sel===3&&myThrees<2&&<TouchableOpacity style={st.btnDeclare} onPress={()=>aiDeclareSet(3)}><Text style={st.btnDeclareT}>✓ Declare Set of 3</Text></TouchableOpacity>}
              {inAction&&sel===1&&<TouchableOpacity style={st.btnDiscard} onPress={aiDiscard}><Text style={st.btnDiscardT}>Discard &amp; End Turn</Text></TouchableOpacity>}
              {inAction&&setsComplete(g.playerSets)&&<TouchableOpacity style={st.btnWin} onPress={aiDeclareWin}><Text style={st.btnWinT}>🏆 Declare Win!</Text></TouchableOpacity>}
            </View>
            {sel>0&&<TouchableOpacity onPress={()=>setGame(gg=>({...gg,selIds:[]}))}><Text style={{fontSize:11,color:C.textFaint,textAlign:'center',marginTop:6}}>✕ Clear selection</Text></TouchableOpacity>}
          </View>

          {renderSets(g.playerSets,aiUndoSet)}
          {isRoundOver&&renderRoundOver(g.roundWinner,[g.scores.player,g.scores.ai],'You','AI',needed,()=>startAiGame(g),null,()=>setScreen('lobby'),g.roundWinner==='player'?g.playerSets:g.aiSets)}

        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}

const st=StyleSheet.create({
  bg:{flex:1,backgroundColor:C.bg},
  lobby:{padding:20,paddingTop:40,paddingBottom:40},
  lobbyTitle:{fontSize:42,fontWeight:'900',color:C.gold,textAlign:'center',letterSpacing:4,marginBottom:4},
  lobbySub:{fontSize:14,color:C.purple,textAlign:'center',fontWeight:'600'},
  lobbyCard:{backgroundColor:C.bg2,borderRadius:20,padding:16,marginBottom:20,borderWidth:1,borderColor:C.border},
  label:{fontSize:11,fontWeight:'700',color:C.textFaint,letterSpacing:1.5,marginBottom:8},
  sectionHead:{fontSize:14,fontWeight:'700',color:C.text,marginBottom:12,marginTop:4},
  input:{backgroundColor:'#1a0533',borderWidth:1.5,borderColor:C.border,borderRadius:12,padding:14,color:C.text,fontSize:14,marginBottom:16},
  modeRow:{flexDirection:'row',gap:8,marginBottom:4},
  pill:{flex:1,borderWidth:1.5,borderColor:C.border,borderRadius:12,paddingVertical:14,alignItems:'center',backgroundColor:'#1a0533'},
  pillOn:{borderColor:C.gold,backgroundColor:'#2D1F00'},
  pillT:{fontSize:13,fontWeight:'700',color:C.textDim},
  pillTOn:{color:C.gold},
  pillS:{fontSize:10,color:C.textFaint,marginTop:2},
  pillSOn:{color:C.gold2},
  btnGold:{backgroundColor:C.gold,borderRadius:14,paddingVertical:16,alignItems:'center',marginBottom:12},
  btnGoldT:{fontSize:16,fontWeight:'800',color:'#1C1917'},
  btnOutline:{borderWidth:1.5,borderColor:C.purple,borderRadius:14,paddingVertical:14,alignItems:'center',marginBottom:12},
  btnOutlineT:{fontSize:14,color:C.purple,fontWeight:'600'},
  btnDeclare:{backgroundColor:C.green,borderRadius:12,paddingVertical:14,alignItems:'center',marginBottom:4},
  btnDeclareT:{fontSize:15,fontWeight:'800',color:'#fff'},
  btnDiscard:{backgroundColor:C.red,borderRadius:12,paddingVertical:13,alignItems:'center',marginBottom:4},
  btnDiscardT:{fontSize:14,fontWeight:'700',color:'#fff'},
  btnWin:{backgroundColor:C.gold,borderRadius:12,paddingVertical:15,alignItems:'center',marginBottom:4},
  btnWinT:{fontSize:16,fontWeight:'900',color:'#1C1917'},
  errT:{fontSize:13,color:'#FCA5A5',textAlign:'center',marginBottom:10},
  divRow:{flexDirection:'row',alignItems:'center',gap:10,marginVertical:12},
  divLine:{flex:1,height:1,backgroundColor:C.border},
  divT:{color:C.textFaint,fontSize:13},
  row:{flexDirection:'row',alignItems:'center',gap:8},
  ruleCard:{backgroundColor:C.bg2,borderRadius:12,padding:16,marginBottom:10,borderWidth:1,borderColor:C.border},
  ruleT:{fontSize:15,fontWeight:'700',color:C.gold,marginBottom:6},
  ruleB:{fontSize:13,color:C.text,lineHeight:20},
  waiting:{flex:1,alignItems:'center',justifyContent:'center',padding:20},
  waitSub:{fontSize:15,color:C.text,marginTop:12,marginBottom:24},
  waitMsg:{fontSize:13,color:C.textFaint,marginTop:20},
  codeBox:{backgroundColor:C.bg2,borderWidth:3,borderColor:C.gold,borderRadius:20,paddingHorizontal:44,paddingVertical:24},
  codeText:{fontSize:52,fontWeight:'900',color:C.gold,letterSpacing:10},
  gameWrap:{padding:12,paddingTop:8,paddingBottom:40},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:C.bg2,borderRadius:16,padding:14,marginBottom:10,borderWidth:1,borderColor:C.border},
  gameTitle:{fontSize:18,fontWeight:'900',color:C.gold,letterSpacing:2},
  roundBadge:{fontSize:10,color:C.textFaint,marginTop:2},
  timerBadge:{borderRadius:20,paddingHorizontal:10,paddingVertical:3,borderWidth:1,marginTop:4},
  timerText:{fontSize:12,fontWeight:'700'},
  scoreItem:{alignItems:'center',minWidth:50},
  scoreN:{fontSize:26,fontWeight:'900',color:C.gold},
  scoreLb:{fontSize:10,color:C.textDim},
  oppZone:{backgroundColor:C.bg2,borderRadius:16,padding:12,marginBottom:10,borderWidth:1,borderColor:C.border},
  oppTitle:{fontSize:13,fontWeight:'700',color:C.text,flex:1},
  thinkingBadge:{backgroundColor:'#1F2937',borderRadius:20,paddingHorizontal:8,paddingVertical:3},
  thinkingText:{fontSize:11,color:C.gold},
  dimT:{fontSize:11,color:C.textFaint},
  handRow:{flexDirection:'row',gap:5,paddingVertical:6},
  badge:{paddingHorizontal:10,paddingVertical:4,borderRadius:20,backgroundColor:'#1F2937',borderWidth:1,borderColor:C.border},
  badgeDone:{backgroundColor:C.success,borderColor:C.green},
  badgeHalf:{backgroundColor:'#1F4D2E'},
  badgeT:{fontSize:11,color:C.text},
  pileLabel:{fontSize:10,fontWeight:'700',color:C.textFaint,letterSpacing:1,marginBottom:4},
  tapHint:{fontSize:9,color:C.gold,marginTop:2,fontWeight:'600'},
  deckPile:{width:64,height:88,borderRadius:10,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:C.border,position:'relative'},
  discardPile:{borderRadius:10,borderWidth:2,borderColor:C.border},
  pileGlow:{borderColor:C.gold,borderWidth:3},
  emptyPile:{width:64,height:88,borderRadius:10,borderWidth:1.5,borderColor:C.border,borderStyle:'dashed',alignItems:'center',justifyContent:'center'},
  deckCount:{position:'absolute',bottom:4,backgroundColor:'rgba(0,0,0,0.7)',borderRadius:8,paddingHorizontal:6,paddingVertical:2},
  deckCountText:{fontSize:10,color:C.gold,fontWeight:'700'},
  msgBox:{flex:1,backgroundColor:C.bg2,borderRadius:12,padding:10,justifyContent:'center',minHeight:88,borderWidth:1,borderColor:C.border},
  msgText:{fontSize:12,color:C.text,lineHeight:18},
  playerZone:{backgroundColor:C.bg2,borderRadius:16,padding:12,marginBottom:10,borderWidth:1,borderColor:C.border},
  playerTitle:{fontSize:13,fontWeight:'700',color:C.text,flex:1},
  yourTurnBadge:{backgroundColor:C.gold,borderRadius:20,paddingHorizontal:10,paddingVertical:3},
  yourTurnText:{fontSize:10,fontWeight:'800',color:'#1C1917'},
  card:{borderRadius:10,backgroundColor:'#ffffff',alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#E5E7EB'},
  cardSel:{borderColor:C.gold,borderWidth:3,transform:[{translateY:-10}]},
  cardMove:{borderColor:C.blue,borderWidth:3,transform:[{translateY:-5}]},
  cardBack:{borderRadius:10,backgroundColor:C.purple,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#5B21B6'},
  cardBackInner:{width:'70%',height:'70%',borderRadius:6,borderWidth:1.5,borderColor:'#5B21B6',alignItems:'center',justifyContent:'center'},
  cardBackLogo:{fontSize:16,fontWeight:'900',color:'rgba(255,255,255,0.4)'},
  selInfo:{fontSize:11,color:C.gold,marginTop:6,fontWeight:'700'},
  movBtn:{backgroundColor:C.border,borderRadius:8,paddingHorizontal:14,paddingVertical:8},
  movBtnX:{backgroundColor:'#7f1d1d',borderRadius:8,paddingHorizontal:10,paddingVertical:8},
  movBtnT:{fontSize:13,color:'#fff',fontWeight:'700'},
  setsZone:{backgroundColor:C.bg2,borderRadius:16,padding:12,marginBottom:10,borderWidth:1,borderColor:C.border},
  setsTitle:{fontSize:12,fontWeight:'700',color:C.textDim,marginBottom:10,letterSpacing:0.5},
  setSlot:{borderWidth:1.5,borderColor:C.border,borderRadius:12,padding:10,marginBottom:8,borderStyle:'dashed'},
  setSlotOn:{borderColor:C.green,borderStyle:'solid',backgroundColor:'#064E3B22'},
  setSlotLbl:{fontSize:12,fontWeight:'700',color:C.textDim,flex:1},
  undoBtn:{backgroundColor:'#374151',borderRadius:8,paddingHorizontal:10,paddingVertical:5},
  undoBtnT:{fontSize:11,color:'#fff'},
  chatZone:{backgroundColor:C.bg2,borderRadius:16,padding:12,marginBottom:10,borderWidth:1,borderColor:C.border},
  chatToggle:{flexDirection:'row',alignItems:'center'},
  chatToggleT:{fontSize:13,fontWeight:'700',color:C.purple},
  chatMsgs:{maxHeight:120,marginTop:10},
  bubble:{borderRadius:12,paddingHorizontal:12,paddingVertical:8,marginBottom:6,maxWidth:'80%'},
  bubbleMe:{backgroundColor:C.gold,alignSelf:'flex-end'},
  bubbleThem:{backgroundColor:C.border,alignSelf:'flex-start'},
  bubbleText:{fontSize:13,color:C.text},
  quickMsgs:{flexDirection:'row',gap:8,paddingVertical:8},
  quickMsg:{backgroundColor:C.border,borderRadius:20,paddingHorizontal:12,paddingVertical:7},
  quickMsgT:{fontSize:12,color:C.text},
  roundOverZone:{backgroundColor:C.bg2,borderRadius:16,padding:16,marginBottom:10,borderWidth:2,borderColor:C.gold,alignItems:'center'},
  roundOverEmoji:{fontSize:56,marginBottom:8},
  roundOverTitle:{fontSize:22,fontWeight:'900',color:C.gold,marginBottom:16,textAlign:'center'},
  revealTitle:{fontSize:13,fontWeight:'700',color:C.text,marginBottom:8},
  scoreBox:{alignItems:'center',backgroundColor:'#1a0533',borderRadius:12,padding:14,minWidth:80},
  scoreBoxN:{fontSize:28,fontWeight:'900',color:C.gold},
  scoreBoxL:{fontSize:11,color:C.textDim},
  seriesWinner:{fontSize:18,fontWeight:'800',color:C.gold,textAlign:'center',marginBottom:12},
  rejoinBanner:{backgroundColor:'#2D1500',borderWidth:2,borderColor:C.gold,borderRadius:16,padding:16,marginBottom:16},
  rejoinTitle:{fontSize:16,fontWeight:'800',color:C.gold,marginBottom:4},
  rejoinSub:{fontSize:13,color:C.textDim},
});