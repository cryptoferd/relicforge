import { authenticate } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { networkPolicy } from '../lib/rf26-networks.js';
import { publicForgeNetwork } from '../lib/rf26-release-preflight.js';
import { effectiveNetworkPolicy, policyPayload, runtimeSettings } from '../lib/founder-policy.js';

export default async function policyRoutes(app){
  app.get('/api/policy/me',{preHandler:authenticate},async request=>
    policyPayload(request.user.wallet,{isFounder:Boolean(request.user.isFounder)}));

  app.get('/api/policy/forge-networks/:chainId/preflight',{preHandler:authenticate},async(request,reply)=>{
    const raw=await networkPolicy(request.params.chainId);
    const effective=await effectiveNetworkPolicy(raw,request.user.wallet,Boolean(request.user.isFounder));
    reply.header('Cache-Control','no-store');
    return {network:publicForgeNetwork(effective),policyMode:effective.founder_mode};
  });

  app.get('/api/public/platform-runtime',async(_request,reply)=>{
    const settings=await runtimeSettings();
    const {rows}=await db.query(`SELECT id,title,body,severity,starts_at,ends_at,updated_at
      FROM founder_announcements WHERE enabled=TRUE
      AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'success' THEN 2 ELSE 3 END,updated_at DESC LIMIT 10`);
    reply.header('Cache-Control','no-store');
    return {maintenanceMode:Boolean(settings.maintenanceMode),announcements:rows.map(row=>({
      id:row.id,title:row.title,body:row.body,severity:row.severity,startsAt:row.starts_at,endsAt:row.ends_at,updatedAt:row.updated_at
    }))};
  });
}
