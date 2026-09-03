import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, transformWithEsbuild } from 'vite';

const here=dirname(fileURLToPath(import.meta.url));
const appRoot=resolve(here,'..');
const componentPath=resolve(appRoot,'src/components/RecordingWorkspace.jsx');
const cssPath=resolve(appRoot,'src/components/RecordingWorkspace.css');
const componentSource=readFileSync(componentPath,'utf8');
const cssSource=readFileSync(cssPath,'utf8');
let vite, recording;
before(async()=>{vite=await createServer({root:appRoot,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});recording=await vite.ssrLoadModule('/src/components/RecordingWorkspace.jsx');});
after(async()=>{await vite?.close();});
function render(overrides={}){return renderToStaticMarkup(React.createElement(recording.RecordingWorkspace,{onImportAudio(){},onOpenDocument(){},onSessionChange(){},...overrides}));}
function includesAll(source,fragments,label){for(const fragment of fragments)assert.ok(source.includes(fragment),label+': missing '+fragment);}

test('RecordingWorkspace 可由仓库 React 19/Vite 工具链真实编译和 SSR 渲染',async()=>{
  const transformed=await transformWithEsbuild(componentSource,componentPath,{loader:'jsx',jsx:'automatic'});assert.ok(transformed.code.length>10000);assert.equal(typeof recording.RecordingWorkspace,'function');
  const html=render();assert.match(html,/直接录音与纪要/);assert.match(html,/data-recording-state="idle"/);assert.match(html,/开始录音/);assert.match(html,/00:00/);
});
test('状态机完整覆盖八个生命周期状态并拒绝非法跃迁',()=>{
  assert.deepEqual(Object.values(recording.RECORDING_STATES),['idle','requesting','recording','paused','stopping','uploading','completed','failed']);
  for(const [from,to] of [['idle','requesting'],['requesting','recording'],['recording','paused'],['paused','recording'],['recording','stopping'],['stopping','uploading'],['uploading','completed'],['failed','uploading']])assert.equal(recording.canTransitionRecordingState(from,to),true);
  assert.equal(recording.canTransitionRecordingState('idle','completed'),false);
});
test('录音格式优先选择 Opus，并为常见 MIME 生成正确扩展名',()=>{
  class RecorderMock{} RecorderMock.isTypeSupported=value=>value==='audio/ogg;codecs=opus';assert.equal(recording.selectRecordingMimeType(RecorderMock),'audio/ogg;codecs=opus');
  assert.equal(recording.recordingExtensionForMimeType('audio/webm;codecs=opus'),'webm');assert.equal(recording.recordingExtensionForMimeType('audio/ogg;codecs=opus'),'ogg');assert.equal(recording.recordingExtensionForMimeType('audio/mp4'),'m4a');
});
test('计时格式支持分钟和超过一小时的长录音',()=>{assert.equal(recording.formatRecordingDuration(0),'00:00');assert.equal(recording.formatRecordingDuration(65999),'01:05');assert.equal(recording.formatRecordingDuration(3661000),'01:01:01');});
test('麦克风权限和设备错误映射为可操作中文提示',()=>{
  assert.match(recording.microphoneErrorMessage({name:'NotAllowedError'}),/权限被拒绝/);assert.match(recording.microphoneErrorMessage({name:'NotFoundError'}),/没有检测到/);assert.match(recording.microphoneErrorMessage({name:'NotReadableError'}),/其他应用占用/);assert.match(recording.microphoneErrorMessage({name:'AbortError'}),/系统中断/);
});
test('session metadata 可序列化并把中断录音恢复为明确失败态',()=>{
  const metadata=recording.createRecordingSessionMetadata({sessionId:'session-1',state:'recording',title:'周会',elapsedMs:8200,uploadProgress:140});assert.equal(metadata.version,1);assert.equal(metadata.source,'direct-recording');assert.equal(metadata.uploadProgress,100);assert.doesNotThrow(()=>JSON.stringify(metadata));
  const restored=recording.normalizeRecordingSession(metadata);assert.equal(restored.state,'failed');assert.equal(restored.errorCode,'session_interrupted');assert.equal(restored.recoverable,true);assert.equal(restored.title,'周会');assert.equal(restored.elapsedMs,8200);
});
test('录音 Blob 形成带安全文件名、MIME 和时间戳的 File',()=>{
  const file=recording.createRecordingFile([new Uint8Array([1,2,3,4])],'audio/webm;codecs=opus','产品/周会:纪要',new Date('2026-08-04T06:30:00.000Z'));
  assert.ok(file instanceof File);assert.equal(file.type,'audio/webm;codecs=opus');assert.equal(file.size,4);assert.match(file.name,/^产品-周会-纪要-2026-08-04T06-30-00-000Z\.webm$/);
});
test('MediaRecorder 控制、权限请求、丢弃清理和导入回调契约齐全',()=>{
  includesAll(componentSource,["navigator.mediaDevices.getUserMedia({",'new globalThis.MediaRecorder','recorder.start(1000)','recorder.pause()','recorder.resume()','recorder.stop()','recorder.requestData?.()','stopTracks(streamRef.current)','uploadControllerRef.current?.abort()','createRecordingFile(chunksRef.current','onImportAudio(file,Object.freeze({...baseMetadata,reportProgress,signal:controller.signal}))','onOpenDocument?.(document','开始录音','暂停','继续','结束录音','丢弃','继续导入'],'recording control contract');
  assert.doesNotMatch(componentSource,/fetch\s*\(|localStorage|sessionStorage|indexedDB|main\.jsx|WorkspaceModules/);
});
test('上传进度、后台继续、完成预览和可访问错误状态为真实 UI',()=>{
  const html=render({initialSession:{state:'uploading',sessionId:'old',title:'访谈',elapsedMs:12000,uploadProgress:40,fileName:'访谈.webm',fileSize:2048}});assert.match(html,/data-recording-state="failed"/);assert.match(html,/role="alert"/);assert.match(html,/上次音频导入被中断/);
  includesAll(componentSource,['role="progressbar"','aria-valuenow={Math.round(uploadProgress)}','可以切换到其他工作，导入会在后台继续','<audio controls preload="metadata"','完成后将自动打开生成的文档','aria-live="polite"'],'upload and completion UI');
});
test('样式覆盖 390px、横向溢出、焦点态、状态色和 reduced motion',()=>{
  includesAll(cssSource,['.recording-workspace{','overflow-x:hidden','.recording-workspace.is-recording .recording-pulse','.recording-workspace.is-paused .recording-pulse','.recording-workspace.is-failed .recording-pulse','.recording-workspace.is-completed .recording-pulse','.recording-actions button:focus-visible','.recording-progress','@media (max-width:390px)','grid-template-columns:minmax(0,1fr)','@media (prefers-reduced-motion:reduce)'],'responsive and state styles');
});
