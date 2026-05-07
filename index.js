const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let rooms = {};

function generateCode(){
  return Math.random().toString(36).slice(2,6).toUpperCase();
}
function send(ws,data){
  if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room,data){
  room.players.forEach(p=>send(p.ws,data));
}

const SUITS=['♠','♥','♦','♣'];
const RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const RANK_VAL={A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13};

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
function isJoker(c){return c.r==='JKR';}
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
function dealRound(room){
  const fresh=shuffle(buildDeck());
  const pool=room.usedPool||[];
  room.deck=pool.length>0?[...fresh,...shuffle(pool)]:fresh;
  room.usedPool=[];
  room.discard=[];
  const w=room.lastWinner;
  room.players[0].hand=room.deck.splice(0,w===0?11:10);
  room.players[1].hand=room.deck.splice(0,w===1?11:10);
  room.players[0].sets=[null,null,null];
  room.players[1].sets=[null,null,null];
  room.turn=w!==null?w:Math.random()<0.5?0:1;
  room.phase='draw';
  room.round=(room.round||0)+1;
}
function sendGameState(room){
  room.players.forEach((player,idx)=>{
    const opp=room.players[1-idx];
    send(player.ws,{
      type:'GAME_STATE',
      yourHand:player.hand,
      yourSets:player.sets,
      oppHandCount:opp.hand.length,
      oppSetsFours:opp.sets.filter(Boolean).filter(s=>s.length===4).length,
      oppSetsThrees:opp.sets.filter(Boolean).filter(s=>s.length===3).length,
      topDiscard:room.discard.length>0?room.discard[room.discard.length-1]:null,
      deckCount:room.deck.length,
      turn:room.turn===idx?'yours':'theirs',
      phase:room.phase,
      scores:room.scores,
      totalGames:room.totalGames,
      round:room.round,
      yourName:player.name,
      oppName:opp.name,
    });
  });
}
function collectUsed(room){
  const all=[
    ...room.deck,
    ...room.discard,
    ...room.players[0].hand,
    ...room.players[1].hand,
    ...room.players[0].sets.filter(Boolean).flat(),
    ...room.players[1].sets.filter(Boolean).flat(),
  ];
  room.usedPool=[...(room.usedPool||[]),...all];
  room.deck=[];
  room.discard=[];
  room.players[0].hand=[];
  room.players[1].hand=[];
  room.players[0].sets=[null,null,null];
  room.players[1].sets=[null,null,null];
}
function endRound(room,winnerIdx){
  collectUsed(room);
  room.lastWinner=winnerIdx;
  if(winnerIdx!==null)room.scores[winnerIdx]++;
  const needed=Math.ceil(room.totalGames/2);
  const seriesOver=room.scores[0]>=needed||room.scores[1]>=needed;
  room.players.forEach((player,idx)=>{
    const opp=room.players[1-idx];
    send(player.ws,{
      type:'ROUND_OVER',
      winner:winnerIdx===null?'tie':winnerIdx===idx?'you':'opponent',
      winnerSets:winnerIdx!==null?room.players[winnerIdx].sets:[],
      scores:room.scores,
      totalGames:room.totalGames,
      yourName:player.name,
      oppName:opp.name,
      seriesOver,
    });
  });
}

wss.on('connection',ws=>{
  console.log('Client connected');

  ws.on('message',raw=>{
    let msg;
    try{msg=JSON.parse(raw);}catch(e){return;}
    const{type,code,name,totalGames,cardId,cardIds,setSize,slotIdx}=msg;

    if(type==='CREATE_ROOM'){
      const roomCode=generateCode();
      rooms[roomCode]={
        code:roomCode,
        totalGames:totalGames||5,
        players:[{ws,hand:[],sets:[null,null,null],name:name||'Player 1'}],
        deck:[],discard:[],usedPool:[],
        scores:[0,0],turn:0,phase:'draw',
        lastWinner:null,round:0,
      };
      ws.roomCode=roomCode;
      ws.playerIdx=0;
      send(ws,{type:'ROOM_CREATED',code:roomCode});
      console.log(`Room created: ${roomCode}`);
    }

    else if(type==='JOIN_ROOM'){
      const room=rooms[code];
      if(!room){send(ws,{type:'ERROR',msg:'Room not found'});return;}
      if(room.players.length>=2){send(ws,{type:'ERROR',msg:'Room is full'});return;}
      room.players.push({ws,hand:[],sets:[null,null,null],name:name||'Player 2'});
      ws.roomCode=code;
      ws.playerIdx=1;
      dealRound(room);
      broadcast(room,{type:'GAME_START'});
      sendGameState(room);
      console.log(`Game started in room ${code}`);
    }

    else{
      const room=rooms[ws.roomCode];
      if(!room)return;
      const pidx=ws.playerIdx;

      if(type==='DRAW_DECK'){
        if(room.turn!==pidx||room.phase!=='draw')return;
        if(room.deck.length===0){endRound(room,null);return;}
        room.players[pidx].hand.push(room.deck.shift());
        room.phase='action';
        sendGameState(room);
      }

      else if(type==='TAKE_DISCARD'){
        if(room.turn!==pidx||room.phase!=='draw'||room.discard.length===0)return;
        room.players[pidx].hand.push(room.discard.pop());
        room.phase='action';
        sendGameState(room);
      }

      else if(type==='DECLARE_SET'){
        if(room.turn!==pidx||room.phase!=='action')return;
        const player=room.players[pidx];
        const cards=player.hand.filter(c=>cardIds.includes(c.id));
        if(cards.length!==setSize){send(ws,{type:'ERROR',msg:`Select exactly ${setSize} cards`});return;}
        if(!isValidSet(cards)){send(ws,{type:'ERROR',msg:'Invalid set'});return;}
        const f=player.sets.filter(Boolean);
        if(setSize===4&&f.filter(s=>s.length===4).length>=1){send(ws,{type:'ERROR',msg:'Already have set of 4'});return;}
        if(setSize===3&&f.filter(s=>s.length===3).length>=2){send(ws,{type:'ERROR',msg:'Already have 2 sets of 3'});return;}
        let slot=-1;
        if(setSize===4){
          slot=player.sets[0]===null?0:player.sets.findIndex(s=>s===null);
        } else {
          const hasFour=player.sets.some(s=>s&&s.length===4);
          if(!hasFour){
            slot=player.sets.findIndex((s,i)=>s===null&&i>0);
            if(slot===-1)slot=player.sets.findIndex(s=>s===null);
          } else {
            slot=player.sets.findIndex(s=>s===null);
          }
        }
        if(slot<0){send(ws,{type:'ERROR',msg:'All slots full'});return;}
        player.sets[slot]=cards;
        player.hand=player.hand.filter(c=>!cardIds.includes(c.id));
        sendGameState(room);
      }

      else if(type==='UNDO_SET'){
        if(room.turn!==pidx||room.phase!=='action')return;
        const player=room.players[pidx];
        if(!player.sets[slotIdx])return;
        const cards=player.sets[slotIdx];
        player.sets[slotIdx]=null;
        player.hand=[...player.hand,...cards];
        sendGameState(room);
      }

      else if(type==='DISCARD_CARD'){
        if(room.turn!==pidx||room.phase!=='action')return;
        const player=room.players[pidx];
        const idx=player.hand.findIndex(c=>c.id===cardId);
        if(idx<0)return;
        room.discard.push(player.hand.splice(idx,1)[0]);
        room.turn=1-pidx;
        room.phase='draw';
        sendGameState(room);
      }

      else if(type==='DECLARE_WIN'){
        if(room.turn!==pidx||room.phase!=='action')return;
        const player=room.players[pidx];
        if(!setsComplete(player.sets)){send(ws,{type:'ERROR',msg:'Sets not complete'});return;}
        endRound(room,pidx);
      }

      else if(type==='NEXT_ROUND'){
        const needed=Math.ceil(room.totalGames/2);
        if(room.scores[0]>=needed||room.scores[1]>=needed)return;
        dealRound(room);
        broadcast(room,{type:'GAME_START'});
        sendGameState(room);
      }

      else if(type==='CHAT'){
        const opp=room.players[1-pidx];
        if(opp) send(opp.ws,{type:'CHAT',text:msg.text});
      }
    }
  });

  ws.on('close',()=>{
    const room=rooms[ws.roomCode];
    if(room){
      room.players.forEach(p=>{
        if(p.ws!==ws) send(p.ws,{type:'ERROR',msg:'Opponent disconnected'});
      });
      delete rooms[ws.roomCode];
    }
    console.log('Client disconnected');
  });
});

console.log(`Server running on port ${PORT}`);