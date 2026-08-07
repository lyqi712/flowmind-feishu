import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileAudio, LoaderCircle, Mic, Pause, Play, RotateCcw, Square, Trash2, UploadCloud } from 'lucide-react';
import './RecordingWorkspace.css';

export const RECORDING_SESSION_VERSION = 1;
export const RECORDING_STATES = Object.freeze({ IDLE:'idle', REQUESTING:'requesting', RECORDING:'recording', PAUSED:'paused', STOPPING:'stopping', UPLOADING:'uploading', COMPLETED:'completed', FAILED:'failed' });
const VALID_STATES = new Set(Object.values(RECORDING_STATES));
const INTERRUPTED_STATES = new Set(['requesting','recording','paused','stopping','uploading']);
const ACTIVE_STATES = new Set(['requesting','recording','paused','stopping','uploading']);
const TRANSITIONS = Object.freeze({
  idle:new Set(['requesting']), requesting:new Set(['recording','failed','idle']), recording:new Set(['paused','stopping','failed','idle']),
  paused:new Set(['recording','stopping','failed','idle']), stopping:new Set(['uploading','failed','idle']), uploading:new Set(['completed','failed','idle']),
  completed:new Set(['requesting','idle']), failed:new Set(['requesting','uploading','idle'])
});
const MIME_CANDIDATES = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4','audio/webm'];

export function canTransitionRecordingState(current, next) { return current === next || Boolean(TRANSITIONS[current]?.has(next)); }
export function selectRecordingMimeType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find(type => Recorder.isTypeSupported(type)) || '';
}
export function formatRecordingDuration(value) {
  const total = Math.max(0, Math.floor((Number(value)||0)/1000));
  const h=Math.floor(total/3600), m=Math.floor((total%3600)/60), s=total%60;
  return h ? [h,m,s].map(v=>String(v).padStart(2,'0')).join(':') : [m,s].map(v=>String(v).padStart(2,'0')).join(':');
}
export function recordingExtensionForMimeType(type) {
  const value=String(type||'').toLowerCase();
  if(value.includes('ogg')) return 'ogg'; if(value.includes('mp4')||value.includes('m4a')) return 'm4a'; if(value.includes('wav')) return 'wav'; return 'webm';
}
export function microphoneErrorMessage(error) {
  const name=String(error?.name||'');
  if(['NotAllowedError','PermissionDeniedError','SecurityError'].includes(name)) return '麦克风权限被拒绝。请在系统或浏览器设置中允许 FlowMind 使用麦克风，然后重试。';
  if(['NotFoundError','DevicesNotFoundError'].includes(name)) return '没有检测到可用麦克风。请连接麦克风并确认它未被系统禁用。';
  if(['NotReadableError','TrackStartError'].includes(name)) return '麦克风正被其他应用占用，或系统暂时无法读取设备。关闭占用程序后重试。';
  if(name==='AbortError') return '麦克风启动被系统中断，请重新开始录音。';
  return String(error?.message||error||'无法启动录音，请检查麦克风和系统权限后重试。');
}
export function createRecordingSessionMetadata(input={}) {
  const state=VALID_STATES.has(input.state)?input.state:'idle';
  return { version:RECORDING_SESSION_VERSION, sessionId:String(input.sessionId||''), state, title:String(input.title||'新录音纪要'),
    startedAt:input.startedAt?String(input.startedAt):null, updatedAt:input.updatedAt?String(input.updatedAt):new Date().toISOString(), completedAt:input.completedAt?String(input.completedAt):null,
    elapsedMs:Math.max(0,Number(input.elapsedMs)||0), durationMs:Math.max(0,Number(input.durationMs??input.elapsedMs)||0), mimeType:String(input.mimeType||''),
    fileName:String(input.fileName||''), fileSize:Math.max(0,Number(input.fileSize)||0), uploadProgress:Math.max(0,Math.min(100,Number(input.uploadProgress)||0)),
    documentId:String(input.documentId||input.document?.id||''), errorCode:String(input.errorCode||''), errorMessage:String(input.errorMessage||''), recoverable:Boolean(input.recoverable), source:'direct-recording' };
}
export function normalizeRecordingSession(input={}) {
  const value=createRecordingSessionMetadata(input);
  if(!INTERRUPTED_STATES.has(value.state)) return value;
  return {...value,state:'failed',errorCode:'session_interrupted',recoverable:true,errorMessage:value.state==='uploading'
    ?'上次音频导入被中断；如果音频文件仍在本页，可继续导入，否则请重新录制。':'上次录音未正常结束。已保留标题和计时信息，请重新开始录音。'};
}
export function createRecordingFile(chunks,mimeType,title,completedAt=new Date()) {
  const blob=new Blob(Array.from(chunks||[]),{type:mimeType||'audio/webm'});
  if(!blob.size) throw new Error('没有捕获到有效音频，请检查麦克风后重新录制。');
  const safe=String(title||'录音纪要').trim().replace(/[\\/:*?"<>|]/g,'-').slice(0,80)||'录音纪要';
  const stamp=completedAt.toISOString().replace(/[:.]/g,'-');
  return new File([blob], `${safe}-${stamp}.${recordingExtensionForMimeType(blob.type)}`, {type:blob.type,lastModified:completedAt.getTime()});
}

function documentFromResult(result){ return result?.document||result?.item||result?.result||result||null; }
function statusCopy(state){ return ({
  idle:['准备录音','开始后会请求一次麦克风权限。'], requesting:['正在连接麦克风','请在系统权限提示中允许麦克风访问。'], recording:['正在录音','可以随时暂停，已录内容不会丢失。'],
  paused:['录音已暂停','继续后将接着当前纪要录制。'], stopping:['正在结束录音','正在整理最后一段音频，请稍候。'], uploading:['正在生成纪要','音频正在后台导入，可以切换到其他工作。'],
  completed:['录音已完成','音频已进入现有处理链，可打开文档继续整理。'], failed:['本次录音未完成','请根据下方提示处理后重试。']
})[state]||['录音工作区','']; }
function newSessionId(){ return globalThis.crypto?.randomUUID?.()||('recording-'+Date.now()+'-'+Math.random().toString(16).slice(2)); }
function stopTracks(stream){ for(const track of stream?.getTracks?.()||[]) track.stop(); }

export function RecordingWorkspace({title:initialTitle='新录音纪要',initialSession,resumeFile=null,onSessionChange,onImportAudio,onOpenDocument}) {
  const restored=useMemo(()=>normalizeRecordingSession({title:initialTitle,...initialSession}),[]);
  const [state,setState]=useState(restored.state), [title,setTitle]=useState(restored.title), [elapsedMs,setElapsedMs]=useState(restored.elapsedMs);
  const [startedAt,setStartedAt]=useState(restored.startedAt), [completedAt,setCompletedAt]=useState(restored.completedAt), [mimeType,setMimeType]=useState(restored.mimeType);
  const [uploadProgress,setUploadProgress]=useState(restored.uploadProgress), [error,setError]=useState(restored.errorMessage), [errorCode,setErrorCode]=useState(restored.errorCode);
  const [fileInfo,setFileInfo]=useState(restored.fileName?{name:restored.fileName,size:restored.fileSize,type:restored.mimeType}:null);
  const [completedDocument,setCompletedDocument]=useState(initialSession?.document||null), [previewUrl,setPreviewUrl]=useState('');
  const stateRef=useRef(restored.state), recorderRef=useRef(null), streamRef=useRef(null), chunksRef=useRef([]), fileRef=useRef(resumeFile||null);
  const discardRef=useRef(false), mountedRef=useRef(true), requestTokenRef=useRef(0), uploadControllerRef=useRef(null), activeStartedAtRef=useRef(0), elapsedBaseRef=useRef(restored.elapsedMs);
  const sessionIdRef=useRef(restored.sessionId||newSessionId()), titleRef=useRef(restored.title), startedAtRef=useRef(restored.startedAt), mimeTypeRef=useRef(restored.mimeType);

  const moveTo=useCallback(next=>{ const current=stateRef.current; if(!canTransitionRecordingState(current,next)) return false; stateRef.current=next; if(mountedRef.current)setState(next); return true; },[]);
  const releaseMedia=useCallback(()=>{ stopTracks(streamRef.current); streamRef.current=null; recorderRef.current=null; },[]);
  const replacePreview=useCallback(file=>setPreviewUrl(current=>{ if(current)URL.revokeObjectURL(current); return file?URL.createObjectURL(file):''; }),[]);
  const fail=useCallback((reason,code='recording_failed')=>{ discardRef.current=true; const recorder=recorderRef.current; if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;try{recorder.stop();}catch{}} releaseMedia(); setError(microphoneErrorMessage(reason)); setErrorCode(code||String(reason?.name||'recording_failed')); moveTo('failed'); },[moveTo,releaseMedia]);

  const uploadFile=useCallback(async(file,duration)=>{
    if(!file||typeof onImportAudio!=='function'){ fail(new Error('音频导入通道尚未连接，请稍后重试。'),'import_unavailable'); return null; }
    discardRef.current=false; fileRef.current=file; setFileInfo({name:file.name,size:file.size,type:file.type}); replacePreview(file); setError(''); setErrorCode(''); setUploadProgress(4);
    if(!moveTo('uploading')) return null;
    const controller=new AbortController(); uploadControllerRef.current=controller; const finishedAt=new Date();
    const baseMetadata=createRecordingSessionMetadata({sessionId:sessionIdRef.current,state:'uploading',title:titleRef.current,startedAt:startedAtRef.current,completedAt:finishedAt.toISOString(),elapsedMs:duration,durationMs:duration,mimeType:file.type,fileName:file.name,fileSize:file.size,uploadProgress:4});
    const reportProgress=value=>{ const progress=Math.max(4,Math.min(99,Number(value)||0)); if(mountedRef.current&&!discardRef.current)setUploadProgress(progress); };
    try{
      const result=await onImportAudio(file,Object.freeze({...baseMetadata,reportProgress,signal:controller.signal}));
      if(discardRef.current||!mountedRef.current)return null;
      const document=documentFromResult(result); setUploadProgress(100); setCompletedAt(finishedAt.toISOString()); setCompletedDocument(document); moveTo('completed');
      if(document)onOpenDocument?.(document,{...baseMetadata,state:'completed',uploadProgress:100}); return document;
    }catch(reason){ if(discardRef.current||reason?.name==='AbortError')return null; setError(String(reason?.message||reason||'音频导入失败，请重试。')); setErrorCode('upload_failed'); moveTo('failed'); return null; }
    finally{ uploadControllerRef.current=null; }
  },[fail,moveTo,onImportAudio,onOpenDocument,replacePreview,startedAt,title]);

  const finalizeRecording=useCallback(async()=>{
    releaseMedia(); if(discardRef.current)return; const duration=Math.max(elapsedBaseRef.current,elapsedMs);
    try{ const file=createRecordingFile(chunksRef.current,mimeTypeRef.current,titleRef.current); chunksRef.current=[]; await uploadFile(file,duration); }
    catch(reason){ fail(reason,'empty_recording'); }
  },[elapsedMs,fail,releaseMedia,uploadFile]);

  const startRecording=useCallback(async()=>{
    if(ACTIVE_STATES.has(stateRef.current))return false;
    const requestToken=++requestTokenRef.current; discardRef.current=false; chunksRef.current=[]; fileRef.current=null; uploadControllerRef.current?.abort();
    setCompletedDocument(null);setFileInfo(null);replacePreview(null);setError('');setErrorCode('');setUploadProgress(0);setElapsedMs(0);elapsedBaseRef.current=0;sessionIdRef.current=newSessionId();
    if(!moveTo('requesting'))return false;
    try{
      if(!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder)throw Object.assign(new Error('当前环境不支持直接录音，请使用最新版桌面应用或浏览器。'),{name:'NotSupportedError'});
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(requestToken!==requestTokenRef.current||discardRef.current||!mountedRef.current){stopTracks(stream);return false;}
      const preferred=selectRecordingMimeType(globalThis.MediaRecorder); const recorder=preferred?new globalThis.MediaRecorder(stream,{mimeType:preferred}):new globalThis.MediaRecorder(stream);
      streamRef.current=stream;recorderRef.current=recorder;const selectedType=recorder.mimeType||preferred||'audio/webm';mimeTypeRef.current=selectedType;setMimeType(selectedType);
      recorder.ondataavailable=event=>{if(!discardRef.current&&event.data?.size)chunksRef.current.push(event.data);};
      recorder.onerror=event=>fail(event.error||new Error('录音设备发生错误。'),'media_recorder_error'); recorder.onstop=()=>{void finalizeRecording();}; recorder.start(1000);
      const now=Date.now();activeStartedAtRef.current=now;const started=new Date(now).toISOString();startedAtRef.current=started;setStartedAt(started);moveTo('recording');return true;
    }catch(reason){if(requestToken!==requestTokenRef.current||discardRef.current)return false;fail(reason,String(reason?.name||'microphone_error'));return false;}
  },[fail,finalizeRecording,moveTo,replacePreview]);

  const pauseRecording=useCallback(()=>{const recorder=recorderRef.current;if(stateRef.current!=='recording'||recorder?.state!=='recording')return false;recorder.pause();const value=elapsedBaseRef.current+Math.max(0,Date.now()-activeStartedAtRef.current);elapsedBaseRef.current=value;setElapsedMs(value);moveTo('paused');return true;},[moveTo]);
  const resumeRecording=useCallback(()=>{const recorder=recorderRef.current;if(stateRef.current!=='paused'||recorder?.state!=='paused')return false;recorder.resume();activeStartedAtRef.current=Date.now();moveTo('recording');return true;},[moveTo]);
  const stopRecording=useCallback(()=>{const recorder=recorderRef.current;if(!['recording','paused'].includes(stateRef.current)||!recorder||recorder.state==='inactive')return false;if(stateRef.current==='recording'){const value=elapsedBaseRef.current+Math.max(0,Date.now()-activeStartedAtRef.current);elapsedBaseRef.current=value;setElapsedMs(value);}moveTo('stopping');try{recorder.requestData?.();}catch{}recorder.stop();return true;},[moveTo]);
  const discardRecording=useCallback(()=>{
    discardRef.current=true;requestTokenRef.current++;uploadControllerRef.current?.abort();const recorder=recorderRef.current;if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;try{recorder.stop();}catch{}}
    releaseMedia();chunksRef.current=[];fileRef.current=null;elapsedBaseRef.current=0;setElapsedMs(0);setStartedAt(null);setCompletedAt(null);mimeTypeRef.current='';startedAtRef.current=null;setMimeType('');setUploadProgress(0);setError('');setErrorCode('');setFileInfo(null);setCompletedDocument(null);replacePreview(null);stateRef.current='idle';setState('idle');
  },[releaseMedia,replacePreview]);
  const retryUpload=useCallback(()=>{if(!fileRef.current||stateRef.current!=='failed')return false;void uploadFile(fileRef.current,elapsedMs);return true;},[elapsedMs,uploadFile]);

  useEffect(()=>{if(state!=='recording')return;const timer=window.setInterval(()=>setElapsedMs(elapsedBaseRef.current+Math.max(0,Date.now()-activeStartedAtRef.current)),250);return()=>window.clearInterval(timer);},[state]);
  const persistedElapsedMs=Math.floor(elapsedMs/1000)*1000;
  useEffect(()=>{onSessionChange?.(createRecordingSessionMetadata({sessionId:sessionIdRef.current,state,title,startedAt,completedAt,elapsedMs:persistedElapsedMs,durationMs:persistedElapsedMs,mimeType:fileInfo?.type||mimeType,fileName:fileInfo?.name,fileSize:fileInfo?.size,uploadProgress,document:completedDocument,errorCode,errorMessage:error,recoverable:state==='failed'&&Boolean(fileRef.current||restored.recoverable)}));},[completedAt,completedDocument,error,errorCode,fileInfo,mimeType,onSessionChange,persistedElapsedMs,restored.recoverable,startedAt,state,title,uploadProgress]);
  useEffect(()=>()=>{mountedRef.current=false;discardRef.current=true;requestTokenRef.current++;uploadControllerRef.current?.abort();const recorder=recorderRef.current;if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;try{recorder.stop();}catch{}}stopTracks(streamRef.current);},[]);
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);

  const [statusTitle,statusDescription]=statusCopy(state), busy=ACTIVE_STATES.has(state), canEditTitle=!['stopping','uploading'].includes(state), canDiscard=state!=='idle', canRetryUpload=state==='failed'&&Boolean(fileRef.current);
  return <section className={'recording-workspace is-'+state} data-recording-state={state} aria-labelledby="recording-workspace-title">
    <header className="recording-workspace-header"><div><span className="recording-workspace-eyebrow"><Mic size={15} aria-hidden="true"/> 直接录音与纪要</span><h2 id="recording-workspace-title">把讨论直接变成可复用知识</h2><p>录音结束后自动交给现有音频导入链，继续转写、整理纪要、写入知识库或保存为笔记。</p></div>
      <label className="recording-title-field"><span>纪要标题</span><input value={title} disabled={!canEditTitle} maxLength={80} onChange={event=>{titleRef.current=event.target.value;setTitle(event.target.value);}} placeholder="例如：产品周会纪要"/></label></header>
    <div className="recording-console" aria-live="polite"><div className="recording-status-visual" aria-hidden="true"><span className="recording-pulse"/><div className="recording-wave">{Array.from({length:16},(_,index)=><i key={index}/>)}</div></div>
      <div className="recording-clock" aria-label={'已录制 '+formatRecordingDuration(elapsedMs)}>{formatRecordingDuration(elapsedMs)}</div><strong>{statusTitle}</strong><p>{statusDescription}</p>{state==='requesting'&&<LoaderCircle className="recording-spin" size={22} aria-label="正在请求麦克风权限"/>}</div>
    {error&&<div className="recording-alert" role="alert" data-error-code={errorCode||'recording_failed'}><AlertCircle size={20} aria-hidden="true"/><div><strong>需要处理</strong><p>{error}</p></div></div>}
    {state==='uploading'&&<div className="recording-upload" aria-label="音频导入进度"><div className="recording-upload-head"><span><UploadCloud size={18} aria-hidden="true"/> 后台导入与纪要生成</span><b>{Math.round(uploadProgress)}%</b></div>
      <div className="recording-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(uploadProgress)}><span style={{width:String(uploadProgress)+'%'}}/></div><p>可以切换到其他工作，导入会在后台继续；完成后将自动打开生成的文档。</p></div>}
    {fileInfo&&['completed','failed'].includes(state)&&<div className="recording-result" data-result-state={state}>{state==='completed'?<CheckCircle2 size={22} aria-hidden="true"/>:<FileAudio size={22} aria-hidden="true"/>}<div><strong>{fileInfo.name}</strong><span>{fileInfo.type||'音频文件'} · {Math.max(1,Math.round(fileInfo.size/1024))} KB · {formatRecordingDuration(elapsedMs)}</span></div>{previewUrl&&<audio controls preload="metadata" src={previewUrl}>你的设备暂不支持音频播放。</audio>}</div>}
    <div className="recording-actions" aria-label="录音控制">
      {['idle','completed','failed'].includes(state)&&!canRetryUpload&&<button type="button" className="recording-primary" onClick={startRecording}><Mic size={18} aria-hidden="true"/>{state==='idle'?'开始录音':'重新录制'}</button>}
      {state==='recording'&&<button type="button" onClick={pauseRecording}><Pause size={18} aria-hidden="true"/>暂停</button>}{state==='paused'&&<button type="button" className="recording-primary" onClick={resumeRecording}><Play size={18} aria-hidden="true"/>继续</button>}
      {['recording','paused'].includes(state)&&<button type="button" className="recording-stop" onClick={stopRecording}><Square size={17} fill="currentColor" aria-hidden="true"/>结束录音</button>}
      {canRetryUpload&&<button type="button" className="recording-primary" onClick={retryUpload}><RotateCcw size={18} aria-hidden="true"/>继续导入</button>}
      {state==='completed'&&completedDocument&&<button type="button" onClick={()=>onOpenDocument?.(completedDocument,createRecordingSessionMetadata({state,title,elapsedMs,document:completedDocument}))}><FileAudio size={18} aria-hidden="true"/>打开纪要</button>}
      {canDiscard&&<button type="button" className="recording-discard" disabled={state==='stopping'} onClick={discardRecording}><Trash2 size={18} aria-hidden="true"/>丢弃</button>}
      {state==='requesting'&&<span className="recording-action-note">等待系统权限确认…</span>}{busy&&state==='uploading'&&<span className="recording-action-note">离开此页面不会阻塞后台任务</span>}
    </div><footer className="recording-session-contract"><span>会话状态：<code>{state}</code></span><span>自动保存标题、计时、导入进度和文档标识</span></footer>
  </section>;
}
