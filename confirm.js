'use strict';
const token=location.hash.slice(1),button=document.getElementById('confirm'),message=document.getElementById('message');
if(token==='preview'){
  button.disabled=true;message.textContent='This is a preview. No attendance will be recorded.';
}else if(!/^\d{1,20}\.[a-f0-9]{64}$/.test(token)){
  button.disabled=true;message.textContent='Please open the confirmation link in your invitation email.';
}
button.addEventListener('click',async()=>{
  button.disabled=true;message.textContent='Confirming your attendance...';
  try{
    const response=await fetch('/api/attendance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store'});
    const result=await response.json();
    if(!response.ok || !result.ok)throw new Error(result.error || 'Unable to confirm. Please try again.');
    message.textContent='Your attendance is confirmed. We look forward to seeing you!';button.textContent='Confirmed';
  }catch(e){message.textContent=e.message || 'Unable to confirm. Please try again.';button.disabled=false;}
});
