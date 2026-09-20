const GEMINI_MODEL = "gemini-1.5-flash";
const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const GEMINI_TIMEOUT_MS = 25_000;
const GEMINI_DAILY_LIMIT = 1_450;
const GEMINI_INPUT_NEURONS = 4_119;
const GEMINI_OUTPUT_NEURONS = 34_868;

export async function callGemini(systemPrompt,userPrompt,apiKey,timeoutMs=GEMINI_TIMEOUT_MS){
 if(!apiKey)throw createProviderError("GEMINI_HTTP_401","Gemini API key is not configured.");
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs),startedAt=Date.now();
 try{const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:systemPrompt}]},contents:[{role:"user",parts:[{text:userPrompt}]}],generationConfig:{temperature:.3,maxOutputTokens:4096}}),signal:controller.signal});
 if(!response.ok){if(response.status===429)throw createProviderError("GEMINI_RATE_LIMIT","Gemini rate limit reached.");throw createProviderError(`GEMINI_HTTP_${response.status}`,`Gemini request failed with HTTP ${response.status}.`);}
 const payload=await response.json(),text=extractGeminiText(payload);if(!text)throw createProviderError("GEMINI_EMPTY_RESPONSE","Gemini returned an empty response.");
 const usage=payload.usageMetadata||{},tokensUsed=Number(usage.totalTokenCount)||Number(usage.promptTokenCount||0)+Number(usage.candidatesTokenCount||0);
 return{text,provider:"gemini",model:GEMINI_MODEL,latencyMs:Date.now()-startedAt,tokensUsed:Number.isFinite(tokensUsed)?tokensUsed:0};
 }catch(error){if(error?.name==="AbortError")throw createProviderError("GEMINI_TIMEOUT","Gemini request timed out.");if(error?.code?.startsWith("GEMINI_"))throw error;throw createProviderError("GEMINI_NETWORK_ERROR","Gemini network request failed.");}finally{clearTimeout(timeout);}
}

export async function callWorkersAI(systemPrompt,userPrompt,env){
 if(!env?.AI||typeof env.AI.run!=="function")throw createProviderError("WORKERS_AI_UNAVAILABLE","Workers AI binding is unavailable.");
 const startedAt=Date.now();
 try{const response=await env.AI.run(WORKERS_AI_MODEL,{messages:[{role:"system",content:systemPrompt},{role:"user",content:userPrompt}],max_tokens:4096,temperature:.3}),text=extractWorkersAIText(response);
 if(!text)throw createProviderError("WORKERS_AI_EMPTY_RESPONSE","Workers AI returned an empty response.");
 const inputTokens=Math.ceil(`${systemPrompt}\n${userPrompt}`.length/4),outputTokens=Math.ceil(text.length/4),neuronsUsed=inputTokens*(GEMINI_INPUT_NEURONS/1e6)+outputTokens*(GEMINI_OUTPUT_NEURONS/1e6);
 return{text,provider:"workers-ai",model:WORKERS_AI_MODEL,latencyMs:Date.now()-startedAt,neuronsUsed:Math.max(1,Math.ceil(neuronsUsed))};
 }catch(error){if(error?.code?.startsWith("WORKERS_AI_"))throw error;throw createProviderError("WORKERS_AI_FAILED","Workers AI request failed.");}
}

export async function generateExplanation(text,lang,env,ctx){
 const errors=[],startedAt=Date.now(),systemPrompt=getSystemPrompt(lang),userPrompt=getUserPrompt(text,lang),shouldTryGemini=Boolean(env?.GEMINI_API_KEY)&&await isGeminiQuotaAvailable(env);
 if(shouldTryGemini){try{const result=await callGemini(systemPrompt,userPrompt,env.GEMINI_API_KEY,GEMINI_TIMEOUT_MS);trackGeminiUsage(env,ctx,"success");trackProviderStats(env,ctx,"gemini","success");return{...result,errors,usedFallback:false,totalLatencyMs:Date.now()-startedAt};}catch(error){errors.push({provider:"gemini",error:sanitizeProviderError(error),timestamp:new Date().toISOString()});trackGeminiUsage(env,ctx,"fail");trackProviderStats(env,ctx,"gemini","fail");}}else errors.push({provider:"gemini",error:"SKIPPED_QUOTA_OR_NO_KEY",timestamp:new Date().toISOString()});
 try{const result=await callWorkersAI(systemPrompt,userPrompt,env);trackNeuronsUsage(env,ctx,result.neuronsUsed||1);trackProviderStats(env,ctx,"workers-ai","success");return{...result,errors,usedFallback:true,totalLatencyMs:Date.now()-startedAt};}catch(error){errors.push({provider:"workers-ai",error:sanitizeProviderError(error),timestamp:new Date().toISOString()});trackProviderStats(env,ctx,"workers-ai","fail");}
 return{text:null,provider:"none",model:null,errors,usedFallback:false,fatal:true,totalLatencyMs:Date.now()-startedAt};
}

export function getSystemPrompt(lang){if(lang==="hi")return["You are an expert scientific research-paper explainer.","Explain research papers accurately for an intelligent general audience.","Write the final explanation in Hindi.","Keep established scientific and technical terms in English when translating them would reduce precision.","Do not fabricate experiments, results, citations, authors, numbers, or claims.","Clearly distinguish information present in the supplied paper from reasonable interpretation.","Preserve equations, important terminology, methodology, limitations, and quantitative results.","Use Markdown.","Structure the explanation with clear headings.","Include the research question, background, methodology, main findings, interpretation, limitations, and practical significance when the source provides enough information.","If the supplied text is incomplete, explicitly state which information is unavailable.","Do not claim that you accessed the original paper beyond the supplied text."].join(" ");return["You are an expert scientific research-paper explainer.","Explain research papers accurately for an intelligent general audience.","Write the final explanation in English.","Do not fabricate experiments, results, citations, authors, numbers, or claims.","Clearly distinguish information present in the supplied paper from reasonable interpretation.","Preserve equations, important terminology, methodology, limitations, and quantitative results.","Use Markdown.","Structure the explanation with clear headings.","Include the research question, background, methodology, main findings, interpretation, limitations, and practical significance when the source provides enough information.","If the supplied text is incomplete, explicitly state which information is unavailable.","Do not claim that you accessed the original paper beyond the supplied text."].join(" ");}

export function getUserPrompt(text,lang){return[`Explain the following research paper in ${lang==="hi"?"Hindi":"English"}.`,"","Source paper:","----- BEGIN SOURCE -----",text,"----- END SOURCE -----","","Produce a self-contained Markdown explanation.","Do not invent missing information."].join("\n");}
export async function isGeminiQuotaAvailable(env){if(!env?.KV)return false;try{const usage=await env.KV.get(`usage:gemini:${new Date().toISOString().slice(0,10)}`,"json")||{count:0};return Number(usage.count)<GEMINI_DAILY_LIMIT;}catch{return false;}}
export function trackGeminiUsage(env,ctx,result){if(!env?.KV)return;scheduleBackgroundTask(ctx,async()=>{const key=`usage:gemini:${new Date().toISOString().slice(0,10)}`,data=await env.KV.get(key,"json")||{count:0,success:0,fail:0};if(result==="success"){data.count+=1;data.success+=1;}else data.fail+=1;await env.KV.put(key,JSON.stringify(data),{expirationTtl:604800});});}
export function trackNeuronsUsage(env,ctx,neurons){if(!env?.KV)return;scheduleBackgroundTask(ctx,async()=>{const key=`usage:neurons:${new Date().toISOString().slice(0,10)}`,data=await env.KV.get(key,"json")||{total:0,calls:0};data.total+=Math.max(0,Number(neurons)||0);data.calls+=1;await env.KV.put(key,JSON.stringify(data),{expirationTtl:604800});});}
export function trackProviderStats(env,ctx,provider,result){if(!env?.KV)return;scheduleBackgroundTask(ctx,async()=>{const key="stats:providers",data=await env.KV.get(key,"json")||{gemini:{success:0,fail:0},"workers-ai":{success:0,fail:0},lastUpdated:null};data[provider]??={success:0,fail:0};data[provider][result]+=1;data.lastUpdated=new Date().toISOString();await env.KV.put(key,JSON.stringify(data));});}
function extractGeminiText(p){return(Array.isArray(p?.candidates)?p.candidates:[]).flatMap(c=>Array.isArray(c?.content?.parts)?c.content.parts:[]).map(x=>typeof x?.text==="string"?x.text.trim():"").filter(Boolean).join("\n\n").trim();}
function extractWorkersAIText(r){if(typeof r==="string")return r.trim();if(typeof r?.response==="string")return r.response.trim();if(typeof r?.result?.response==="string")return r.result.response.trim();if(typeof r?.output_text==="string")return r.output_text.trim();return"";}
function createProviderError(code,message){const e=new Error(message);e.code=code;return e;}
function sanitizeProviderError(e){return typeof e?.code==="string"&&(e.code.startsWith("GEMINI_")||e.code.startsWith("WORKERS_AI_"))?e.code:"PROVIDER_FAILED";}
function scheduleBackgroundTask(ctx,task){if(ctx&&typeof ctx.waitUntil==="function")ctx.waitUntil(Promise.resolve().then(task).catch(()=>undefined));}
