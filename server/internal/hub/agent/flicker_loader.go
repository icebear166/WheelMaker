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

function patchMyFlickerBundle(source) {
  const sessionMatch = source.match(/let B=await this\.getCanUseModels\(\),D=new (\w+)\(Q,this\.messageBus,this\.connection,this\.clientFsCapabilities\);return this\.sessions\.set\(Q,D\),await D\.init\(\),/);
  if (!sessionMatch) {
    throw new Error("WheelMaker flicker ACP patch failed: session constructor not found");
  }
  const sessionClass = sessionMatch[1];
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
  source = replaceOnce(
    source,
    "{sessionId:Q,models:B||void 0}",
    "{sessionId:Q,configOptions:WMF(B,this.__wmfConfig)}",
    "newSession config options"
  );
  source = replaceOnce(
    source,
    "loadSession(A){throw Error(\"Method not implemented.\")}",
    "async loadSession(A){if(!this.messageBus)throw Error(\"Agent not initialized\");let Q=A.sessionId;if(!Q)throw Error(\"sessionId is required\");let B=await this.getCanUseModels(),D=new " + sessionClass + "(Q,this.messageBus,this.connection,this.clientFsCapabilities);this.sessions.set(Q,D),await this.messageBus.request(\"session.initialize\",{cwd:this.defaultCwd,sessionId:Q,source:\"resume\"}),D.listenChunkEvent(),D.initPermission(),setTimeout(()=>{D.initSlashCommand()},0);try{let J=(await this.messageBus.request(\"session.messages.list\",{cwd:this.defaultCwd,sessionId:Q}))?.data?.messages,$=(Y)=>{if(typeof Y===\"string\")return Y;if(Array.isArray(Y))return Y.map((E)=>{if(typeof E===\"string\")return E;if(!E||typeof E!==\"object\")return\"\";if(typeof E.text===\"string\")return E.text;if(typeof E.content===\"string\")return E.content;if(E.type===\"text\"&&typeof E.value===\"string\")return E.value;return\"\"}).filter(Boolean).join(\"\");if(Y&&typeof Y===\"object\"){if(typeof Y.text===\"string\")return Y.text;if(typeof Y.content===\"string\")return Y.content;if(typeof Y.value===\"string\")return Y.value}return\"\"};if(Array.isArray(J))for(let Y of J){let E=Y?.message??Y,G=E?.role,X=$(E?.content??E?.uiContent);if(!X)continue;let K=G===\"user\"?\"user_message_chunk\":G===\"assistant\"?\"agent_message_chunk\":\"\";if(K)this.connection.sessionUpdate({sessionId:Q,update:{sessionUpdate:K,content:{type:\"text\",text:X}}})}}catch(J){console.error(\"Failed to replay session history:\",J)}return{configOptions:WMF(B,this.__wmfConfig)}}",
    "loadSession"
  );
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
