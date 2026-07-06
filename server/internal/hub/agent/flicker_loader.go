package agent

const flickerACPLoaderSource = `
import { Buffer } from "node:buffer";

function isMyFlickerBundle(url) {
  const normalized = decodeURIComponent(url).replace(/\\/g, "/");
  return normalized.endsWith("/node_modules/@myflicker/cli/dist/cli.mjs");
}

function sourceToString(source) {
  if (typeof source === "string") {
    return source;
  }
  if (source instanceof Uint8Array) {
    return Buffer.from(source).toString("utf8");
  }
  return "";
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) {
    throw new Error("WheelMaker flicker ACP patch failed: " + label + " not found");
  }
  if (source.indexOf(needle, index + needle.length) >= 0) {
    throw new Error("WheelMaker flicker ACP patch failed: " + label + " matched more than once");
  }
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function replaceOnceRegex(source, pattern, replacement, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const globalPattern = new RegExp(pattern.source, flags);
  const matches = [...source.matchAll(globalPattern)];
  if (matches.length === 0) {
    throw new Error("WheelMaker flicker ACP patch failed: " + label + " not found");
  }
  if (matches.length > 1) {
    throw new Error("WheelMaker flicker ACP patch failed: " + label + " matched more than once");
  }
  return source.replace(pattern, replacement);
}

function replaceOptionalOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) {
    return { source, replaced: false };
  }
  if (source.indexOf(needle, index + needle.length) >= 0) {
    throw new Error("WheelMaker flicker ACP patch failed: " + label + " matched more than once");
  }
  return {
    source: source.slice(0, index) + replacement + source.slice(index + needle.length),
    replaced: true,
  };
}

function findSessionClass(source) {
  const matches = [...source.matchAll(/new (\w+)\([^)]*this\.messageBus,this\.connection,this\.clientFsCapabilities\)/g)];
  const classNames = [...new Set(matches.map((match) => match[1]))];
  if (classNames.length !== 1) {
    throw new Error("WheelMaker flicker ACP patch failed: session constructor not found");
  }
  return classNames[0];
}

function loadSessionPatchSource(sessionClass) {
  return "async loadSession(A){if(!this.messageBus)throw Error(\"Agent not initialized\");let Q=A.sessionId;if(!Q)throw Error(\"sessionId is required\");let B=await this.getCanUseModels(),D=typeof SU1===\"function\"?SU1(A.mcpServers):{};if(this.registerRuntimeMcpServers)await this.registerRuntimeMcpServers(D);let J=this.sessions.get(Q);if(!J)J=new " + sessionClass + "(Q,this.messageBus,this.connection,this.clientFsCapabilities),this.sessions.set(Q,J),J.defaultCwd=this.defaultCwd,await this.messageBus.request(\"session.initialize\",{cwd:this.defaultCwd,sessionId:Q,source:\"resume\"}),J.listenChunkEvent(),J.initPermission(),setTimeout(()=>{J.initSlashCommand()},0);try{let H=(await this.messageBus.request(\"session.messages.list\",{cwd:this.defaultCwd,sessionId:Q}))?.data?.messages,V=(I)=>{if(typeof I===\"string\")return I;if(Array.isArray(I))return I.map((W)=>{if(typeof W===\"string\")return W;if(!W||typeof W!==\"object\")return\"\";if(typeof W.text===\"string\")return W.text;if(typeof W.content===\"string\")return W.content;if(W.type===\"text\"&&typeof W.value===\"string\")return W.value;return\"\"}).filter(Boolean).join(\"\");if(I&&typeof I===\"object\"){if(typeof I.text===\"string\")return I.text;if(typeof I.content===\"string\")return I.content;if(typeof I.value===\"string\")return I.value}return\"\"};if(Array.isArray(H))for(let I of H){let W=I?.message??I,_=W?.role,z=V(W?.content??W?.uiContent);if(!z)continue;let w=_===\"user\"?\"user_message_chunk\":_===\"assistant\"?\"agent_message_chunk\":\"\";if(w)this.connection.sessionUpdate({sessionId:Q,update:{sessionUpdate:w,content:{type:\"text\",text:z}}})}}catch(H){console.error(\"Failed to replay session history:\",H)}return{configOptions:WMF(B,this.__wmfConfig)}}";
}

function patchMyFlickerBundle(source) {
  const sessionClass = findSessionClass(source);
  source = replaceOnceRegex(
    source,
    /}(class \w+\{connection;sessions=new Map;messageBus;nodeBridge;context;defaultCwd;contextCreateOpts;clientFsCapabilities;)/,
    "}function WMF(A,Q){Q=Q||{};let B=Q.access||\"yolo\",D=Q.effort||\"xhigh\",J=(A?.availableModels||[]).map(($)=>{let Y=$.modelId||$.id||$.value;return Y?{value:Y,name:$.name||Y}:null}).filter(Boolean),$=Q.model||A?.currentModelId||J[0]?.value||\"\",Y=[{id:\"access\",name:\"Access\",category:\"access\",type:\"select\",currentValue:B,options:[{value:\"default\",name:\"Default\"},{value:\"autoEdit\",name:\"Auto Edit\"},{value:\"auto\",name:\"Auto\"},{value:\"yolo\",name:\"Yolo\"},{value:\"plan\",name:\"Plan\"},{value:\"dontAsk\",name:\"Dont Ask\"}]}];if(J.length>0)Y.push({id:\"model\",name:\"Model\",category:\"model\",type:\"select\",currentValue:$,options:J});Y.push({id:\"effort\",name:\"Effort\",category:\"effort\",type:\"select\",currentValue:D,options:[{value:\"low\",name:\"Low\"},{value:\"medium\",name:\"Medium\"},{value:\"high\",name:\"High\"},{value:\"max\",name:\"Max\"},{value:\"xhigh\",name:\"XHigh\"},{value:\"maxOrXhigh\",name:\"Max Or XHigh\"}]});return Y}async function WMFS(A,Q,B){if(!A.messageBus)throw Error(\"Agent not initialized\");A.__wmfConfig={...A.__wmfConfig,[Q]:B};if(Q===\"model\")await A.unstable_setSessionModel({modelId:B});else{let D=Q===\"access\"?\"approvalMode\":Q===\"effort\"?\"thinkingLevel\":Q;await A.messageBus.request(\"config.set\",{cwd:A.defaultCwd,key:D,value:B,isGlobal:!0}),await A.messageBus.request(\"project.clearContext\",{})}let D=await A.getCanUseModels();return{configOptions:WMF(D,A.__wmfConfig)}}$1",
    "flicker config helpers"
  );
  source = replaceOnceRegex(
    source,
    /agentCapabilities:\{\}\}\}async getCanUseModels\(\)/,
    "agentCapabilities:{loadSession:!0}}}async getCanUseModels()",
    "initialize capabilities"
  );
  source = replaceOnceRegex(
    source,
    /\{sessionId:(\w+),models:(\w+)\|\|void 0\}/,
    "{sessionId:$1,configOptions:WMF($2,this.__wmfConfig)}",
    "newSession config options"
  );
  const patchedLoadSession = loadSessionPatchSource(sessionClass);
  const oldLoadSession = replaceOptionalOnce(
    source,
    "loadSession(A){throw Error(\"Method not implemented.\")}",
    patchedLoadSession,
    "loadSession"
  );
  if (oldLoadSession.replaced) {
    source = oldLoadSession.source;
  } else {
    source = replaceOnceRegex(
      source,
      /async loadSession\(A\)\{if\(!this\.messageBus\)throw Error\("Agent not initialized"\);[\s\S]*?\{models:\w+\|\|void 0\}\}(?=async setSessionModelValue\(A\))/,
      patchedLoadSession,
      "loadSession"
    );
  }
  source = replaceOnce(
    source,
    "unstable_resumeSession(A){throw Error(\"Method not implemented.\")}",
    "async unstable_resumeSession(A){return await this.loadSession(A)}",
    "resumeSession"
  );
  source = replaceOnce(
    source,
    "unstable_setSessionConfigOption(A){throw Error(\"Method not implemented.\")}",
    "async unstable_setSessionConfigOption(A){let Q=A.configId,B=A.value;if(!Q)throw Error(\"configId is required\");if(Q===\"model\"||Q===\"access\"||Q===\"effort\")return await WMFS(this,Q,B);throw Error(\"Unsupported config option \"+Q)}",
    "setSessionConfigOption"
  );
  return source;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!isMyFlickerBundle(url)) {
    return result;
  }
  const source = sourceToString(result.source);
  if (!source) {
    return result;
  }
  return { ...result, source: patchMyFlickerBundle(source) };
}
`
