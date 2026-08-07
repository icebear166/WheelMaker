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
  source = replaceOnceRegex(
    source,
    /}(class \w+\{connection;sessions=new Map;sessionModelMap=new Map;messageBus;nodeBridge;context;defaultCwd;contextCreateOpts;clientFsCapabilities;)/,
    "}function WMFA(A,Q){Q=Q||{};let B=Q.access||\"yolo\";return[{id:\"access\",name:\"Access\",category:\"access\",type:\"select\",currentValue:B,options:[{value:\"default\",name:\"Default\"},{value:\"autoEdit\",name:\"Auto Edit\"},{value:\"auto\",name:\"Auto\"},{value:\"yolo\",name:\"Yolo\"},{value:\"plan\",name:\"Plan\"},{value:\"dontAsk\",name:\"Dont Ask\"}]},...(Array.isArray(A)?A:[])]}async function WMFS(A,Q){if(!A.messageBus)throw Error(\"Agent not initialized\");A.__wmfConfig={...A.__wmfConfig,access:Q};await A.messageBus.request(\"config.set\",{cwd:A.defaultCwd,key:\"approvalMode\",value:Q,isGlobal:!0}),await A.messageBus.request(\"project.clearContext\",{});let B=await A.getCanUseModels();return{configOptions:WMFA(A.buildSessionConfigOptions(B),A.__wmfConfig)}}$1",
    "0.3.14 access config helpers"
  );
  source = replaceMethodOnceRegex(
    source,
    "buildSessionConfigOptions(A){",
    /return Q}/,
    "return WMFA(Q,this.__wmfConfig)}",
    "0.3.14 config options"
  );
  source = replaceMethodOnceRegex(
    source,
    "async unstable_setSessionConfigOption(A){if(!this.messageBus)throw Error(\"Agent not initialized\");",
    /let\{configId:Q,value:B\}=A,\$=this\.sessions\.get\(A\.sessionId\);if\(Q===\"model\"\)/,
    "let{configId:Q,value:B}=A,$=this.sessions.get(A.sessionId);if(Q===\"access\")return await WMFS(this,B);if(Q===\"model\")",
    "0.3.14 access config handler"
  );
  source = replaceOnce(
    source,
    "unstable_resumeSession(A){throw Error(\"Method not implemented.\")}",
    "async unstable_resumeSession(A){return await this.loadSession(A)}",
    "resumeSession"
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
