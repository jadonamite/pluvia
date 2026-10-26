export interface AppConfig {
  sampleMode:boolean; sampleModeReason:string; port:number; contactEmail:string;
  zetaris:{url:string;orgId:string;apiKey:string;contactEmail?:string};
  nightshift:{url:string;runtimeToken:string;model:string};
}
export function loadConfig(env:NodeJS.ProcessEnv=process.env):AppConfig {
  if(env.SAMPLE_MODE!==undefined&&!['true','false'].includes(env.SAMPLE_MODE))throw new Error('SAMPLE_MODE must be true or false');
  const hasCredentials=Boolean(env.ZETARIS_API_KEY?.trim()||env.METERLESS_RUNTIME_TOKEN?.trim());
  const sampleMode=env.SAMPLE_MODE===undefined?!hasCredentials:env.SAMPLE_MODE==='true';
  const sampleModeReason=env.SAMPLE_MODE!==undefined?`Explicit SAMPLE_MODE=${env.SAMPLE_MODE}`:hasCredentials?'Live credentials supplied; automatic sample mode disabled':'No Zetaris or Nightshift credentials supplied; using cached sample evidence';
  const port=Number(env.PORT??8000);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
  return {sampleMode,sampleModeReason,port,contactEmail:env.CONTACT_EMAIL??'',
    zetaris:{url:(env.ZETARIS_REST_URL??'http://localhost:8888/api/v1.0').replace(/\/$/,''),orgId:env.ZETARIS_ORG_ID??'1',apiKey:env.ZETARIS_API_KEY??'',contactEmail:env.CONTACT_EMAIL??''},
    nightshift:{url:(env.METERLESS_BASE_URL??'http://127.0.0.1:8088/v1').replace(/\/$/,''),runtimeToken:env.METERLESS_RUNTIME_TOKEN??'',model:env.METERLESS_MODEL??''}};
}
