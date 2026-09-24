// One voice channel: latest state wins, never queue historical actions.
export class VoiceManager {
 constructor({audio,enabled,volume,now=Date.now,debug=()=>{}}){Object.assign(this,{audio,enabled,volume,now,debug});this.played=new Set();this.context='';this.current=null;this.pending=null;}
 stop(){const item=this.current;this.current=null;this.pending=null;if(item){clearTimeout(item.timer);item.audio.removeEventListener('ended',item.end);item.audio.removeEventListener('error',item.error);item.audio.pause?.();item.audio.currentTime=0;this.debug('VOICE INTERRUPT',item.id);}}
 update(context){if(context!==this.context){this.stop();this.context=context;}if(!this.enabled())this.stop();if(this.current)this.current.audio.volume=this.volume();}
 play(id,type,context,valid=()=>true){
  this.debug('VOICE EVENT RECEIVED',{id,type,context});
  if(this.played.has(id)){this.debug('VOICE DISCARD_DUPLICATE',id);return false;}
  if(context!==this.context||!this.enabled()||!valid()){this.debug('VOICE DISCARD_EXPIRED',id);return false;}
  this.stop();this.played.add(id);if(this.played.size>512)this.played.delete(this.played.values().next().value);
  const audio=this.audio(type);if(!audio)return false;audio.volume=this.volume();
  const item={audio,id,context,valid};this.current=item;
  item.end=()=>{if(this.current!==item)return;const next=this.pending;this.stop();if(next&&context===this.context&&valid())next();};
  item.error=()=>{if(this.current===item)this.stop();};
  audio.addEventListener('ended',item.end);audio.addEventListener('error',item.error);item.timer=setTimeout(item.error,5000);
  this.debug('VOICE PLAY',id);try{audio.play()?.catch(item.error);}catch{item.error();}return true;
 }
 turn(id,context,valid){if(this.played.has(id))return;const run=()=>this.play(id,'turn',context,valid);if(this.current&&this.current.context===context)this.pending=run;else run();}
}
