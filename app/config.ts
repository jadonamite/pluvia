export interface AppConfig {
  sampleMode:boolean; port:number; contactEmail:string;
  zetaris:{url:string;orgId:string;apiKey:string;contactEmail?:string};
  nightshift:{url:string;runtimeToken:string;model:string};
}
export function loadConfig(env:NodeJS.ProcessEnv=process.env):AppConfig {
  const port=Number(env.PORT??8000);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
  return {sampleMode:env.SAMPLE_MODE==='true',port,contactEmail:env.CONTACT_EMAIL??'',
    zetaris:{url:(env.ZETARIS_REST_URL??'http://localhost:8888/api/v1.0').replace(/\/$/,''),orgId:env.ZETARIS_ORG_ID??'1',apiKey:env.ZETARIS_API_KEY??'',contactEmail:env.CONTACT_EMAIL??''},
    nightshift:{url:(env.METERLESS_BASE_URL??'http://127.0.0.1:8088/v1').replace(/\/$/,''),runtimeToken:env.METERLESS_RUNTIME_TOKEN??'',model:env.METERLESS_MODEL??''}};
}
