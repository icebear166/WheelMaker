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

const flickerBacktick = String.fromCharCode(96);

function findMethodSource(source, signature, label) {
  const start = source.indexOf(signature);
  if (start < 0) {
    throw new Error("WheelMaker flicker ACP patch failed: " + label + " not found");
  }
  let depth = 1;
  let quote = "";
  for (let index = start + signature.length; index < source.length; index++) {
    const ch = source[index];
    if (quote) {
      if (ch === "\\") {
        index++;
        continue;
      }
      if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === flickerBacktick) {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return {
          start,
          end: index + 1,
          source: source.slice(start, index + 1),
        };
      }
    }
  }
  throw new Error("WheelMaker flicker ACP patch failed: " + label + " end not found");
}

function replaceMethodOnceRegex(source, signature, pattern, replacement, label) {
  const method = findMethodSource(source, signature, label);
  const patched = replaceOnceRegex(method.source, pattern, replacement, label);
  return source.slice(0, method.start) + patched + source.slice(method.end);
}

function patchMyFlickerBundle(source) {
  const legacyConfigShape = /models:(\w+)\|\|void 0/.test(source);
  const legacySetConfigStub = source.includes('unstable_setSessionConfigOption(A){throw Error("Method not implemented.")}');
  const isLegacy = legacyConfigShape && legacySetConfigStub;
  if (!isLegacy) {
    // Newer bundles (e.g. @myflicker/cli 0.3.x) build configOptions and implement
    // setSessionConfigOption natively. Only shim the still-missing resume.
    if (source.includes('unstable_resumeSession(A){throw Error("Method not implemented.")}')) {
      source = replaceOnce(
        source,
        "unstable_resumeSession(A){throw Error(\"Method not implemented.\")}",
        "async unstable_resumeSession(A){return await this.loadSession(A)}",
        "resumeSession"
      );
    }
    return source;
  }
  source = replaceOnceRegex(
    source,
    /}(class \w+\{connection;sessions=new Map;messageBus;nodeBridge;context;defaultCwd;contextCreateOpts;clientFsCapabilities;)/,
    "}function WMF(A,Q){Q=Q||{};let B=Q.access||\"yolo\",D=Q.effort||\"xhigh\",J=(A?.availableModels||[]).map(($)=>{let Y=$.modelId||$.id||$.value;return Y?{value:Y,name:$.name||Y}:null}).filter(Boolean),$=Q.model||A?.currentModelId||J[0]?.value||\"\",Y=[{id:\"access\",name:\"Access\",category:\"access\",type:\"select\",currentValue:B,options:[{value:\"default\",name:\"Default\"},{value:\"autoEdit\",name:\"Auto Edit\"},{value:\"auto\",name:\"Auto\"},{value:\"yolo\",name:\"Yolo\"},{value:\"plan\",name:\"Plan\"},{value:\"dontAsk\",name:\"Dont Ask\"}]}];if(J.length>0)Y.push({id:\"model\",name:\"Model\",category:\"model\",type:\"select\",currentValue:$,options:J});Y.push({id:\"effort\",name:\"Effort\",category:\"effort\",type:\"select\",currentValue:D,options:[{value:\"low\",name:\"Low\"},{value:\"medium\",name:\"Medium\"},{value:\"high\",name:\"High\"},{value:\"max\",name:\"Max\"},{value:\"xhigh\",name:\"XHigh\"},{value:\"maxOrXhigh\",name:\"Max Or XHigh\"}]});return Y}async function WMFS(A,Q,B){if(!A.messageBus)throw Error(\"Agent not initialized\");A.__wmfConfig={...A.__wmfConfig,[Q]:B};if(Q===\"model\")await A.unstable_setSessionModel({modelId:B});else{let D=Q===\"access\"?\"approvalMode\":Q===\"effort\"?\"thinkingLevel\":Q;await A.messageBus.request(\"config.set\",{cwd:A.defaultCwd,key:D,value:B,isGlobal:!0}),await A.messageBus.request(\"project.clearContext\",{})}let D=await A.getCanUseModels();return{configOptions:WMF(D,A.__wmfConfig)}}$1",
    "flicker config helpers"
  );
  source = replaceMethodOnceRegex(
    source,
    "async newSession(A){if(!this.messageBus)throw Error(\"Agent not initialized\");",
    /models:(\w+)\|\|void 0/,
    "configOptions:WMF($1,this.__wmfConfig)",
    "newSession config options"
  );
  source = replaceMethodOnceRegex(
    source,
    "async loadSession(A){if(!this.messageBus)throw Error(\"Agent not initialized\");",
    /models:(\w+)\|\|void 0/,
    "configOptions:WMF($1,this.__wmfConfig)",
    "loadSession config options"
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
