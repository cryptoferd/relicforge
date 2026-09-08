import { Contract } from 'ethers';
import { db,one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { providerFor } from '../lib/rpc.js';
import { networkPolicy } from '../lib/rf26-networks.js';
import { createSlugService } from '../lib/rf26-slug-service.js';

// Mounted inside the existing RF26 Fastify plugin. No second server or RPC
// credential is created. All writes reuse Cloud's authenticated EOA session.
export function registerRf26SlugRoutes(app,{verifyV2}) {
  const service=createSlugService({
    db,one,networkPolicy,verifyV2,
    readController:async(id,contract)=>{
      const collection=new Contract(contract,['function controller() view returns(address)'],providerFor(id));
      return collection.controller();
    }
  });
  const params={type:'object',required:['chainId','contract'],additionalProperties:false,
    properties:{chainId:{type:'string',pattern:'^[0-9]{1,16}$'},
      contract:{type:'string',pattern:'^0x[0-9a-fA-F]{40}$'}}};
  const slugParams={type:'object',required:['slug'],additionalProperties:false,
    properties:{slug:{type:'string',minLength:3,maxLength:48}}};
  const authenticated={preHandler:authenticate};
  const noStore=reply=>reply.header('Cache-Control','no-store');

  app.get('/api/rc26/deployments/:chainId/:contract/publication',
    {...authenticated,schema:{params}},async(request,reply)=>{
      noStore(reply);
      return service.getPublication(request.params.chainId,request.params.contract,request.user.wallet);
    });
  app.get('/api/public/mint-slugs/:slug/available',
    {schema:{params:slugParams},config:{rateLimit:{max:60,timeWindow:'1 minute'}}},
    async(request,reply)=>{
      noStore(reply);
      return service.availability(request.params.slug);
    });
  app.put('/api/rc26/deployments/:chainId/:contract/slug',
    {...authenticated,schema:{params,body:{type:'object',required:['slug'],additionalProperties:false,
      properties:{slug:{type:'string',minLength:3,maxLength:48},
        projectId:{type:'string',format:'uuid'}}}}},
    async(request,reply)=>{
      noStore(reply);
      return service.claim(request.params.chainId,request.params.contract,request.user.wallet,request.body);
    });
  app.put('/api/rc26/deployments/:chainId/:contract/publication',
    {...authenticated,schema:{params,body:{type:'object',required:['listed','featureRequested'],
      additionalProperties:false,properties:{listed:{type:'boolean'},featureRequested:{type:'boolean'}}}}},
    async(request,reply)=>{
      noStore(reply);
      return service.setPublication(request.params.chainId,request.params.contract,request.user.wallet,request.body);
    });
  app.get('/api/public/mint-slugs/:slug',
    {schema:{params:slugParams},config:{rateLimit:{max:120,timeWindow:'1 minute'}}},
    async(request,reply)=>{
      noStore(reply);
      try{return await service.resolve(request.params.slug);}
      catch(error){
        if(error.statusCode===404)return reply.code(404).send({error:'Mint page not found.'});
        throw error;
      }
    });
}
