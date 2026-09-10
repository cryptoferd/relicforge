import page from '../rf26-mint-route.cjs';

const handler=page.createWebHandler({readTemplate:page.readMintTemplate});

// Web Standard Vercel Function. No database, wallet, or private RPC access.
export default {fetch:handler};
